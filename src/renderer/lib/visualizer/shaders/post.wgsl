// NAR Studio Visualizer — Post-process compute shader (WGSL)
// Ported from CHROMATIC post.comp.glsl
//
// Pipeline:
//   Lens distortion → chromatic aberration → bloom composite → saturation
//   → ACES tonemap → sRGB encode → vignette → film grain → dither → RGBA8

@group(0) @binding(0) var outImage:      texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(1) var sceneHDR:      texture_2d<f32>;
@group(0) @binding(2) var bloomTex:      texture_2d<f32>;
@group(0) @binding(3) var linearSampler: sampler;

struct PostParams {
  imageSize:        vec2f,
  bloomStrength:    f32,   // 0.15
  bloomDirt:        f32,   // 0.0 (reserved)
  vignetteStrength: f32,   // 0.32
  aberrationBase:   f32,   // 0.0008
  aberrationBeat:   f32,   // 0.009
  beatStrength:     f32,   // 0..1
  grainStrength:    f32,   // 0.012
  exposure:         f32,   // 1.10
  lensDistortion:   f32,   // 0.012
  saturation:       f32,   // 1.15
  time:             f32,
  _pad0: f32, _pad1: f32, _pad2: f32,
}
@group(1) @binding(0) var<uniform> p: PostParams;

// ── Colour science ────────────────────────────────────────────────────────────

fn ACESFilm(x: vec3f) -> vec3f {
  let a = 2.51f;
  let b = 0.03f;
  let c = 2.43f;
  let d = 0.59f;
  let e = 0.14f;
  return clamp((x*(a*x+b)) / (x*(c*x+d)+e), vec3f(0.0), vec3f(1.0));
}

fn linearToSRGB(c: vec3f) -> vec3f {
  // IEC 61966-2-1 piecewise
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0/2.4)) - 0.055;
  return select(hi, lo, c < vec3f(0.0031308));
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn adjustSaturation(col: vec3f, sat: f32) -> vec3f {
  return mix(vec3f(luminance(col)), col, sat);
}

// ── Lens distortion ───────────────────────────────────────────────────────────

fn lensDistort(uv: vec2f, k: f32) -> vec2f {
  let pt = uv - 0.5;
  let r2 = dot(pt, pt);
  return 0.5 + pt * (1.0 + k * r2);
}

// ── Noise / grain ─────────────────────────────────────────────────────────────

fn gradientNoise(uv: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(uv, vec2f(0.06711056, 0.00583715))));
}

fn filmGrain(uv: vec2f, t: f32) -> f32 {
  let a = fract(sin(dot(uv * 1000.0 + t, vec2f(127.1, 311.7))) * 43758.5453);
  let b = fract(sin(dot(uv * 1000.0 - t, vec2f(269.5, 183.3))) * 12345.6789);
  return (a + b) * 0.5 - 0.5;
}

// ── Vignette ──────────────────────────────────────────────────────────────────

fn vignette(uv: vec2f, strength: f32) -> f32 {
  let pt = uv - 0.5;
  let d  = length(pt * vec2f(1.0, p.imageSize.y / p.imageSize.x));
  let v  = 1.0 - smoothstep(0.25, 0.85, d);
  return mix(1.0, v, strength);
}

// ── Main ──────────────────────────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn cs_main(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(id.xy);
  if (coord.x >= i32(p.imageSize.x) || coord.y >= i32(p.imageSize.y)) { return; }

  let uv = (vec2f(coord) + 0.5) / p.imageSize;

  // 1. Lens distortion — beat-reactive pulse
  let distK  = p.lensDistortion + p.beatStrength * 0.01;
  let distUV = lensDistort(uv, distK);

  // 2. Chromatic aberration — radial RGB channel split
  let ca     = p.aberrationBase + p.aberrationBeat * p.beatStrength;
  let caDir  = normalize(uv - 0.5 + 1e-6);
  let caEdge = length(uv - 0.5) * 2.0;

  let r = textureSampleLevel(sceneHDR, linearSampler, lensDistort(uv, distK) + caDir * ca * caEdge, 0.0).r;
  let g = textureSampleLevel(sceneHDR, linearSampler, distUV, 0.0).g;
  let b = textureSampleLevel(sceneHDR, linearSampler, lensDistort(uv, distK) - caDir * ca * caEdge, 0.0).b;

  var hdr = vec3f(r, g, b) * p.exposure;

  // 3. Bloom composite — additive, with subtle CA on bloom too
  let bloomCA = ca * 0.3;
  let br = textureSampleLevel(bloomTex, linearSampler, distUV + caDir * bloomCA * caEdge, 0.0).r;
  let bg = textureSampleLevel(bloomTex, linearSampler, distUV, 0.0).g;
  let bb = textureSampleLevel(bloomTex, linearSampler, distUV - caDir * bloomCA * caEdge, 0.0).b;
  hdr += vec3f(br, bg, bb) * p.bloomStrength;

  // 4. Saturation
  hdr = adjustSaturation(hdr, p.saturation);

  // 5. ACES filmic tonemap (HDR → LDR)
  var ldr = ACESFilm(hdr);

  // 6. sRGB gamma encode
  ldr = linearToSRGB(ldr);

  // 7. Vignette (in perceptual space)
  ldr *= vignette(uv, p.vignetteStrength);

  // 8. Film grain (temporal — changes every frame)
  ldr += filmGrain(uv, p.time * 0.037) * p.grainStrength;

  // 9. Gradient noise dither (sub-LSB — kills 8-bit banding on broadcast monitors)
  ldr += (gradientNoise(vec2f(coord) + p.time * 7.3) * 2.0 - 1.0) * (0.5 / 255.0);

  // 10. Write RGBA8
  ldr = clamp(ldr, vec3f(0.0), vec3f(1.0));
  textureStore(outImage, coord, vec4f(ldr, 1.0));
}
