// NAR Studio Visualizer — Fullscreen blit
// Copies the post-processed RGBA8 texture to the canvas surface.
// Uses a single oversized triangle (covers NDC [-1..3] x [-1..3]) — no VBO needed.

@group(0) @binding(0) var outTex:    texture_2d<f32>;
@group(0) @binding(1) var outSampler: sampler;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0)       uv:  vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VsOut {
  // Single triangle: vertices at (-1,-1), (3,-1), (-1,3)
  // Covers the entire clip space with one draw call, no index buffer.
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  let uvs = array<vec2f, 3>(
    vec2f(0.0, 1.0),
    vec2f(2.0, 1.0),
    vec2f(0.0, -1.0),
  );

  var o: VsOut;
  o.pos = vec4f(positions[vid], 0.0, 1.0);
  o.uv  = uvs[vid];
  return o;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  return textureSample(outTex, outSampler, in.uv);
}
