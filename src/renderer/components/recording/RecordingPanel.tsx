import { useState, useEffect } from 'react'
import { useSchedule } from '../../hooks/useSchedule'
import { useEngine } from '../../engine/EngineProvider'

const studio = (window as any).studio

const pad = (n: number) => String(n).padStart(2, '0')

function useElapsed(startedAtMs: number | null) {
  const [elapsed, setElapsed] = useState('')
  useEffect(() => {
    if (!startedAtMs) { setElapsed(''); return }
    const tick = () => {
      const ms = Date.now() - startedAtMs
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      const s = Math.floor((ms % 60_000) / 1000)
      setElapsed(`${pad(h)}:${pad(m)}:${pad(s)}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [startedAtMs])
  return elapsed
}

export function RecordingPanel() {
  const { engineId } = useEngine()
  return engineId === 'builtin' ? <BuiltinRecording /> : <ObsRecording />
}

function BuiltinRecording() {
  const {
    recording, recordingStartedAt, recordingFile, startRecording, stopRecording,
    autoRecord, setAutoRecord, recordIso, setRecordIso, isoCount, recordError,
  } = useEngine()
  const { current } = useSchedule()
  const elapsed = useElapsed(recordingStartedAt)
  const [error, setError] = useState<string | null>(null)
  // The session folder — program + every ISO file are saved here together.
  const folder = recordingFile ? recordingFile.replace(/[\\/][^\\/]*$/, '') : null

  const start = async () => {
    setError(null)
    try {
      await startRecording(current)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Recording — Built-in</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => studio?.builtinRecOpenFolder?.()}
            title="Open the recordings folder"
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            Open folder
          </button>
          <button
            onClick={() => setAutoRecord(!autoRecord)}
            className={`text-xs px-2 py-0.5 rounded transition-colors ${
              autoRecord ? 'bg-nar-green/20 text-nar-green border border-nar-green/30' : 'bg-surface-700 text-slate-500'
            }`}
          >
            AUTO {autoRecord ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {recordError && (
        <div className="flex items-start gap-1.5 p-2 rounded bg-nar-red/15 border border-nar-red/40">
          <span className="text-xs font-bold text-nar-red shrink-0">⚠ DISK</span>
          <span className="text-xs text-nar-red">{recordError}</span>
        </div>
      )}

      {recording ? (
        <div className="flex flex-col gap-1 p-2 rounded bg-surface-800 border border-nar-red/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-nar-red animate-pulse shrink-0" />
            <span className="text-xs font-bold text-white truncate">{current?.name ?? 'Program'}</span>
          </div>
          <span className="text-lg font-mono font-bold text-nar-red tabular-nums">{elapsed}</span>
          <span className="text-xs text-slate-500">
            Program{isoCount > 0 ? ` + ${isoCount} ISO camera ${isoCount === 1 ? 'file' : 'files'}` : ''} →
          </span>
          {folder && (
            <span className="text-xs text-slate-600 truncate" title={folder}>{folder}</span>
          )}
          <button
            onClick={stopRecording}
            className="mt-1 text-xs bg-surface-700 hover:bg-nar-red hover:text-white text-slate-400 py-1 rounded transition-colors font-bold uppercase tracking-wider"
          >
            Stop Recording
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <button
            onClick={start}
            className="text-xs bg-nar-red hover:bg-red-600 text-white py-1.5 rounded font-bold uppercase tracking-wider transition-colors"
          >
            ● REC Program{recordIso ? ' + ISO' : ''}
          </button>
          {error && <span className="text-xs text-nar-red">{error}</span>}
          <button
            onClick={() => setRecordIso(!recordIso)}
            className={`text-xs px-2 py-1 rounded transition-colors font-bold uppercase tracking-wider ${
              recordIso
                ? 'bg-nar-green/20 text-nar-green border border-nar-green/30'
                : 'bg-surface-700 text-slate-500'
            }`}
          >
            ISO per-camera {recordIso ? 'ON' : 'OFF'}
          </button>
          <span className="text-xs text-slate-600">
            {recordIso
              ? 'Records the program plus a clean, ungraded file per camera — all to Videos/NAR Studio/Recordings.'
              : 'Records the program output only (video + studio audio).'}
          </span>
        </div>
      )}
    </div>
  )
}

interface RecordingSession {
  showUid: string
  showName: string
  showSlug: string
  outputDir: string
  startedAt: string
  autoStarted: boolean
}

function ObsRecording() {
  const { shows, current } = useSchedule()
  const [session, setSession] = useState<RecordingSession | null>(null)
  const [autoRecord, setAutoRecord] = useState(true)
  const elapsed = useElapsed(session ? new Date(session.startedAt).getTime() : null)

  useEffect(() => {
    studio?.getRecordingSession?.().then((s: RecordingSession | null) => setSession(s))
    const unsub = studio?.onRecordingSession?.((s: RecordingSession | null) => setSession(s))
    return () => unsub?.()
  }, [])

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
        <span className="text-xs text-slate-500 uppercase tracking-wider">Recording — OBS</span>
        <button
          onClick={toggleAuto}
          className={`text-xs px-2 py-0.5 rounded transition-colors ${
            autoRecord ? 'bg-nar-green/20 text-nar-green border border-nar-green/30' : 'bg-surface-700 text-slate-500'
          }`}
        >
          AUTO {autoRecord ? 'ON' : 'OFF'}
        </button>
      </div>

      {session ? (
        <div className="flex flex-col gap-1 p-2 rounded bg-surface-800 border border-nar-red/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-nar-red animate-pulse shrink-0" />
            <span className="text-xs font-bold text-white truncate">{session.showName}</span>
            {session.autoStarted && <span className="text-xs text-slate-500 shrink-0">auto</span>}
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
