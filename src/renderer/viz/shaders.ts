// GLSL ES 3.00 — multi-pass audio-reactive visualizer.
//
// Pipeline:  scene (with frame-feedback) → bright-pass → blur ×4 → composite.
// The scene shader carries 23 modes branched by uMode — geometric neon looks,
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
    vec3(0.043,0.012,0.063), vec3(0.255,0.035,0.110), vec3(0.741,0.043,0.180),
    vec3(0.984,0.451,0.137), vec3(1.000,0.929,0.792));
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

// Distance to a hexagon edge — 0 at centre, 0.5 at the edge.
float hexDist(vec2 p) {
  p = abs(p);
  return max(p.x * 0.5 + p.y * 0.866, p.x);
}
// Hex tiling: .xy = local coord within the cell, .zw = cell id.
vec4 hexCell(vec2 p) {
  vec2 r = vec2(1.0, 1.732);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, p - gv);
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
  return col * 1.1;
}

// ── Mode 1: Tunnel — clean geometric neon tunnel ────────────────────────────
vec3 mTunnel(vec2 uv) {
  float r = length(uv);
  float a = atan(uv.y, uv.x) + uTime * 0.06;          // slow hypnotic rotation
  float speed = 0.6 + 1.6 * uBass + 0.9 * uBeat;
  float depth = 0.40 / (r + 0.05) + uTime * speed;
  float ang = a / 6.2831853;

  vec3 col = vec3(0.0);

  // longitudinal ribs running into the distance
  float rib = neon(fract(ang * 18.0) - 0.5, 0.04);
  col += palette(0.62) * rib * smoothstep(0.0, 0.42, r) * 0.55;

  // rings flying toward the camera — brightness tracks the spectrum
  float ringAmp = spec(fract(depth * 0.11));
  float ring = neon(fract(depth) - 0.5, 0.05 + 0.05 * ringAmp);
  col += palette(0.30 + 0.5 * ringAmp) * ring * (0.35 + 1.7 * ringAmp);

  // bright vanishing point + depth haze
  col += palette(0.9) * exp(-r * 5.5) * (0.5 + 1.3 * uBass + 0.8 * uBeat);

  col *= smoothstep(1.35, 0.10, r);
  return col * (0.85 + 0.5 * uLevel);
}

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
    col += palette(0.15 + fi * 0.16 + uv.y * 0.25 + uTreble * 0.2) * curtain * (0.5 + 0.7 * uLevel);
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
  col += palette(0.55 + uMid * 0.3) * glow * 0.045;
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
  col += palette(0.5) * exp(-trap * 3.0) * (0.6 + 1.6 * uBass);
  return col * (0.6 + 0.7 * uLevel);
}

// ── Mode 5: Lightpaint — sparse seeds smeared by the feedback buffer ────────
vec3 mLightpaint(vec2 uv) {
  vec3 col = vec3(0.0);
  float a = atan(uv.y, uv.x), rad = length(uv);
  float ang = a / 6.28318 + 0.5;
  float s = spec(abs(ang * 2.0 - 1.0));
  float ringR = 0.32 + 0.42 * s;
  float ring = exp(-abs(rad - ringR) * 64.0) * (0.4 + 1.8 * s);
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
  col += palette(0.1) * smoothstep(0.005, 0.0, abs(tuv.y - baseY)) * 0.7;
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
  col += wc * smoothstep(0.07, 0.0, d) * 0.22;          // soft glow
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
  col += palette(0.12) * smoothstep(0.006, 0.0, abs(rad - ringR + 0.013)) * (0.6 + 1.5 * uLevel);
  col += palette(0.05 + 0.3 * uBass) * smoothstep(ringR - 0.008, 0.0, rad)
         * (0.22 + 0.95 * uBass + 0.6 * uBeat);
  return col;
}

// ── Mode 10: Corridor — neon grid flythrough ────────────────────────────────
vec3 mCorridor(vec2 uv) {
  vec3 col = vec3(0.0);
  float speed = 1.2 + 3.0 * uBass + 1.6 * uBeat;
  float ay = abs(uv.y);

  if (ay > 0.0035) {
    float z = 0.16 / ay;                       // depth — huge toward the horizon
    float wx = uv.x * z * 2.6;                 // perspective-divided lane
    float wz = z + uTime * speed;
    float gx = neon(fract(wx) - 0.5, 0.022);
    float gz = neon(fract(wz) - 0.5, 0.022);
    float amp = spec(clamp(abs(uv.x) * 1.4, 0.0, 1.0));
    float face = uv.y < 0.0 ? 1.0 : 0.5;       // bright floor, dim ceiling
    col += palette(0.34 + 0.42 * amp) * (gx + gz) * face
           * exp(-z * 0.06) * smoothstep(0.0, 0.05, ay) * (0.45 + 1.6 * amp);
  }

  // horizon glow band + synth sun
  col += palette(0.82) * exp(-ay * 11.0) * (0.7 + 1.6 * uBass + uBeat);
  float sun = length(vec2(uv.x, uv.y * 2.4));
  col += palette(0.55) * smoothstep(0.30, 0.04, sun) * (0.5 + 0.5 * uLevel);
  return col * 1.15;
}

// ── Mode 11: Warp — hyperspace streak field ─────────────────────────────────
vec3 mWarp(vec2 uv) {
  vec3 col = vec3(0.0);
  float r = length(uv);
  float a = atan(uv.y, uv.x) + uTime * 0.04;
  float ang = a / 6.2831853 + 0.5;
  float id = floor(ang * 70.0);
  float seed = hash11(id);

  float line = neon(fract(ang * 70.0) - 0.5, 0.04 + 0.05 * seed);
  float speed = 0.25 + 1.2 * uBass + 0.6 * seed;
  float headR = fract(uTime * speed + seed) * 1.5;
  float tail = headR - r;
  float dash = step(0.0, tail) * smoothstep(0.5, 0.0, tail);
  float amp = 0.4 + 1.8 * spec(seed);
  col += palette(0.35 + 0.45 * seed) * line * dash * amp * smoothstep(1.5, 0.25, r);

  // hot core
  col += palette(0.92) * exp(-r * 6.5) * (0.5 + 1.5 * uBass + uBeat);
  return col * 1.25;
}

// ── Mode 12: Hex — hexagonal neon tunnel flythrough ─────────────────────────
vec3 mHexTunnel(vec2 uv) {
  float r = length(uv);
  float a = atan(uv.y, uv.x) + uTime * 0.05;
  float speed = 0.5 + 1.4 * uBass + 0.8 * uBeat;
  float depth = 0.42 / (r + 0.05) + uTime * speed;
  float ang = a / 6.2831853;

  vec4 hc = hexCell(vec2(ang * 9.0, depth * 2.2));
  float ed = hexDist(hc.xy);                          // 0 centre … 0.5 edge
  float cellAmp = spec(fract(hc.z * 0.07 + hc.w * 0.13));

  vec3 col = palette(0.34 + 0.46 * cellAmp) * neon(0.5 - ed, 0.06) * (0.4 + 1.7 * cellAmp);
  col += palette(0.28) * smoothstep(0.18, 0.0, ed) * cellAmp * 0.7;
  col += palette(0.9) * exp(-r * 5.5) * (0.5 + 1.3 * uBass + 0.8 * uBeat);
  col *= smoothstep(1.35, 0.10, r);
  return col * (0.85 + 0.5 * uLevel);
}

// ── Mode 13: Rings — concentric neon pulses ─────────────────────────────────
vec3 mRings(vec2 uv) {
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  float speed = 0.35 + 0.9 * uBass;
  float phase = r * 6.0 - uTime * speed - uBeat * 0.6;
  float amp = spec(fract(floor(phase) * 0.11));
  vec3 col = palette(0.30 + 0.5 * amp)
             * neon(fract(phase) - 0.5, 0.07 + 0.05 * amp) * (0.4 + 1.7 * amp);
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
             * (0.35 + 0.6 * spec(hash21(id))) * lvl;
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
  col += palette(0.92) * neon(length(uv - scope(1.0) * 0.46), 0.018) * 1.3;
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
  col += wc * smoothstep(0.06, 0.0, d) * 0.18;
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
  col += palette(0.16 + rowFrac * 0.66) * dotMask * lit * (0.55 + 1.0 * h);
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
    col += palette(0.2 + fi * 0.14 + band * 0.2) * node * (0.4 + 2.0 * band);
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
    col += vec3(1.0, 0.98, 0.94) * spe * 1.6;              // hot specular
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
    float thick = (0.020 + 0.05 * abs(w) + 0.03 * uLevel) * scale;
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
    col += palette(0.22 + 0.5 * t + 0.2 * band) * nA * (0.4 + 1.9 * band) * (0.55 + 0.45 * depthA);
    float dB = length(uv - pB);
    float rB = (0.013 + 0.05 * band) * perspB;
    float nB = rB / (dB + rB); nB *= nB;
    col += palette(0.22 + 0.5 * t + 0.2 * band) * nB * (0.4 + 1.9 * band) * (0.55 + 0.45 * depthB);
  }
  col += palette(0.05 + 0.30 * uBass) * exp(-length(uv) * 3.0) * (0.22 + 0.9 * uBass + 0.5 * uBeat);
  return col * (0.78 + 0.5 * uLevel);
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
  else fresh = mNebula(uv);

  // Per-mode frame feedback — light trails for the flow modes, heavy
  // light-painting for mode 5. Meter modes (6-9) stay crisp (no feedback).
  float fbAmt = 0.0, fbZoom = 1.0, fbRot = 0.0;
  if (uMode == 5)      { fbAmt = 0.945; fbZoom = 0.992; fbRot = 0.010 + 0.03 * uBeat; }
  else if (uMode == 1) { fbAmt = 0.22;  fbZoom = 0.994; fbRot = 0.0; }
  else if (uMode == 12){ fbAmt = 0.20;  fbZoom = 0.994; fbRot = 0.0; }
  else if (uMode == 15){ fbAmt = 0.45;  fbZoom = 1.0;   fbRot = 0.0; }  // scope phosphor trail
  else if (uMode == 0) { fbAmt = 0.34;  fbZoom = 0.997; fbRot = 0.0016; }
  else if (uMode == 20){ fbAmt = 0.38;  fbZoom = 1.0;   fbRot = 0.0; }  // starfield motion blur
  else if (uMode == 19){ fbAmt = 0.16;  fbZoom = 0.999; fbRot = 0.0; }  // liquid — faint trail

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
    float wAmt = (uMode == 5) ? 0.016 : (uMode == 0) ? 0.011
               : (uMode == 1 || uMode == 12) ? 0.006 : 0.0;
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
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(c * smoothstep(0.62, 1.10, l), 1.0);
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

  vec2 d = uv - 0.5;
  // restrained chromatic aberration — a hint of lens character, no fringing
  float ca = 0.0010 + 0.0022 * uBeat;
  vec3 col;
  col.r = texture(uScene, uv + d * ca).r;
  col.g = texture(uScene, uv).g;
  col.b = texture(uScene, uv - d * ca).b;

  col *= uIntensity;

  // soft, controlled bloom — glow on genuine highlights, not a haze
  col += texture(uBloom, uv).rgb * (0.70 + 0.35 * uBeat);

  // rich blacks — a deep cool base so the picture is never dead-flat black
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += vec3(0.018, 0.022, 0.034) * (1.0 - smoothstep(0.0, 0.10, lum));

  // gentle luminance lift on the beat — no full-screen colour wash
  col *= 1.0 + 0.05 * uBeat;

  // soft vignette
  float vig = clamp(1.0 - 0.78 * dot(d, d), 0.0, 1.0);
  col *= mix(0.64, 1.0, vig);

  // filmic grade
  col = aces(col * 1.2);

  // fine grain — subtle texture
  float gr = hash12(gl_FragCoord.xy + fract(uTime) * 113.0);
  col += (gr - 0.5) * 0.012;

  // triangular-PDF dither — removes 8-bit banding in gradients
  float d1 = hash12(gl_FragCoord.xy + 0.17);
  float d2 = hash12(gl_FragCoord.xy + 0.83);
  col += (d1 + d2 - 1.0) / 255.0;

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
