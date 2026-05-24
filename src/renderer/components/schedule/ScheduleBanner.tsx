import { useEffect, useRef, useState } from 'react'
import { useSchedule } from '../../hooks/useSchedule'
import { useViz } from '../../viz/VizProvider'
import { NAR_LOGO_DATA_URI } from '../../cg/narLogo'

function PaceIndicator() {
  const { levelsRef, audioActive } = useViz()
  const audioActiveRef = useRef(audioActive)
  audioActiveRef.current = audioActive
  const [pace, setPace] = useState({ bpm: 0, locked: false, beat: 0 })

  useEffect(() => {
    const id = window.setInterval(() => {
      const lv = levelsRef.current
      const bpm = Math.round(lv.bpm)
      const locked = lv.bpmConfident && audioActiveRef.current
      setPace(prev =>
        prev.bpm === bpm && prev.locked === locked && Math.abs(prev.beat - lv.beat) < 0.05
          ? prev
          : { bpm, locked, beat: lv.beat })
    }, 150)
    return () => window.clearInterval(id)
  }, [levelsRef])

  return (
    <div
      className="flex items-center gap-1.5 shrink-0"
      title={pace.locked ? 'Pace locked — tempo-driven triggers active' : 'Listening for a stable tempo…'}
    >
      <div
        className="w-1.5 h-1.5 rounded-full"
        style={{
          background: pace.locked ? '#f7931e' : '#2e2e3a',
          opacity: pace.locked ? 0.45 + 0.55 * pace.beat : 1,
        }}
      />
      <span className={`text-xs tabular-nums font-bold ${pace.locked ? 'text-nar-amber' : 'text-slate-600'}`}>
        {pace.locked && pace.bpm > 50 ? pace.bpm : '—'}
      </span>
      <span className="text-[10px] text-slate-500 tracking-wider">BPM</span>
    </div>
  )
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return (
    <span className="text-slate-200 tabular-nums text-sm font-bold">
      {time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  )
}

export function ScheduleBanner() {
  const { current, next, nextIn, progress, stale } = useSchedule()

  return (
    <div className="flex items-center gap-4 px-4 h-10 bg-surface-900 border-b border-surface-700 shrink-0">
      {/* Station ident */}
      <div className="flex items-center shrink-0">
        <img src={NAR_LOGO_DATA_URI} alt="Now Ayrshire Radio" className="h-6 w-auto" />
      </div>

      {/* Current show */}
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {current?.thumbnail && (
          <img src={current.thumbnail} className="h-6 w-6 rounded object-cover shrink-0" alt="" />
        )}
        <div className="flex flex-col min-w-0">
          <span className="text-xs text-slate-400 uppercase tracking-wider leading-none">ON AIR</span>
          <span className="text-sm font-bold text-white truncate leading-tight">
            {current?.name ?? '—'}
          </span>
        </div>

        {/* Progress bar */}
        {current && (
          <div className="flex-1 max-w-48 h-1 bg-surface-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-nar-red rounded-full transition-all duration-1000"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Next show */}
      {next && (
        <div className="flex items-center gap-2 shrink-0 text-slate-500">
          <span className="text-xs uppercase tracking-wider">Next</span>
          <span className="text-xs text-slate-300 font-medium truncate max-w-40">{next.name}</span>
          {nextIn && <span className="text-xs text-nar-amber font-mono">{nextIn}</span>}
        </div>
      )}

      {stale && (
        <span className="text-xs text-nar-amber shrink-0">⚠ stale</span>
      )}

      <PaceIndicator />

      <Clock />
    </div>
  )
}
