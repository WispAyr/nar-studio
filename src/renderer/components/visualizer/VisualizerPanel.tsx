// NAR Studio — Visualizer Panel
// Mounts a WebGPU canvas, drives the AudioAnalyser + WebGPUEngine each rAF tick.
// Reads the active audio device from localStorage (set by AudioPanel).

import { useEffect, useRef, useState, useCallback } from 'react'
import { AudioAnalyser } from '../../lib/visualizer/AudioAnalyser'
import {
  WebGPUEngine,
  DEFAULT_VIZ_PARAMS,
  DEFAULT_POST_PARAMS,
  type VizParams,
} from '../../lib/visualizer/WebGPUEngine'

// ── Types ─────────────────────────────────────────────────────────────────────

type EngineState = 'idle' | 'initialising' | 'running' | 'error'

// ── Component ─────────────────────────────────────────────────────────────────

export function VisualizerPanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<WebGPUEngine | null>(null)
  const analyserRef = useRef<AudioAnalyser | null>(null)
  const rafRef = useRef<number>(0)

  const [engineState, setEngineState] = useState<EngineState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fps, setFps]     = useState(0)
  const [params, setParams] = useState<VizParams>({ ...DEFAULT_VIZ_PARAMS, post: { ...DEFAULT_POST_PARAMS } })

  // FPS counter
  const fpsRef      = useRef({ frames: 0, last: performance.now() })

  // ── Engine lifecycle ────────────────────────────────────────────────────────

  const startEngine = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    setEngineState('initialising')
    setError(null)

    try {
      // Initialise WebGPU engine
      canvas.width  = canvas.offsetWidth  * window.devicePixelRatio
      canvas.height = canvas.offsetHeight * window.devicePixelRatio

      const engine = new WebGPUEngine()
      await engine.initialize(canvas)
      engineRef.current = engine

      // Initialise audio analyser — pick up device saved by AudioPanel
      const deviceId = localStorage.getItem('nar-audio-device') ?? ''
      const analyser = new AudioAnalyser()
      if (deviceId) await analyser.connect(deviceId)
      analyserRef.current = analyser

      setEngineState('running')

      // ── rAF loop ──────────────────────────────────────────────────────
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop)

        // Read audio
        if (analyser.connected) {
          const data = analyser.read()
          engine.setAudioData(data)
        }

        // Render
        engine.render()

        // FPS
        fpsRef.current.frames++
        const now = performance.now()
        if (now - fpsRef.current.last > 1000) {
          setFps(fpsRef.current.frames)
          fpsRef.current.frames = 0
          fpsRef.current.last   = now
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[VisualizerPanel] init failed:', e)
      setError(msg)
      setEngineState('error')
    }
  }, [])

  const stopEngine = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    analyserRef.current?.disconnect()
    engineRef.current?.destroy()
    analyserRef.current = null
    engineRef.current   = null
    setEngineState('idle')
  }, [])

  // ── Mount / unmount ─────────────────────────────────────────────────────────

  useEffect(() => {
    startEngine()
    return () => stopEngine()
  }, [startEngine, stopEngine])

  // ── Sync params to engine ───────────────────────────────────────────────────

  useEffect(() => {
    engineRef.current?.setParams(params)
  }, [params])

  // ── Resize observer ─────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(() => {
      if (!engineRef.current) return
      const w = canvas.offsetWidth  * window.devicePixelRatio
      const h = canvas.offsetHeight * window.devicePixelRatio
      canvas.width  = w
      canvas.height = h
      engineRef.current.resize(w, h)
    })
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  // ── Controls helpers ─────────────────────────────────────────────────────────

  const setPostParam = (key: keyof typeof DEFAULT_POST_PARAMS, value: number) => {
    setParams(p => ({ ...p, post: { ...p.post, [key]: value } }))
  }

  const hex2lin = (hex: string): [number, number, number] => {
    const r = parseInt(hex.slice(1, 3), 16) / 255
    const g = parseInt(hex.slice(3, 5), 16) / 255
    const b = parseInt(hex.slice(5, 7), 16) / 255
    // sRGB → linear (approx)
    return [r**2.2, g**2.2, b**2.2]
  }

  const lin2hex = (rgb: [number, number, number]): string => {
    const clamp = (v: number) => Math.round(Math.min(255, Math.max(0, v**(1/2.2) * 255)))
    return `#${clamp(rgb[0]).toString(16).padStart(2,'0')}${clamp(rgb[1]).toString(16).padStart(2,'0')}${clamp(rgb[2]).toString(16).padStart(2,'0')}`
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-surface-950">

      {/* Canvas — takes all remaining vertical space */}
      <div className="relative flex-1 min-h-0 bg-black">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
          style={{ display: engineState === 'running' ? 'block' : 'none' }}
        />

        {/* Overlay states */}
        {engineState === 'initialising' && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-slate-500 text-xs font-mono uppercase tracking-widest">
              Initialising WebGPU…
            </span>
          </div>
        )}
        {engineState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <span className="text-nar-red text-xs font-mono uppercase tracking-widest">WebGPU unavailable</span>
            <span className="text-slate-600 text-xs font-mono max-w-64 text-center">{error}</span>
            <button
              onClick={startEngine}
              className="mt-2 px-3 py-1 bg-surface-800 border border-surface-600 rounded text-xs text-slate-400 hover:text-white transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* FPS badge */}
        {engineState === 'running' && (
          <span className="absolute top-2 right-2 text-xs font-mono text-slate-700 tabular-nums pointer-events-none">
            {fps} fps
          </span>
        )}
      </div>

      {/* Controls strip — compact, matches NAR dark theme */}
      <div className="shrink-0 bg-surface-900 border-t border-surface-700 px-3 py-2 flex flex-wrap gap-x-5 gap-y-2 text-xs">

        {/* Layer toggles */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600 uppercase tracking-wider">Layers</span>
          {(['spectrumEnabled', 'waveformEnabled', 'particlesEnabled'] as const).map(key => (
            <button
              key={key}
              onClick={() => setParams(p => ({ ...p, [key]: !p[key] }))}
              className={`px-2 py-0.5 rounded text-xs font-mono transition-colors ${
                params[key]
                  ? 'bg-nar-red text-white'
                  : 'bg-surface-700 text-slate-500 hover:text-slate-300'
              }`}
            >
              {key.replace('Enabled', '')}
            </button>
          ))}
        </div>

        {/* Colours */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600 uppercase tracking-wider">Primary</span>
          <input
            type="color"
            value={lin2hex(params.primaryColor)}
            onChange={e => setParams(p => ({ ...p, primaryColor: hex2lin(e.target.value) }))}
            className="w-6 h-5 rounded cursor-pointer bg-transparent border border-surface-600"
          />
          <span className="text-slate-600 uppercase tracking-wider">Accent</span>
          <input
            type="color"
            value={lin2hex(params.accentColor)}
            onChange={e => setParams(p => ({ ...p, accentColor: hex2lin(e.target.value) }))}
            className="w-6 h-5 rounded cursor-pointer bg-transparent border border-surface-600"
          />
        </div>

        {/* Bloom */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600 uppercase tracking-wider">Bloom</span>
          <input
            type="range" min={0} max={0.5} step={0.01}
            value={params.post.bloomStrength}
            onChange={e => setPostParam('bloomStrength', Number(e.target.value))}
            className="w-16 accent-nar-red"
          />
          <span className="text-slate-500 tabular-nums w-8">{params.post.bloomStrength.toFixed(2)}</span>
        </div>

        {/* Exposure */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600 uppercase tracking-wider">EV</span>
          <input
            type="range" min={0.5} max={2.0} step={0.05}
            value={params.post.exposure}
            onChange={e => setPostParam('exposure', Number(e.target.value))}
            className="w-16 accent-nar-red"
          />
          <span className="text-slate-500 tabular-nums w-8">{params.post.exposure.toFixed(2)}</span>
        </div>

        {/* Saturation */}
        <div className="flex items-center gap-2">
          <span className="text-slate-600 uppercase tracking-wider">Sat</span>
          <input
            type="range" min={0} max={2} step={0.05}
            value={params.post.saturation}
            onChange={e => setPostParam('saturation', Number(e.target.value))}
            className="w-16 accent-nar-red"
          />
          <span className="text-slate-500 tabular-nums w-8">{params.post.saturation.toFixed(2)}</span>
        </div>

      </div>
    </div>
  )
}
