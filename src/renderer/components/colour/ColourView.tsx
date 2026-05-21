import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useCameraStreams } from '../../camera/CameraStreamProvider'
import { useGrade } from '../../grade/GradeProvider'
import { GradeEngine } from '../../grade/GradeEngine'
import { NEUTRAL_GRADE, type Grade, type RGB } from '../../grade/types'
import { GRADE_PRESETS } from '../../grade/presets'
import { Scopes } from '../../scopes'

/**
 * Full-screen colour-grading workspace. Shows a live-graded preview of the
 * selected camera, broadcast scopes of that graded output, and per-camera
 * lift/gamma/gain + LUT controls. Grades persist and feed the compositor, so
 * what is dialled in here is what goes to air.
 */
export function ColourView({ onExit }: { onExit: () => void }) {
  const { sources, videoEls } = useCameraStreams()
  const { grades, gradesRef, setGrade, resetGrade, copyGradeToAll, loadLut, clearLut, accelerated } = useGrade()

  const [selected, setSelected] = useState(() => {
    const v = Number(localStorage.getItem('nar-selected-camera'))
    return v >= 0 && v <= 3 ? v : 0
  })
  const [bypass, setBypass] = useState(false)
  const [lutError, setLutError] = useState<string | null>(null)
  const [engineCanvas, setEngineCanvas] = useState<HTMLCanvasElement | null>(null)

  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const bypassRef = useRef(bypass)
  bypassRef.current = bypass
  const previewRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { localStorage.setItem('nar-selected-camera', String(selected)) }, [selected])

  // This view's own grade engine — independent of the compositor's, so the
  // preview never contends with the program render. Disposed on exit.
  useEffect(() => {
    const engine = new GradeEngine()
    setEngineCanvas(engine.canvas)
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = previewRef.current
      if (!cv) return
      const v = videoEls.current[selectedRef.current]
      const grade = bypassRef.current ? NEUTRAL_GRADE : gradesRef.current[selectedRef.current]
      if (v) engine.process(v, grade)

      const rect = cv.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w === 0 || h === 0) return
      if (cv.width !== w) cv.width = w
      if (cv.height !== h) cv.height = h
      const ctx = cv.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      const ec = engine.canvas
      const scale = Math.min(w / ec.width, h / ec.height)
      const dw = ec.width * scale
      const dh = ec.height * scale
      ctx.drawImage(ec, (w - dw) / 2, (h - dh) / 2, dw, dh)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      engine.dispose()
    }
  }, [videoEls, gradesRef])

  const grade = grades[selected]
  const hasSignal = sources.find(s => s.index === selected)?.hasSignal ?? false
  const patch = (p: Partial<Grade>) => setGrade(selected, { ...grade, ...p })

  const onLutFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file
    if (!file) return
    setLutError(null)
    try {
      await loadLut(selected, file)
    } catch (err) {
      setLutError((err as Error).message || 'Invalid .cube file')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-surface-950 overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-3 px-3 h-11 shrink-0 bg-surface-900 border-b border-surface-700">
        <button
          onClick={onExit}
          className="text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
        >
          ‹ Switcher
        </button>
        <span className="text-xs font-bold tracking-wider text-slate-200">COLOUR GRADING</span>

        <div className="flex gap-1 ml-2">
          {[0, 1, 2, 3].map(i => {
            const sig = sources.find(s => s.index === i)?.hasSignal ?? false
            return (
              <button
                key={i}
                onClick={() => setSelected(i)}
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded transition-colors ${
                  selected === i
                    ? 'bg-nar-red text-white'
                    : 'bg-surface-700 text-slate-400 hover:text-white'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${sig ? 'bg-nar-green' : 'bg-surface-500'}`} />
                CAM {i + 1}
              </button>
            )
          })}
        </div>

        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
            accelerated ? 'bg-nar-green/20 text-nar-green' : 'bg-nar-amber/20 text-nar-amber'
          }`}
          title={accelerated ? 'GPU-accelerated grading (WebGL2)' : 'Software fallback — WebGL2 unavailable'}
        >
          {accelerated ? 'GPU' : 'CPU'}
        </span>

        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setBypass(b => !b)}
            className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded transition-colors ${
              bypass ? 'bg-nar-amber text-black' : 'bg-surface-700 text-slate-400 hover:text-white'
            }`}
          >
            {bypass ? 'Bypassed' : 'Bypass'}
          </button>
          <button
            onClick={() => copyGradeToAll(selected)}
            title="Apply this camera's grade to all four — match every camera"
            className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-surface-700 text-slate-400 hover:text-white transition-colors"
          >
            Copy to all
          </button>
          <button
            onClick={() => resetGrade(selected)}
            className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded bg-surface-700 text-slate-400 hover:text-white transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Body: preview · scopes · controls */}
      <div className="flex flex-1 min-h-0 gap-1 p-1">

        {/* Live-graded preview */}
        <div className="flex-1 min-w-0 relative bg-black rounded border border-surface-700 overflow-hidden">
          <canvas ref={previewRef} className="w-full h-full" />
          {bypass && (
            <span className="absolute top-2 left-2 text-xs font-bold bg-nar-amber text-black px-2 py-0.5 rounded">
              BYPASS — ungraded
            </span>
          )}
          {!hasSignal && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-600 text-xs uppercase tracking-wider">CAM {selected + 1} — no signal</span>
            </div>
          )}
          <span className="absolute bottom-2 left-2 text-xs bg-black/60 text-slate-300 px-2 py-0.5 rounded">
            CAM {selected + 1}{grade.lut ? ` · LUT: ${grade.lut.title ?? 'loaded'}` : ''}
          </span>
        </div>

        {/* Broadcast scopes of the graded output */}
        <div className="w-72 shrink-0">
          <Scopes source={engineCanvas} layout="stack" className="h-full overflow-y-auto" />
        </div>

        {/* Grade controls */}
        <div className="w-72 shrink-0 bg-surface-900 rounded border border-surface-700 flex flex-col">
          <div className="px-3 py-2 border-b border-surface-700 shrink-0">
            <span className="text-xs font-bold tracking-wider text-slate-300">CAM {selected + 1} GRADE</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

            <section className="flex flex-col gap-1.5">
              <SectionLabel>Looks — one-click presets</SectionLabel>
              {(['Studio', 'Cinematic'] as const).map(group => (
                <div key={group} className="flex flex-col gap-1">
                  <span className="text-[9px] font-medium uppercase tracking-wider text-slate-600">{group}</span>
                  <div className="grid grid-cols-2 gap-1">
                    {GRADE_PRESETS.filter(p => p.group === group).map(p => (
                      <button
                        key={p.id}
                        onClick={() => setGrade(selected, p.build())}
                        title={`Apply the ${p.label} look to CAM ${selected + 1}`}
                        className="text-[11px] py-1.5 px-1.5 rounded bg-surface-700 text-slate-300 hover:bg-surface-600 hover:text-white transition-colors truncate"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </section>

            <RgbGroup
              title="Lift — shadows" value={grade.lift}
              min={-0.5} max={0.5} step={0.005} neutral={0}
              onChange={lift => patch({ lift })}
            />
            <RgbGroup
              title="Gamma — midtones" value={grade.gamma}
              min={0.25} max={2.5} step={0.01} neutral={1}
              onChange={gamma => patch({ gamma })}
            />
            <RgbGroup
              title="Gain — highlights" value={grade.gain}
              min={0} max={2.5} step={0.01} neutral={1}
              onChange={gain => patch({ gain })}
            />

            <section className="flex flex-col gap-1">
              <SectionLabel>Tone &amp; colour</SectionLabel>
              <GradeSlider
                label="Contrast" accent="#94a3b8" value={grade.contrast}
                min={0} max={2} step={0.01} neutral={1}
                onChange={v => patch({ contrast: v })}
              />
              <GradeSlider
                label="Saturate" accent="#94a3b8" value={grade.saturation}
                min={0} max={2} step={0.01} neutral={1}
                onChange={v => patch({ saturation: v })}
              />
              <GradeSlider
                label="Temp" accent="#f59e0b" value={grade.temperature}
                min={-1} max={1} step={0.01} neutral={0}
                onChange={v => patch({ temperature: v })}
              />
              <GradeSlider
                label="Tint" accent="#c026d3" value={grade.tint}
                min={-1} max={1} step={0.01} neutral={0}
                onChange={v => patch({ tint: v })}
              />
            </section>

            <section className="flex flex-col gap-1.5">
              <SectionLabel>3D LUT (.cube)</SectionLabel>
              <input
                ref={fileInputRef} type="file" accept=".cube"
                onChange={onLutFile} className="hidden"
              />
              <div className="flex gap-1">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 text-xs py-1.5 rounded bg-surface-700 text-slate-300 hover:bg-surface-600 hover:text-white transition-colors"
                >
                  {grade.lut ? 'Replace LUT' : 'Load LUT'}
                </button>
                {grade.lut && (
                  <button
                    onClick={() => clearLut(selected)}
                    className="text-xs py-1.5 px-2 rounded bg-surface-700 text-slate-400 hover:bg-nar-red hover:text-white transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
              {grade.lut && (
                <span className="text-[10px] text-slate-500 truncate">
                  {grade.lut.title ?? 'Untitled'} · {grade.lut.size}³ cube
                </span>
              )}
              {lutError && <span className="text-[10px] text-nar-red">{lutError}</span>}
              <span className="text-[10px] text-slate-700">
                Numeric grade persists; LUTs reload each session.
              </span>
            </section>

            <span className="text-[10px] text-slate-700">Double-click any slider to reset it.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{children}</span>
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  neutral: number
  accent: string
  onChange: (v: number) => void
}

function GradeSlider({ label, value, min, max, step, neutral, accent, onChange }: SliderProps) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] text-slate-400">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(neutral)}
        title="Double-click to reset"
        className="flex-1 min-w-0"
        style={{ accentColor: accent }}
      />
      <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-400">
        {value.toFixed(2)}
      </span>
    </div>
  )
}

interface RgbGroupProps {
  title: string
  value: RGB
  min: number
  max: number
  step: number
  neutral: number
  onChange: (v: RGB) => void
}

function RgbGroup({ title, value, min, max, step, neutral, onChange }: RgbGroupProps) {
  return (
    <section className="flex flex-col gap-1">
      <SectionLabel>{title}</SectionLabel>
      <GradeSlider
        label="Red" accent="#ef4444" value={value.r}
        min={min} max={max} step={step} neutral={neutral}
        onChange={r => onChange({ ...value, r })}
      />
      <GradeSlider
        label="Green" accent="#22c55e" value={value.g}
        min={min} max={max} step={step} neutral={neutral}
        onChange={g => onChange({ ...value, g })}
      />
      <GradeSlider
        label="Blue" accent="#3b82f6" value={value.b}
        min={min} max={max} step={step} neutral={neutral}
        onChange={b => onChange({ ...value, b })}
      />
    </section>
  )
}
