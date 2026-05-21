import { useState, type ReactNode } from 'react'
import { useCameraControl, PRESET_COUNT, type Axis, type Mode } from '../../camera/useCameraControl'
import { useAiTracking } from '../../ai/AiTrackingProvider'
import { useSegmentation, type BgMode } from '../../segmentation/SegmentationProvider'

interface Props {
  index: number
}

export function CameraControls({ index }: Props) {
  const cam = useCameraControl(index)
  const { tracking, setTracking } = useAiTracking()
  const { configs: bgConfigs, setConfig: setBgConfig } = useSegmentation()
  const [saveMode, setSaveMode] = useState(false)
  const isTracking = tracking[index]
  const bg = bgConfigs[index]

  if (!cam.available) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-slate-600 text-xs uppercase tracking-wider">Camera offline</span>
      </div>
    )
  }

  const hold = (axis: Axis, dir: 1 | -1) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture?.(e.pointerId)
      cam.startMove(axis, dir)
    },
    onPointerUp: cam.stopMove,
    onPointerCancel: cam.stopMove,
  })

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">

      {/* AI auto-track — steers pan/tilt to keep the detected subject framed */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>AI Auto-Track</SectionLabel>
        <button
          onClick={() => setTracking(index, !isTracking)}
          className={`h-10 rounded text-xs font-bold uppercase tracking-wider transition-colors flex items-center justify-center gap-2 ${
            isTracking
              ? 'bg-nar-green text-black'
              : 'bg-surface-700 text-slate-300 hover:bg-surface-600 hover:text-white'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isTracking ? 'bg-black animate-pulse' : 'bg-slate-500'}`} />
          {isTracking ? 'Tracking — On' : 'Tracking — Off'}
        </button>
      </section>

      {/* Pan / Tilt */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <SectionLabel>Pan / Tilt</SectionLabel>
          <button
            onClick={() => cam.setInvertPan(!cam.invertPan)}
            title="Flip pan direction for this camera"
            className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors ${
              cam.invertPan ? 'bg-nar-blue text-white' : 'bg-surface-700 text-slate-400 hover:text-white'
            }`}
          >
            ⇄ Invert Pan
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1.5 w-fit mx-auto">
          <span />
          <PadButton {...hold('tilt', 1)}>▲</PadButton>
          <span />
          <PadButton {...hold('pan', -1)}>◀</PadButton>
          <button
            onClick={cam.goHome}
            className="w-14 h-14 rounded bg-surface-800 hover:bg-surface-700 text-slate-400 hover:text-white text-lg transition-colors"
            title="Home"
          >
            ⌂
          </button>
          <PadButton {...hold('pan', 1)}>▶</PadButton>
          <span />
          <PadButton {...hold('tilt', -1)}>▼</PadButton>
          <span />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 w-10">Speed</span>
          <input
            type="range" min={10} max={100} value={cam.speed}
            onChange={e => cam.setSpeed(Number(e.target.value))}
            className="flex-1 accent-nar-red"
          />
          <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{cam.speed}</span>
        </div>
      </section>

      {/* Zoom */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>
          Zoom <span className="text-slate-600 normal-case">{Math.round(cam.ptz.zoom)}%</span>
        </SectionLabel>
        <div className="flex gap-1.5">
          <button
            {...hold('zoom', -1)}
            className="flex-1 h-10 rounded bg-surface-700 hover:bg-surface-600 active:bg-nar-red text-slate-200 text-xs font-bold uppercase tracking-wider transition-colors select-none"
          >
            − Wide
          </button>
          <button
            {...hold('zoom', 1)}
            className="flex-1 h-10 rounded bg-surface-700 hover:bg-surface-600 active:bg-nar-red text-slate-200 text-xs font-bold uppercase tracking-wider transition-colors select-none"
          >
            Tele +
          </button>
        </div>
      </section>

      {/* Presets — the ⌂ slot is this camera's home position */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <SectionLabel>Presets</SectionLabel>
          <button
            onClick={() => setSaveMode(s => !s)}
            className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors ${
              saveMode ? 'bg-nar-amber text-black' : 'bg-surface-700 text-slate-400 hover:text-white'
            }`}
          >
            {saveMode ? 'Tap a slot' : 'Save'}
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          <button
            onClick={() => {
              if (saveMode) { cam.setHome(); setSaveMode(false) }
              else cam.goHome()
            }}
            title={
              saveMode
                ? 'Save current position as home'
                : cam.home
                ? 'Home — recall saved position'
                : 'Home — recall default position'
            }
            className={`h-10 rounded text-base font-bold transition-colors ${
              saveMode
                ? 'bg-nar-amber/20 text-nar-amber border border-nar-amber/40'
                : cam.home
                ? 'bg-nar-blue/80 text-white hover:bg-nar-blue'
                : 'bg-surface-700 text-slate-300 hover:bg-surface-600'
            }`}
          >
            ⌂
          </button>
          {Array.from({ length: PRESET_COUNT }, (_, slot) => {
            const isSet = !!cam.presets[slot]
            return (
              <button
                key={slot}
                onClick={() => {
                  if (saveMode) { cam.savePreset(slot); setSaveMode(false) }
                  else cam.recallPreset(slot)
                }}
                className={`h-10 rounded text-sm font-bold transition-colors ${
                  saveMode
                    ? 'bg-nar-amber/20 text-nar-amber border border-nar-amber/40'
                    : isSet
                    ? 'bg-surface-700 hover:bg-nar-red hover:text-white text-slate-200'
                    : 'bg-surface-800 text-slate-600 hover:text-slate-400'
                }`}
              >
                {slot + 1}
              </button>
            )
          })}
        </div>
      </section>

      {/* Image */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Image</SectionLabel>
        <ModeRow label="Exposure" mode={cam.exposureMode} onChange={cam.setExposure} />
        <ModeRow
          label="White Bal"
          mode={cam.whiteBalanceMode}
          onChange={m => cam.setWhiteBalance(m, cam.kelvin)}
        />
        {cam.whiteBalanceMode === 'manual' && (
          <div className="flex items-center gap-2 pl-1">
            <input
              type="range" min={2000} max={10000} step={100} value={cam.kelvin}
              onChange={e => cam.setWhiteBalance('manual', Number(e.target.value))}
              className="flex-1 accent-nar-blue"
            />
            <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{cam.kelvin}K</span>
          </div>
        )}
        <ModeRow label="Focus" mode={cam.focusMode} onChange={cam.setFocus} />
      </section>

      {/* Background — live segmentation: green-screen-free blur or backdrop */}
      <section className="flex flex-col gap-1.5">
        <SectionLabel>Background</SectionLabel>
        <div className="flex gap-1">
          {(['off', 'blur', 'colour', 'viz'] as BgMode[]).map(m => (
            <button
              key={m}
              onClick={() => setBgConfig(index, { mode: m })}
              className={`flex-1 text-xs py-1 rounded capitalize transition-colors ${
                bg.mode === m ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        {bg.mode === 'viz' && (
          <span className="text-xs text-slate-600">Live music visualizer — set the look in the Viz tab.</span>
        )}
        {bg.mode === 'blur' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-10">Blur</span>
            <input
              type="range" min={4} max={40} value={bg.blur}
              onChange={e => setBgConfig(index, { blur: Number(e.target.value) })}
              className="flex-1 accent-nar-blue"
            />
            <span className="text-xs text-slate-400 w-8 text-right tabular-nums">{bg.blur}</span>
          </div>
        )}
        {bg.mode === 'colour' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 w-10">Colour</span>
            <input
              type="color" value={bg.colour}
              onChange={e => setBgConfig(index, { colour: e.target.value })}
              className="flex-1 h-7 rounded bg-surface-800 border border-surface-600 cursor-pointer"
            />
          </div>
        )}
      </section>
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-xs text-slate-500 uppercase tracking-wider">{children}</span>
}

function PadButton({ children, ...handlers }: { children: ReactNode } & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...handlers}
      className="w-14 h-14 rounded bg-surface-700 hover:bg-surface-600 active:bg-nar-red text-slate-200 hover:text-white text-lg transition-colors select-none touch-none"
    >
      {children}
    </button>
  )
}

function ModeRow({
  label, mode, onChange,
}: {
  label: string
  mode: Mode
  onChange: (m: Mode) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
      <div className="flex gap-1 flex-1">
        {(['auto', 'manual'] as const).map(m => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={`flex-1 text-xs py-1 rounded capitalize transition-colors ${
              mode === m ? 'bg-surface-600 text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {m}
          </button>
        ))}
      </div>
    </div>
  )
}
