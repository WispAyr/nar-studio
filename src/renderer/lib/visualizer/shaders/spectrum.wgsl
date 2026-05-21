// NAR Studio Visualizer — Spectrum bars (vertex + fragment)
// Instanced rendering: 64 instances × 6 vertices = 128 tris
// HDR neon profile: white-hot cubic core + exponential coloured halo.
// No clamp at output — bloom in post.wgsl creates the glow halos.

// ── Bind groups ───────────────────────────────────────────────────────────────

@group(0) @binding(0) var<storage, read> bandHeights: array<f32>;  // 64 values, 0..1

struct SpectrumUni {
  colorLow:  vec3f,
  _pad0:     f32,
  colorHigh: vec3f,
  _pad1:     f32,
  glow:      f32,   // 0.5 + beatStrength*0.5
  beat:      f32,   // beatStrength 0..1
  aspect:    f32,
  _pad2:     f32,
}
@group(0) @binding(1) var<uniform> u: SpectrumUni;

// ── Vertex ────────────────────────────────────────────────────────────────────

struct VsOut {
  @builtin(position) pos:      vec4f,
  @location(0)       vV:       f32,   // 0=bottom, 1=tip
  @location(1)       vBandNorm: f32,  // 0=bass, 1=treble
}

// NDC extent of the spectrum
const X_MIN  = -0.95f;
const X_MAX  =  0.95f;
const Y_BASE = -0.85f;
const Y_MAX  =  0.85f;
const BANDS  = 64u;

@vertex
fn vs_main(
  @builtin(instance_index) band:   u32,
  @builtin(vertex_index)   vertex: u32,
) -> VsOut {
  let totalW = X_MAX - X_MIN;
  let barW   = totalW / f32(BANDS);
  let gap    = barW * 0.15;
  let height = bandHeights[band] * (Y_MAX - Y_BASE);

  let x0 = X_MIN + f32(band) * barW + gap * 0.5;
  let x1 = x0 + barW - gap;
  let y0 = Y_BASE;
  let y1 = Y_BASE + max(height, 0.002);

  // 6-vertex quad (two triangles), CCW
  var xs = array<f32, 6>(x0, x1, x1,  x0, x1, x0);
  var ys = array<f32, 6>(y0, y0, y1,  y0, y1, y1);
  var vs = array<f32, 6>(0f, 0f, 1f,  0f, 1f, 1f);

  var o: VsOut;
  o.pos       = vec4f(xs[vertex], ys[vertex], 0.0, 1.0);
  o.vV        = vs[vertex];
  o.vBandNorm = f32(band) / f32(BANDS - 1u);
  return o;
}

// ── Fragment ──────────────────────────────────────────────────────────────────

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let baseColor = mix(u.colorLow, u.colorHigh, in.vBandNorm);

  // Cubic core — white-hot at tip, dark at base
  let core = pow(in.vV, 3.0) * 3.0;

  // Exponential halo — the tube's emissive body, coloured
  let halo = exp(-3.5 * (1.0 - in.vV)) * 1.5;

  // Core bleaches toward white (hot emitter)
  let coreCol = mix(baseColor, vec3f(1.6, 1.6, 1.6), 0.7);

  // Halo: base brand colour, slight cool shift
  let haloCol = baseColor * vec3f(0.5, 0.7, 1.1);

  var col = coreCol * core + haloCol * halo;

  // Beat flash — tip blazes white on transient
  col += vec3f(u.beat * pow(in.vV, 2.0) * 2.0);

  // Energy modulation
  col *= (0.7 + u.glow * 1.0);

  // Base reflection (wet floor — faint bleed at very bottom of bar)
  col += baseColor * (1.0 - in.vV) * (1.0 - in.vV) * 0.18;

  // HDR output — do NOT clamp; bloom picks up the hot pixels
  return vec4f(col, 1.0);
}
