// GLSL ES 3.00 shader sources for the colour-grading engine.
// Self-contained — no imports outside src/renderer/grade/.

/** Vertex shader: full-screen triangle/quad, passes through UVs. */
export const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texcoord;

out vec2 v_uv;

void main() {
  v_uv = a_texcoord;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * Fragment shader applying the full grade pipeline:
 *   input -> lift/gamma/gain -> contrast -> temperature/tint -> saturation -> 3D LUT
 *
 * With a neutral grade and u_useLut == 0 the output equals the input exactly.
 */
export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_source;   // current video/canvas frame
uniform sampler3D u_lut;      // 3D LUT (bound even when unused)

uniform vec3  u_lift;         // neutral 0
uniform vec3  u_gamma;        // neutral 1
uniform vec3  u_gain;         // neutral 1
uniform float u_contrast;     // neutral 1
uniform float u_saturation;   // neutral 1
uniform float u_temperature;  // neutral 0, range -1..1
uniform float u_tint;         // neutral 0, range -1..1

uniform int   u_useLut;       // 0 = off, 1 = on
uniform float u_lutSize;      // edge size of the cube
uniform vec3  u_lutDomainMin; // domain remap
uniform vec3  u_lutDomainMax;

// Rec. 709 luma weights.
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// ASC-CDL-ish slope/offset/power: out = pow(gain * (in + lift), 1/gamma).
vec3 applyLiftGammaGain(vec3 c) {
  vec3 v = u_gain * (c + u_lift);
  v = max(v, vec3(0.0));
  // Guard against division by zero / negative gamma.
  vec3 g = max(u_gamma, vec3(1e-4));
  return pow(v, vec3(1.0) / g);
}

// Contrast around a 0.5 pivot. u_contrast == 1 is identity.
vec3 applyContrast(vec3 c) {
  return (c - vec3(0.5)) * u_contrast + vec3(0.5);
}

// Temperature (warm/cool) + tint (magenta/green). All-zero is identity.
vec3 applyTemperatureTint(vec3 c) {
  // Temperature pushes red up / blue down for warm, opposite for cool.
  vec3 tempShift = vec3(u_temperature, 0.0, -u_temperature) * 0.2;
  // Tint pushes magenta (R+B) up / green down, or vice versa.
  vec3 tintShift = vec3(u_tint, -u_tint, u_tint) * 0.1;
  return c + tempShift + tintShift;
}

// Luma-preserving saturation. u_saturation == 1 is identity.
vec3 applySaturation(vec3 c) {
  float luma = dot(c, LUMA);
  return mix(vec3(luma), c, u_saturation);
}

// Trilinear 3D LUT lookup with domain remap. hardware sampler does the
// trilinear interpolation; we just compute the correct sample coordinate.
vec3 applyLut(vec3 c) {
  vec3 denom = max(u_lutDomainMax - u_lutDomainMin, vec3(1e-6));
  vec3 norm = clamp((c - u_lutDomainMin) / denom, 0.0, 1.0);
  // Map [0,1] to texel centres: 0.5/N .. (N-0.5)/N.
  float n = u_lutSize;
  vec3 coord = norm * ((n - 1.0) / n) + (0.5 / n);
  return texture(u_lut, coord).rgb;
}

void main() {
  vec3 c = texture(u_source, v_uv).rgb;

  c = applyLiftGammaGain(c);
  c = applyContrast(c);
  c = applyTemperatureTint(c);
  c = applySaturation(c);

  c = clamp(c, 0.0, 1.0);

  if (u_useLut == 1) {
    c = applyLut(c);
  }

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;
