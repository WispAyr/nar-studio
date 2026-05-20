import { useState, useEffect } from 'react'
import { useSchedule } from '../../hooks/useSchedule'

const studio = (window as any).studio

interface RecordingSession {
  showUid: string
  showName: string
  showSlug: string
  outputDir: string
  startedAt: string
  autoStarted: boolean
}

export function RecordingPanel() {
  const { shows, current } = useSchedule()
  const [session, setSession] = useState<RecordingSession | null>(null)
  const [autoRecord, setAutoRecord] = useState(true)
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    studio?.getRecordingSession?.().then((s: RecordingSession | null) => setSession(s))
    const unsub = studio?.onRecordingSession?.((s: RecordingSession | null) => setSession(s))
    return () => unsub?.()
  }, [])

  // Elapsed timer
  useEffect(() => {
    if (!session) { setElapsed(''); return }
    const tick = () => {
      const ms = Date.now() - new Date(session.startedAt).getTime()
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      const s = Math.floor((ms % 60_000) / 1000)
      setElapsed(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [session])

  const toggleAuto = () => {
    const next = !autoRecord
    setAutoRecord(next)
    studio?.setAutoRecord?.(next)
  }

  const startManual = (show: any) => studio?.startRecording?.(show)
  const stop = () => studio?.stopRecording?.()

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Recording</span>
        <button
          onClick={toggleAuto}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            autoRecord ? 'bg-nar-green/20 text-nar-green border border-nar-green/30' : 'bg-surface-700 text-slate-500'
          }`}
        >
          AUTO {autoRecord ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Active session */}
      {session ? (
        <div className="flex flex-col gap-1 p-2 rounded bg-surface-800 border border-nar-red/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-nar-red animate-pulse shrink-0" />
            <span className="text-xs font-bold text-white truncate">{session.showName}</span>
            {session.autoStarted && (
              <span className="text-xs text-slate-500 shrink-0">auto</span>
            )}
          </div>
          <span className="text-lg font-mono font-bold text-nar-red tabular-nums">{elapsed}</span>
          <span className="text-xs text-slate-600 truncate">{session.outputDir}</span>
          <button
            onClick={stop}
            className="mt-1 text-xs bg-surface-700 hover:bg-nar-red hover:text-white text-slate-400 py-1 rounded transition-colors font-bold uppercase tracking-wider"
          >
            Stop Recording
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-slate-600">No active session</span>
          {current && (
            <button
              onClick={() => startManual(current)}
              className="text-xs bg-nar-red hover:bg-red-600 text-white py-1.5 rounded font-bold uppercase tracking-wider transition-colors"
            >
              ● REC  {current.name}
            </button>
          )}
        </div>
      )}

      {/* Upcoming shows quick-start */}
      {!session && shows.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-xs text-slate-600 uppercase tracking-wider">Quick Start</span>
          {shows.slice(0, 3).map(show => (
            <button
              key={show.uid}
              onClick={() => startManual(show)}
              className="text-xs text-left px-2 py-1 rounded bg-surface-800 hover:bg-surface-700 text-slate-400 hover:text-white transition-colors truncate"
            >
              {show.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
