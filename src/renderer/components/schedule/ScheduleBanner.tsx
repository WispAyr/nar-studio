import { useEffect, useState } from 'react'
import { useSchedule } from '../../hooks/useSchedule'

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
      {/* Logo / branding */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-2 h-2 rounded-full bg-nar-red" />
        <span className="text-xs font-bold tracking-widest text-slate-400 uppercase">NAR</span>
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

      <Clock />
    </div>
  )
}
