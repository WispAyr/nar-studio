import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode, type MutableRefObject,
} from 'react'
import { VERT_SRC, SCENE_FRAG, BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG, CUSTOM_PREAMBLE } from './shaders'

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
  { id: 6, label: 'Spectrum', group: 'Meters', hint: 'Premium bar analyzer with peak-hold' },
  { id: 7, label: 'VU', group: 'Meters', hint: 'Stereo broadcast VU meters' },
  { id: 8, label: 'Waveform', group: 'Meters', hint: 'Live oscilloscope trace' },
  { id: 9, label: 'Radial', group: 'Meters', hint: 'Circular spectrum analyzer' },
  { id: 15, label: 'Scope', group: 'Meters', hint: 'X-Y stereo oscilloscope' },
  { id: 16, label: 'Wave Ring', group: 'Meters', hint: 'Circular live waveform' },
  { id: 17, label: 'Grid', group: 'Meters', hint: 'LED video-wall spectrum matrix' },
  { id: 18, label: 'Orbits', group: 'Geometric', hint: 'Concentric orbiting node rings' },
] as const

export const VIZ_PALETTES = [
  { id: 0, label: 'NAR Ember', swatch: '#e8003c' },
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

function makeTarget(gl: WebGL2RenderingContext, w: number, h: number): RenderTarget {
  const tex = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  const fbo = gl.createFramebuffer()!
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
  return { tex, fbo }
}

/** Uniform names the scene shader — and any custom shader — may declare. */
const SCENE_UNIFORMS = [
  'uRes', 'uTime', 'uLevel', 'uBass', 'uMid', 'uTreble', 'uBeat', 'uMode', 'uPalette',
  'uSpectrum', 'uSpecPeak', 'uWave', 'uScope', 'uPrev',
  'uVuL', 'uVuR', 'uVuPeakL', 'uVuPeakR', 'uCentroid', 'uBeatPhase',
]

/** Compile a user / ISF shader, wrapped so it runs in our WebGL2 context. */
function tryMakeCustomProgram(gl: WebGL2RenderingContext, source: string): WebGLProgram | null {
  // ISF generators are GLSL ES 1.00 — strip any #version and alias gl_FragColor.
  const body = source.replace(/#version[^\n]*\n/g, '').replace(/\bgl_FragColor\b/g, 'fragColor')
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

  const [mode, setModeState] = useState(() => {
    const v = Number(localStorage.getItem('nar-viz-mode'))
    return v >= 0 && v <= 18 ? v : 1
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
  })

  const [customShaders, setCustomShaders] = useState<string[]>([])
  const [customMode, setCustomModeState] = useState<string | null>(() => localStorage.getItem('nar-viz-custom'))
  const customModeRef = useRef(customMode)
  customModeRef.current = customMode

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

  // Auto-cycle — rotate through the modes on a slow timer.
  useEffect(() => {
    if (!autoCycle) return
    const id = window.setInterval(() => setMode((modeRef.current + 1) % VIZ_MODES.length), 32000)
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
      ['uScene', 'uBloom', 'uRes', 'uTime', 'uIntensity', 'uBeat', 'uTreble', 'uKaleido'])

    // Texture units: 0 spectrum · 1 scene/feedback · 2 peak/blur · 3 wave · 4 scope.
    gl.useProgram(sceneProg)
    gl.uniform1i(sceneU.uSpectrum, 0)
    gl.uniform1i(sceneU.uSpecPeak, 2)
    gl.uniform1i(sceneU.uWave, 3)
    gl.uniform1i(sceneU.uScope, 4)
    gl.uniform1i(sceneU.uPrev, 1)
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
    const bloom = [makeTarget(gl, BLOOM_W, BLOOM_H), makeTarget(gl, BLOOM_W, BLOOM_H)]
    let cur = 0

    // ── Audio — independent capture of the studio desk device ───────────────
    let audioCtx: AudioContext | null = null
    let stream: MediaStream | null = null
    let analyser: AnalyserNode | null = null
    let analyserL: AnalyserNode | null = null
    let analyserR: AnalyserNode | null = null
    let freqData = new Uint8Array(0)
    let prevFreq = new Float32Array(0)
    let timeData = new Uint8Array(0)
    let vuBufL = new Uint8Array(0)
    let vuBufR = new Uint8Array(0)
    let currentDevice = localStorage.getItem('nar-audio-device') || ''
    let disposed = false

    const teardownAudio = () => {
      try { stream?.getTracks().forEach(t => t.stop()) } catch { /* ignore */ }
      try { audioCtx?.close() } catch { /* ignore */ }
      stream = null
      audioCtx = null
      analyser = null
      analyserL = null
      analyserR = null
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
        analyser = audioCtx.createAnalyser()
        analyser.fftSize = 2048
        // Light smoothing — spectral flux needs frame-to-frame change to survive.
        analyser.smoothingTimeConstant = 0.6
        node.connect(analyser)
        freqData = new Uint8Array(analyser.frequencyBinCount)
        prevFreq = new Float32Array(analyser.frequencyBinCount)
        timeData = new Uint8Array(analyser.fftSize)
        // Stereo split — drives the L/R VU meters and the X-Y scope.
        const splitter = audioCtx.createChannelSplitter(2)
        node.connect(splitter)
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

    const drawQuad = () => gl.drawArrays(gl.TRIANGLES, 0, 3)

    const draw = () => {
      raf = requestAnimationFrame(draw)
      const now = performance.now() / 1000

      let bass = 0, mid = 0, treble = 0, level = 0, centroid = 0
      let vuLraw = 0, vuRraw = 0
      let onset = false

      if (analyser) {
        analyser.getByteFrequencyData(freqData)
        const n = freqData.length
        bass = band(1, 8)
        mid = band(8, 70)
        treble = band(70, 320)

        // Spectral flux (onset energy) + spectral centroid (brightness).
        let fl = 0, csum = 0, cwsum = 0
        for (let i = 2; i < n; i++) {
          const m = freqData[i] / 255
          const d = m - prevFreq[i]
          if (d > 0) fl += d
          prevFreq[i] = m
          csum += m
          cwsum += m * i
        }
        const flux = fl / n
        centroid = csum > 1e-4 ? Math.min(1, (cwsum / csum) / 200) : 0
        fluxHist.push(flux)
        if (fluxHist.length > 43) fluxHist.shift()
        const fluxAvg = fluxHist.reduce((a, b) => a + b, 0) / fluxHist.length
        onset = flux > fluxAvg * 1.6 && flux > 0.002 && (now - lastBeat) > 0.12

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

      // Beat — flux onsets, with a tracked period for a smooth beat-phase clock.
      if (onset) {
        const interval = now - lastBeat
        if (interval > 0.30 && interval < 1.05) beatPeriod = beatPeriod * 0.78 + interval * 0.22
        lastBeat = now
        beatEnv = 1
      }
      beatEnv *= 0.90
      const beatPhase = Math.min(1, (now - lastBeat) / beatPeriod)

      levelsRef.current = {
        bass: sm.bass, mid: sm.mid, treble: sm.treble, level: sm.level,
        beat: beatEnv, beatAt: lastBeat, centroid: smCentroid, beatPhase,
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
      gl.uniform2f(compU.uRes, VIZ_W, VIZ_H)
      gl.uniform1f(compU.uTime, now)
      gl.uniform1f(compU.uIntensity, intensityRef.current)
      gl.uniform1f(compU.uBeat, beatEnv)
      gl.uniform1f(compU.uTreble, sm.treble)
      gl.uniform1i(compU.uKaleido, kaleidoRef.current ? 6 : 0)
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
      gl.deleteVertexArray(vao)
      for (const t of scene) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
      for (const t of bloom) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo) }
    }
  }, [])

  const getCanvas = useCallback(() => canvasRef.current, [])

  return (
    <Ctx.Provider value={{
      getCanvas, mode, setMode, palette, setPalette, intensity, setIntensity,
      kaleido, setKaleido, autoCycle, setAutoCycle, audioActive, levelsRef,
      customShaders, customMode, setCustomMode, openShaderFolder,
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
