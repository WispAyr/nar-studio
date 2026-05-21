// NAR Studio Visualizer — Waveform line (vertex + fragment)
// 255 instanced quads, each covering one segment between adjacent PCM samples.
// WebGPU has no variable line width, so each segment is a screen-space quad
// with thickness — HDR output means bloom creates the glow.

@group(0) @binding(0) var<storage, read> waveform: array<f32>;  // 256 samples, -1..1

struct WaveformUni {
  color:     vec3f,
  _pad0:     f32,
  beat:      f32,
  thickness: f32,   // NDC half-thickness, ~0.004
  aspect:    f32,
  _pad1:     f32,
}
@group(0) @binding(1) var<uniform> u: WaveformUni;

// ── Vertex ────────────────────────────────────────────────────────────────────

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) vT:        f32,    // 0=left sample, 1=right sample
  @location(1) vSide:     f32,    // -1=bottom edge, +1=top edge
}

const SAMPLES = 256u;
const X_MIN   = -0.9f;
const X_MAX   =  0.9f;
const Y_SCALE =  0.4f;  // waveform amplitude in NDC

@vertex
fn vs_main(
  @builtin(instance_index) seg:    u32,
  @builtin(vertex_index)   vertex: u32,
) -> VsOut {
  let segCount = SAMPLES - 1u;
  let dx = (X_MAX - X_MIN) / f32(segCount);

  let i0 = seg;
  let i1 = seg + 1u;
  let x0 = X_MIN + f32(i0) * dx;
  let x1 = X_MIN + f32(i1) * dx;
  let y0 = waveform[i0] * Y_SCALE;
  let y1 = waveform[i1] * Y_SCALE;

  // Segment direction + normal (in NDC, corrected for aspect)
  let dir    = normalize(vec2f(x1 - x0, (y1 - y0) / u.aspect));
  let normal = vec2f(-dir.y * u.aspect, dir.x);

  let thick = u.thickness * (1.0 + u.beat * 0.5);

  // 6-vertex quad: TL, TR, BL, TR, BR, BL
  var xs   = array<f32, 6>(x0, x1, x0,  x1, x1, x0);
  var ys   = array<f32, 6>(y0, y1, y0,  y1, y1, y0);
  var ts   = array<f32, 6>(0f, 1f, 0f,  1f, 1f, 0f);
  var side = array<f32, 6>(1f, 1f,-1f,  1f,-1f,-1f);

  let offset = normal * thick * side[vertex];

  var o: VsOut;
  o.pos   = vec4f(xs[vertex] + offset.x, ys[vertex] + offset.y, 0.0, 1.0);
  o.vT    = ts[vertex];
  o.vSide = side[vertex];
  return o;
}

// ── Fragment ──────────────────────────────────────────────────────────────────

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  // Soft edge falloff — bright centre, fades at edges
  let edgeFade = 1.0 - abs(in.vSide);
  let glowCore = pow(edgeFade, 0.5) * 2.2;
  let col = u.color * glowCore + vec3f(1.5, 1.5, 1.8) * glowCore * 0.3;

  // Beat flash
  let finalCol = col + vec3f(u.beat * edgeFade * 1.5);

  // Alpha — used for alpha-blend into HDR FBO
  let alpha = clamp(edgeFade * 1.4, 0.0, 1.0);

  return vec4f(finalCol, alpha);
}
