import { useState, useEffect } from 'react'
import { useOBS } from '../../hooks/useOBS'

const studio = (window as any).studio

interface StreamProfile {
  id: string
  name: string
  rtmpUrl: string
  streamKey: string
  platform: 'youtube' | 'twitch' | 'custom'
}

const PLATFORM_LABELS = { youtube: 'YT', twitch: 'TW', custom: '⚡' }

export function StreamPanel() {
  const { streaming, streamTimecode } = useOBS()
  const [profiles, setProfiles] = useState<StreamProfile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<StreamProfile | null>(null)

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

  const startStream = () => studio?.startStream?.(activeId ?? undefined)
  const stopStream = () => studio?.stopStream?.()

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

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Stream</span>
        <button onClick={newProfile} className="text-xs text-slate-500 hover:text-slate-300">+ Add</button>
      </div>

      {/* Go Live button */}
      {streaming ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-nar-red animate-pulse" />
            <span className="text-xs font-bold text-nar-red">LIVE</span>
            <span className="text-xs font-mono text-slate-400 tabular-nums">{streamTimecode ?? ''}</span>
          </div>
          <button
            onClick={stopStream}
            className="text-xs bg-surface-700 hover:bg-nar-red hover:text-white text-slate-400 py-1.5 rounded font-bold uppercase tracking-wider transition-colors"
          >
            End Stream
          </button>
        </div>
      ) : (
        <button
          onClick={startStream}
          disabled={!activeId}
          className="text-xs bg-nar-red hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white py-1.5 rounded font-bold uppercase tracking-wider transition-colors"
        >
          ▶ Go Live
        </button>
      )}

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
