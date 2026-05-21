/**
 * Custom visualizer shaders — user-supplied GLSL fragment shaders loaded from a
 * folder at runtime, so a designer can add looks without rebuilding the app.
 * Modern GLSL ES 3.00 works directly; many single-pass ISF generators load via
 * a light compatibility shim applied in the renderer.
 */
import { app, shell } from 'electron'
import fs from 'fs'
import path from 'path'

const EXAMPLE = `// NAR Studio — custom visualizer shader (GLSL ES 3.00 fragment).
// Provided uniforms:
//   vec2  uRes        output resolution in pixels
//   float uTime       seconds
//   float uLevel uBass uMid uTreble   band energies, 0..1
//   float uBeat       decaying beat envelope, 0..1
//   float uCentroid   brightness 0..1   uBeatPhase  0..1 beat clock
//   sampler2D uSpectrum   256-wide spectrum — sample .r at x in 0..1
//   sampler2D uWave       256-wide waveform — .r is 0..1, centre 0.5
//   sampler2D uPrev       the previous frame
// Write fragColor in main(). Bloom and the colour grade are applied after.
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float r = length(uv);
  float s = texture(uSpectrum, vec2(r * 1.4, 0.5)).r;
  vec3 col = vec3(0.92, 0.18, 0.32) * exp(-r * 4.0) * (0.4 + 2.2 * uBass);
  col += vec3(1.0, 0.62, 0.20) * pow(s, 1.3) * smoothstep(1.2, 0.08, r);
  fragColor = vec4(col, 1.0);
}
`

const README = `NAR Studio — Visualizer Shaders
================================

Drop GLSL fragment shaders (.glsl, .fs or .frag) in this folder. Each one
becomes a selectable mode in the Viz panel, under "Custom". Edits reload live.

Write a modern GLSL ES 3.00 fragment shader with a main() that sets fragColor.
See example.glsl for the uniforms available to you.

ShaderToy shaders: paste a single-pass ShaderToy shader straight in. The app
provides iResolution, iTime, iTimeDelta, iFrame, iMouse, iDate, iSampleRate and
iChannel0-3, and synthesises a main() around your mainImage(). iChannel0 is the
spectrum, iChannel1 the waveform — so audio-reactive ShaderToys work. Multi-pass
ShaderToys (Buffer A/B/C/D) and ones needing texture/cubemap/video inputs are
not supported — use the "Image" tab shader only.

ISF shaders: many single-pass ISF generators load too — the app aliases TIME,
RENDERSIZE and isf_FragNormCoord and remaps gl_FragColor. Multi-pass ISF, and
shaders needing image inputs or custom INPUTS, are not supported.

A shader that fails to compile is skipped (it just won't appear) — the rest
keep working.
`

class VizShaders {
  private dir = ''

  init() {
    this.dir = path.join(app.getPath('documents'), 'NAR Studio', 'Visualizer Shaders')
    try {
      fs.mkdirSync(this.dir, { recursive: true })
      const readme = path.join(this.dir, 'README.txt')
      if (!fs.existsSync(readme)) fs.writeFileSync(readme, README)
      const example = path.join(this.dir, 'example.glsl')
      if (!fs.existsSync(example)) fs.writeFileSync(example, EXAMPLE)
    } catch (e) {
      console.error('[viz-shaders] init failed:', e)
    }
  }

  /** All custom shader files — name (no extension) + raw GLSL source. */
  list(): { name: string; source: string }[] {
    if (!this.dir) return []
    try {
      return fs.readdirSync(this.dir)
        .filter(f => /\.(glsl|fs|frag)$/i.test(f))
        .sort()
        .map(f => {
          try {
            return {
              name: f.replace(/\.[^.]+$/, ''),
              source: fs.readFileSync(path.join(this.dir, f), 'utf8'),
            }
          } catch { return null }
        })
        .filter((x): x is { name: string; source: string } => x != null)
    } catch {
      return []
    }
  }

  watch(cb: () => void) {
    if (!this.dir) return
    let t: ReturnType<typeof setTimeout> | null = null
    try {
      fs.watch(this.dir, () => {
        if (t) clearTimeout(t)
        t = setTimeout(cb, 250)   // debounce editor saves
      })
    } catch { /* ignore */ }
  }

  openFolder() {
    return this.dir ? shell.openPath(this.dir) : Promise.resolve('')
  }
}

export const vizShaders = new VizShaders()
