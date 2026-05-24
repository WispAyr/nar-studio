import { useState, useEffect } from 'react'
import { useEngine } from '../../engine/EngineProvider'
import { useViz } from '../../viz/VizProvider'

const studio = (window as any).studio

interface StreamProfile {
  id: string
  name: string
  rtmpUrl: string
  streamKey: string
  platform: 'youtube' | 'twitch' | 'custom'
}

const PLATFORM_LABELS = { youtube: 'YT', twitch: 'TW', custom: '⚡' }

/** Secondary RTMP destinations the built-in streamer simulcasts to via FFmpeg's
 *  tee muxer. Each URL must include its own stream key. */
function SimulcastSection() {
  const [urls, setUrls] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('nar-stream-simulcast')
      if (raw) {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr)) {
          const out = arr.filter((s: unknown) => typeof s === 'string') as string[]
          while (out.length < 3) out.push('')
          return out.slice(0, 3)
        }
      }
    } catch { /* ignore */ }
    return ['', '', '']
  })
  const update = (i: number, v: string) => {
    const next = [...urls]
    next[i] = v
    setUrls(next)
    try {
      localStorage.setItem('nar-stream-simulcast', JSON.stringify(next.filter(s => s.trim())))
    } catch { /* ignore */ }
  }
  const activeCount = urls.filter(s => s.trim()).length
  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Simulcast · extra RTMPs</span>
        {activeCount > 0 && (
          <span className="text-[10px] font-bold text-nar-amber">+{activeCount}</span>
        )}
      </div>
      {urls.map((u, i) => (
        <input
          key={i}
          type="text"
          placeholder={`Optional RTMP URL ${i + 1} (e.g. rtmp://live.twitch.tv/app/KEY)`}
          value={u}
          onChange={e => update(i, e.target.value)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[10px] text-slate-200 font-mono outline-none focus:border-nar-blue/60"
        />
      ))}
      <span className="text-[10px] text-slate-600 leading-snug">
        FFmpeg tees the encode to all destinations; <span className="font-mono">onfail=ignore</span> means one platform dropping won't kill the others. Each URL must include its stream key.
      </span>
    </div>
  )
}

const pad = (n: number) => String(n).padStart(2, '0')
const PREROLL_PRESETS = [30, 60, 90, 120]
const durLabel = (s: number) => (s % 60 === 0 ? `${s / 60}m` : `${s}s`)

export function StreamPanel() {
  const {
    engineId, streamStatus, streamTimecode, streamStartedAt, startStream, stopStream,
    prerollEnabled, setPrerollEnabled, prerollSeconds, setPrerollSeconds, prerollEndsAt, skipPreroll,
  } = useEngine()
  const [profiles, setProfiles] = useState<StreamProfile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<StreamProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState('')
  const [prerollLeft, setPrerollLeft] = useState('')

  useEffect(() => {
    const load = async () => {
      const [profs, active] = await Promise.all([
        studio?.getStreamProfiles?.(),
        studio?.getActiveStreamProfile?.(),
      ])
      if (profs) setProfiles(profs)
      if (active) setActiveId(active.id)
    }
    load()
  }, [])

  // Built-in stream elapsed timer
  useEffect(() => {
    if (!streamStartedAt) { setElapsed(''); return }
    const tick = () => {
      const ms = Date.now() - streamStartedAt
      const h = Math.floor(ms / 3_600_000)
      const m = Math.floor((ms % 3_600_000) / 60_000)
      const s = Math.floor((ms % 60_000) / 1000)
      setElapsed(`${pad(h)}:${pad(m)}:${pad(s)}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [streamStartedAt])

  // Pre-roll countdown
  useEffect(() => {
    if (!prerollEndsAt) { setPrerollLeft(''); return }
    const tick = () => {
      const ms = Math.max(0, prerollEndsAt - Date.now())
      setPrerollLeft(`${Math.floor(ms / 60000)}:${pad(Math.floor((ms % 60000) / 1000))}`)
    }
    tick()
    const t = setInterval(tick, 250)
    return () => clearInterval(t)
  }, [prerollEndsAt])

  const goLive = async () => {
    setError(null)
    const profile = profiles.find(p => p.id === activeId)
    if (engineId === 'builtin') {
      if (!profile) { setError('Select a stream profile'); return }
      try {
        await startStream(profile.rtmpUrl, profile.streamKey)
      } catch (e) {
        setError((e as Error).message)
      }
    } else {
      studio?.startStream?.(activeId ?? undefined)
    }
  }

  const endStream = () => {
    if (engineId === 'builtin') stopStream()
    else studio?.stopStream?.()
  }

  const saveProfile = async (p: StreamProfile) => {
    await studio?.saveStreamProfile?.(p)
    setProfiles(prev => [...prev.filter(x => x.id !== p.id), p])
    setEditing(null)
  }

  const newProfile = () => setEditing({
    id: crypto.randomUUID(),
    name: 'New Stream',
    rtmpUrl: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: '',
    platform: 'youtube',
  })

  const timecode = engineId === 'builtin' ? elapsed : (streamTimecode ?? '')

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">
          Stream — {engineId === 'builtin' ? 'Built-in' : 'OBS'}
        </span>
        <button onClick={newProfile} className="text-xs text-slate-500 hover:text-slate-300">+ Add</button>
      </div>

      {/* Go Live / live status */}
      {streamStatus === 'idle' ? (
        <button
          onClick={goLive}
          disabled={!activeId}
          className="text-xs bg-nar-red hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white py-1.5 rounded font-bold uppercase tracking-wider transition-colors"
        >
          ▶ Go Live
        </button>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full animate-pulse ${
              streamStatus === 'live' ? 'bg-nar-red' : 'bg-nar-amber'
            }`} />
            <span className={`text-xs font-bold ${
              streamStatus === 'reconnecting' ? 'text-nar-amber' : 'text-nar-red'
            }`}>
              {streamStatus === 'live' ? 'LIVE'
                : streamStatus === 'reconnecting' ? 'RECONNECTING…'
                : 'STREAM LOST'}
            </span>
            {streamStatus === 'live' && (
              <span className="text-xs font-mono text-slate-400 tabular-nums">{timecode}</span>
            )}
          </div>
          {streamStatus === 'reconnecting' && (
            <span className="text-xs text-slate-500">RTMP dropped — restoring the stream…</span>
          )}
          {streamStatus === 'lost' && (
            <span className="text-xs text-nar-red">Can’t reach the stream — still retrying. Check the connection.</span>
          )}
          {prerollEndsAt != null && (
            <div className="flex items-center gap-2 rounded bg-nar-blue/15 border border-nar-blue/40 px-2 py-1.5">
              <span className="text-xs font-bold text-nar-blue shrink-0">▶ PRE-ROLL</span>
              <span className="text-xs font-mono text-slate-300 tabular-nums">{prerollLeft}</span>
              <button
                onClick={skipPreroll}
                className="ml-auto text-xs px-2 py-0.5 rounded bg-surface-700 hover:bg-nar-blue hover:text-white text-slate-300 font-bold uppercase tracking-wider transition-colors"
              >
                Skip to live
              </button>
            </div>
          )}
          <button
            onClick={endStream}
            className="text-xs bg-surface-700 hover:bg-nar-red hover:text-white text-slate-400 py-1.5 rounded font-bold uppercase tracking-wider transition-colors"
          >
            End Stream
          </button>
        </div>
      )}
      {error && <span className="text-xs text-nar-red">{error}</span>}

      {/* Pre-roll — optional visualiser intro before the stream shows cameras */}
      {streamStatus === 'idle' && engineId === 'builtin' && (
        <div className="flex flex-col gap-1.5 rounded bg-surface-800 border border-surface-700 p-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Pre-roll visualiser</span>
            <button
              onClick={() => setPrerollEnabled(!prerollEnabled)}
              className={`text-xs px-2 py-0.5 rounded font-bold transition-colors ${
                prerollEnabled
                  ? 'bg-nar-blue/20 text-nar-blue border border-nar-blue/40'
                  : 'bg-surface-700 text-slate-500'
              }`}
            >
              {prerollEnabled ? 'ON' : 'OFF'}
            </button>
          </div>
          {prerollEnabled && (
            <>
              <div className="flex gap-1">
                {PREROLL_PRESETS.map(s => (
                  <button
                    key={s}
                    onClick={() => setPrerollSeconds(s)}
                    className={`flex-1 text-xs py-1 rounded transition-colors ${
                      prerollSeconds === s
                        ? 'bg-nar-blue text-white'
                        : 'bg-surface-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {durLabel(s)}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-600 leading-snug">
                When you go live the music visualiser plays for {durLabel(prerollSeconds)}, then the
                program cuts to the cameras. Cut manually or hit Skip to end it early.
              </span>
            </>
          )}
        </div>
      )}

      {/* Quality preset selector — drives FFmpeg encoder + bitrate */}
      {engineId === 'builtin' && <QualitySection />}

      {/* Live stream-health readout (encoder fps, bitrate, speed, drops) */}
      {engineId === 'builtin' && streamStatus !== 'idle' && <StreamHealthRow />}

      {/* Pre-flight readiness checks before going live */}
      {engineId === 'builtin' && streamStatus === 'idle' && <PreflightSection />}

      {/* Simulcast destinations — built-in engine only, FFmpeg tee */}
      {engineId === 'builtin' && <SimulcastSection />}

      {/* Profile list */}
      <div className="flex flex-col gap-1">
        {profiles.map(p => (
          <div
            key={p.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
              activeId === p.id ? 'bg-surface-700 text-white' : 'bg-surface-800 text-slate-500 hover:text-slate-300'
            }`}
            onClick={() => setActiveId(p.id)}
          >
            <span className="text-xs font-bold w-5 shrink-0 text-center">{PLATFORM_LABELS[p.platform]}</span>
            <span className="text-xs flex-1 truncate">{p.name}</span>
            {!p.streamKey && <span className="text-xs text-nar-amber">No key</span>}
            <button
              onClick={e => { e.stopPropagation(); setEditing(p) }}
              className="text-xs text-slate-600 hover:text-slate-300 transition-colors"
            >
              ✎
            </button>
          </div>
        ))}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-800 border border-surface-600 rounded-lg p-4 w-80 flex flex-col gap-3">
            <span className="text-sm font-bold text-white">Stream Profile</span>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Name</span>
              <input
                className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white outline-none focus:border-nar-blue"
                value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Platform</span>
              <select
                className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white outline-none"
                value={editing.platform}
                onChange={e => {
                  const p = e.target.value as StreamProfile['platform']
                  const urls = {
                    youtube: 'rtmp://a.rtmp.youtube.com/live2',
                    twitch: 'rtmp://live.twitch.tv/live',
                    custom: editing.rtmpUrl,
                  }
                  setEditing({ ...editing, platform: p, rtmpUrl: urls[p] })
                }}
              >
                <option value="youtube">YouTube</option>
                <option value="twitch">Twitch</option>
                <option value="custom">Custom RTMP</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">RTMP URL</span>
              <input
                className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-nar-blue"
                value={editing.rtmpUrl}
                onChange={e => setEditing({ ...editing, rtmpUrl: e.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-slate-500">Stream Key</span>
              <input
                type="password"
                className="bg-surface-700 border border-surface-600 rounded px-2 py-1 text-xs text-white font-mono outline-none focus:border-nar-blue"
                value={editing.streamKey}
                onChange={e => setEditing({ ...editing, streamKey: e.target.value })}
                placeholder="Paste stream key..."
              />
            </label>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(null)} className="text-xs px-3 py-1.5 rounded bg-surface-700 text-slate-400 hover:text-white">Cancel</button>
              <button onClick={() => saveProfile(editing)} className="text-xs px-3 py-1.5 rounded bg-nar-blue text-white font-bold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Quality preset chooser. The preset id is persisted to localStorage; the
 * built-in streamer reads it on every start + reconnect. Hardware (NVENC)
 * presets sit behind a small "Advanced" toggle because they require a
 * compatible NVIDIA GPU + driver and silently fail otherwise — we want the
 * common-case software presets to be the obvious choice.
 */
function QualitySection() {
  const [presets, setPresets] = useState<{ id: string; label: string; encoder: string; bitrateK: number }[]>([])
  const [selected, setSelected] = useState<string>(() => localStorage.getItem('nar-stream-quality') || 'standard')
  const [showAdvanced, setShowAdvanced] = useState(() => localStorage.getItem('nar-stream-advanced') === '1')

  useEffect(() => {
    studio?.builtinStreamPresets?.().then((p: any[]) => setPresets(p || [])).catch(() => setPresets([]))
  }, [])

  const apply = (id: string) => {
    localStorage.setItem('nar-stream-quality', id)
    setSelected(id)
  }

  const isAdv = (encoder: string) => encoder !== 'libx264'
  const visible = presets.filter(p => showAdvanced || !isAdv(p.encoder))
  const current = presets.find(p => p.id === selected)

  return (
    <div className="flex flex-col gap-1 mt-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Quality</span>
        <button
          onClick={() => {
            const next = !showAdvanced
            localStorage.setItem('nar-stream-advanced', next ? '1' : '0')
            setShowAdvanced(next)
          }}
          className="text-[10px] text-slate-600 hover:text-slate-300"
        >
          {showAdvanced ? 'Hide hardware' : 'Show hardware'}
        </button>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {visible.map(p => (
          <button
            key={p.id}
            onClick={() => apply(p.id)}
            className={`text-[10px] py-1 rounded font-bold uppercase tracking-wider transition-colors ${
              selected === p.id
                ? 'bg-nar-blue text-white'
                : 'bg-surface-800 text-slate-500 hover:text-slate-300'
            }`}
            title={`${p.encoder} · ${p.bitrateK} kbps`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {current && (
        <span className="text-[10px] text-slate-600 leading-snug">
          {current.encoder === 'h264_nvenc' ? 'GPU (NVENC)' : 'CPU (libx264)'} · {current.bitrateK} kbps · BT.709 colour
        </span>
      )}
    </div>
  )
}

/**
 * Live stream-health readout — sourced from FFmpeg's progress lines. Speed
 * is the most important number: anything under ~0.98× means the encoder is
 * losing ground to the source and YouTube will eventually drop us.
 */
function StreamHealthRow() {
  const { streamStats: stats } = useEngine()
  if (!stats) return null
  const speedOk = stats.speed >= 0.98
  const speedWarn = stats.speed >= 0.92 && !speedOk
  const speedColor = speedOk ? 'text-nar-green' : speedWarn ? 'text-nar-amber' : 'text-nar-red'
  const fpsOk = stats.fps >= 29.0
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums text-slate-500 mt-1 px-1">
      <span>
        <span className="text-slate-700 mr-1">fps</span>
        <span className={fpsOk ? 'text-slate-300' : 'text-nar-amber'}>{stats.fps.toFixed(0)}</span>
      </span>
      <span>
        <span className="text-slate-700 mr-1">kbps</span>
        <span className="text-slate-300">{stats.bitrateK.toFixed(0)}</span>
      </span>
      <span>
        <span className="text-slate-700 mr-1">speed</span>
        <span className={speedColor}>{stats.speed.toFixed(2)}×</span>
      </span>
      <span>
        <span className="text-slate-700 mr-1">q</span>
        <span className="text-slate-300">{stats.q.toFixed(0)}</span>
      </span>
      {stats.drops > 0 && (
        <span className="text-nar-red">drop {stats.drops}</span>
      )}
    </div>
  )
}

/**
 * Pre-flight checks before Go Live — surfaces problems early instead of
 * letting the operator find out during a five-second blank cut.
 */
function PreflightSection() {
  const { engineId } = useEngine()
  // The useViz hook is the canonical source of GPU FPS for the program canvas.
  const viz = useVizFps()
  const [audioOk, setAudioOk] = useState(false)
  const [hasKey, setHasKey] = useState(false)

  // Quick audio level probe — we read the broadcast bus analyser if available
  // via a lightweight DOM check; otherwise just confirm a device is picked.
  useEffect(() => {
    setHasKey(!!localStorage.getItem('nar-audio-device'))
    let raf = 0
    let cancelled = false
    let probeStream: MediaStream | null = null
    ;(async () => {
      try {
        const id = localStorage.getItem('nar-audio-device') || ''
        probeStream = await navigator.mediaDevices.getUserMedia({
          audio: id ? { deviceId: { exact: id } } : true,
          video: false,
        })
        if (cancelled) { probeStream?.getTracks().forEach(t => t.stop()); return }
        const ac = new AudioContext()
        const src = ac.createMediaStreamSource(probeStream)
        const an = ac.createAnalyser(); an.fftSize = 256
        src.connect(an)
        const buf = new Float32Array(256)
        let frames = 0
        const tick = () => {
          if (cancelled) return
          an.getFloatTimeDomainData(buf)
          let peak = 0
          for (const v of buf) { const a = Math.abs(v); if (a > peak) peak = a }
          if (peak > 0.001) setAudioOk(true)
          frames += 1
          if (frames < 30) raf = requestAnimationFrame(tick)
          else {
            try { ac.close() } catch {}
            probeStream?.getTracks().forEach(t => t.stop())
            probeStream = null
          }
        }
        raf = requestAnimationFrame(tick)
      } catch {
        setAudioOk(false)
      }
    })()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      probeStream?.getTracks().forEach(t => t.stop())
    }
  }, [])

  if (engineId !== 'builtin') return null
  const fpsOk = viz >= 28
  const fpsLabel = viz > 0 ? viz.toFixed(0) : '—'

  const Pill = ({ ok, label, value }: { ok: boolean; label: string; value: string }) => (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${ok ? 'bg-surface-800' : 'bg-surface-800/60'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-nar-green' : 'bg-nar-amber'}`} />
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-[10px] tabular-nums ${ok ? 'text-slate-300' : 'text-nar-amber'}`}>{value}</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-1 mt-1">
      <span className="text-xs text-slate-600 uppercase tracking-wider">Pre-flight</span>
      <div className="grid grid-cols-2 gap-1">
        <Pill ok={fpsOk} label="GPU" value={`${fpsLabel} fps`} />
        <Pill ok={audioOk} label="Audio" value={audioOk ? 'OK' : '—'} />
        <Pill ok={hasKey} label="Device" value={hasKey ? 'set' : 'default'} />
        <Pill ok={true} label="FFmpeg" value="bundled" />
      </div>
    </div>
  )
}

function useVizFps() {
  const { levelsRef } = useViz()
  const [fps, setFps] = useState(0)
  useEffect(() => {
    // Levels ref is updated by the render loop; poll at 2 Hz for the UI.
    const tick = () => setFps(levelsRef.current.fps || 0)
    tick()
    const id = window.setInterval(tick, 500)
    return () => window.clearInterval(id)
  }, [levelsRef])
  return fps
}
