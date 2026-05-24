// GLSL ES 3.00 — multi-pass audio-reactive visualizer.
//
// Pipeline:  scene (with frame-feedback) → bright-pass → blur ×4 → composite.
// The scene shader carries 26 modes branched by uMode — geometric neon looks,
// artistic flow fields, raymarched 3D, and broadcast meters.

export const VERT_SRC = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

// ── Scene pass ──────────────────────────────────────────────────────────────
export const SCENE_FRAG = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2  uRes;
uniform float uTime;
uniform float uLevel, uBass, uMid, uTreble, uBeat;
uniform float uVuL, uVuR, uVuPeakL, uVuPeakR;
uniform float uCentroid, uBeatPhase;
uniform int   uMode, uPalette;
uniform sampler2D uSpectrum;
uniform sampler2D uSpecPeak;
uniform sampler2D uWave;
uniform sampler2D uScope;
uniform sampler2D uPrev;
uniform sampler2D uLogo;
uniform sampler2D uCam0;
uniform sampler2D uCam1;
uniform sampler2D uCam2;
uniform sampler2D uCam3;
uniform int uCamPick;
uniform float uBpm;
uniform float uBarPhase;
uniform float uBpmLocked;
uniform float uTimeH;
uniform float uTimeM;
uniform float uTimeS;
uniform float uCountdown;
uniform float uCountdownDuration;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p * 2.0 + 1.7; a *= 0.5; }
  return v;
}

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Curated five-stop colour ramps — deep graded shadow → luminous highlight,
// within a controlled hue family. Replaces cosine palettes (the rainbow look).
vec3 ramp(float t, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4) {
  t = clamp(t, 0.0, 0.99999) * 4.0;
  float seg = floor(t);
  float f = t - seg;
  f = f * f * (3.0 - 2.0 * f);
  vec3 a = seg < 1.0 ? c0 : seg < 2.0 ? c1 : seg < 3.0 ? c2 : c3;
  vec3 b = seg < 1.0 ? c1 : seg < 2.0 ? c2 : seg < 3.0 ? c3 : c4;
  return mix(a, b, f);
}
vec3 palette(float t) {
  if (uPalette == 0) return ramp(t,                                  // NAR Ember
    vec3(0.045,0.020,0.035), vec3(0.270,0.045,0.060), vec3(0.898,0.125,0.169),
    vec3(0.969,0.576,0.118), vec3(1.000,0.929,0.792));
  if (uPalette == 1) return ramp(t,                                  // Neon
    vec3(0.024,0.020,0.078), vec3(0.102,0.063,0.337), vec3(0.216,0.216,0.831),
    vec3(0.275,0.667,0.973), vec3(0.855,0.953,1.000));
  if (uPalette == 2) return ramp(t,                                  // Emerald
    vec3(0.012,0.051,0.047), vec3(0.027,0.180,0.157), vec3(0.055,0.490,0.337),
    vec3(0.408,0.847,0.451), vec3(0.886,1.000,0.851));
  if (uPalette == 3) return ramp(t,                                  // Ice
    vec3(0.020,0.039,0.090), vec3(0.063,0.157,0.302), vec3(0.204,0.451,0.659),
    vec3(0.553,0.804,0.949), vec3(0.953,0.992,1.000));
  if (uPalette == 4) return ramp(t,                                  // Sunset
    vec3(0.063,0.020,0.102), vec3(0.322,0.063,0.220), vec3(0.784,0.180,0.282),
    vec3(0.984,0.553,0.204), vec3(1.000,0.922,0.659));
  return ramp(t,                                                     // Mono
    vec3(0.020,0.020,0.027), vec3(0.133,0.137,0.157), vec3(0.380,0.392,0.420),
    vec3(0.702,0.714,0.745), vec3(0.980,0.992,1.000));
}

float spec(float x) { return texture(uSpectrum, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float specPeak(float x) { return texture(uSpecPeak, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
float wave(float x) { return texture(uWave, vec2(clamp(x, 0.0, 1.0), 0.5)).r; }
// Stereo scope sample — .x = left, .y = right, each in -1..1.
vec2 scope(float x) { return texture(uScope, vec2(clamp(x, 0.0, 1.0), 0.5)).rg * 2.0 - 1.0; }

// Glowing-neon line profile — bright core, smooth halo. d = signed distance.
float neon(float d, float w) {
  float g = w / (abs(d) + w);
  return g * g * (0.5 + 0.8 * g * g * g * g);
}

// Animated node position (0..1) for a plexus grid cell.
vec2 cellPoint(vec2 id) {
  float h1 = hash21(id);
  float h2 = hash21(id + 7.3);
  return vec2(0.5 + 0.38 * sin(uTime * 0.5 + h1 * 6.2831853),
              0.5 + 0.38 * cos(uTime * 0.45 + h2 * 6.2831853));
}
// Distance from point p to the segment a-b.
float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

float sdBox(vec3 p, vec3 b) {
  vec3 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}

// ── Mode 0: Nebula ──────────────────────────────────────────────────────────
vec3 mNebula(vec2 uv) {
  float t = uTime * 0.09;
  vec2 p = uv * (1.55 - 0.32 * uBass);
  p *= rot(t * 0.5 + uBeat * 0.15);
  vec2 q = vec2(fbm(p + t), fbm(p - t + 5.2));
  vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + 0.15 * t),
                fbm(p + 2.0 * q + vec2(8.3, 2.8) - 0.12 * t));
  float f = fbm(p + 3.0 * r + t);
  vec3 col = palette(f + 0.35 * length(r) + 0.25 * uMid + uTreble * 0.2);
  col *= 0.5 + 0.95 * f;
  col = mix(col, col * col * 1.5, 0.45);
  float d = length(uv);
  col += palette(0.05 + 0.4 * uBass) * exp(-d * (2.6 - 1.5 * uBass)) * (0.5 + 1.7 * uBass + 1.3 * uBeat);
  return col * (1.05 + 0.16 * uBeat);
}

// ── Raymarched neon tunnel — shared by Tunnel (round) and Hex ────────────────
// A camera flies along a curving centreline through a panelled tunnel: the
// panels emit the spectrum, the seams glow as neon, rings fly past on the beat
// and a light pulse sweeps the length. shape 0 = round, 1 = hexagonal.
vec2 tunPath(float z) {
  return vec2(sin(z * 0.21) * 0.55 + sin(z * 0.110 + 1.3) * 0.30,
              cos(z * 0.17) * 0.45 + sin(z * 0.130 + 0.7) * 0.28);
}
float tunCross(vec2 q, float shape) {
  vec2 aq = abs(q);
  float hex = max(aq.x * 0.866025 + aq.y * 0.5, aq.y);
  return mix(length(q), hex, shape);
}
vec3 tunnelScene(vec2 uv, float shape) {
  // Steady forward flight; bass surges and the beat lurches the camera onward.
  // A bounded offset — never uTime*speed, which would jump when the speed changes.
  float camZ = uTime * 3.2 + 1.4 * uBass + 1.0 * uBeat;

  // camera on the centreline, aimed down the path so it banks into the curves
  vec3 ro = vec3(tunPath(camZ), camZ);
  vec3 fwd = normalize(vec3(tunPath(camZ + 2.2), camZ + 2.2) - ro);
  vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 upv = cross(fwd, rgt);
  vec3 rd = normalize(uv.x * rgt + uv.y * upv + fwd * 1.45);

  // march the tunnel interior — step by the distance to the wall
  float t = 0.0;
  for (int i = 0; i < 88; i++) {
    vec3 p = ro + rd * t;
    float radius = 1.05 + 0.16 * sin(p.z * 0.35) + 0.30 * uBass;
    float wall = radius - tunCross(p.xy - tunPath(p.z), shape);
    if (wall < 0.004) break;
    t += max(0.02, wall * 0.72);
    if (t > 46.0) break;
  }

  vec3 p = ro + rd * t;
  vec2 q = p.xy - tunPath(p.z);
  float theta = atan(q.y, q.x);

  // panel grid — cells around the circumference and along the length
  float around = mix(24.0, 18.0, shape);
  vec2 cell = vec2(theta / 6.2831853 * around, p.z * 1.15);
  vec2 cid = floor(cell);
  vec2 cf  = fract(cell);
  float edgeX = min(cf.x, 1.0 - cf.x);
  float edgeY = min(cf.y, 1.0 - cf.y);

  // glowing neon seams + spectrum-emitting panel faces
  float seam = neon(edgeX - 0.015, 0.05) + neon(edgeY - 0.015, 0.05);
  float panelFace = smoothstep(0.07, 0.26, edgeX) * smoothstep(0.07, 0.26, edgeY);
  float bandX = abs(fract(cid.x / around) * 2.0 - 1.0);
  float emis = pow(spec(bandX), 1.3) * (0.45 + 0.85 * hash21(cid));

  // rings flying toward the camera
  float ring = neon(fract(p.z * 0.42) - 0.5, 0.045 + 0.05 * uBeat);
  float ringAmp = spec(fract(floor(p.z * 0.42) * 0.13));

  vec3 col = vec3(0.0);
  col += palette(0.12) * panelFace * (0.05 + 0.12 * uLevel);            // faint wall fill
  col += palette(0.26 + 0.46 * emis) * panelFace * emis * 2.4;          // panel emission
  col += palette(0.58) * seam * (0.45 + 1.0 * uTreble);                 // neon seams
  col += palette(0.32 + 0.5 * ringAmp) * ring * (0.5 + 2.4 * ringAmp);  // flying rings

  // a bright pulse of light sweeping down the tunnel
  float pulse = exp(-pow((fract(p.z * 0.11 - uTime * 0.35) - 0.5) * 4.5, 2.0));
  col += palette(0.85) * pulse * panelFace * (0.25 + 0.7 * uLevel);

  // depth fog, then a hot glow at the vanishing point dead ahead
  col *= exp(-t * 0.085);
  col += palette(0.95) * pow(max(0.0, dot(rd, fwd)), 7.0)
         * (0.35 + 1.5 * uBass + 1.0 * uBeat);

  return col * (0.9 + 0.4 * uLevel);
}

// ── Mode 1: Tunnel — raymarched round neon tunnel ───────────────────────────
vec3 mTunnel(vec2 uv) { return tunnelScene(uv, 0.0); }

// ── Mode 2: Aurora ──────────────────────────────────────────────────────────
vec3 mAurora(vec2 uv) {
  vec3 col = mix(vec3(0.010,0.020,0.050), vec3(0.050,0.020,0.090), uv.y * 0.5 + 0.5);
  float x = uv.x * 0.5 + 0.5;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float band = spec(fract(x * 0.6 + fi * 0.21));
    float wv = fbm(vec2(x * 3.0 + uTime * (0.05 + fi * 0.02), fi * 1.7 + uTime * 0.1));
    float h = -0.25 + 1.15 * band * (0.6 + 0.8 * uMid) + 0.35 * wv;
    float d = h - uv.y;
    float curtain = smoothstep(0.0, 0.9, d) * smoothstep(1.25, 0.0, d) * (0.5 + 1.3 * band);
    col += palette(0.15 + fi * 0.16 + uv.y * 0.25 + uTreble * 0.2) * curtain * (0.5 + 0.7 * uLevel + 0.4 * uBeat);
  }
  col += palette(0.08) * exp(-abs(uv.y + 0.55) * 4.0) * (0.4 + 2.2 * uBass + uBeat);
  float st = hash21(floor(uv * vec2(220.0, 160.0)));
  col += vec3(pow(st, 40.0)) * 0.7 * smoothstep(-0.2, 0.6, uv.y);
  return col;
}

// ── Mode 3: Raymarch — flying through an audio-morphed lattice ──────────────
float rmMap(vec3 p, inout float glow) {
  vec3 q = p;
  q.z = mod(q.z, 4.0) - 2.0;
  float tw = 0.35 * sin(p.z * 0.2 + uTime * 0.5) + uBass * 0.6;
  q.xy *= rot(tw * q.z * 0.25 + p.z * 0.15);
  q.xy = mod(q.xy + 1.5, 3.0) - 1.5;
  float box = sdBox(q, vec3(0.28 + 0.18 * uBass)) - 0.12;
  float sph = length(q) - (0.5 + 0.35 * uMid);
  float d = mix(box, sph, 0.5 + 0.5 * sin(uTime * 0.3));
  glow += 0.016 / (0.01 + d * d);
  return d;
}
vec3 mRaymarch(vec2 uv) {
  vec3 ro = vec3(0.0, 0.0, -uTime * (2.0 + 3.0 * uBass + 2.0 * uBeat));
  vec3 rd = normalize(vec3(uv * 1.1, 1.3));
  rd.xy *= rot(sin(uTime * 0.2) * 0.3 + uBeat * 0.25);
  float t = 0.0, glow = 0.0, hit = 0.0;
  for (int i = 0; i < 80; i++) {
    vec3 p = ro + rd * t;
    float d = rmMap(p, glow);
    if (d < 0.002) { hit = 1.0; break; }
    t += d * 0.75;
    if (t > 34.0) break;
  }
  vec3 col = palette(fract(t * 0.045 + uTime * 0.02 + uTreble * 0.2)) * (hit * (1.3 / (1.0 + t * 0.12)));
  col += palette(0.55 + uMid * 0.3) * glow * (0.040 + 0.03 * uBeat);
  return col * (0.7 + 0.6 * uLevel);
}

// ── Mode 4: Fractal — audio-driven Julia set ────────────────────────────────
vec3 mFractal(vec2 uv) {
  float zoom = 0.95 + 0.45 * sin(uTime * 0.13) - 0.35 * uBass;
  vec2 z = uv * zoom * 1.4;
  z *= rot(uTime * 0.05);
  vec2 c = vec2(0.36 * sin(uTime * 0.21) + 0.12 * uMid, 0.38 * cos(uTime * 0.17) + 0.12 * uTreble);
  c *= 1.0 + 0.25 * uBeat;
  float trap = 1e9, it = 0.0;
  for (int i = 0; i < 72; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    trap = min(trap, length(z));
    if (dot(z, z) > 16.0) break;
    it += 1.0;
  }
  float sm = it / 72.0;
  vec3 col = palette(fract(sm * 1.5 + uTime * 0.03 + uTreble * 0.2));
  col *= 0.3 + 1.4 * pow(1.0 - sm, 1.5);
  col += palette(0.5) * exp(-trap * 3.0) * (0.6 + 1.6 * uBass + 0.8 * uBeat);
  return col * (0.6 + 0.7 * uLevel);
}

// ── Mode 5: Lightpaint — sparse seeds smeared by the feedback buffer ────────
vec3 mLightpaint(vec2 uv) {
  vec3 col = vec3(0.0);
  float a = atan(uv.y, uv.x), rad = length(uv);
  float ang = a / 6.28318 + 0.5;
  float s = spec(abs(ang * 2.0 - 1.0));
  float ringR = 0.32 + 0.42 * s;
  float ring = exp(-abs(rad - ringR) * 64.0) * (0.4 + 1.8 * s + 0.5 * uBeat);
  col += palette(fract(ang + uTime * 0.05)) * ring * 1.3;
  float spikes = pow(abs(sin(a * 7.0 + uTime * 0.7)), 24.0) * exp(-rad * 2.2);
  col += palette(0.1 + uMid) * spikes * uBeat * 3.5;
  float sp = hash21(floor(uv * vec2(90.0) + floor(uTime * vec2(3.0, 1.0))));
  col += vec3(pow(sp, 40.0)) * uTreble * 1.6;
  return col;
}

// ── Mode 6: Spectrum — premium bar analyzer with peak-hold + reflection ─────
vec3 mSpectrum(vec2 tuv) {
  const float N = 54.0;
  const float baseY = 0.13;
  const float topY = 0.90;
  vec3 col = vec3(0.0);

  float colx = tuv.x * N;
  float fx = fract(colx);
  float sx = (floor(colx) + 0.5) / N;
  float h = pow(spec(sx), 0.70);
  float pk = pow(specPeak(sx), 0.70);
  float barTop = baseY + h * (topY - baseY);
  float pkTop = baseY + pk * (topY - baseY);

  // bar fills the central 74% of the column, with soft edges
  float inCol = smoothstep(0.10, 0.16, fx) * smoothstep(0.90, 0.84, fx);
  float yE = 0.0016;
  float inBar = smoothstep(baseY - yE, baseY + yE, tuv.y)
              * smoothstep(barTop + yE, barTop - yE, tuv.y);

  float g = clamp((tuv.y - baseY) / (topY - baseY), 0.0, 1.0);
  vec3 barCol = palette(0.20 + g * 0.62);
  barCol = mix(barCol, vec3(1.0, 0.96, 0.90), smoothstep(0.62, 1.0, g) * 0.7);
  col += barCol * inCol * inBar * (0.85 + 0.95 * h);

  // glowing peak cap
  col += vec3(1.0, 0.93, 0.85) * smoothstep(0.014, 0.0, abs(tuv.y - pkTop)) * inCol * 1.6;

  // mirrored reflection below the baseline
  if (tuv.y < baseY) {
    float my = 2.0 * baseY - tuv.y;
    float inRef = smoothstep(baseY - yE, baseY + yE, my)
                * smoothstep(barTop + yE, barTop - yE, my);
    float fade = clamp(1.0 - (baseY - tuv.y) / 0.12, 0.0, 1.0);
    col += barCol * inCol * inRef * fade * fade * 0.4;
  }

  // baseline glow
  col += palette(0.1) * smoothstep(0.005, 0.0, abs(tuv.y - baseY)) * (0.7 + 0.6 * uBeat);
  return col;
}

// ── Mode 7: VU — stereo broadcast meters with peak-hold ─────────────────────
vec3 vuZone(float pos) {
  vec3 green = vec3(0.13, 0.85, 0.34);
  vec3 lime  = vec3(0.62, 0.88, 0.16);
  vec3 amber = vec3(1.00, 0.66, 0.08);
  vec3 red   = vec3(1.00, 0.21, 0.16);
  if (pos < 0.66) return mix(green, lime, pos / 0.66);
  if (pos < 0.86) return mix(amber, red, (pos - 0.66) / 0.20);
  return red;
}
vec3 vuMeter(vec2 tuv, float cy, float halfH, float level, float peak) {
  float mx0 = 0.09, mx1 = 0.91;
  float yE = 0.0018, xE = 0.0016;
  float inY = smoothstep(cy - halfH - yE, cy - halfH + yE, tuv.y)
            * smoothstep(cy + halfH + yE, cy + halfH - yE, tuv.y);
  float inX = smoothstep(mx0 - xE, mx0 + xE, tuv.x) * smoothstep(mx1 + xE, mx1 - xE, tuv.x);
  float track = inY * inX;
  if (track < 0.001) return vec3(0.0);
  float pos = clamp((tuv.x - mx0) / (mx1 - mx0), 0.0, 1.0);
  vec3 col = vec3(0.045, 0.045, 0.060) * track;            // unlit track
  float filled = track * smoothstep(level + xE, level - xE, pos);
  // soft glowing segment pattern
  float seg = 0.60 + 0.40 * smoothstep(0.20, 0.46, abs(fract(pos * 44.0) - 0.5) * 2.0);
  col += vuZone(pos) * filled * seg * 1.7;
  // peak-hold marker
  col += vec3(1.0, 0.97, 0.90) * track * smoothstep(0.009, 0.0, abs(pos - peak)) * step(0.02, peak) * 2.0;
  return col;
}
vec3 mVu(vec2 tuv) {
  return vuMeter(tuv, 0.585, 0.115, uVuL, uVuPeakL)
       + vuMeter(tuv, 0.415, 0.115, uVuR, uVuPeakR);
}

// ── Mode 8: Waveform — live oscilloscope trace ──────────────────────────────
vec3 mWaveform(vec2 tuv) {
  vec3 col = vec3(0.0);
  float dx = 1.6 / uRes.x;
  float a0 = (wave(tuv.x - dx) - 0.5) * 2.0;
  float a1 = (wave(tuv.x) - 0.5) * 2.0;
  float a2 = (wave(tuv.x + dx) - 0.5) * 2.0;
  float loY = 0.5 + min(a1, min(a0, a2)) * 0.36;
  float hiY = 0.5 + max(a1, max(a0, a2)) * 0.36;
  float d = max(0.0, max(loY - tuv.y, tuv.y - hiY));   // distance to the trace ribbon
  vec3 wc = palette(0.5 + a1 * 0.32);
  col += wc * smoothstep(0.011, 0.0, d) * 1.7;          // crisp trace
  col += wc * smoothstep(0.07, 0.0, d) * (0.22 + 0.22 * uBeat);  // soft glow
  // faint fill between the centre line and the trace
  float lo = min(0.5, loY), hi = max(0.5, hiY);
  col += palette(0.2) * step(lo, tuv.y) * step(tuv.y, hi) * 0.09;
  // centre reference line
  col += palette(0.14) * smoothstep(0.0032, 0.0, abs(tuv.y - 0.5)) * 0.30;
  return col;
}

// ── Mode 9: Radial — circular spectrum analyzer ─────────────────────────────
vec3 mRadial(vec2 uv) {
  vec3 col = vec3(0.0);
  float rad = length(uv);
  float a01 = atan(uv.y, uv.x) / 6.28318 + 0.5;
  const float N = 88.0;
  float bf = fract(a01 * N);
  float sx = abs(((floor(a01 * N) + 0.5) / N) * 2.0 - 1.0);
  float h = pow(spec(sx), 0.72);
  float ringR = 0.17;
  float barLen = 0.012 + h * 0.21;
  float inWedge = smoothstep(0.14, 0.20, bf) * smoothstep(0.86, 0.80, bf);
  float rE = 0.0016;
  float inBar = smoothstep(ringR - rE, ringR + rE, rad)
              * smoothstep(ringR + barLen + rE, ringR + barLen - rE, rad);
  float g = clamp((rad - ringR) / 0.22, 0.0, 1.0);
  vec3 barCol = palette(0.20 + g * 0.60);
  barCol = mix(barCol, vec3(1.0, 0.96, 0.90), smoothstep(0.6, 1.0, g) * 0.6);
  col += barCol * inWedge * inBar * (0.9 + h);
  // base ring + bass-reactive core
  col += palette(0.12) * smoothstep(0.006, 0.0, abs(rad - ringR + 0.013)) * (0.6 + 1.5 * uLevel + 0.5 * uBeat);
  col += palette(0.05 + 0.3 * uBass) * smoothstep(ringR - 0.008, 0.0, rad)
         * (0.22 + 0.95 * uBass + 0.6 * uBeat);
  return col;
}

// ── Mode 10: Corridor — 3D synthwave grid corridor ──────────────────────────
// Genuine ray-plane 3D: a banking camera flies between a neon floor and ceiling
// with a scanline sun on the horizon ahead.
vec3 mCorridor(vec2 uv) {
  // forward flight — constant base speed + bounded bass/beat surge
  float camZ = uTime * 5.0 + 2.4 * uBass + 1.6 * uBeat;
  vec3 ro = vec3(0.0, 0.0, camZ);
  vec3 fwd = normalize(vec3(sin(uTime * 0.15) * 0.05, -0.02, 1.0));
  vec3 rgt = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 upv = cross(fwd, rgt);
  vec3 rd = normalize(uv.x * rgt + uv.y * upv + fwd * 1.4);

  vec3 col = vec3(0.0);

  // synthwave sun on the horizon ahead, with carved scanline bands
  vec2 sunUv = vec2(dot(rd, rgt), rd.y);
  float sunD = length(vec2(sunUv.x, sunUv.y * 1.15));
  float sun = smoothstep(0.33, 0.29, sunD);
  float bandMask = smoothstep(0.0, 0.025, sin(sunUv.y * 64.0 + 1.0))
                 * smoothstep(0.01, -0.16, sunUv.y);
  sun *= 1.0 - bandMask * 0.9;
  col += palette(0.90) * sun * (1.4 + 0.9 * uBass + 0.6 * uBeat);
  col += palette(0.82) * smoothstep(0.62, 0.0, sunD) * (0.35 + 0.5 * uLevel);
  col += palette(0.66) * exp(-abs(rd.y) * 7.0) * (0.25 + 0.5 * uLevel);

  // floor neon grid — exact ray/plane intersection at y = -1
  if (rd.y < -0.002) {
    float td = -1.0 / rd.y;
    vec3 hp = ro + rd * td;
    float gx = neon(fract(hp.x) - 0.5, 0.025);
    float gz = neon(fract(hp.z) - 0.5, 0.025);
    float amp = spec(clamp(abs(hp.x) * 0.055, 0.0, 1.0));
    col += palette(0.30 + 0.46 * amp) * (gx + gz)
           * (0.4 + 1.9 * amp + 0.5 * uBeat) * exp(-td * 0.05);
  }
  // ceiling neon grid (dimmer) — ray/plane intersection at y = 1.7
  if (rd.y > 0.002) {
    float td = 1.7 / rd.y;
    vec3 hp = ro + rd * td;
    float gx = neon(fract(hp.x) - 0.5, 0.025);
    float gz = neon(fract(hp.z) - 0.5, 0.025);
    float amp = spec(clamp(abs(hp.x) * 0.055, 0.0, 1.0));
    col += palette(0.52 + 0.34 * amp) * (gx + gz)
           * (0.3 + 1.4 * amp + 0.35 * uBeat) * exp(-td * 0.055) * 0.66;
  }

  return col * (0.92 + 0.4 * uLevel);
}

// ── Mode 11: Warp — 3D hyperspace light-streak jump ─────────────────────────
// Each streak carries a real depth z; perspective (1/z) makes it rush outward
// and stretch as it nears — the defining look of a light-speed jump.
vec3 mWarp(vec2 uv) {
  vec3 col = vec3(0.0);
  float r = length(uv);
  float a01 = atan(uv.y, uv.x) / 6.2831853 + 0.5;
  const float N = 96.0;
  float id = floor(a01 * N);
  float seed = hash11(id);
  float seed2 = hash11(id + 41.0);

  // thin neon line centred in this streak's angular wedge
  float line = neon(fract(a01 * N) - 0.5, 0.028 + 0.05 * seed);

  // perspective depth — z cycles far(1) -> near(0). The rate is constant (no
  // audio in it, so no phase jump); audio adds a bounded forward surge.
  float z = fract(seed2 - uTime * (0.16 + 0.16 * seed) - 0.5 * uBass - 0.7 * uBeat);
  float headR = 0.045 / (z + 0.03);                  // head radius blows up near camera
  float tailLen = 0.10 + 1.5 * (1.0 - z);            // streak stretches as it nears
  float tailR = max(0.0, headR - tailLen);

  // streak body from tail to head, with a hot knot at the head
  float body = smoothstep(tailR, mix(tailR, headR, 0.45), r)
             * smoothstep(headR + 0.015, headR - 0.02, r);
  float head = exp(-abs(r - headR) * 24.0);
  float depthB = (1.0 - z) * smoothstep(0.0, 0.06, z);
  float band = 0.35 + 1.8 * spec(seed);
  col += palette(0.30 + 0.5 * seed) * line * (body * 0.85 + head * 1.7) * depthB * band;

  // a slow counter-swirl — the forming light tunnel
  col += palette(0.62) * neon(fract(a01 * 26.0 - uTime * 0.10) - 0.5, 0.06)
         * exp(-r * 1.7) * (0.10 + 0.55 * uLevel);

  // hot core punching the vanishing point
  col += palette(0.95) * exp(-r * 5.2) * (0.45 + 1.9 * uBass + 1.6 * uBeat);

  return col * (1.05 + 0.4 * uLevel);
}

// ── Mode 12: Hex — raymarched hexagonal neon tunnel ─────────────────────────
vec3 mHexTunnel(vec2 uv) { return tunnelScene(uv, 1.0); }

// ── Mode 13: Rings — concentric neon pulses ─────────────────────────────────
vec3 mRings(vec2 uv) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float speed = 0.35 + 0.9 * uBass;
  float phase = r * 6.0 - uTime * speed - uBeat * 0.6;
  float amp = spec(fract(floor(phase) * 0.11));
  vec3 col = palette(0.30 + 0.5 * amp)
             * neon(fract(phase) - 0.5, 0.07 + 0.05 * amp) * (0.4 + 1.7 * amp + 0.4 * uBeat);
  col += palette(0.88) * exp(-r * 4.0) * (0.5 + 1.5 * uBass + uBeat);
  col *= 0.86 + 0.14 * sin(a * 6.0 + uTime * 0.6);    // gentle angular life
  col *= smoothstep(1.4, 0.08, r);
  return col * (0.8 + 0.5 * uLevel);
}

// ── Mode 14: Plexus — drifting neon node network ────────────────────────────
vec3 mPlexus(vec2 uv) {
  vec3 col = vec3(0.0);
  vec2 p = uv * 4.0 + vec2(uTime * 0.08, uTime * 0.04);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float lvl = 0.35 + 1.0 * uLevel;
  vec2 c0 = cellPoint(cell) - f;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 off = vec2(float(dx), float(dy));
      vec2 id = cell + off;
      vec2 pt = off + cellPoint(id) - f;
      if (dx != 0 || dy != 0) {
        float dl = segDist(vec2(0.0), c0, pt);
        col += palette(0.55) * neon(dl, 0.018) * 0.16 * lvl;
      }
      col += palette(0.34 + 0.42 * hash21(id)) * neon(length(pt), 0.045)
             * (0.35 + 0.6 * spec(hash21(id)) + 0.4 * uBeat) * lvl;
    }
  }
  col += palette(0.9) * exp(-length(uv) * 3.5) * (0.2 + 0.9 * uBass + 0.5 * uBeat);
  return col * 1.15;
}

// ── Mode 15: Scope — X-Y stereo oscilloscope (Lissajous) ────────────────────
vec3 mScope(vec2 uv) {
  vec3 col = vec3(0.0);
  const int N = 72;
  vec2 prev = scope(0.0) * 0.46;
  for (int i = 1; i < N; i++) {
    vec2 p = scope(float(i) / float(N - 1)) * 0.46;
    col += palette(0.5 + 0.25 * uCentroid) * neon(segDist(uv, prev, p), 0.006) * 0.6;
    prev = p;
  }
  // bright head at the most recent sample
  col += palette(0.92) * neon(length(uv - scope(1.0) * 0.46), 0.018) * (1.1 + 0.7 * uTreble);
  return col * (0.65 + 0.7 * uLevel);
}

// ── Mode 16: Wave Ring — circular live waveform ─────────────────────────────
vec3 mWaveRing(vec2 uv) {
  vec3 col = vec3(0.0);
  float r = length(uv);
  float a01 = atan(uv.y, uv.x) / 6.2831853 + 0.5;
  float s = abs(a01 * 2.0 - 1.0);                  // mirror — seamless ring
  float dx = 1.0 / 360.0;
  float w0 = (wave(s - dx) - 0.5) * 2.0;
  float w1 = (wave(s) - 0.5) * 2.0;
  float w2 = (wave(s + dx) - 0.5) * 2.0;
  float ringR = 0.30 + 0.022 * sin(uBeatPhase * 3.14159);
  float lo = ringR + min(w1, min(w0, w2)) * 0.12;
  float hi = ringR + max(w1, max(w0, w2)) * 0.12;
  float d = max(0.0, max(lo - r, r - hi));
  vec3 wc = palette(0.5 + w1 * 0.3);
  col += wc * neon(d, 0.005) * 1.6;
  col += wc * smoothstep(0.06, 0.0, d) * (0.18 + 0.18 * uBeat);
  col += palette(0.12) * neon(r - ringR, 0.0025) * 0.35;
  col += palette(0.05 + 0.35 * uBass) * exp(-r * 4.2) * (0.25 + 1.2 * uBass + 0.7 * uBeat);
  return col * (0.7 + 0.6 * uLevel);
}

// ── Mode 17: Grid — LED video-wall spectrum matrix ──────────────────────────
vec3 mGrid(vec2 tuv) {
  vec3 col = vec3(0.0);
  vec2 cells = vec2(32.0, 18.0);
  vec2 cell = floor(tuv * cells);
  vec2 f = fract(tuv * cells);
  float colN = (cell.x + 0.5) / cells.x;
  float h = pow(spec(colN), 0.7);
  float pk = pow(specPeak(colN), 0.7);
  float rowFrac = (cell.y + 0.5) / cells.y;
  float dotMask = smoothstep(0.40, 0.12, length(f - 0.5));
  float lit = step(rowFrac, h);
  col += palette(0.16 + rowFrac * 0.66) * dotMask * lit * (0.55 + 1.0 * h + 0.35 * uBeat);
  col += vec3(0.020, 0.020, 0.026) * dotMask;                    // unlit LEDs
  col += palette(0.92) * dotMask * step(abs(cell.y - floor(pk * cells.y)), 0.5) * 1.2;
  return col;
}

// ── Mode 18: Orbits — concentric rings of orbiting nodes ────────────────────
vec3 mOrbits(vec2 uv) {
  vec3 col = vec3(0.0);
  float r = length(uv);
  float a = atan(uv.y, uv.x) / 6.2831853 + 0.5;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float ringR = 0.11 + fi * 0.084;
    float band = pow(spec(0.08 + fi * 0.2), 0.7);
    float nodes = 6.0 + fi * 3.0;
    float dir = (i == 1 || i == 3) ? -1.0 : 1.0;
    float na = fract((a + uTime * (0.12 - fi * 0.018) * dir) * nodes);
    float radD = (r - ringR) / 0.024;
    float node = neon(min(na, 1.0 - na), 0.06 + 0.05 * band) * exp(-radD * radD);
    col += palette(0.2 + fi * 0.14 + band * 0.2) * node * (0.4 + 2.0 * band + 0.45 * uBeat);
    col += palette(0.12) * exp(-pow((r - ringR) / 0.006, 2.0)) * (0.10 + 0.2 * band);
  }
  col += palette(0.05 + 0.3 * uBass) * exp(-r * 7.0) * (0.3 + 1.3 * uBass + 0.7 * uBeat);
  return col * (0.7 + 0.6 * uLevel);
}

// ── Mode 19: Liquid — raymarched chrome metaball (premium keynote look) ─────
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float sdSphere(vec3 p, float r) { return length(p) - r; }
float liqMap(vec3 p) {
  p.xz *= rot(uTime * 0.25);
  p.xy *= rot(uTime * 0.17);
  float k = 0.45 + 0.40 * uBass;                       // bass makes it gooier
  float d = sdSphere(p, 0.66 + 0.20 * uBeat);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ph = uTime * (0.55 + fi * 0.23) + fi * 1.9;
    vec3 o = vec3(sin(ph), cos(ph * 1.3), sin(ph * 0.7)) * (0.55 + 0.45 * uMid);
    float rr = 0.26 + 0.10 * sin(uTime * 1.4 + fi * 2.1) + 0.14 * uTreble;
    d = smin(d, sdSphere(p - o, rr), k);
  }
  return d;
}
vec3 liqNormal(vec3 p) {
  vec2 e = vec2(0.0012, 0.0);
  return normalize(vec3(
    liqMap(p + e.xyy) - liqMap(p - e.xyy),
    liqMap(p + e.yxy) - liqMap(p - e.yxy),
    liqMap(p + e.yyx) - liqMap(p - e.yyx)));
}
// studio environment — dark room, soft top key light, neon rim + fill
vec3 liqEnv(vec3 rd) {
  vec3 base = mix(vec3(0.012, 0.015, 0.028), vec3(0.055, 0.065, 0.110), rd.y * 0.5 + 0.5);
  float key = pow(max(0.0, dot(rd, normalize(vec3(0.30, 0.82, -0.40)))), 8.0);
  base += vec3(1.0, 0.97, 0.92) * key * 0.95;
  float rim = pow(max(0.0, dot(rd, normalize(vec3(-0.62, -0.18, 0.55)))), 4.0);
  base += palette(0.72) * rim * 0.65;
  float fill = pow(max(0.0, dot(rd, normalize(vec3(0.5, -0.5, -0.2)))), 3.0);
  base += palette(0.32) * fill * 0.30;
  return base;
}
vec3 mLiquid(vec2 uv) {
  vec3 ro = vec3(0.0, 0.0, -3.0);
  vec3 rd = normalize(vec3(uv * 1.05, 1.5));
  float t = 0.0, hit = 0.0;
  for (int i = 0; i < 84; i++) {
    vec3 p = ro + rd * t;
    float d = liqMap(p);
    if (d < 0.0015) { hit = 1.0; break; }
    t += d * 0.86;
    if (t > 8.0) break;
  }
  vec3 col;
  if (hit > 0.5) {
    vec3 p = ro + rd * t;
    vec3 n = liqNormal(p);
    vec3 refl = reflect(rd, n);
    float fres = pow(1.0 - max(0.0, dot(n, -rd)), 3.0);
    vec3 env = liqEnv(refl);
    vec3 tint = mix(palette(0.28 + 0.42 * uCentroid), vec3(1.0), 0.35);
    col = env * (0.45 + 0.55 * tint);
    col += palette(0.86) * fres * (0.85 + 1.25 * uBeat);   // fresnel glow rim
    float spe = pow(max(0.0, dot(refl, normalize(vec3(0.30, 0.82, -0.40)))), 64.0);
    col += vec3(1.0, 0.98, 0.94) * spe * (1.4 + 0.9 * uTreble);  // hot specular
  } else {
    col = liqEnv(rd);
  }
  return col * (0.85 + 0.4 * uLevel);
}

// ── Mode 20: Starfield — volumetric 3D star warp ────────────────────────────
vec3 mStarfield(vec2 uv) {
  vec3 col = mix(vec3(0.010, 0.012, 0.024), vec3(0.028, 0.022, 0.050), uv.y * 0.5 + 0.5);
  float speed = 0.5 + 1.8 * uBass + 2.4 * uBeat;
  for (int i = 0; i < 80; i++) {
    float fi = float(i);
    float seed  = hash11(fi * 2.13 + 1.7);
    float seed2 = hash11(fi * 1.31 + 8.4);
    float z = fract(seed - uTime * speed * 0.035);         // 1 = far, 0 = at camera
    float persp = 0.05 / (z * z + 0.05);                   // explodes near camera
    vec2 dir = vec2(seed - 0.5, seed2 - 0.5);
    vec2 pos = dir * persp * 1.9;
    if (dot(pos, pos) > 4.0) continue;                     // off-screen — skip
    float bright = (1.0 - z) * smoothstep(0.0, 0.10, z);
    vec2 rd = normalize(pos + vec2(1e-4, 1e-4));
    float along = dot(uv - pos, rd);
    float side  = dot(uv - pos, vec2(-rd.y, rd.x));
    float kAlong = mix(2600.0, 70.0, clamp((speed - 0.5) * 0.45, 0.0, 1.0));
    float s = exp(-(side * side * 5600.0 + along * along * kAlong));
    col += palette(0.5 + 0.34 * seed) * s * bright * 1.4;
  }
  // a bass-driven warp core keeps the centre alive
  col += palette(0.05 + 0.3 * uBass) * exp(-length(uv) * 3.2) * (0.2 + 1.1 * uBass + 0.7 * uBeat);
  return col * (0.85 + 0.5 * uLevel);
}

// ── Mode 21: Ribbon — flowing glossy neon audio ribbon ──────────────────────
vec3 mRibbon(vec2 uv) {
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float depth = fi / 3.0;                                // 0 front .. 1 back
    float scale = mix(1.0, 0.58, depth);
    float x = uv.x * 0.5 + 0.5;
    float w = (wave(fract(x * 0.5 + fi * 0.13 + uTime * 0.025)) - 0.5) * 2.0;
    float flow = sin(uv.x * 2.4 + uTime * (0.55 + fi * 0.22) + fi * 2.1);
    float cy = (0.11 * flow + 0.32 * w * (0.5 + uMid)) * scale + (depth - 0.4) * 0.06;
    float thick = (0.020 + 0.05 * abs(w) + 0.03 * uLevel + 0.04 * uBeat) * scale;
    float d = abs(uv.y - cy);
    float body = smoothstep(thick, thick * 0.18, d);
    float grad = clamp((uv.y - cy) / thick * 0.5 + 0.5, 0.0, 1.0);
    vec3 rc = palette(0.28 + 0.42 * grad + 0.16 * depth);
    rc = mix(rc, vec3(1.0, 0.97, 0.92), smoothstep(0.55, 0.96, grad) * 0.75);  // sheen
    col += rc * body * (0.7 + 0.6 * uLevel) * mix(1.0, 0.38, depth);
    col += palette(0.86) * neon(d - thick, 0.012) * mix(1.0, 0.32, depth) * (0.55 + 0.9 * uBeat);
  }
  col += palette(0.06 + 0.30 * uBass) * exp(-abs(uv.y + 0.46) * 5.0) * (0.30 + 1.0 * uBass + 0.5 * uBeat);
  return col * 1.05;
}

// ── Mode 22: Helix — rotating double-helix of spectrum nodes ────────────────
vec3 mHelix(vec2 uv) {
  vec3 col = vec3(0.0);
  const int N = 34;
  float spin = uTime * 0.55 + uBeatPhase * 0.5;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    float t = fi / float(N - 1);                           // 0..1 along the strand
    float y = (t - 0.5) * 1.55;
    float ph = t * 9.0 + spin;
    float band = pow(spec(t), 0.7);
    float xA = sin(ph) * (0.32 + 0.07 * band);
    float xB = sin(ph + 3.14159265) * (0.32 + 0.07 * band);
    float depthA = cos(ph), depthB = cos(ph + 3.14159265);
    float perspA = 0.78 + 0.34 * depthA;                   // front nodes larger
    float perspB = 0.78 + 0.34 * depthB;
    vec2 pA = vec2(xA, y) * perspA;
    vec2 pB = vec2(xB, y) * perspB;
    col += palette(0.6) * neon(segDist(uv, pA, pB), 0.006) * 0.22 * (0.4 + band);  // rung
    float dA = length(uv - pA);
    float rA = (0.013 + 0.05 * band) * perspA;
    float nA = rA / (dA + rA); nA *= nA;
    col += palette(0.22 + 0.5 * t + 0.2 * band) * nA * (0.4 + 1.9 * band + 0.4 * uBeat) * (0.55 + 0.45 * depthA);
    float dB = length(uv - pB);
    float rB = (0.013 + 0.05 * band) * perspB;
    float nB = rB / (dB + rB); nB *= nB;
    col += palette(0.22 + 0.5 * t + 0.2 * band) * nB * (0.4 + 1.9 * band + 0.4 * uBeat) * (0.55 + 0.45 * depthB);
  }
  col += palette(0.05 + 0.30 * uBass) * exp(-length(uv) * 3.0) * (0.22 + 0.9 * uBass + 0.5 * uBeat);
  return col * (0.78 + 0.5 * uLevel);
}

// ── Mode 23: Galaxy — audio-reactive spiral galaxy ──────────────────────────
vec3 mGalaxy(vec2 uv) {
  // map the screen into the disk plane: tilt, then un-foreshorten, then spin —
  // so the galaxy reads as an inclined 3D disk rather than a flat swirl.
  vec2 p = uv * (1.30 - 0.12 * uBass);
  p *= rot(0.62);
  p.y /= 0.46;
  p *= rot(uTime * 0.05 + uBeat * 0.04);
  float r = length(p);
  float a = atan(p.y, p.x);

  vec3 col = vec3(0.0);

  // logarithmic spiral arms — differential rotation winds the inner disk faster
  float wind = a + log(r + 0.06) * 3.6 - uTime * 0.18 - 1.2 / (r + 0.25);
  float arms = pow(max(0.0, cos(wind * 2.0)), 2.0);

  // two octaves of dust — broad lanes plus fine filaments
  float dustBroad = fbm(p * 2.6 + vec2(wind * 0.35, uTime * 0.05));
  float dustFine  = fbm(p * 7.0 - vec2(uTime * 0.04, wind * 0.20));
  float dust = dustBroad * (0.65 + 0.5 * dustFine);
  float band = spec(clamp(r * 1.2, 0.0, 1.0));

  // disk — hot/white toward the centre, cooler out along the arms
  float disk = arms * dust * exp(-r * 1.7);
  float hue = 0.20 + 0.46 * dust + 0.22 * band - 0.30 * exp(-r * 2.2);
  col += palette(clamp(hue, 0.0, 1.0)) * disk * (1.7 + 3.6 * band);

  // hot galactic core + soft halo
  col += palette(0.95) * exp(-r * (7.5 - 3.4 * uBass)) * (1.1 + 2.8 * uBass + 2.0 * uBeat);
  col += palette(0.72) * exp(-r * 2.6) * (0.32 + 0.6 * uMid);

  // anamorphic lens flare from the core — screen-aligned, kicked on the beat
  float flare = exp(-abs(uv.y) * 24.0) * exp(-abs(uv.x) * 1.8)
              + 0.40 * exp(-abs(uv.x) * 30.0) * exp(-abs(uv.y) * 2.4);
  col += palette(0.90) * flare * (0.30 + 1.6 * uBeat);

  // twinkling foreground starfield — fixed positions, animated brightness
  vec2 cellId = floor(uv * 230.0);
  float st = hash21(cellId + 3.0);
  float tw = 0.5 + 0.5 * sin(uTime * (2.0 + 6.0 * hash21(cellId + 19.0)) + st * 40.0);
  col += vec3(pow(st, 52.0)) * (0.4 + 1.0 * tw) * (0.6 + 0.8 * uTreble);

  return col * (0.85 + 0.5 * uLevel);
}

// ── Mode 24: Terrain — raymarched audio-sculpted mountain flythrough ─────────
// The heightfield is value noise plus a lateral ridge whose crest is driven by
// the live spectrum — the mountains literally are the music.
float terrainH(vec2 p) {
  float sx = clamp(p.x * 0.052 + 0.5, 0.0, 1.0);
  float h = 0.0, amp = 1.5;
  mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
  vec2 q = p * 0.30;
  for (int i = 0; i < 3; i++) { h += amp * noise(q); q = m * q * 2.03 + 1.1; amp *= 0.5; }
  float ridge = pow(spec(sx), 0.8) * (1.5 + 1.3 * uBass);
  return h + ridge - 1.5;
}
vec3 mTerrain(vec2 uv) {
  vec3 ro = vec3(0.0, 2.5 + 0.5 * uBass, -uTime * (3.0 + 2.6 * uBass + 2.2 * uBeat));
  vec3 rd = normalize(vec3(uv * 1.10, 1.32));
  rd.xy *= rot(0.045 * sin(uTime * 0.23));
  vec3 sunDir = normalize(vec3(0.30, 0.16, 0.80));       // low sun ahead

  float t = 0.0, hit = 0.0;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = p.y - terrainH(p.xz);
    if (d < 0.0026 * t) { hit = 1.0; break; }
    t += max(0.05, d * 0.44);
    if (t > 78.0) break;
  }

  // sky — graded dusk with a glowing sun disc and a scatter of stars
  vec3 sky = mix(palette(0.66), vec3(0.020, 0.020, 0.055), clamp(rd.y * 1.4 + 0.18, 0.0, 1.0));
  float sun = max(0.0, dot(rd, sunDir));
  sky += palette(0.95) * pow(sun, 220.0) * 3.0;
  sky += palette(0.88) * pow(sun, 6.0) * 0.7;
  sky += vec3(pow(hash21(floor(rd.xy * 320.0)), 80.0)) * smoothstep(0.05, 0.5, rd.y) * 0.8;

  vec3 col;
  if (hit > 0.5) {
    vec3 p = ro + rd * t;
    vec2 e = vec2(0.10, 0.0);
    vec3 n = normalize(vec3(
      terrainH(p.xz - e.xy) - terrainH(p.xz + e.xy),
      2.0 * e.x,
      terrainH(p.xz - e.yx) - terrainH(p.xz + e.yx)));
    float dif = max(0.0, dot(n, sunDir));
    float amb = 0.5 + 0.5 * n.y;                         // sky ambient
    float back = max(0.0, dot(n, normalize(vec3(-sunDir.x, 0.2, -sunDir.z))));
    float hgt = clamp(p.y * 0.20 + 0.40, 0.0, 1.0);
    float slope = 1.0 - n.y;                             // 0 flat .. 1 vertical

    // rock on the slopes, snow on high flat ground
    float snowMask = smoothstep(0.45, 0.85, hgt) * smoothstep(0.70, 0.35, slope);
    vec3 surf = mix(palette(0.16 + 0.34 * hgt), vec3(0.92, 0.95, 1.04), snowMask);
    col  = surf * dif * vec3(1.05, 0.92, 0.78) * 1.15;   // warm sun key
    col += surf * amb * vec3(0.16, 0.20, 0.34);          // cool sky fill
    col += surf * back * vec3(0.30, 0.16, 0.22) * 0.5;   // rim bounce

    // glowing world-space neon grid + height contours on the surface
    float band = pow(spec(clamp(p.x * 0.052 + 0.5, 0.0, 1.0)), 0.8);
    float grid = neon(fract(p.x * 0.5) - 0.5, 0.03) + neon(fract(p.z * 0.5) - 0.5, 0.03);
    col += palette(0.42 + 0.30 * hgt) * grid * 0.35 * (0.4 + 1.6 * band);
    col += palette(0.50) * neon(fract(p.y * 1.5) - 0.5, 0.05) * (0.3 + 1.4 * band);

    // specular glint on the snow caps
    col += vec3(1.0) * pow(max(0.0, dot(n, normalize(sunDir - rd))), 40.0)
           * snowMask * (0.6 + 1.0 * uTreble);

    col = mix(col, sky, smoothstep(20.0, 78.0, t));      // distance fog
  } else {
    col = sky;
  }
  return col * (0.82 + 0.5 * uLevel);
}

// ── Mode 25: Fluid — curl-noise advected audio dye ──────────────────────────
// Curl of a value-noise field is a smooth divergence-free flow; the previous
// frame is advected back along it and fresh dye is injected on the beat.
vec2 curlFlow(vec2 p) {
  float e = 0.09;
  float dy = noise(p + vec2(0.0, e)) - noise(p - vec2(0.0, e));
  float dx = noise(p + vec2(e, 0.0)) - noise(p - vec2(e, 0.0));
  return vec2(dy, -dx) / (2.0 * e);
}
vec3 mFluid(vec2 uv, vec2 tuv) {
  // turbulent velocity — three octaves of curl noise, evolving in time
  vec2 vel = curlFlow(uv * 1.6 + vec2(0.0, uTime * 0.06));
  vel += 0.50 * curlFlow(uv * 3.4 - vec2(uTime * 0.05, 0.0));
  vel += 0.25 * curlFlow(uv * 7.1 + vec2(uTime * 0.09, uTime * 0.03));

  // the beat pumps a radial shockwave outward from the centre
  float r = length(uv);
  vel += normalize(uv + 1e-4) * (0.5 * uBass + 1.5 * uBeat) * exp(-r * 2.2);

  // advect the previous frame back along the flow, then dissipate it
  vec2 adv = tuv - vel * (0.0024 + 0.0042 * uBass) * vec2(uRes.y / uRes.x, 1.0);
  vec3 col = texture(uPrev, adv).rgb * (0.952 - 0.05 * uTreble);

  // inject glowing dye from four drifting sources — kicked by the beat
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float ph = uTime * (0.21 + fi * 0.10) + fi * 1.9;
    vec2 src = vec2(cos(ph), sin(ph * 1.27)) * (0.32 + 0.12 * uMid);
    float d = length(uv - src);
    float inj = exp(-d * d * 95.0) * (0.05 + 0.60 * spec(0.12 + fi * 0.23));
    col += palette(0.24 + 0.54 * fract(fi * 0.41 + uTime * 0.04)) * inj * (0.4 + 1.8 * uBeat);
  }
  return col;
}

// ── Mode 26: Logo Mark — animated NAR ident ──────────────────────────────────
// The embedded NAR long-logo is sampled as a texture. Three echoes give depth,
// the main copy gets a beat-driven chromatic aberration, and audio drives a
// spectrum aura, brand-orange halo, treble sparkles and a beat-pulsed scale.
vec3 mLogoMark(vec2 uv) {
  vec3 col = mix(vec3(0.014, 0.018, 0.040), vec3(0.040, 0.022, 0.052), uv.y * 0.5 + 0.5);
  float r = length(uv);
  col += palette(0.92) * exp(-r * 2.4) * (0.10 + 0.6 * uBass + 0.4 * uBeat);

  const float aspect = 3.74;     // embedded long-logo is 202x54

  // three echoes for depth — main + two faint copies behind
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float depth = fi / 2.0;
    float logoW = mix(1.20, 0.74, depth) * (1.0 + 0.08 * uBeat);
    float logoH = logoW / aspect;
    float ang = sin(uTime * (0.08 + 0.05 * depth) + depth * 1.6) * (0.04 + 0.025 * depth);
    vec2 lp = rot(ang) * uv;
    lp.y += depth * 0.04 * sin(uTime * 0.7 + depth * 2.0);

    vec2 logoUv = vec2(lp.x / logoW + 0.5, -lp.y / logoH + 0.5);
    if (logoUv.x > 0.0 && logoUv.x < 1.0 && logoUv.y > 0.0 && logoUv.y < 1.0) {
      vec3 logoCol;
      float a;
      if (fi < 0.5) {
        vec2 ca = vec2(0.006 * uBeat, 0.0);
        vec4 ltC = texture(uLogo, logoUv);
        logoCol = vec3(texture(uLogo, logoUv + ca).r, ltC.g, texture(uLogo, logoUv - ca).b);
        a = ltC.a;
      } else {
        vec4 lt = texture(uLogo, logoUv);
        logoCol = lt.rgb;
        a = lt.a * mix(1.0, 0.35, depth);
      }
      logoCol *= 1.0 + 0.50 * uBeat;
      col = mix(col, logoCol, a);
    }
  }

  // spectrum aura just outside the logo
  float ang01 = atan(uv.y, uv.x) / 6.2831853 + 0.5;
  float band = pow(spec(abs(ang01 * 2.0 - 1.0)), 0.7);
  col += palette(0.35 + 0.45 * band) * band
         * smoothstep(0.70, 0.95, r) * smoothstep(1.35, 0.90, r)
         * (0.40 + 1.2 * uMid + 0.6 * uBeat);

  // treble sparkles
  float st = hash21(floor(uv * 180.0) + 7.0);
  col += vec3(pow(st, 60.0)) * (0.3 + 1.3 * uTreble);

  return col * (0.92 + 0.4 * uLevel);
}

// ── Mode 27: Cymatics — Chladni standing-wave patterns driven by audio ───────
// Bass drives one mode number, treble the other; the zero-crossings of the
// pattern form glowing organic node lines that morph with the music.
float chladni(vec2 p, float n, float m) {
  return cos(n * 3.14159265 * p.x) * cos(m * 3.14159265 * p.y)
       - cos(m * 3.14159265 * p.x) * cos(n * 3.14159265 * p.y);
}
vec3 mCymatics(vec2 uv) {
  vec2 p = uv * 1.6;
  float n = 3.0 + 4.0 * uBass + 1.5 * sin(uTime * 0.18);
  float m = 3.0 + 4.0 * uTreble + 1.5 * cos(uTime * 0.13);
  float c1 = chladni(p, n, m);
  float c2 = chladni(p * 1.6 + 0.3, n + 1.0, m - 0.5);
  float c = c1 + 0.45 * c2;
  float nodes = neon(c, 0.025 + 0.025 * uBeat);
  vec3 col = palette(0.25 + 0.55 * abs(c) + 0.20 * uCentroid) * nodes * (0.5 + 1.6 * uLevel);
  col += palette(0.55) * abs(c) * 0.04 * (0.3 + 0.8 * uMid);
  col *= smoothstep(1.6, 0.4, length(uv));
  col += palette(0.92) * exp(-length(uv) * 4.0) * (0.15 + 0.7 * uBeat);
  return col * (0.85 + 0.5 * uLevel);
}

// Sample whichever camera is currently chosen by uCamPick (0–3).
vec4 camPick(vec2 uv) {
  if (uCamPick == 1) return texture(uCam1, uv);
  if (uCamPick == 2) return texture(uCam2, uv);
  if (uCamPick == 3) return texture(uCam3, uv);
  return texture(uCam0, uv);
}

// Sample camera by explicit index — for modes that show multiple cameras.
vec4 camByIndex(int idx, vec2 uv) {
  if (idx == 1) return texture(uCam1, uv);
  if (idx == 2) return texture(uCam2, uv);
  if (idx == 3) return texture(uCam3, uv);
  return texture(uCam0, uv);
}

// ── Mode 28: Live Cam — audio-reactive treatment of the live camera feed ─────
// Bass drives a chromatic split, the beat fires a horizontal glitch tear plus
// a Sobel-lite edge highlight, treble intensifies broadcast scan lines, and
// the spectrum draws a bar along the bottom edge.
vec3 mLiveCam(vec2 uv, vec2 tuv) {
  vec2 cuv = tuv;
  // beat-driven horizontal tear — rare and brief, eye-catching
  float bandY = floor(cuv.y * 70.0);
  float tearMask = step(0.94, hash11(bandY + floor(uTime * 8.0)));
  cuv.x += (hash11(bandY * 1.3 + floor(uTime * 8.0) * 7.1) - 0.5)
           * 0.05 * tearMask * uBeat;

  // bass-driven chromatic split — RGB channels shear with the music
  float ca = 0.0020 + 0.012 * uBass;
  vec4 c0 = camPick(cuv);
  float r = camPick(cuv + vec2(ca, 0.0)).r;
  float b = camPick(cuv - vec2(ca, 0.0)).b;
  vec3 cam = vec3(r, c0.g, b);

  // broadcast split-tone — cool navy shadows, warm brand-orange highlights
  float l = dot(cam, vec3(0.299, 0.587, 0.114));
  vec3 graded = mix(vec3(0.05, 0.07, 0.16), vec3(1.08, 0.94, 0.62), l);
  vec3 col = mix(cam * 1.05, graded, 0.55);

  // Sobel-lite edge highlight, kicked by the beat
  vec2 px = 1.0 / uRes;
  vec3 cN = camPick(cuv + vec2(0.0, px.y * 2.0)).rgb;
  vec3 cS = camPick(cuv - vec2(0.0, px.y * 2.0)).rgb;
  vec3 cE = camPick(cuv + vec2(px.x * 2.0, 0.0)).rgb;
  vec3 cW = camPick(cuv - vec2(px.x * 2.0, 0.0)).rgb;
  float edge = length((cN - cS) + (cE - cW));
  col += palette(0.42) * edge * (0.35 + 1.3 * uBeat) * 0.5;

  // spectrum bar along the bottom edge of the frame
  float barRange = 0.085;
  if (tuv.y < barRange) {
    float h = pow(spec(tuv.x), 0.7) * 0.88;
    float yInBar = tuv.y / barRange;
    float lit = smoothstep(h, h - 0.025, yInBar);
    col = mix(col, palette(0.28 + 0.5 * h) * (0.8 + 1.6 * h), lit * 0.85);
  }

  // gentle scan lines that intensify with treble — a touch of broadcast feel
  float scan = 0.5 + 0.5 * sin(tuv.y * uRes.y * 1.5708);
  col *= 1.0 - 0.06 * scan * (0.30 + 0.75 * uTreble);

  return col;
}

// ── Mode 29: Live Mosaic — all 4 cameras in a 2×2 grid with reactive borders ─
// Top row is cam 1 & 2, bottom row is cam 3 & 4. Borders pulse with the beat;
// the camera matching uCamPick gets a brand-red rim glow (program highlight).
vec3 mLiveMosaic(vec2 uv, vec2 tuv) {
  vec2 q = tuv * 2.0;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  int col_ = int(cell.x);
  int row_ = int(cell.y);                       // 0 = bottom row, 1 = top row
  int camIdx = col_ + (1 - row_) * 2;           // TL=0, TR=1, BL=2, BR=3

  vec3 col = camByIndex(camIdx, f).rgb;

  // gutter / border around each tile — navy base, brand pulse on beat
  float bw = 0.012;
  float edgeDist = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
  float borderMask = 1.0 - smoothstep(0.0, bw, edgeDist);
  vec3 borderCol = mix(vec3(0.12, 0.14, 0.26), palette(0.45), 0.40 + 0.50 * uBeat);
  col = mix(col, borderCol, borderMask);

  // program-camera rim glow — brand red, kicks on the beat
  if (camIdx == uCamPick) {
    float rim = 1.0 - smoothstep(0.0, bw * 4.0, edgeDist);
    col += vec3(0.95, 0.20, 0.12) * rim * (0.45 + 0.70 * uBeat);
  }

  // per-tile bass-driven brightness pulse (each tile phased independently)
  float pulseSeed = hash11(float(camIdx) * 1.3 + 4.0);
  col *= 1.0 + 0.10 * uBass * sin(uTime * 1.2 + pulseSeed * 6.2831853);

  // treble sparkles
  float st = hash21(floor(tuv * 200.0) + 13.0);
  col += vec3(pow(st, 70.0)) * (0.30 + 1.00 * uTreble);

  return col;
}

// ── Mode 30: PIP — program camera big + 3 small insets along the right ──────
// The chosen camera fills the frame; the other three are stacked as small
// insets on the right edge with beat-pulsed brand-coloured borders.
vec3 mPIP(vec2 uv, vec2 tuv) {
  vec3 col = camPick(tuv).rgb;

  float insetX0 = 0.755, insetX1 = 0.985;
  float gutter = 0.012;
  float insetW = insetX1 - insetX0;
  float insetH = (1.0 - 4.0 * gutter) / 3.0;

  for (int row = 0; row < 3; row++) {
    float y1 = 1.0 - gutter - float(row) * (insetH + gutter);
    float y0 = y1 - insetH;
    if (tuv.x < insetX0 || tuv.x > insetX1 || tuv.y < y0 || tuv.y > y1) continue;
    vec2 f = vec2((tuv.x - insetX0) / insetW, (tuv.y - y0) / insetH);
    int slot = (uCamPick + row + 1) - 4 * ((uCamPick + row + 1) / 4);   // cyclic %4
    vec3 inset = camByIndex(slot, f).rgb;
    float bw = 0.025;
    float edgeD = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float borderM = 1.0 - smoothstep(0.0, bw, edgeD);
    vec3 borderCol = mix(vec3(0.10, 0.12, 0.22), palette(0.50), 0.40 + 0.45 * uBeat);
    col = mix(inset, borderCol, borderM);
    break;
  }
  return col;
}

// ── 7-segment digit helpers — for the Pace Display mode ─────────────────────
// Bitmasks: bit 0 = segment a (top), 1 = b, 2 = c, 3 = d (bottom),
//           4 = e, 5 = f, 6 = g (middle). d == -1 → dash (g only).
int seg7Mask(int d) {
  if (d == 0) return 63;
  if (d == 1) return 6;
  if (d == 2) return 91;
  if (d == 3) return 79;
  if (d == 4) return 102;
  if (d == 5) return 109;
  if (d == 6) return 125;
  if (d == 7) return 7;
  if (d == 8) return 127;
  if (d == 9) return 111;
  return 64;
}
float segRect(vec2 p, vec2 c, vec2 hs) {
  vec2 dv = abs(p - c) - hs;
  float dist = length(max(dv, 0.0)) + min(max(dv.x, dv.y), 0.0);
  return 1.0 - smoothstep(0.0, 0.08, dist);
}
vec3 sevenSeg(vec2 p, int d, vec3 onCol, vec3 offCol) {
  int m = seg7Mask(d);
  vec3 col = vec3(0.0);
  col += mix(offCol, onCol, float((m >> 0) & 1)) * segRect(p, vec2( 0.00,  0.80), vec2(0.55, 0.09));
  col += mix(offCol, onCol, float((m >> 1) & 1)) * segRect(p, vec2( 0.78,  0.40), vec2(0.09, 0.32));
  col += mix(offCol, onCol, float((m >> 2) & 1)) * segRect(p, vec2( 0.78, -0.40), vec2(0.09, 0.32));
  col += mix(offCol, onCol, float((m >> 3) & 1)) * segRect(p, vec2( 0.00, -0.80), vec2(0.55, 0.09));
  col += mix(offCol, onCol, float((m >> 4) & 1)) * segRect(p, vec2(-0.78, -0.40), vec2(0.09, 0.32));
  col += mix(offCol, onCol, float((m >> 5) & 1)) * segRect(p, vec2(-0.78,  0.40), vec2(0.09, 0.32));
  col += mix(offCol, onCol, float((m >> 6) & 1)) * segRect(p, vec2( 0.00,  0.00), vec2(0.55, 0.09));
  return col;
}

// ── Mode 31: Pace Display — Pioneer-style BPM + beat grid + phase indicator ──
vec3 mPaceDisplay(vec2 uv, vec2 tuv) {
  float vig = 1.0 - 0.50 * dot(uv, uv);
  vec3 col = vec3(0.020, 0.025, 0.052) * vig;

  bool locked = uBpmLocked > 0.5;
  bool valid = uBpm > 30.0;
  vec3 onCol  = locked ? vec3(0.98, 0.62, 0.14) : vec3(0.38, 0.40, 0.46);
  vec3 offCol = vec3(0.04, 0.05, 0.10);

  // ── BPM digits — large 7-segment block, centred upper-middle ──
  int bpm = int(uBpm + 0.5);
  float hw = 0.072, hh = 0.155;
  float spacing = 0.19;
  float baseY = 0.12;
  if (valid) {
    int h_ = bpm / 100;
    int t  = (bpm - h_ * 100) / 10;
    int o  = bpm - (bpm / 10) * 10;
    if (bpm >= 100) {
      vec2 p = (uv - vec2(-spacing, baseY)) * vec2(1.0 / hw, 1.0 / hh);
      if (abs(p.x) < 1.15 && abs(p.y) < 1.15) col += sevenSeg(p, h_, onCol, offCol);
    }
    {
      vec2 p = (uv - vec2(0.0, baseY)) * vec2(1.0 / hw, 1.0 / hh);
      if (abs(p.x) < 1.15 && abs(p.y) < 1.15) col += sevenSeg(p, t, onCol, offCol);
    }
    {
      vec2 p = (uv - vec2(spacing, baseY)) * vec2(1.0 / hw, 1.0 / hh);
      if (abs(p.x) < 1.15 && abs(p.y) < 1.15) col += sevenSeg(p, o, onCol, offCol);
    }
  } else {
    for (int i = -1; i <= 1; i++) {
      vec2 p = (uv - vec2(float(i) * spacing, baseY)) * vec2(1.0 / hw, 1.0 / hh);
      if (abs(p.x) < 1.15 && abs(p.y) < 1.15) col += sevenSeg(p, -1, onCol, offCol);
    }
  }

  // ── 4-dot beat grid ── shows current beat in the bar
  float dotY = -0.07;
  float dotSpacing = 0.12;
  int beatInBar = int(uBarPhase * 4.0);
  if (beatInBar > 3) beatInBar = 3;
  if (beatInBar < 0) beatInBar = 0;
  float blPhase = fract(uBarPhase * 4.0);
  for (int i = 0; i < 4; i++) {
    float dotX = (float(i) - 1.5) * dotSpacing;
    vec2 p = uv - vec2(dotX, dotY);
    float dist = length(p);
    float lit = float(beatInBar == i);
    float pulse = 1.0 - blPhase * 0.65;
    vec3 dotOn = onCol * pulse;
    float dotMask = 1.0 - smoothstep(0.024, 0.028, dist);
    col = mix(col, mix(offCol, dotOn, lit), dotMask);
    col += dotOn * lit * exp(-dist * 22.0) * 0.45;
  }

  // ── Phase progress bar ── linear sweep across a bar
  float barY = -0.21;
  float barHalfW = 0.42;
  float barH = 0.014;
  if (abs(uv.y - barY) < barH && abs(uv.x) < barHalfW) {
    col = vec3(0.06, 0.07, 0.13);
    float fillEdge = -barHalfW + barHalfW * 2.0 * uBarPhase;
    if (uv.x < fillEdge) col = onCol;
  }

  // ── Lock indicator (top-right corner) ──
  vec2 lockPos = vec2(0.70, 0.38);
  float lockDist = length(uv - lockPos);
  if (lockDist < 0.030) {
    vec3 lockCol = locked ? vec3(0.13, 0.85, 0.34) : vec3(0.96, 0.66, 0.10);
    lockCol *= (0.75 + 0.40 * uBeat);
    float m = 1.0 - smoothstep(0.022, 0.026, lockDist);
    col = mix(col, lockCol, m);
  }

  return col;
}

// ── Mode 33: Countdown — pre-broadcast "GOING LIVE IN…" ──────────────────────
// Huge 7-seg seconds-remaining display, NAR logo above, progress bar below.
// When uCountdown crosses zero, the frame flashes red with a pulsing logo —
// the operator's cue to cut to the actual program.
vec3 mCountdown(vec2 uv, vec2 tuv) {
  vec3 col = vec3(0.018, 0.022, 0.045);
  bool past = uCountdown <= 0.0;

  if (past) {
    // LIVE flash — red strobe + huge logo pulsing
    float flash = 0.5 + 0.5 * sin(uTime * 6.0 * 6.2831853);
    col = mix(vec3(0.95, 0.10, 0.12), vec3(0.10, 0.02, 0.04), 0.5 + 0.5 * (1.0 - flash));
    float logoH = 0.30;
    float logoW = logoH * 3.74 * (uRes.y / uRes.x);
    float lx0 = 0.5 - logoW * 0.5;
    float ly0 = 0.5 - logoH * 0.5;
    if (tuv.x > lx0 && tuv.x < lx0 + logoW && tuv.y > ly0 && tuv.y < ly0 + logoH) {
      vec2 lu = vec2((tuv.x - lx0) / logoW, 1.0 - (tuv.y - ly0) / logoH);
      vec4 lt = texture(uLogo, lu);
      col = mix(col, lt.rgb, lt.a);
    }
    return col;
  }

  // Active countdown — logo top, big digits centre, progress bar bottom
  float logoH = 0.12;
  float logoW = logoH * 3.74 * (uRes.y / uRes.x);
  float lx0 = 0.5 - logoW * 0.5;
  float ly0 = 0.78;
  if (tuv.x > lx0 && tuv.x < lx0 + logoW && tuv.y > ly0 && tuv.y < ly0 + logoH) {
    vec2 lu = vec2((tuv.x - lx0) / logoW, 1.0 - (tuv.y - ly0) / logoH);
    vec4 lt = texture(uLogo, lu);
    col = mix(col, lt.rgb, lt.a);
  }

  int sec = int(ceil(uCountdown));
  if (sec > 99) sec = 99;
  if (sec < 0) sec = 0;
  vec3 onCol = vec3(0.98, 0.62, 0.14);
  vec3 offCol = vec3(0.04, 0.05, 0.10);
  float dhw = 0.13, dhh = 0.24;

  if (sec >= 10) {
    int t = sec / 10;
    int o = sec - t * 10;
    vec2 p1 = (uv - vec2(-0.20, 0.0)) * vec2(1.0 / dhw, 1.0 / dhh);
    if (abs(p1.x) < 1.15 && abs(p1.y) < 1.15) col += sevenSeg(p1, t, onCol, offCol);
    vec2 p2 = (uv - vec2( 0.20, 0.0)) * vec2(1.0 / dhw, 1.0 / dhh);
    if (abs(p2.x) < 1.15 && abs(p2.y) < 1.15) col += sevenSeg(p2, o, onCol, offCol);
  } else {
    vec2 p = uv * vec2(1.0 / dhw, 1.0 / dhh);
    if (abs(p.x) < 1.15 && abs(p.y) < 1.15) col += sevenSeg(p, sec, onCol, offCol);
  }

  // Progress bar at the bottom
  float barY = 0.12;
  float barHalfW = 0.42;
  float barH = 0.020;
  if (abs(tuv.y - barY) < barH && abs(tuv.x - 0.5) < barHalfW) {
    col = vec3(0.06, 0.07, 0.13);
    float progress = uCountdownDuration > 0.001
      ? 1.0 - uCountdown / uCountdownDuration : 0.0;
    float fillEdge = (0.5 - barHalfW) + barHalfW * 2.0 * progress;
    if (tuv.x < fillEdge) col = onCol;
  }

  // Per-second tick pulse — brightens just before each integer second
  float frac = fract(uCountdown);
  col += vec3(0.18, 0.10, 0.04) * (1.0 - frac) * 0.6;

  return col;
}

// ── Mode 32: Slate — SMPTE 75% bars + station ident + clock ──────────────────
// Cut here pre-broadcast for monitor alignment + a clean station holding card.
vec3 mSlate(vec2 uv, vec2 tuv) {
  // SMPTE 75% colour bars across the top 75% of the frame
  if (tuv.y > 0.25) {
    int bar = int(clamp(tuv.x * 7.0, 0.0, 6.9999));
    if (bar == 0) return vec3(0.75);
    if (bar == 1) return vec3(0.75, 0.75, 0.0);
    if (bar == 2) return vec3(0.0, 0.75, 0.75);
    if (bar == 3) return vec3(0.0, 0.75, 0.0);
    if (bar == 4) return vec3(0.75, 0.0, 0.75);
    if (bar == 5) return vec3(0.75, 0.0, 0.0);
    return vec3(0.0, 0.0, 0.75);
  }

  // ── Slate strip (bottom 25%) — navy with ident + clock ──
  vec3 col = vec3(0.018, 0.022, 0.045);

  // NAR logo on the left, vertically centred in the strip.
  float logoH = 0.15;
  float logoW = logoH * 3.74 * (uRes.y / uRes.x);
  if (tuv.x > 0.04 && tuv.x < 0.04 + logoW && tuv.y > 0.05 && tuv.y < 0.20) {
    vec2 lu = vec2((tuv.x - 0.04) / logoW, 1.0 - (tuv.y - 0.05) / logoH);
    vec4 lt = texture(uLogo, lu);
    col = mix(col, lt.rgb, lt.a);
  }

  // 7-segment HH:MM:SS clock on the right in brand amber.
  vec3 onCol  = vec3(0.98, 0.62, 0.14);
  vec3 offCol = vec3(0.06, 0.07, 0.12);
  int hh = int(uTimeH + 0.5);
  int mm = int(uTimeM + 0.5);
  int ss = int(uTimeS + 0.5);

  float dhw = 0.020, dhh = 0.060, cy = 0.125;
  float cxs[8];
  cxs[0] = 0.620; cxs[1] = 0.670; cxs[2] = 0.710; cxs[3] = 0.745;
  cxs[4] = 0.795; cxs[5] = 0.835; cxs[6] = 0.870; cxs[7] = 0.920;
  int vals[8];
  vals[0] = hh / 10;                    vals[1] = hh - (hh / 10) * 10;
  vals[2] = -2;                         vals[3] = mm / 10;
  vals[4] = mm - (mm / 10) * 10;        vals[5] = -2;
  vals[6] = ss / 10;                    vals[7] = ss - (ss / 10) * 10;

  for (int i = 0; i < 8; i++) {
    if (vals[i] == -2) {
      // colon — two small dots
      float d1 = length(tuv - vec2(cxs[i], cy - 0.030));
      float d2 = length(tuv - vec2(cxs[i], cy + 0.030));
      float m = 1.0 - smoothstep(0.006, 0.009, min(d1, d2));
      col = mix(col, onCol, m);
    } else {
      vec2 p = vec2((tuv.x - cxs[i]) / dhw, (tuv.y - cy) / dhh);
      if (abs(p.x) < 1.15 && abs(p.y) < 1.15) col += sevenSeg(p, vals[i], onCol, offCol);
    }
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - 0.5 * uRes) / uRes.y;
  vec2 tuv = frag / uRes;

  vec3 fresh;
  if (uMode == 1) fresh = mTunnel(uv);
  else if (uMode == 2) fresh = mAurora(uv);
  else if (uMode == 3) fresh = mRaymarch(uv);
  else if (uMode == 4) fresh = mFractal(uv);
  else if (uMode == 5) fresh = mLightpaint(uv);
  else if (uMode == 6) fresh = mSpectrum(tuv);
  else if (uMode == 7) fresh = mVu(tuv);
  else if (uMode == 8) fresh = mWaveform(tuv);
  else if (uMode == 9) fresh = mRadial(uv);
  else if (uMode == 10) fresh = mCorridor(uv);
  else if (uMode == 11) fresh = mWarp(uv);
  else if (uMode == 12) fresh = mHexTunnel(uv);
  else if (uMode == 13) fresh = mRings(uv);
  else if (uMode == 14) fresh = mPlexus(uv);
  else if (uMode == 15) fresh = mScope(uv);
  else if (uMode == 16) fresh = mWaveRing(uv);
  else if (uMode == 17) fresh = mGrid(tuv);
  else if (uMode == 18) fresh = mOrbits(uv);
  else if (uMode == 19) fresh = mLiquid(uv);
  else if (uMode == 20) fresh = mStarfield(uv);
  else if (uMode == 21) fresh = mRibbon(uv);
  else if (uMode == 22) fresh = mHelix(uv);
  else if (uMode == 23) fresh = mGalaxy(uv);
  else if (uMode == 24) fresh = mTerrain(uv);
  else if (uMode == 25) fresh = mFluid(uv, tuv);
  else if (uMode == 26) fresh = mLogoMark(uv);
  else if (uMode == 27) fresh = mCymatics(uv);
  else if (uMode == 28) fresh = mLiveCam(uv, tuv);
  else if (uMode == 29) fresh = mLiveMosaic(uv, tuv);
  else if (uMode == 30) fresh = mPIP(uv, tuv);
  else if (uMode == 31) fresh = mPaceDisplay(uv, tuv);
  else if (uMode == 32) fresh = mSlate(uv, tuv);
  else if (uMode == 33) fresh = mCountdown(uv, tuv);
  else fresh = mNebula(uv);

  // Per-mode frame feedback — light trails for the flow modes, heavy
  // light-painting for mode 5. Meter modes (6-9) stay crisp (no feedback).
  float fbAmt = 0.0, fbZoom = 1.0, fbRot = 0.0;
  if (uMode == 5)      { fbAmt = 0.945; fbZoom = 0.992; fbRot = 0.010 + 0.03 * uBeat; }
  else if (uMode == 1) { fbAmt = 0.16;  fbZoom = 1.0;   fbRot = 0.0; }
  else if (uMode == 12){ fbAmt = 0.16;  fbZoom = 1.0;   fbRot = 0.0; }
  else if (uMode == 11){ fbAmt = 0.32;  fbZoom = 1.0;   fbRot = 0.0; }  // warp — streak trails
  else if (uMode == 15){ fbAmt = 0.45;  fbZoom = 1.0;   fbRot = 0.0; }  // scope phosphor trail
  else if (uMode == 0) { fbAmt = 0.34;  fbZoom = 0.997; fbRot = 0.0016; }
  else if (uMode == 20){ fbAmt = 0.38;  fbZoom = 1.0;   fbRot = 0.0; }  // starfield motion blur
  else if (uMode == 19){ fbAmt = 0.16;  fbZoom = 0.999; fbRot = 0.0; }  // liquid — faint trail
  else if (uMode == 23){ fbAmt = 0.26;  fbZoom = 0.998; fbRot = 0.0; }  // galaxy — soft inward glow trail

  vec3 col = fresh;
  if (fbAmt > 0.0) {
    vec2 ctr = vec2(0.5);
    vec2 d = tuv - ctr;
    d.x *= uRes.x / uRes.y;
    d = rot(fbRot) * d * fbZoom;
    d.x *= uRes.y / uRes.x;
    vec2 fbUv = ctr + d;
    // MilkDrop-style per-pixel warp — the feedback sample is domain-warped by a
    // slow noise field, so trails curl and flow instead of just zooming.
    float wAmt = (uMode == 5) ? 0.016 : (uMode == 0) ? 0.011 : 0.0;
    if (wAmt > 0.0) {
      float wt = uTime * 0.07;
      fbUv += (vec2(fbm(tuv * 3.0 + wt), fbm(tuv * 3.0 - wt + 17.3)) - 0.5)
              * wAmt * (1.0 + 1.4 * uBass);
    }
    vec3 prev = texture(uPrev, fbUv).rgb;
    col = (uMode == 5) ? prev * fbAmt + fresh : mix(fresh, prev, fbAmt);
  }

  fragColor = vec4(max(col, 0.0), 1.0);
}`

// ── Bright-pass — extract the glowing parts for bloom ───────────────────────
export const BRIGHT_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform vec2 uRes;
void main() {
  vec3 c = texture(uScene, gl_FragCoord.xy / uRes).rgb;
  // Saturation-aware brightness: blend luma with the peak channel so a bright
  // blue or red neon blooms as readily as a bright white — luma alone would
  // starve saturated colours of glow (blue's luma weight is only 0.114).
  float l = max(dot(c, vec3(0.299, 0.587, 0.114)), max(c.r, max(c.g, c.b)) * 0.85);
  // Higher threshold (0.78 vs the old 0.60) so only true highlights leak into
  // the bloom buffer — the previous setting blew up midtones into a haze.
  fragColor = vec4(c * smoothstep(0.78, 1.10, l), 1.0);
}`

// ── Separable Gaussian blur (9-tap) ─────────────────────────────────────────
export const BLUR_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;
uniform vec2 uDir;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 px = uDir / uRes;
  vec3 c = texture(uTex, uv).rgb * 0.227027;
  c += (texture(uTex, uv + px * 1.5).rgb + texture(uTex, uv - px * 1.5).rgb) * 0.194595;
  c += (texture(uTex, uv + px * 3.0).rgb + texture(uTex, uv - px * 3.0).rgb) * 0.121622;
  c += (texture(uTex, uv + px * 4.5).rgb + texture(uTex, uv - px * 4.5).rgb) * 0.054054;
  c += (texture(uTex, uv + px * 6.0).rgb + texture(uTex, uv - px * 6.0).rgb) * 0.016216;
  fragColor = vec4(c, 1.0);
}`

// ── Composite — bloom, kaleidoscope, filmic grade, dither ───────────────────
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2  uRes;
uniform float uTime;
uniform float uIntensity;
uniform float uBeat, uTreble;
uniform int   uKaleido;
// True final master — applied AFTER bloom, flares, dirt and grain so dropping
// it to 0 actually darkens the picture (uIntensity only attenuates the scene
// pre-bloom, which leaves bright post-fx visible).
uniform float uVizBrightness;
// Operator-controlled bloom dose. Scales the bloom sum, the anamorphic flare
// contribution AND the lens-dirt sparkle together so they always feel like
// one knob, not three controls fighting each other.
uniform float uBloomAmount;

vec2 kaleido(vec2 uv, float seg) {
  vec2 c = uv - 0.5;
  c.x *= uRes.x / uRes.y;
  float a = atan(c.y, c.x);
  float r = length(c);
  float k = 6.28318 / seg;
  a = abs(mod(a, k) - k * 0.5);
  vec2 p = vec2(cos(a), sin(a)) * r;
  p.x *= uRes.y / uRes.x;
  return p + 0.5;
}

// ACES filmic tonemap (Narkowicz) — rich contrast, graceful highlight rolloff.
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uKaleido > 0) uv = kaleido(uv, float(uKaleido));

  // Beat-driven micro camera shake — a touch of handheld energy on each hit.
  vec2 shake = vec2(
    sin(uTime * 31.0) + sin(uTime * 14.7),
    cos(uTime * 27.0) + sin(uTime * 19.3)
  ) * 0.00085 * uBeat;
  uv += shake;

  // Mild barrel distortion — the frame reads as "shot through a lens" instead
  // of a flat plane; a big lift toward broadcast-grade with almost no cost.
  vec2 d = uv - 0.5;
  uv = 0.5 + d * (1.0 + 0.05 * dot(d, d));
  d = uv - 0.5;

  // Radial chromatic aberration — stronger toward the edges, like a real lens.
  float ca = (0.0010 + 0.0020 * uBeat) * (1.0 + 1.4 * dot(d, d));
  vec3 col;
  col.r = texture(uScene, uv + d * ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - d * ca).b;

  col *= uIntensity;

  // multi-scale bloom — summing several mip levels of the glow buffer gives a
  // tight bright core with a wide, soft cinematic falloff (vs a single scale).
  // Outer mips trimmed (haze contributor); operator amount scales the whole sum.
  vec3 bloomC = textureLod(uBloom, uv, 0.0).rgb * 0.42
              + textureLod(uBloom, uv, 1.0).rgb * 0.22
              + textureLod(uBloom, uv, 2.0).rgb * 0.12
              + textureLod(uBloom, uv, 3.0).rgb * 0.06
              + textureLod(uBloom, uv, 4.0).rgb * 0.03;
  col += bloomC * (0.30 + 0.14 * uBeat) * uBloomAmount;

  // Anamorphic horizontal flare — bright spots leave soft horizontal streaks,
  // the unmistakable lens character of cinema/broadcast. Sampled from mip 1 so
  // the streaks are inherently soft and the cost stays low.
  vec3 anam = vec3(0.0);
  for (int i = 1; i <= 4; i++) {
    vec2 off = vec2(float(i) * 0.020, 0.0);
    anam += textureLod(uBloom, uv + off, 1.0).rgb;
    anam += textureLod(uBloom, uv - off, 1.0).rgb;
  }
  col += anam * 0.045 * (0.45 + 0.20 * uBeat) * uBloomAmount;

  // rich blacks — a deep cool base so the picture is never dead-flat black
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += vec3(0.022, 0.026, 0.040) * (1.0 - smoothstep(0.0, 0.10, lum));

  // broadcast-grade highlight desaturation — colours that push past white
  // gracefully desaturate toward grey instead of clipping to neon mush
  col = mix(col, vec3(lum), smoothstep(1.0, 1.7, lum) * 0.20);

  // gentle luminance lift on the beat — controlled, never a full-screen flash
  col *= 1.0 + 0.035 * uBeat;

  // soft vignette
  float vig = clamp(1.0 - 0.78 * dot(d, d), 0.0, 1.0);
  col *= mix(0.66, 1.0, vig);

  // filmic grade — slightly reduced exposure for a more controlled rolloff
  col = aces(col * 1.10);

  // Lens dirt — sparse warm-white speckles that ONLY shine through where bloom
  // is bright. Scales with the bloom amount so killing bloom kills the dirt too.
  float dirt = pow(hash12(floor(gl_FragCoord.xy * 0.65)), 18.0);
  col += vec3(0.96, 0.98, 1.00) * dirt * dot(bloomC, vec3(0.4)) * 0.55 * uBloomAmount;

  // fine grain — slightly stronger so the image feels photographic, not digital
  float gr = hash12(gl_FragCoord.xy + fract(uTime) * 113.0);
  col += (gr - 0.5) * 0.016;

  // triangular-PDF dither — removes 8-bit banding in gradients
  float d1 = hash12(gl_FragCoord.xy + 0.17);
  float d2 = hash12(gl_FragCoord.xy + 0.83);
  col += (d1 + d2 - 1.0) / 255.0;

  // True final master — see uniform comment. Multiplies the fully-composited
  // image so 0 = black, 1 = unity, >1 boosts (clamp catches blow-out).
  col *= uVizBrightness;

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

// ── Custom-shader preamble ──────────────────────────────────────────────────
// Prepended to user-supplied / ISF shaders so they compile in our WebGL2
// context. Provides the standard uniforms plus ISF compatibility aliases.
export const CUSTOM_PREAMBLE = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2  uRes;
uniform float uTime, uLevel, uBass, uMid, uTreble, uBeat, uCentroid, uBeatPhase;
uniform sampler2D uSpectrum;
uniform sampler2D uWave;
uniform sampler2D uPrev;
uniform sampler2D uLogo;
uniform sampler2D uCam0;
uniform sampler2D uCam1;
uniform sampler2D uCam2;
uniform sampler2D uCam3;
uniform int uCamPick;
uniform float uBpm;
uniform float uBarPhase;
uniform float uBpmLocked;
uniform float uTimeH;
uniform float uTimeM;
uniform float uTimeS;
uniform float uCountdown;
uniform float uCountdownDuration;
#define RENDERSIZE uRes
#define TIME uTime
#define isf_FragNormCoord (gl_FragCoord.xy / uRes)
#define texture2D texture
// ── ShaderToy compatibility ────────────────────────────────────────────────
#define iResolution vec3(uRes, 1.0)
#define iTime uTime
#define iGlobalTime uTime
#define iTimeDelta 0.0166667
#define iFrame 0
#define iFrameRate 60.0
#define iMouse vec4(0.0)
#define iDate vec4(2026.0, 1.0, 1.0, 0.0)
#define iSampleRate 48000.0
#define iChannel0 uSpectrum
#define iChannel1 uWave
#define iChannel2 uPrev
#define iChannel3 uPrev
`
