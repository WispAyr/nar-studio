// NAR Studio Visualizer — Bloom compute shader (WGSL)
// Ported from CHROMATIC bloom.comp.glsl
// Jimenez dual-kawase + Karis average anti-flicker + Eero Mutka firefly clamp
//
// Two entry points: cs_down (downsample / threshold) + cs_up (upsample + accumulate)
// Engine dispatches each pass with the appropriate pipeline + bind groups.

// ── Bind group 0: textures (swapped per pass) ────────────────────────────────

// cs_down: dst = bloom_down[i]  src = bloom_down[i-1] or sceneHDR
// cs_up:   dst = bloom_up[i]    src = bloom_up[i+1] (or bloom_down[5] for first up)
//                               accum = bloom_down[i]  (downsampled content to add back)

@group(0) @binding(0) var dst:          texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var src:          texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var accum:        texture_2d<f32>;  // upsample only

// ── Bind group 1: per-pass parameters ────────────────────────────────────────

struct BloomParams {
  srcSize:   vec2f,
  dstSize:   vec2f,
  threshold: f32,
  radius:    f32,
  isFirst:   f32,   // 1.0 on pass 0 (apply karis + threshold), 0.0 otherwise
  _pad:      f32,
}
@group(1) @binding(0) var<uniform> p: BloomParams;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn luminance(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn karisAvg(a: vec3f, b: vec3f, c: vec3f, d: vec3f) -> vec3f {
  let wa = 1.0 / (1.0 + luminance(a));
  let wb = 1.0 / (1.0 + luminance(b));
  let wc = 1.0 / (1.0 + luminance(c));
  let wd = 1.0 / (1.0 + luminance(d));
  return (a*wa + b*wb + c*wc + d*wd) / (wa + wb + wc + wd);
}

fn sampleSrc(uv: vec2f) -> vec3f {
  return textureSampleLevel(src, linearSampler, uv, 0.0).rgb;
}

fn downsample13(uv: vec2f, texel: vec2f) -> vec3f {
  let m  = sampleSrc(uv);
  let tl = sampleSrc(uv + texel * vec2f(-0.5, -0.5));
  let tr = sampleSrc(uv + texel * vec2f( 0.5, -0.5));
  let bl = sampleSrc(uv + texel * vec2f(-0.5,  0.5));
  let br = sampleSrc(uv + texel * vec2f( 0.5,  0.5));
  let l  = sampleSrc(uv + texel * vec2f(-1.0,  0.0));
  let r  = sampleSrc(uv + texel * vec2f( 1.0,  0.0));
  let t  = sampleSrc(uv + texel * vec2f( 0.0, -1.0));
  let b  = sampleSrc(uv + texel * vec2f( 0.0,  1.0));
  let c00 = sampleSrc(uv + texel * vec2f(-1.0, -1.0));
  let c10 = sampleSrc(uv + texel * vec2f( 1.0, -1.0));
  let c01 = sampleSrc(uv + texel * vec2f(-1.0,  1.0));
  let c11 = sampleSrc(uv + texel * vec2f( 1.0,  1.0));
  return m  * 0.125
    + (tl+tr+bl+br) * 0.125
    + (l+r+t+b)     * 0.03125
    + (c00+c10+c01+c11) * 0.03125;
}

fn upsample9(uv: vec2f, texel: vec2f, r: f32) -> vec3f {
  var result = vec3f(0.0);
  result += sampleSrc(uv + texel * r * vec2f(-1.0, -1.0)) * (1.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f( 0.0, -1.0)) * (2.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f( 1.0, -1.0)) * (1.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f(-1.0,  0.0)) * (2.0/16.0);
  result += sampleSrc(uv                                 ) * (4.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f( 1.0,  0.0)) * (2.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f(-1.0,  1.0)) * (1.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f( 0.0,  1.0)) * (2.0/16.0);
  result += sampleSrc(uv + texel * r * vec2f( 1.0,  1.0)) * (1.0/16.0);
  return result;
}

// ── Downsample entry point ────────────────────────────────────────────────────

@compute @workgroup_size(8, 8)
fn cs_down(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(id.xy);
  if (coord.x >= i32(p.dstSize.x) || coord.y >= i32(p.dstSize.y)) { return; }

  let uv    = (vec2f(coord) + 0.5) / p.dstSize;
  let texel = 1.0 / p.srcSize;

  var result: vec3f;

  if (p.isFirst > 0.5) {
    // Pass 0: threshold extract with Karis avg + Eero Mutka firefly clamp
    let t = texel;
    var a = sampleSrc(uv + t * vec2f(-0.5, -0.5));
    var b = sampleSrc(uv + t * vec2f( 0.5, -0.5));
    var c = sampleSrc(uv + t * vec2f(-0.5,  0.5));
    var d = sampleSrc(uv + t * vec2f( 0.5,  0.5));

    // Firefly clamp before Karis — prevents single hot pixels from dominating 5 mip levels
    a = min(a, vec3f(3.0));
    b = min(b, vec3f(3.0));
    c = min(c, vec3f(3.0));
    d = min(d, vec3f(3.0));

    result = karisAvg(a, b, c, d);

    // Soft-knee threshold
    let lum  = luminance(result);
    let knee = p.threshold * 0.5;
    let rq   = clamp(lum - p.threshold + knee, 0.0, 2.0 * knee);
    let rq2  = (rq * rq) / (4.0 * knee + 1e-5);
    result  *= max(rq2, lum - p.threshold) / max(lum, 1e-5);
  } else {
    // Pass 1+: plain 13-tap downsample
    result = downsample13(uv, texel);
  }

  textureStore(dst, coord, vec4f(result, 1.0));
}

// ── Upsample + accumulate entry point ────────────────────────────────────────
// dst    = bloom_up[i]
// src    = bloom_up[i+1] (or bloom_down[LEVELS-1] for the first upsample)
// accum  = bloom_down[i]  (the scene's contribution at this resolution)

@compute @workgroup_size(8, 8)
fn cs_up(@builtin(global_invocation_id) id: vec3u) {
  let coord = vec2i(id.xy);
  if (coord.x >= i32(p.dstSize.x) || coord.y >= i32(p.dstSize.y)) { return; }

  let uv    = (vec2f(coord) + 0.5) / p.dstSize;
  let texel = 1.0 / p.srcSize;

  let up   = upsample9(uv, texel, p.radius);
  let base = textureSampleLevel(accum, linearSampler, uv, 0.0).rgb;

  textureStore(dst, coord, vec4f(base + up * 0.5, 1.0));
}
