/**
 * Status-bar health indicator — a small dot + alert count. Green when the
 * system is happy, amber pulse on warnings, red pulse on criticals. Clicking
 * pops a panel of every active alert with per-alert dismiss buttons.
 */
import { useEffect, useRef, useState } from 'react'
import { useHealth, type HealthAlert } from './HealthMonitorProvider'

function levelDotClass(level: HealthAlert['level']): string {
  if (level === 'critical') return 'bg-nar-red'
  if (level === 'warning') return 'bg-nar-amber'
  return 'bg-nar-green'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

export function HealthIndicator() {
  const { alerts, dismiss, critical, warning } = useHealth()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Click-away — close the popover when the operator clicks anywhere else.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const dotClass = critical
    ? 'bg-nar-red animate-pulse'
    : warning
    ? 'bg-nar-amber animate-pulse'
    : 'bg-nar-green'

  const label = critical
    ? `${alerts.length} CRITICAL`
    : warning
    ? `${alerts.length} WARN`
    : 'OK'
  const labelClass = critical
    ? 'text-nar-red font-bold'
    : warning
    ? 'text-nar-amber font-bold'
    : 'text-slate-500'

  const title = alerts.length === 0
    ? 'System health: all clear'
    : `System health: ${alerts.length} active alert${alerts.length === 1 ? '' : 's'}`

  return (
    <div ref={wrapperRef} className="relative flex items-center shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        title={title}
        className="flex items-center gap-1.5 px-1.5 rounded hover:bg-surface-800 transition-colors"
      >
        <div className={`w-1.5 h-1.5 rounded-full ${dotClass}`} />
        <span className={`uppercase tracking-wider ${labelClass}`}>{label}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 bottom-full mb-1 w-80 max-h-96 overflow-y-auto bg-surface-900 border border-surface-700 rounded shadow-2xl z-50"
          role="dialog"
        >
          <div className="px-3 py-2 text-xs uppercase tracking-wider text-slate-500 border-b border-surface-800">
            System health
          </div>
          {alerts.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-500">
              No active alerts. All systems nominal.
            </div>
          ) : (
            <ul className="divide-y divide-surface-800">
              {alerts.map(a => (
                <li key={a.id} className="flex items-start gap-2 px-3 py-2 text-xs">
                  <div className={`mt-1 w-2 h-2 rounded-full shrink-0 ${levelDotClass(a.level)}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200 truncate">{a.source}</span>
                      <span className="text-slate-600 tabular-nums">{fmtTime(a.timestamp)}</span>
                    </div>
                    <div className="text-slate-400 mt-0.5 break-words">{a.message}</div>
                  </div>
                  <button
                    onClick={() => dismiss(a.id)}
                    title="Dismiss"
                    className="text-slate-600 hover:text-slate-200 transition-colors shrink-0 px-1"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
