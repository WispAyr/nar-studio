import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { VERT_SRC, SCENE_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG, CUSTOM_PREAMBLE } from './shaders'
import { NAR_LOGO_DATA_URI } from '../cg/narLogo'
import { useCameraStreams, MAX_CAMERAS } from '../camera/CameraStreamProvider'

const studio = (window as any).studio

const VIZ_W = 1920
const VIZ_H = 1080
const BLOOM_W = 480
const BLOOM_H = 270

/** Mode picker groups, in display order. */
export const VIZ_GROUPS = ['Geometric', 'Artistic', 'Meters'] as const

export const VIZ_MODES = [
  { id: 1, label: 'Tunnel', group: 'Geometric', hint: 'Clean geometric neon tunnel' },
  { id: 10, label: 'Corridor', group: 'Geometric', hint: 'Neon grid flythrough' },
  { id: 11, label: 'Warp', group: 'Geometric', hint: 'Hyperspace streak field' },
  { id: 12, label: 'Hex', group: 'Geometric', hint: 'Hexagonal neon tunnel' },
  { id: 13, label: 'Rings', group: 'Geometric', hint: 'Concentric neon pulses' },
  { id: 14, label: 'Plexus', group: 'Geometric', hint: 'Drifting neon node network' },
  { id: 0, label: 'Nebula', group: 'Artistic', hint: 'Domain-warped flow field' },
  { id: 2, label: 'Aurora', group: 'Artistic', hint: 'Calm spectral curtains' },
  { id: 3, label: 'Raymarch', group: 'Artistic', hint: '3D audio-morphed lattice' },
  { id: 4, label: 'Fractal', group: 'Artistic', hint: 'Audio-driven Julia set' },
  { id: 5, label: 'Lightpaint', group: 'Artistic', hint: 'Feedback-buffer light trails' },
  { id: 19, label: 'Liquid', group: 'Artistic', hint: 'Raymarched chrome metaball' },
  { id: 6, label: 'Spectrum', group: 'Meters', hint: 'Premium bar analyzer with peak-hold' },
  { id: 7, label: 'VU', group: 'Meters', hint: 'Stereo broadcast VU meters' },
  { id: 8, label: 'Waveform', group: 'Meters', hint: 'Live oscilloscope trace' },
  { id: 9, label: 'Radial', group: 'Meters', hint: 'Circular spectrum analyzer' },
  { id: 15, label: 'Scope', group: 'Meters', hint: 'X-Y stereo oscilloscope' },
  { id: 16, label: 'Wave Ring', group: 'Meters', hint: 'Circular live waveform' },
  { id: 17, label: 'Grid', group: 'Meters', hint: 'LED video-wall spectrum matrix' },
  { id: 18, label: 'Orbits', group: 'Geometric', hint: 'Concentric orbiting node rings' },
  { id: 20, label: 'Starfield', group: 'Geometric', hint: '3D volumetric star warp' },
  { id: 21, label: 'Ribbon', group: 'Geometric', hint: 'Flowing glossy neon ribbon' },
  { id: 22, label: 'Helix', group: 'Geometric', hint: 'Rotating double-helix of nodes' },
  { id: 24, label: 'Terrain', group: 'Geometric', hint: 'Raymarched audio mountain flythrough' },
  { id: 23, label: 'Galaxy', group: 'Artistic', hint: 'Audio-reactive spiral galaxy' },
  { id: 25, label: 'Fluid', group: 'Artistic', hint: 'Curl-noise advected dye fluid' },
  { id: 26, label: 'Logo Mark', group: 'Artistic', hint: 'Animated NAR ident with audio aura' },
  { id: 27, label: 'Cymatics', group: 'Artistic', hint: 'Chladni standing-wave patterns' },
  { id: 28, label: 'Live Cam', group: 'Artistic', hint: 'Live camera feed with audio-reactive treatment' },
  { id: 29, label: 'Live Mosaic', group: 'Artistic', hint: 'All 4 cameras tiled, beat-pulsed borders, program highlight' },
  { id: 30, label: 'PIP', group: 'Artistic', hint: 'Program camera + 3 insets — interview layout' },
  { id: 31, label: 'Pace Display', group: 'Meters', hint: 'Pioneer-style BPM, beat grid + phase indicator' },
  { id: 32, label: 'Slate', group: 'Meters', hint: 'SMPTE bars + NAR ident + clock — pre-broadcast holding card' },
  { id: 33, label: 'Countdown', group: 'Meters', hint: 'Pre-broadcast "going live in…" countdown with LIVE flash' },
] as const

export const VIZ_PALETTES = [
  { id: 0, label: 'NAR Ember', swatch: '#e5202b' },
  { id: 1, label: 'Neon', swatch: '#7c5cff' },
  { id: 2, label: 'Emerald', swatch: '#22c55e' },
  { id: 3, label: 'Ice', swatch: '#5b8dff' },
  { id: 4, label: 'Sunset', swatch: '#f97316' },
  { id: 5, label: 'Mono', swatch: '#cbd5e1' },
] as const

export interface VizLevels {
  bass: number
  mid: number
  treble: number
  /** Perceptual loudness, 0..1. */
  level: number
  /** Decaying 0..1 beat envelope. */
  beat: number
  /** performance.now()/1000 of the last detected onset — a discrete event marker. */
  beatAt: number
  /** Spectral centroid — perceived brightness, 0..1. */
  centroid: number
  /** 0..1 sawtooth through the current (tempo-tracked) beat. */
  beatPhase: number
  /** Tempo in beats-per-minute, smoothed from a window of recent IBIs. */
  bpm: number
  /** True when we have enough stable beats from real audio to trust the BPM. */
  bpmConfident: boolean
  /** Approximate momentary loudness in LUFS (K-weighted, ITU-R BS.1770). */
  lufs: number
  /** Smoothed render-loop frame rate, for the diagnostics widget. */
  fps: number
}

interface VizContextValue {
  /** The detached 1080p WebGL canvas the compositor draws from. */
  getCanvas: () => HTMLCanvasElement | null
  mode: number
  setMode: (m: number) => void
  palette: number
  setPalette: (p: number) => void
  intensity: number
  setIntensity: (i: number) => void
  /** 6-fold kaleidoscope fold on the final image. */
  kaleido: boolean
  setKaleido: (on: boolean) => void
  /** Auto-rotate through the modes so a long show never goes static. */
  autoCycle: boolean
  setAutoCycle: (on: boolean) => void
  /** True when the visualizer is locked onto the studio audio device. */
  audioActive: boolean
  /** Live band energies — read per-frame, never triggers a render. */
  levelsRef: MutableRefObject<VizLevels>
  /** Names of user-supplied custom shaders loaded from the shader folder. */
  customShaders: string[]
  /** Selected custom shader, or null when a built-in mode is active. */
  customMode: string | null
  setCustomMode: (name: string) => void
  /** Open the folder where custom shaders live. */
  openShaderFolder: () => void
  /** Which live camera the Live Cam mode (and any custom shader) reads (0–3). */
  camPick: number
  setCamPick: (i: number) => void
  /** When true, the Live Cam camera tracks whichever camera is on program. */
  camAuto: boolean
  setCamAuto: (on: boolean) => void
  /**
   * Trim on the audio fed into the visualizer analyser, in percent. Lives
   * separately from the broadcast gain — the operator can hit the viz hard
   * for tighter reactivity without affecting what the stream hears.
   */
  audioGain: number
  setAudioGain: (g: number) => void
  /**
   * Output brightness of the final composited image, in percent. 0 = black,
   * 100 = unity. Applied at the very end so bloom, flares and grain are all
   * attenuated together.
   */
  brightness: number
  setBrightness: (b: number) => void
  /**
   * Bloom dose, in percent. Scales the bloom + anamorphic flare + lens dirt
   * together so the operator can tone down the "halo soup" without touching
   * the base scene.
   */
  bloomAmount: number
  setBloomAmount: (b: number) => void
  /** Pre-broadcast countdown. -3 < seconds <= 0 enters the LIVE flash state. */
  countdownDuration: number
  startCountdown: (seconds: number) => void
  stopCountdown: () => void
  /**
   * Register a consumer of the visualizer. While at least one is held the GPU
   * pipeline renders; with none it idles (audio analysis keeps running).
   * Returns a release function. Prefer the `useVizActive` hook.
   */
  acquire: () => () => void
}

const Ctx = createContext<VizContextValue | null>(null)

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`[viz] shader compile failed: ${log}`)
  }
  return sh
}

function makeProgram(gl: WebGL2RenderingContext, fragSrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC)
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc)
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`[viz] program link failed: ${gl.getProgramInfoLog(prog)}`)
  }
  return prog
}

function uniformMap(
  gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[],
): Record<string, WebGLUniformLocation | null> {
  const map: Record<string, WebGLUniformLocation | null> = {}
  for (const n of names) map[n] = gl.getUniformLocation(prog, n)
  return map
}

interface RenderTarget { tex: WebGLTexture; fbo: WebGLFramebuffer }

function makeTarget(
  gl: WebGL2RenderingContext, w: number, h: number, mip = false,
): RenderTarget {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  // A mip target feeds the multi-scale bloom — it needs a trilinear min filter
  // and a complete mip chain (rebuilt each frame after the blur passes).
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  if (mip) gl.generateMipmap(gl.TEXTURE_2D)   // start mip-complete
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo }
}

/** Uniform names the scene shader — and any custom shader — may declare. */
const SCENE_UNIFORMS = [
  'uRes', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uMode', 'uPalette',
  'uSpectrum', 'uSpecPeak', 'uWave', 'uScope', 'uPrev',
  'uVuL', 'uVuR', 'uVuPeakL', 'uVuPeakR', 'uCentroid', 'uBeatPhase', 'uLogo',
  'uCam0', 'uCam1', 'uCam2', 'uCam3', 'uCamPick',
  'uBpm', 'uBarPhase', 'uBpmLocked',
  'uTimeH', 'uTimeM', 'uTimeS',
  'uCountdown', 'uCountdownDuration',
]

/** Compile a user / ISF shader, wrapped so it runs in our WebGL2 context. */
function tryMakeCustomProgram(gl: WebGL2RenderingContext, source: string): WebGLProgram | null {
  // ISF generators are GLSL ES 1.00 — strip any #version and alias gl_FragColor.
  let body = source.replace(/#version[^\n]*\n/g, '').replace(/\bgl_FragColor\b/g, 'fragColor')
  // ShaderToy shaders define mainImage() instead of main() — synthesise an
  // entry point that maps the fragment coordinate into ShaderToy's signature.
  if (/\bmainImage\s*\(/.test(body) && !/\bvoid\s+main\s*\(/.test(body)) {
    body += '\nvoid main() { mainImage(fragColor, gl_FragCoord.xy); }\n'
  }
  try {
    return makeProgram(gl, CUSTOM_PREAMBLE + body)
  } catch (e) {
    console.warn('[viz] custom shader skipped:', (e as Error).message)
    return null
  }
}

export function VizProvider({ children }: { children: ReactNode }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  if (!canvasRef.current) {
    const c = document.createElement('canvas')
    c.width = VIZ_W
    c.height = VIZ_H
    canvasRef.current = c
  }

  // Master camera <video> elements — uploaded as GL textures each frame so the
  // viz can sample the live feeds. The ref's identity is stable; the render
  // loop reads .current to see the live videos.
  const { videoEls } = useCameraStreams()

  const [mode, setModeState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-mode'))
    return v >= 0 && v <= 33 ? v : 1
  })
  const [palette, setPaletteState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-palette'))
    return v >= 0 && v <= 5 ? v : 0
  })
  const [intensity, setIntensityState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-intensity'))
    return v >= 0.3 && v <= 2.5 ? v : 1.0
  })
  const [kaleido, setKaleidoState] = useState(() => localStorage.getItem('nar-viz-kaleido') === 'on')
  const [autoCycle, setAutoCycleState] = useState(() => localStorage.getItem('nar-viz-autocycle') === 'on')
  const [audioActive, setAudioActive] = useState(false)
  const [camPick, setCamPickState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-cam-pick'))
    return v >= 0 && v <= 3 ? v : 0
  })
  const [camAuto, setCamAutoState] = useState(() => localStorage.getItem('nar-viz-cam-auto') !== 'off')
  const [audioGain, setAudioGainState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-audio-gain'))
    return Number.isFinite(v) && v >= 0 && v <= 400 ? v : 100
  })
  // Master output brightness — multiplied at the very end of the composite
  // pass so 0 actually paints black (independent of bloom + post-fx, which
  // uIntensity doesn't reach).
  const [brightness, setBrightnessState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-brightness'))
    return Number.isFinite(v) && v >= 0 && v <= 150 ? v : 100
  })
  const brightnessRef = useRef(brightness / 100)
  brightnessRef.current = brightness / 100
  // Bloom dose. Scales the multi-scale bloom sum + anamorphic flare + lens
  // dirt together so the operator only needs one knob to tame "halo soup".
  const [bloomAmount, setBloomAmountState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-bloom'))
    return Number.isFinite(v) && v >= 0 && v <= 200 ? v : 100
  })
  const bloomAmountRef = useRef(bloomAmount / 100)
  bloomAmountRef.current = bloomAmount / 100
  // The live GainNode sits between the device source and the analyser. The
  // capture closure stores a setter here so the React-side slider can drive
  // it without re-creating the audio graph.
  const vizGainApplyRef = useRef<((g: number) => void) | null>(null)
  const audioGainRef = useRef(audioGain)
  audioGainRef.current = audioGain
  const [countdownDuration, setCountdownDurationState] = useState(30)
  const countdownStartRef = useRef(0)
  const countdownDurationRef = useRef(30)

  const modeRef = useRef(mode)
  modeRef.current = mode
  const paletteRef = useRef(palette)
  paletteRef.current = palette
  const intensityRef = useRef(intensity)
  intensityRef.current = intensity
  const kaleidoRef = useRef(kaleido)
  kaleidoRef.current = kaleido
  const levelsRef = useRef<VizLevels>({
    bass: 0, mid: 0, treble: 0, level: 0, beat: 0, beatAt: 0, centroid: 0, beatPhase: 0,
    bpm: 0, bpmConfident: false,
    lufs: -60, fps: 60,
  })
  // How many things currently display the visualizer. When zero, the render
  // loop skips the GPU passes — the viz only costs GPU when it is actually seen.
  const consumersRef = useRef(0)

  const [customShaders, setCustomShaders] = useState<string[]>([])
  const [customMode, setCustomModeState] = useState<string | null>(() => localStorage.getItem('nar-viz-custom'))
  const customModeRef = useRef(customMode)
  customModeRef.current = customMode
  const camPickRef = useRef(camPick)
  camPickRef.current = camPick

  const setMode = useCallback((m: number) => {
    localStorage.setItem('nar-viz-mode', String(m))
    localStorage.removeItem('nar-viz-custom')   // a built-in mode clears any custom selection
    setModeState(m)
    setCustomModeState(null)
  }, [])
  const setCustomMode = useCallback((name: string) => {
    localStorage.setItem('nar-viz-custom', name)
    setCustomModeState(name)
  }, [])
  const openShaderFolder = useCallback(() => { studio?.vizShadersOpenFolder?.() }, [])
  const setPalette = useCallback((p: number) => {
    localStorage.setItem('nar-viz-palette', String(p))
    setPaletteState(p)
  }, [])
  const setIntensity = useCallback((i: number) => {
    localStorage.setItem('nar-viz-intensity', String(i))
    setIntensityState(i)
  }, [])
  const setKaleido = useCallback((on: boolean) => {
    localStorage.setItem('nar-viz-kaleido', on ? 'on' : 'off')
    setKaleidoState(on)
  }, [])
  const setAutoCycle = useCallback((on: boolean) => {
    localStorage.setItem('nar-viz-autocycle', on ? 'on' : 'off')
    setAutoCycleState(on)
  }, [])
  const setCamPick = useCallback((i: number) => {
    if (i < 0 || i > 3) return
    localStorage.setItem('nar-viz-cam-pick', String(i))
    setCamPickState(i)
  }, [])
  const setCamAuto = useCallback((on: boolean) => {
    localStorage.setItem('nar-viz-cam-auto', on ? 'on' : 'off')
    setCamAutoState(on)
  }, [])
  const setAudioGain = useCallback((g: number) => {
    const clamped = Math.max(0, Math.min(400, g))
    localStorage.setItem('nar-viz-audio-gain', String(clamped))
    setAudioGainState(clamped)
    vizGainApplyRef.current?.(clamped)
  }, [])
  const setBrightness = useCallback((b: number) => {
    const clamped = Math.max(0, Math.min(150, b))
    localStorage.setItem('nar-viz-brightness', String(clamped))
    setBrightnessState(clamped)
  }, [])
  const setBloomAmount = useCallback((b: number) => {
    const clamped = Math.max(0, Math.min(200, b))
    localStorage.setItem('nar-viz-bloom', String(clamped))
    setBloomAmountState(clamped)
  }, [])
  const startCountdown = useCallback((seconds: number) => {
    const s = Math.max(1, Math.min(120, Math.round(seconds)))
    countdownDurationRef.current = s
    countdownStartRef.current = Date.now()
    setCountdownDurationState(s)
  }, [])
  const stopCountdown = useCallback(() => {
    countdownStartRef.current = 0
  }, [])

  // Auto-cycle — pace to the music. Advances mode every 32 detected beats,
  // with a 60s wall-clock fallback so silence still rotates the look.
  useEffect(() => {
    if (!autoCycle) return
    let beatCount = 0
    let lastBeatAt = levelsRef.current.beatAt
    let lastAdvanceAt = performance.now()
    const TICK_MS = 250
    const BEATS_PER_CYCLE = 32
    const FALLBACK_MS = 60000
    const id = window.setInterval(() => {
      const lv = levelsRef.current
      if (lv.beatAt > lastBeatAt) {
        beatCount += 1
        lastBeatAt = lv.beatAt
      }
      const elapsed = performance.now() - lastAdvanceAt
      if (beatCount >= BEATS_PER_CYCLE || elapsed > FALLBACK_MS) {
        setMode((modeRef.current + 1) % VIZ_MODES.length)
        beatCount = 0
        lastAdvanceAt = performance.now()
      }
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [autoCycle, setMode])

  // GL pipeline + audio capture + render loop — one effect so the loop closes
  // over the shader programs and the (re-capturable) analyser together.
  useEffect(() => {
    const canvas = canvasRef.current!
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true,   // the studio compositor reads this canvas
      powerPreference: 'high-performance',
    })
    if (!gl) {
      console.error('[viz] WebGL2 unavailable — visualizer disabled')
      return
    }

    let sceneProg: WebGLProgram, brightProg: WebGLProgram, blurProg: WebGLProgram, compProg: WebGLProgram
    try {
      sceneProg = makeProgram(gl, SCENE_FRAG)
      brightProg = makeProgram(gl, BRIGHT_FRAG)
      blurProg = makeProgram(gl, BLUR_FRAG)
      compProg = makeProgram(gl, COMPOSITE_FRAG)
    } catch (e) {
      console.error(e)
      return
    }

    const sceneU = uniformMap(gl, sceneProg, SCENE_UNIFORMS)
    const brightU = uniformMap(gl, brightProg, ['uScene', 'uRes'])
    const blurU = uniformMap(gl, blurProg, ['uTex', 'uRes', 'uDir'])
    const compU = uniformMap(gl, compProg,
      ['uScene', 'uBloom', 'uRes', 'uTime', 'uIntensity', 'uBeat', 'uTreble', 'uKaleido', 'uVizBrightness', 'uBloomAmount'])

    // Texture units: 0 spectrum · 1 scene/feedback · 2 peak/blur · 3 wave · 4 scope.
    gl.useProgram(sceneProg)
    gl.uniform1i(sceneU.uSpectrum, 0)
    gl.uniform1i(sceneU.uSpecPeak, 2)
    gl.uniform1i(sceneU.uWave, 3)
    gl.uniform1i(sceneU.uScope, 4)
    gl.uniform1i(sceneU.uPrev, 1)
    gl.uniform1i(sceneU.uLogo, 5)
    gl.uniform1i(sceneU.uCam0, 6)
    gl.uniform1i(sceneU.uCam1, 7)
    gl.uniform1i(sceneU.uCam2, 8)
    gl.uniform1i(sceneU.uCam3, 9)
    gl.useProgram(brightProg)
    gl.uniform1i(brightU.uScene, 1)
    gl.useProgram(blurProg)
    gl.uniform1i(blurU.uTex, 2)
    gl.useProgram(compProg)
    gl.uniform1i(compU.uScene, 1)
    gl.uniform1i(compU.uBloom, 2)

    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    // ── Audio data textures ─────────────────────────────────────────────────
    const SPEC_N = 256        // spectrum / peak / waveform — 256-wide R8
    const SCOPE_N = 128       // X-Y scope — 128-wide RG8 (L, R)
    const specBytes = new Uint8Array(SPEC_N)
    const specSmooth = new Float32Array(SPEC_N)
    const specPeak = new Float32Array(SPEC_N)
    const specPeakBytes = new Uint8Array(SPEC_N)
    const waveBytes = new Uint8Array(SPEC_N).fill(128)
    const scopeBytes = new Uint8Array(SCOPE_N * 2).fill(128)

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const makeDataTex = (width: number, internalFormat: number, format: number, init: Uint8Array): WebGLTexture => {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, 1, 0, format, gl.UNSIGNED_BYTE, init)
      return t
    }
    const specTex = makeDataTex(SPEC_N, gl.R8, gl.RED, specBytes)
    const specPeakTex = makeDataTex(SPEC_N, gl.R8, gl.RED, specPeakBytes)
    const waveTex = makeDataTex(SPEC_N, gl.R8, gl.RED, waveBytes)
    const scopeTex = makeDataTex(SCOPE_N, gl.RG8, gl.RG, scopeBytes)

    // Ping-pong scene buffers (frame feedback) + quarter-res bloom buffers.
    const scene = [makeTarget(gl, VIZ_W, VIZ_H), makeTarget(gl, VIZ_W, VIZ_H)]
    // bloom[0] is the final glow buffer the compositor mip-samples — give it a chain.
    const bloom = [makeTarget(gl, BLOOM_W, BLOOM_H, true), makeTarget(gl, BLOOM_W, BLOOM_H)]
    let cur = 0

    // ── Live camera textures — units 6..9, refreshed in the render loop ─────
    const camTex: WebGLTexture[] = []
    for (let i = 0; i < MAX_CAMERAS; i++) {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      // 1×1 black placeholder until the camera produces a frame
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]))
      camTex.push(t)
      // Stay bound to the matching texture unit — other passes only touch 0–4.
      gl.activeTexture(gl.TEXTURE0 + 6 + i)
      gl.bindTexture(gl.TEXTURE_2D, t)
    }
    const lastCamTime = [0, 0, 0, 0]

    // ── Audio — independent capture of the studio desk device ───────────────
    let audioCtx: AudioContext | null = null
    let stream: MediaStream | null = null
    let analyser: AnalyserNode | null = null
    let analyserL: AnalyserNode | null = null
    let analyserR: AnalyserNode | null = null
    let freqData = new Uint8Array(0)
    let prevFreq = new Float32Array(0)
    let timeData = new Uint8Array(0)
    let timeFloat = new Float32Array(0)
    let vuBufL = new Uint8Array(0)
    let vuBufR = new Uint8Array(0)
    let currentDevice = localStorage.getItem('nar-audio-device') || ''
    let disposed = false

    // ── Brand logo texture — sampled by the Logo Mark mode (unit 5) ─────────
    const logoTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, logoTex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    // 1×1 transparent placeholder until the embedded logo decodes
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]))
    const logoImg = new Image()
    logoImg.onload = () => {
      if (disposed) return
      gl.bindTexture(gl.TEXTURE_2D, logoTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, logoImg)
    }
    logoImg.src = NAR_LOGO_DATA_URI
    // Stays bound to unit 5 — other passes only touch 0–4.
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, logoTex)

    const teardownAudio = () => {
      try { stream?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      try { audioCtx?.close() } catch { /* ignore */ }
      stream = null
      audioCtx = null
      analyser = null
      analyserL = null
      analyserR = null
      vizGainApplyRef.current = null
    }

    const capture = async (deviceId: string) => {
      teardownAudio()
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId
            ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            : true,
          video: false,
        })
        if (disposed) { teardownAudio(); return }
        audioCtx = new AudioContext()
        audioCtx.resume().catch(() => { /* resumed on first gesture */ })
        const node = audioCtx.createMediaStreamSource(stream)
        // Separate from broadcast — only the viz analyser hears this gain.
        // Operator drives it via the VIZ slider; persists across restarts.
        const vizGain = audioCtx.createGain()
        vizGain.gain.value = audioGainRef.current / 100
        node.connect(vizGain)
        vizGainApplyRef.current = (pct: number) => {
          if (!audioCtx) return
          const target = pct / 100
          try {
            vizGain.gain.cancelScheduledValues(audioCtx.currentTime)
            vizGain.gain.setTargetAtTime(target, audioCtx.currentTime, 0.03)
          } catch { vizGain.gain.value = target }
        }
        analyser = audioCtx.createAnalyser()
        analyser.fftSize = 2048
        // Light smoothing — spectral flux needs frame-to-frame change to survive.
        analyser.smoothingTimeConstant = 0.6
        vizGain.connect(analyser)
        freqData = new Uint8Array(analyser.frequencyBinCount)
        prevFreq = new Float32Array(analyser.frequencyBinCount)
        timeData = new Uint8Array(analyser.fftSize)
        timeFloat = new Float32Array(analyser.fftSize)
        // Stereo split — drives the L/R VU meters and the X-Y scope.
        const splitter = audioCtx.createChannelSplitter(2)
        vizGain.connect(splitter)
        analyserL = audioCtx.createAnalyser()
        analyserR = audioCtx.createAnalyser()
        analyserL.fftSize = 1024
        analyserR.fftSize = 1024
        splitter.connect(analyserL, 0)
        splitter.connect(analyserR, 1)
        vuBufL = new Uint8Array(analyserL.fftSize)
        vuBufR = new Uint8Array(analyserR.fftSize)
        setAudioActive(true)
      } catch (e) {
        console.warn('[viz] audio capture failed:', e)
        setAudioActive(false)
      }
    }
    capture(currentDevice)

    const devicePoll = window.setInterval(() => {
      const d = localStorage.getItem('nar-audio-device') || ''
      if (d !== currentDevice) {
        currentDevice = d
        capture(d)
      }
    }, 2000)

    const resumeOnGesture = () => { audioCtx?.resume().catch(() => { /* ignore */ }) }
    window.addEventListener('pointerdown', resumeOnGesture)

    // ── Custom shaders — user GLSL from a folder, compiled as extra modes ────
    let customProgs: { name: string; prog: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }[] = []
    const loadCustom = async () => {
      let list: { name: string; source: string }[] = []
      try { list = (await studio?.vizShadersList?.()) ?? [] } catch { list = [] }
      if (disposed) return
      for (const c of customProgs) gl.deleteProgram(c.prog)
      customProgs = []
      for (const item of list) {
        const prog = tryMakeCustomProgram(gl, item.source)
        if (!prog) continue
        const u = uniformMap(gl, prog, SCENE_UNIFORMS)
        gl.useProgram(prog)
        gl.uniform1i(u.uSpectrum, 0)
        gl.uniform1i(u.uPrev, 1)
        gl.uniform1i(u.uWave, 3)
        gl.uniform1i(u.uLogo, 5)
        gl.uniform1i(u.uCam0, 6)
        gl.uniform1i(u.uCam1, 7)
        gl.uniform1i(u.uCam2, 8)
        gl.uniform1i(u.uCam3, 9)
        customProgs.push({ name: item.name, prog, u })
      }
      setCustomShaders(customProgs.map(c => c.name))
    }
    loadCustom()
    const offShaders = studio?.onVizShadersChanged?.(() => { loadCustom() })

    // ── Render loop ─────────────────────────────────────────────────────────
    const sm = { bass: 0, mid: 0, treble: 0, level: 0 }
    const fluxHist: number[] = []
    let beatEnv = 0
    let lastBeat = 0
    let beatPeriod = 0.5
    // Sliding window of inter-beat intervals (seconds) — only filled from real
    // audio onsets, so the synthetic idle path never poisons the BPM estimate.
    const ibiHistory: number[] = []
    let smBpm = 0
    let bpmConfident = false
    // Diagnostics — render-loop FPS, sampled once per second.
    let frameCount = 0
    let lastFpsAt = 0
    let smFps = 60
    // LUFS — ITU-R BS.1770 K-weighting filter state (48 kHz coefficients).
    // Two cascaded biquads: pre-filter (high-shelf at ~1.68 kHz +4 dB) + 38 Hz
    // high-pass. K-weighted samples are squared and meaned for momentary LUFS.
    let smLufs = -60
    let kpX1 = 0, kpX2 = 0, kpY1 = 0, kpY2 = 0
    let khX1 = 0, khX2 = 0, khY1 = 0, khY2 = 0
    // Onset envelope + periodic autocorrelation — the Pioneer-deck-style tempo
    // validator that catches half/double-tempo errors the IBI median can lock
    // onto. Sample rate is measured (not assumed) so display refresh doesn't
    // bias the result.
    const onsetEnv: number[] = []
    let lastFluxPushAt = 0
    let envSampleSec = 1 / 60
    let lastAcAt = 0
    let acBpm = 0
    // Phase-locked beat tracking — once a stable tempo is acquired, only onsets
    // aligned with the grid update the tempo. Builds, breakdowns and stray hits
    // can't drag it around. Lock breaks if we miss ~4 consecutive beats OR the
    // autocorrelation strongly disagrees with the locked tempo for several secs.
    let phaseLocked = false
    let gridAnchor = 0
    let lastConfirmingBeat = 0
    let lastLockLossAt = 0
    let acDisagreement = 0
    let smCentroid = 0
    let vuL = 0, vuR = 0, vuPeakL = 0, vuPeakR = 0
    let raf = 0

    const band = (lo: number, hi: number) => {
      let s = 0, c = 0
      for (let i = lo; i < hi && i < freqData.length; i++) { s += freqData[i]; c++ }
      return c ? s / c / 255 : 0
    }

    // Channel RMS → 0..1 over a -54..0 dB scale, for the VU meters.
    const rmsNorm = (buf: Uint8Array) => {
      if (buf.length === 0) return 0
      let s = 0
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v }
      const db = 20 * Math.log10(Math.sqrt(s / buf.length) + 1e-7)
      return Math.min(1, Math.max(0, (db + 54) / 54))
    }

    // Soft compressor on the audio level signals — linear below 0.55, a gentle
    // exponential knee above. Keeps loud passages from overdriving the per-mode
    // brightness multipliers (which would strobe) while preserving dynamics.
    const softCap = (x: number): number =>
      x <= 0.55 ? x : 0.55 + (1.0 - Math.exp(-(x - 0.55) * 2.4)) * 0.45

    const drawQuad = () => gl.drawArrays(gl.TRIANGLES, 0, 3)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const now = performance.now() / 1000

      // FPS — sampled once per second, gently smoothed.
      frameCount++
      if (now - lastFpsAt > 1.0) {
        const measured = frameCount / Math.max(0.001, now - lastFpsAt)
        smFps += (measured - smFps) * 0.30
        frameCount = 0
        lastFpsAt = now
      }

      let bass = 0, mid = 0, treble = 0, level = 0, centroid = 0
      let vuLraw = 0, vuRraw = 0
      let onset = false

      if (analyser) {
        analyser.getByteFrequencyData(freqData)
        const n = freqData.length
        bass = band(1, 8)
        mid = band(8, 70)
        treble = band(70, 320)

        // Spectral flux focused on the kick/snare/low-mid band (bins 2..50 ≈
        // 50–1170 Hz at 48 kHz) — beat-bearing transients live here. Longer
        // fluxHist gives a more stable adaptive threshold for a Pioneer-style lock.
        const FLUX_HI = 50
        let fl = 0, csum = 0, cwsum = 0
        for (let i = 2; i < n; i++) {
          const m = freqData[i] / 255
          const d = m - prevFreq[i]
          if (d > 0 && i <= FLUX_HI) fl += d
          prevFreq[i] = m
          csum += m
          cwsum += m * i
        }
        const flux = fl / (FLUX_HI - 1)
        centroid = csum > 1e-4 ? Math.min(1, (cwsum / csum) / 200) : 0
        fluxHist.push(flux)
        if (fluxHist.length > 120) fluxHist.shift()
        const fluxAvg = fluxHist.reduce((a, b) => a + b, 0) / fluxHist.length
        onset = flux > fluxAvg * 1.7 && flux > 0.015 && (now - lastBeat) > 0.18

        // Sample the onset envelope at ~60 Hz for the periodic autocorrelation.
        if (now - lastFluxPushAt > 0.015) {
          if (lastFluxPushAt > 0) {
            envSampleSec += ((now - lastFluxPushAt) - envSampleSec) * 0.03
          }
          lastFluxPushAt = now
          onsetEnv.push(flux)
          if (onsetEnv.length > 360) onsetEnv.shift()
        }

        // Octave-band spectrum with a perceptual treble tilt — keeps the top
        // end alive instead of drooping into nothing.
        const minBin = 1, maxBin = 520
        let lsum = 0
        for (let x = 0; x < SPEC_N; x++) {
          const b0 = Math.floor(minBin * Math.pow(maxBin / minBin, x / SPEC_N))
          let b1 = Math.floor(minBin * Math.pow(maxBin / minBin, (x + 1) / SPEC_N))
          if (b1 <= b0) b1 = b0 + 1
          let s = 0
          for (let b = b0; b < b1 && b < n; b++) s += freqData[b]
          const tilt = 0.5 + 2.0 * Math.pow(x / SPEC_N, 0.85)
          const v = Math.min(1.3, (s / (b1 - b0) / 255) * tilt)
          specSmooth[x] = specSmooth[x] * 0.55 + v * 0.45
          lsum += specSmooth[x]
        }
        level = Math.min(1, (lsum / SPEC_N) * 1.7)

        // Time-domain waveform — downsampled to the 256-wide texture.
        analyser.getByteTimeDomainData(timeData)
        for (let x = 0; x < SPEC_N; x++) waveBytes[x] = timeData[Math.min(timeData.length - 1, x * 8)]

        // LUFS — K-weighted RMS over the float time-domain buffer (BS.1770).
        // Coefficients are for 48 kHz; at 44.1 kHz the result is close enough
        // for monitoring — not a compliance-grade integrated value.
        analyser.getFloatTimeDomainData(timeFloat)
        let lSum = 0
        const lN = timeFloat.length
        for (let i = 0; i < lN; i++) {
          const x = timeFloat[i]
          // Stage 1: shelving pre-filter
          const y1 = 1.53512485958697 * x
                   - 2.69169618940638 * kpX1
                   + 1.19839281085285 * kpX2
                   + 1.69065929318241 * kpY1
                   - 0.73248077421585 * kpY2
          kpX2 = kpX1; kpX1 = x
          kpY2 = kpY1; kpY1 = y1
          // Stage 2: 38 Hz high-pass
          const y2 = y1
                   - 2.0 * khX1
                   + khX2
                   + 1.99004745483398 * khY1
                   - 0.99007225036621 * khY2
          khX2 = khX1; khX1 = y1
          khY2 = khY1; khY1 = y2
          lSum += y2 * y2
        }
        const meanSq = lSum / lN
        const lufs = -0.691 + 10 * Math.log10(meanSq + 1e-10)
        smLufs += (Math.max(-70, lufs) - smLufs) * 0.18

        // Stereo VU + X-Y scope.
        if (analyserL && analyserR) {
          analyserL.getByteTimeDomainData(vuBufL)
          analyserR.getByteTimeDomainData(vuBufR)
          vuLraw = rmsNorm(vuBufL)
          vuRraw = rmsNorm(vuBufR)
          for (let x = 0; x < SCOPE_N; x++) {
            const si = Math.min(vuBufL.length - 1, x * 8)
            scopeBytes[2 * x] = vuBufL[si]
            scopeBytes[2 * x + 1] = vuBufR[si]
          }
        }
      } else {
        // Idle — gentle synthetic motion so no mode is ever dead air.
        bass = 0.26 + 0.16 * Math.sin(now * 1.7) + 0.07 * Math.sin(now * 0.6)
        mid = 0.28 + 0.14 * Math.sin(now * 0.9 + 1.0)
        treble = 0.20 + 0.12 * Math.sin(now * 2.3 + 2.0)
        level = 0.30 + 0.12 * Math.sin(now * 0.7)
        centroid = 0.42 + 0.18 * Math.sin(now * 0.5)
        onset = (now - lastBeat) > 0.52
        for (let x = 0; x < SPEC_N; x++) {
          const f = x / SPEC_N
          const v = (0.32 + 0.30 * Math.sin(now * 0.8 + f * 9.0) + 0.20 * Math.sin(now * 1.7 - f * 22.0))
            * (1.0 - f * 0.6) * (0.55 + 0.45 * Math.sin(now * 0.3))
          specSmooth[x] = specSmooth[x] * 0.7 + Math.max(0, v) * 0.3
        }
        for (let x = 0; x < SPEC_N; x++) {
          const w = 128 + 64 * Math.sin(x * 0.19 + now * 5.0) + 22 * Math.sin(x * 0.071 - now * 2.3)
          waveBytes[x] = Math.min(255, Math.max(0, w))
        }
        for (let x = 0; x < SCOPE_N; x++) {
          const ph = x / SCOPE_N
          scopeBytes[2 * x] = Math.min(255, Math.max(0, 128 + 92 * Math.sin(ph * 18.8 + now * 1.3)))
          scopeBytes[2 * x + 1] = Math.min(255, Math.max(0, 128 + 92 * Math.sin(ph * 12.6 + now * 1.1 + 1.0)))
        }
        vuLraw = 0.4 + 0.22 * Math.sin(now * 1.3) + 0.06 * Math.sin(now * 5.1)
        vuRraw = 0.4 + 0.22 * Math.sin(now * 1.3 + 0.8) + 0.06 * Math.sin(now * 4.7)
      }

      // Attack-fast / release-slow smoothing — keeps transients punchy.
      const ar = (cValue: number, prev: number) => prev + (cValue - prev) * (cValue > prev ? 0.5 : 0.12)
      sm.bass = ar(bass, sm.bass)
      sm.mid = ar(mid, sm.mid)
      sm.treble = ar(treble, sm.treble)
      sm.level = ar(level, sm.level)
      smCentroid += (centroid - smCentroid) * 0.12

      // Beat tracking — when phase-locked, only onsets aligned with the beat
      // grid update tempo and the beat marker. Off-grid onsets (snare rolls in
      // builds, sparse hits in breakdowns) just pulse the visual envelope and
      // never pollute the tempo. The grid keeps ticking with no onsets too, so
      // breakdowns don't lose the pace.
      if (onset) {
        if (phaseLocked) {
          const k = Math.round((now - gridAnchor) / beatPeriod)
          const phaseError = now - (gridAnchor + k * beatPeriod)
          const tolerance = beatPeriod * 0.20
          if (Math.abs(phaseError) < tolerance) {
            // Confirming beat — gentle drift correction + small tempo nudge
            gridAnchor += phaseError * 0.30
            const interval = now - lastBeat
            if (interval > beatPeriod * 0.80 && interval < beatPeriod * 1.20) {
              beatPeriod += (interval - beatPeriod) * 0.05
              if (analyser) {
                ibiHistory.push(interval)
                if (ibiHistory.length > 48) ibiHistory.shift()
              }
            }
            lastBeat = now
            lastConfirmingBeat = now
            beatEnv = 1
          } else {
            // Off-beat onset — visual pulse only, never updates tempo
            beatEnv = Math.max(beatEnv, 0.45)
          }
        } else {
          // Unlocked — bootstrap from any reasonable onset
          const interval = now - lastBeat
          if (interval > 0.30 && interval < 1.05) {
            beatPeriod = beatPeriod * 0.78 + interval * 0.22
            if (analyser) {
              ibiHistory.push(interval)
              if (ibiHistory.length > 48) ibiHistory.shift()
            }
          }
          lastBeat = now
          beatEnv = 1
        }
      }
      beatEnv *= 0.90

      // Lock acquisition / release — survives breakdowns by holding the grid
      // even when onsets dry up. Loses lock only if ~6 predicted beats pass
      // without a confirming detection; 2 s cooldown prevents lock thrash.
      if (!phaseLocked && bpmConfident && now - lastLockLossAt > 2.0) {
        phaseLocked = true
        gridAnchor = lastBeat
        lastConfirmingBeat = lastBeat
      } else if (phaseLocked && now - lastConfirmingBeat > 4 * beatPeriod) {
        phaseLocked = false
        lastLockLossAt = now
        ibiHistory.length = 0   // fresh start — old tempo is no longer relevant
        acDisagreement = 0
      }

      // Beat phase — continuous sawtooth while locked, so visuals keyed off
      // uBeatPhase keep moving even through a silent breakdown.
      const beatPhase = phaseLocked
        ? ((((now - gridAnchor) % beatPeriod) + beatPeriod) % beatPeriod) / beatPeriod
        : Math.min(1, (now - lastBeat) / beatPeriod)
      // Bar phase — 0..1 across 4 beats. Drives the Pace Display dot row.
      const barLen = beatPeriod * 4
      const barPhase = phaseLocked
        ? ((((now - gridAnchor) % barLen) + barLen) % barLen) / barLen
        : 0

      // Periodic autocorrelation on the onset envelope — Pioneer-style tempo
      // validator. Finds the lag with the strongest periodicity, then BPM =
      // 60 / (sampleInterval * lag). Run once per second; the window is short.
      if (analyser && onsetEnv.length >= 90 && now - lastAcAt > 1.0) {
        lastAcAt = now
        let bestLag = 0, bestCorr = 0
        const Nbuf = onsetEnv.length
        // Lag range 18..60 at ~60 Hz sampling ≈ 60..200 BPM
        for (let lag = 18; lag <= 60; lag++) {
          let c = 0
          for (let i = lag; i < Nbuf; i++) c += onsetEnv[i] * onsetEnv[i - lag]
          c /= (Nbuf - lag)
          if (c > bestCorr) { bestCorr = c; bestLag = lag }
        }
        if (bestLag > 0) {
          acBpm = 60 / (envSampleSec * bestLag)
          // Auto-unlock if AC strongly disagrees with the locked tempo for ~3s
          // (escapes a wrong lock when the track changes tempo or transitions).
          if (phaseLocked && smBpm > 0) {
            const r = acBpm / smBpm
            if ((r > 1.80 && r < 2.20) || (r > 0.45 && r < 0.55)) {
              acDisagreement++
              if (acDisagreement >= 3) {
                phaseLocked = false
                lastLockLossAt = now
                ibiHistory.length = 0
                acDisagreement = 0
              }
            } else {
              acDisagreement = 0
            }
          }
        } else {
          acBpm = 0
        }
      }

      // Pace — median IBI over the window is the base BPM estimate. Two
      // refinements push it toward Pioneer-deck reliability:
      //   1. Cross-check with the autocorrelation peak: when AC strongly says
      //      "you're at half or double tempo," it wins. Catches the classic
      //      IBI-median failure mode where a syncopated kick fools onset timing.
      //   2. Octave fold — pop/dance/rock sits at 70..160 BPM; outside that,
      //      the tempo is almost always one octave off.
      if (ibiHistory.length >= 6) {
        const sorted = ibiHistory.slice().sort((a, b) => a - b)
        const med = sorted[Math.floor(sorted.length / 2)]
        let targetBpm = 60 / med
        // AC override only when NOT phase-locked — once locked, the grid logic
        // already keeps off-beat onsets out of ibiHistory; AC during a build
        // might catch sub-beats and falsely "correct" us off the real tempo.
        if (!phaseLocked && acBpm > 55 && acBpm < 215) {
          const r = acBpm / targetBpm
          if (r > 1.80 && r < 2.20) targetBpm = acBpm        // median was half-tempo
          else if (r > 0.45 && r < 0.55) targetBpm = acBpm   // median was double-tempo
        }
        if (targetBpm > 165) targetBpm *= 0.5
        else if (targetBpm < 65) targetBpm *= 2
        // Slower smoothing when locked (stable hold), faster when unlocked
        // (catch up quickly after a track change or a real tempo shift).
        const rate = phaseLocked ? 0.06 : 0.18
        smBpm = smBpm === 0 ? targetBpm : smBpm + (targetBpm - smBpm) * rate
        let mean = 0
        for (const v of sorted) mean += v
        mean /= sorted.length
        let sq = 0
        for (const v of sorted) sq += (v - mean) * (v - mean)
        const cv = Math.sqrt(sq / sorted.length) / mean
        // Tighter confidence: small CV + locked sample + real audio level.
        bpmConfident = ibiHistory.length >= 8 && cv < 0.12 && analyser !== null && sm.level > 0.02
      } else {
        bpmConfident = false
      }

      levelsRef.current = {
        bass: softCap(sm.bass), mid: softCap(sm.mid),
        treble: softCap(sm.treble), level: softCap(sm.level),
        beat: beatEnv, beatAt: lastBeat, centroid: smCentroid, beatPhase,
        bpm: smBpm, bpmConfident,
        lufs: smLufs, fps: smFps,
      }

      // Spectrum bytes + slowly-falling peak-hold for the bar analyzer.
      for (let x = 0; x < SPEC_N; x++) {
        specPeak[x] = Math.max(specPeak[x] - 0.0055, specSmooth[x])
        specBytes[x] = Math.min(255, Math.max(0, Math.pow(specSmooth[x], 0.8) * 255))
        specPeakBytes[x] = Math.min(255, Math.max(0, Math.pow(specPeak[x], 0.8) * 255))
      }

      // VU ballistics — fast attack, slow release, with falling peak-hold.
      vuL += (vuLraw - vuL) * (vuLraw > vuL ? 0.3 : 0.11)
      vuR += (vuRraw - vuR) * (vuRraw > vuR ? 0.3 : 0.11)
      vuPeakL = vuLraw > vuPeakL ? vuLraw : Math.max(vuPeakL - 0.006, vuL)
      vuPeakR = vuRraw > vuPeakR ? vuRraw : Math.max(vuPeakR - 0.006, vuR)

      // Nothing displays the visualizer — the audio analysis above keeps
      // levelsRef live for beat FX and the director, but skip the costly
      // 7-pass GPU render entirely until a consumer needs it.
      if (consumersRef.current <= 0) return

      // Upload live camera frames when the active mode needs them (Live Cam, or
      // any custom shader that might sample them). Throttled by currentTime so
      // we only push genuine new frames, not every render tick.
      const needCam = modeRef.current === 28 || modeRef.current === 29 || modeRef.current === 30 || customModeRef.current != null
      if (needCam) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
        for (let i = 0; i < MAX_CAMERAS; i++) {
          const v = videoEls.current[i]
          if (v && v.readyState >= 2 && v.currentTime !== lastCamTime[i]) {
            lastCamTime[i] = v.currentTime
            gl.activeTexture(gl.TEXTURE0 + 6 + i)
            gl.bindTexture(gl.TEXTURE_2D, camTex[i])
            try {
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, v)
            } catch { /* video not ready / browser quirk — try next frame */ }
          }
        }
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      }

      const prevIdx = 1 - cur

      // Pass 1 — scene. A loaded custom shader replaces the built-in program.
      const activeCustom = customModeRef.current
        ? customProgs.find(c => c.name === customModeRef.current)
        : undefined
      const p1prog = activeCustom ? activeCustom.prog : sceneProg
      const p1u = activeCustom ? activeCustom.u : sceneU
      gl.bindFramebuffer(gl.FRAMEBUFFER, scene[cur].fbo)
      gl.viewport(0, 0, VIZ_W, VIZ_H)
      gl.useProgram(p1prog)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, specTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEC_N, 1, gl.RED, gl.UNSIGNED_BYTE, specBytes)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, specPeakTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEC_N, 1, gl.RED, gl.UNSIGNED_BYTE, specPeakBytes)
      gl.activeTexture(gl.TEXTURE3)
      gl.bindTexture(gl.TEXTURE_2D, waveTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SPEC_N, 1, gl.RED, gl.UNSIGNED_BYTE, waveBytes)
      gl.activeTexture(gl.TEXTURE4)
      gl.bindTexture(gl.TEXTURE_2D, scopeTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCOPE_N, 1, gl.RG, gl.UNSIGNED_BYTE, scopeBytes)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, scene[prevIdx].tex)
      gl.uniform2f(p1u.uRes, VIZ_W, VIZ_H)
      gl.uniform1f(p1u.uTime, now)
      gl.uniform1f(p1u.uLevel, sm.level)
      gl.uniform1f(p1u.uBass, sm.bass)
      gl.uniform1f(p1u.uMid, sm.mid)
      gl.uniform1f(p1u.uTreble, sm.treble)
      gl.uniform1f(p1u.uBeat, beatEnv)
      gl.uniform1f(p1u.uCentroid, smCentroid)
      gl.uniform1f(p1u.uBeatPhase, beatPhase)
      gl.uniform1f(p1u.uVuL, vuL)
      gl.uniform1f(p1u.uVuR, vuR)
      gl.uniform1f(p1u.uVuPeakL, vuPeakL)
      gl.uniform1f(p1u.uVuPeakR, vuPeakR)
      gl.uniform1i(p1u.uMode, modeRef.current)
      gl.uniform1i(p1u.uPalette, paletteRef.current)
      gl.uniform1i(p1u.uCamPick, camPickRef.current)
      gl.uniform1f(p1u.uBpm, smBpm)
      gl.uniform1f(p1u.uBarPhase, barPhase)
      gl.uniform1f(p1u.uBpmLocked, (bpmConfident || phaseLocked) ? 1.0 : 0.0)
      const dNow = new Date()
      gl.uniform1f(p1u.uTimeH, dNow.getHours())
      gl.uniform1f(p1u.uTimeM, dNow.getMinutes())
      gl.uniform1f(p1u.uTimeS, dNow.getSeconds())
      // Countdown — sentinel +999 when not active so the shader stays in idle.
      let ctd = 999.0
      if (countdownStartRef.current > 0) {
        const elapsed = (Date.now() - countdownStartRef.current) / 1000
        ctd = countdownDurationRef.current - elapsed
        if (ctd < -3) { countdownStartRef.current = 0; ctd = 999.0 }
      }
      gl.uniform1f(p1u.uCountdown, ctd)
      gl.uniform1f(p1u.uCountdownDuration, countdownDurationRef.current)
      drawQuad()

      // Pass 2 — bright-pass extract (quarter res).
      gl.bindFramebuffer(gl.FRAMEBUFFER, bloom[0].fbo)
      gl.viewport(0, 0, BLOOM_W, BLOOM_H)
      gl.useProgram(brightProg)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, scene[cur].tex)
      gl.uniform2f(brightU.uRes, BLOOM_W, BLOOM_H)
      drawQuad()

      // Passes 3-6 — two separable Gaussian blur iterations.
      gl.useProgram(blurProg)
      gl.uniform2f(blurU.uRes, BLOOM_W, BLOOM_H)
      const blurStep = (src: RenderTarget, dst: RenderTarget, dx: number, dy: number) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, src.tex)
        gl.uniform2f(blurU.uDir, dx, dy)
        drawQuad()
      }
      blurStep(bloom[0], bloom[1], 1, 0)
      blurStep(bloom[1], bloom[0], 0, 1)
      blurStep(bloom[0], bloom[1], 1, 0)
      blurStep(bloom[1], bloom[0], 0, 1)

      // Pass 7 — composite to the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, VIZ_W, VIZ_H)
      gl.useProgram(compProg)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, scene[cur].tex)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, bloom[0].tex)
      gl.generateMipmap(gl.TEXTURE_2D)   // rebuild the bloom mip chain for multi-scale glow
      gl.uniform2f(compU.uRes, VIZ_W, VIZ_H)
      gl.uniform1f(compU.uTime, now)
      gl.uniform1f(compU.uIntensity, intensityRef.current)
      gl.uniform1f(compU.uBeat, beatEnv)
      gl.uniform1f(compU.uTreble, sm.treble)
      gl.uniform1i(compU.uKaleido, kaleidoRef.current ? 6 : 0)
      gl.uniform1f(compU.uVizBrightness, brightnessRef.current)
      gl.uniform1f(compU.uBloomAmount, bloomAmountRef.current)
      drawQuad()

      cur = prevIdx
    }
    raf = requestAnimationFrame(draw)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      window.clearInterval(devicePoll)
      window.removeEventListener('pointerdown', resumeOnGesture)
      offShaders?.()
      teardownAudio()
      for (const c of customProgs) gl.deleteProgram(c.prog)
      gl.deleteProgram(sceneProg)
      gl.deleteProgram(brightProg)
      gl.deleteProgram(blurProg)
      gl.deleteProgram(compProg)
      gl.deleteTexture(specTex)
      gl.deleteTexture(specPeakTex)
      gl.deleteTexture(waveTex)
      gl.deleteTexture(scopeTex)
      gl.deleteTexture(logoTex)
      for (const t of camTex) gl.deleteTexture(t)
      gl.deleteVertexArray(vao)
      for (const t of scene) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
      for (const t of bloom) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    }
  }, [])

  const getCanvas = useCallback(() => canvasRef.current, [])

  const acquire = useCallback(() => {
    consumersRef.current += 1
    return () => { consumersRef.current = Math.max(0, consumersRef.current - 1) }
  }, [])

  return (
    <Ctx.Provider value={{
      getCanvas, mode, setMode, palette, setPalette, intensity, setIntensity,
      kaleido, setKaleido, autoCycle, setAutoCycle, audioActive, levelsRef,
      customShaders, customMode, setCustomMode, openShaderFolder, acquire,
      camPick, setCamPick, camAuto, setCamAuto,
      audioGain, setAudioGain,
      brightness, setBrightness,
      bloomAmount, setBloomAmount,
      countdownDuration, startCountdown, stopCountdown,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useViz() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useViz must be used within VizProvider')
  return ctx
}

/**
 * While `active` is true, keep the visualizer's GPU pipeline rendering. Use it
 * in any component that displays the viz canvas (the program, a preview, a
 * camera backdrop) so the viz idles when nothing shows it.
 */
export function useVizActive(active: boolean): void {
  const ctx = useContext(Ctx)
  useEffect(() => {
    if (!active || !ctx) return
    return ctx.acquire()
  }, [active, ctx])
}
