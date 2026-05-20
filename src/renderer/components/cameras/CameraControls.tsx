import { useState } from 'react'
import type { CameraInfo } from '../../hooks/useCameras'

const studio = (window as any).studio

// PTZ direction values matching obsbot.ts PTZ constants
const PTZ = { STOP: 0x00, PAN_LEFT: 0x01, PAN_RIGHT: 0x02, TILT_UP: 0x04, TILT_DOWN: 0x08 }

interface Props {
  camera: CameraInfo | null
  index: number
}

export function CameraControls({ camera, index }: Props) {
  const [speed, setSpeed] = useState(50)
  const [tracking, setTracking] = useState<'body' | 'face' | 'desk' | 'whiteboard'>('body')
  const [wbMode, setWbMode] = useState<'auto' | 'manual'>('auto')
  const [kelvin, setKelvin] = useState(5500)
  const [expMode, setExpMode] = useState<'auto' | 'manual'>('auto')

  if (!camera) return null

  const ptz = (dir: number) => studio?.cameraPtz?.(index, dir, speed)
  const zoom = (dir: 'in' | 'out' | 'stop') => studio?.cameraZoom?.(index, dir, speed)

  const toggleAi = () => {
    studio?.cameraAi?.(index, !camera.aiTracking)
  }

  return (
    <div className="flex flex-wrap gap-3 p-3 h-full overflow-y-auto content-start">

      {/* PTZ Joystick */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider">PTZ</span>
        <div className="grid grid-cols-3 gap-1 w-fit">
          <div />
          <button className="ptz-btn" onMouseDown={() => ptz(PTZ.TILT_UP)} onMouseUp={() => ptz(PTZ.STOP)}>▲</button>
          <div />
          <button className="ptz-btn" onMouseDown={() => ptz(PTZ.PAN_LEFT)} onMouseUp={() => ptz(PTZ.STOP)}>◀</button>
          <button className="ptz-btn" onClick={() => studio?.cameraResetHome?.(index)}>⊙</button>
          <button className="ptz-btn" onMouseDown={() => ptz(PTZ.PAN_RIGHT)} onMouseUp={() => ptz(PTZ.STOP)}>▶</button>
          <div />
          <button className="ptz-btn" onMouseDown={() => ptz(PTZ.TILT_DOWN)} onMouseUp={() => ptz(PTZ.STOP)}>▼</button>
          <div />
        </div>
        {/* Zoom */}
        <div className="flex gap-1">
          <button className="ptz-btn flex-1 text-xs" onMouseDown={() => zoom('out')} onMouseUp={() => zoom('stop')}>W−</button>
          <button className="ptz-btn flex-1 text-xs" onMouseDown={() => zoom('in')} onMouseUp={() => zoom('stop')}>T+</button>
        </div>
        {/* Speed */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Spd</span>
          <input
            type="range" min={1} max={100} value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="flex-1 accent-nar-red"
          />
          <span className="text-xs text-slate-400 w-6 text-right tabular-nums">{speed}</span>
        </div>
      </div>

      {/* Presets */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Presets</span>
        <div className="grid grid-cols-3 gap-1">
          {[1, 2, 3, 4, 5, 6].map(slot => (
            <div key={slot} className="flex flex-col gap-0.5">
              <button
                className={`text-xs px-2 py-1 rounded font-bold transition-colors ${
                  camera.currentPreset === slot
                    ? 'bg-nar-red text-white'
                    : 'bg-surface-700 hover:bg-surface-600 text-slate-300'
                }`}
                onClick={() => studio?.cameraPresetGoto?.(index, slot)}
              >
                {slot}
              </button>
              <button
                className="text-xs px-1 py-0.5 rounded bg-surface-800 hover:bg-surface-700 text-slate-500 hover:text-slate-300 transition-colors"
                onClick={() => studio?.cameraPresetSave?.(index, slot)}
                title={`Save preset ${slot}`}
              >
                SET
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* AI Tracking */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider">AI Tracking</span>
        <button
          onClick={toggleAi}
          className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider transition-colors ${
            camera.aiTracking
              ? 'bg-nar-green text-black'
              : 'bg-surface-700 hover:bg-surface-600 text-slate-400'
          }`}
        >
          {camera.aiTracking ? 'ON' : 'OFF'}
        </button>
        <div className="flex flex-col gap-1">
          {(['body', 'face', 'desk', 'whiteboard'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => { setTracking(mode); studio?.cameraTrackingMode?.(index, mode) }}
              className={`text-xs px-2 py-1 rounded capitalize transition-colors ${
                tracking === mode
                  ? 'bg-surface-600 text-white'
                  : 'bg-surface-800 hover:bg-surface-700 text-slate-500'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Image settings */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Image</span>

        {/* Exposure */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">Exposure</span>
          <div className="flex gap-1">
            {(['auto', 'manual'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setExpMode(m); studio?.cameraExposure?.(index, m) }}
                className={`text-xs px-2 py-0.5 rounded capitalize transition-colors ${
                  expMode === m ? 'bg-surface-600 text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* White Balance */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">White Balance</span>
          <div className="flex gap-1">
            {(['auto', 'manual'] as const).map(m => (
              <button
                key={m}
                onClick={() => { setWbMode(m); studio?.cameraWhiteBalance?.(index, m, kelvin) }}
                className={`text-xs px-2 py-0.5 rounded capitalize transition-colors ${
                  wbMode === m ? 'bg-surface-600 text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {wbMode === 'manual' && (
            <div className="flex items-center gap-2">
              <input
                type="range" min={2500} max={8000} step={100} value={kelvin}
                onChange={e => { setKelvin(Number(e.target.value)); studio?.cameraWhiteBalance?.(index, 'manual', Number(e.target.value)) }}
                className="flex-1 accent-nar-blue"
              />
              <span className="text-xs text-slate-400 tabular-nums w-12 text-right">{kelvin}K</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
