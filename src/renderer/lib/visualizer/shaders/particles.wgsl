// NAR Studio Visualizer — Particle system (compute + render)
// GPU-side 200k particles in a storage buffer.
// Update: compute shader → position/velocity/life each frame
// Render: instanced quads (6 verts) with radial sprite SDF

// ── Particle struct ───────────────────────────────────────────────────────────

struct Particle {
  pos:     vec2f,
  vel:     vec2f,
  life:    f32,    // 0=dead, 1=just spawned; counts down to 0
  maxLife: f32,    // initial life (varies per particle)
  size:    f32,    // NDC half-size of sprite quad
  seed:    f32,    // random seed (frozen at spawn)
}

// ── Shared bind groups ────────────────────────────────────────────────────────

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;

struct ParticleUni {
  colorA:      vec3f,
  _pad0:       f32,
  colorB:      vec3f,
  _pad1:       f32,
  beat:        f32,
  beatStrength: f32,
  dt:          f32,   // delta-time in seconds
  time:        f32,
  bass:        f32,
  rms:         f32,
  aspect:      f32,
  _pad2:       f32,
}
@group(0) @binding(1) var<uniform> u: ParticleUni;

// ── Hash helpers ──────────────────────────────────────────────────────────────

fn hash1(n: f32) -> f32 {
  return fract(sin(n * 127.1 + 311.7) * 43758.5453);
}

fn hash2(n: f32) -> vec2f {
  return vec2f(hash1(n), hash1(n + 1.7));
}

// ── Compute: update particles ─────────────────────────────────────────────────

@compute @workgroup_size(64)
fn cs_update(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&particles)) { return; }

  var p = particles[i];

  if (p.life <= 0.0) {
    // ── Respawn ──────────────────────────────────────────────────────────
    // Spawn on beat + continuous trickle proportional to bass energy
    let spawnProb = 0.03 + u.bass * 0.15 + u.beat * 0.5;
    let r = hash1(p.seed + u.time * 0.001 + f32(i) * 0.0001);
    if (r > spawnProb) { return; }  // stay dead this frame

    let h = hash2(p.seed + u.time * 0.01);
    p.pos     = vec2f(h.x * 2.0 - 1.0, -0.9 + h.y * 0.3);
    let angle = h.x * 3.14159 * 2.0;
    let speed = 0.3 + h.y * 0.7 + u.beatStrength * 0.8;
    p.vel     = vec2f(cos(angle) * speed * 0.02, sin(angle) * speed * 0.04 + 0.01);
    p.life    = 0.5 + hash1(p.seed * 13.1) * 1.5;
    p.maxLife = p.life;
    p.size    = 0.003 + hash1(p.seed * 7.3) * 0.008;
    p.seed    = hash1(p.seed + 1.0);  // advance seed
  } else {
    // ── Update live particle ─────────────────────────────────────────────
    // Gravity + turbulence
    let turb = hash2(p.seed + u.time * 2.3 + f32(i) * 0.00003);
    p.vel.x += (turb.x - 0.5) * 0.002;
    p.vel.y -= 0.00015;  // gentle gravity
    p.vel   *= 0.995;    // drag

    // Beat kick — impulse upward on onset
    if (u.beat > 0.5) {
      p.vel.y += 0.015 * u.beatStrength;
    }

    p.pos  += p.vel * u.dt * 60.0;  // normalise to 60fps
    p.life -= u.dt / p.maxLife;
    p.life  = max(0.0, p.life);
  }

  particles[i] = p;
}

// ── Render: vertex shader ─────────────────────────────────────────────────────

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) vUV:       vec2f,   // [-1,1] from sprite centre
  @location(1) vLife:     f32,
  @location(2) vSpeed:    f32,
}

@vertex
fn vs_render(
  @builtin(instance_index) inst:   u32,
  @builtin(vertex_index)   vertex: u32,
) -> VsOut {
  let p = particles[inst];

  // Degenerate quad for dead particles (zero area, off screen)
  if (p.life <= 0.0) {
    var o: VsOut;
    o.pos = vec4f(-2.0, -2.0, 0.0, 1.0);
    o.vUV = vec2f(0.0);
    o.vLife = 0.0;
    o.vSpeed = 0.0;
    return o;
  }

  // Quad corners in sprite-local space [-1,1]
  var uvs = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f( 1.0, -1.0), vec2f( 1.0,  1.0),
    vec2f(-1.0, -1.0), vec2f( 1.0,  1.0), vec2f(-1.0,  1.0),
  );

  let uv     = uvs[vertex];
  let lifeNorm = p.life;
  let size   = p.size * (0.8 + lifeNorm * 0.4) * (1.0 + u.beatStrength * 0.3);
  let worldPos = p.pos + uv * vec2f(size, size * u.aspect);

  var o: VsOut;
  o.pos    = vec4f(worldPos, 0.0, 1.0);
  o.vUV    = uv;
  o.vLife  = lifeNorm;
  o.vSpeed = length(p.vel);
  return o;
}

// ── Render: fragment shader ───────────────────────────────────────────────────

@fragment
fn fs_render(in: VsOut) -> @location(0) vec4f {
  // Radial SDF
  let dist = dot(in.vUV, in.vUV);  // squared distance from sprite centre
  if (dist > 1.0) { discard; }

  let d = sqrt(dist);

  // Layered glow profile (same as CHROMATIC particles.frag)
  let core = pow(max(0.0, 1.0 - d * 4.0), 0.5);
  let body = pow(max(0.0, 1.0 - d), 1.5);

  // Age-based colour: newborn = colorA, old = colorB
  let bodyCol = mix(u.colorA, u.colorB, 1.0 - in.vLife);
  let coreCol = mix(bodyCol, vec3f(2.0, 2.0, 2.2), 0.8);

  // Speed tint — fast particles streak white
  let speedFactor = clamp(in.vSpeed * 0.5, 0.0, 1.0);
  let tintedBody  = mix(bodyCol, vec3f(1.4, 1.2, 1.6), speedFactor * 0.3);

  var col = coreCol * core + tintedBody * body;

  // Beat flash
  col += vec3f(u.beatStrength * core * 3.0);
  col += tintedBody * u.beatStrength * body * 1.2;

  // Lifetime fade
  col *= in.vLife;
  let alpha = body * in.vLife * 0.9;

  // HDR output — no clamp; bloom turns bright particles into lens halos
  return vec4f(col, alpha);
}
