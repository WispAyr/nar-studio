import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react'
import { TitleLayer } from './TitleLayer'
import type { CgAsset, CgLayer, TitleTemplate } from './types'

const studio = (window as any).studio

const DEFAULT_BLEND: GlobalCompositeOperation = 'source-over'

/** Exit-animation length — kept in step with the compositor's LAYER_OUT_MS. */
const LAYER_EXIT_MS = 380

export const TITLE_TEMPLATES: { template: TitleTemplate; label: string }[] = [
  { template: 'show-lower-third', label: 'Show Lower-Third' },
  { template: 'up-next', label: 'Up Next' },
  { template: 'now-playing', label: 'Now Playing' },
  { template: 'captions', label: 'Captions' },
  { template: 'clock', label: 'Clock' },
]

interface NowPlaying { track: string; artist: string }

/** True when this Chromium build exposes the Web Speech Recognition API. */
const SPEECH_AVAILABLE = typeof window !== 'undefined' &&
  (!!(window as any).SpeechRecognition || !!(window as any).webkitSpeechRecognition)

type CgElement = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement

interface CGContextValue {
  assets: Record<string, CgAsset[]>
  layers: CgLayer[]
  elements: MutableRefObject<Map<string, CgElement>>
  toggleLayer: (asset: CgAsset) => void
  toggleTitle: (template: TitleTemplate) => void
  removeLayer: (id: string) => void
  setOpacity: (id: string, opacity: number) => void
  setBlend: (id: string, blend: GlobalCompositeOperation) => void
  raiseLayer: (id: string) => void
  openFolder: (category?: string) => void
  nowPlaying: NowPlaying
  setNowPlaying: (track: string, artist: string) => void
  /** Optional HTTP endpoint polled for live track metadata. Empty = manual. */
  nowPlayingUrl: string
  setNowPlayingUrl: (url: string) => void
  captionText: string
  captionsOn: boolean
  setCaptionsOn: (on: boolean) => void
  captionsSupported: boolean
}

const Ctx = createContext<CGContextValue | null>(null)

let layerSeq = 0

export function CGProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Record<string, CgAsset[]>>({})
  const [layers, setLayers] = useState<CgLayer[]>([])
  const [nowPlaying, setNowPlayingState] = useState<NowPlaying>(() => {
    try {
      const raw = localStorage.getItem('nar-now-playing')
      if (raw) {
        const o = JSON.parse(raw)
        if (typeof o?.track === 'string' && typeof o?.artist === 'string') return o
      }
    } catch { /* ignore */ }
    return { track: '', artist: '' }
  })
  const setNowPlaying = useCallback((track: string, artist: string) => {
    const next = { track, artist }
    setNowPlayingState(next)
    try { localStorage.setItem('nar-now-playing', JSON.stringify(next)) } catch { /* ignore */ }
  }, [])

  // Optional auto-poller — operator can point at the station's now-playing
  // endpoint (Icecast status-json, custom JSON, or plain "Artist - Track" text).
  // Errors are silent; manual entry keeps working.
  const [nowPlayingUrl, setNowPlayingUrlState] = useState(() => localStorage.getItem('nar-now-playing-url') || '')
  const setNowPlayingUrl = useCallback((url: string) => {
    setNowPlayingUrlState(url)
    try { localStorage.setItem('nar-now-playing-url', url) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    if (!nowPlayingUrl) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const poll = async () => {
      try {
        const res = await fetch(nowPlayingUrl, { cache: 'no-store' })
        if (cancelled || !res.ok) return
        const ct = res.headers.get('content-type') || ''
        let track = '', artist = ''
        if (ct.includes('json')) {
          const data: any = await res.json()
          if (cancelled) return
          track = data.track || data.title || data.song || data.now_playing?.title || ''
          artist = data.artist || data.artist_name || data.now_playing?.artist || ''
          // Icecast fallback — title field as "Artist - Track"
          if (!track && data.icestats?.source) {
            const src = Array.isArray(data.icestats.source) ? data.icestats.source[0] : data.icestats.source
            const t = src.title || src.yp_currently_playing || ''
            if (t.includes(' - ')) {
              const parts = t.split(' - ')
              artist = parts[0].trim()
              track = parts.slice(1).join(' - ').trim()
            } else if (t) {
              track = t
            }
          }
        } else {
          const t = (await res.text()).trim()
          if (cancelled) return
          if (t.includes(' - ')) {
            const parts = t.split(' - ')
            artist = parts[0].trim()
            track = parts.slice(1).join(' - ').trim()
          } else {
            track = t
          }
        }
        if (!cancelled && (track || artist)) {
          const next = { track, artist }
          setNowPlayingState(next)
          try { localStorage.setItem('nar-now-playing', JSON.stringify(next)) } catch { /* ignore */ }
        }
      } catch { /* network error — try again next tick */ }
      finally {
        if (!cancelled) timer = setTimeout(poll, 10000)
      }
    }
    poll()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [nowPlayingUrl])

  // Live captions via Web Speech Recognition (Chromium-only).
  const [captionsOn, setCaptionsOn] = useState(false)
  const [captionText, setCaptionText] = useState('')
  useEffect(() => {
    if (!captionsOn || !SPEECH_AVAILABLE) return
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-GB'
    let stoppedByUs = false
    rec.onresult = (e: any) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) final += r[0].transcript
        else interim += r[0].transcript
      }
      const next = (final || interim).trim()
      if (next) setCaptionText(next)
    }
    rec.onerror = (e: any) => console.warn('[captions]', e.error)
    // SpeechRecognition stops itself after a long silence — auto-restart.
    rec.onend = () => {
      if (!stoppedByUs) {
        try { rec.start() } catch { /* might be too soon — leave to next mount */ }
      }
    }
    try { rec.start() } catch (e) { console.warn('[captions] start failed:', e) }
    return () => {
      stoppedByUs = true
      try { rec.stop() } catch { /* ignore */ }
    }
  }, [captionsOn])
  const layersRef = useRef<CgLayer[]>([])
  layersRef.current = layers
  const elements = useRef<Map<string, CgElement>>(new Map())

  const refresh = useCallback(() => {
    studio?.cgList?.().then((a: Record<string, CgAsset[]>) => { if (a) setAssets(a) })
  }, [])

  useEffect(() => {
    refresh()
    const unsub = studio?.onCgChanged?.(refresh)
    return () => unsub?.()
  }, [refresh])

  // Start a layer's exit animation, then prune it once the animation is done.
  // Re-toggling during the exit cancels removal, so the timeout re-checks state.
  const beginRemove = useCallback((id: string) => {
    setLayers(prev => prev.map(l => (l.id === id && l.removingAt == null ? { ...l, removingAt: performance.now() } : l)))
    window.setTimeout(() => {
      setLayers(prev => {
        const done = prev.some(l =>
          l.id === id && l.removingAt != null && performance.now() - l.removingAt >= LAYER_EXIT_MS)
        if (!done) return prev
        elements.current.delete(id)
        return prev.filter(l => l.id !== id)
      })
    }, LAYER_EXIT_MS + 90)
  }, [])

  const toggleLayer = useCallback((asset: CgAsset) => {
    const existing = layersRef.current.find(
      l => l.kind !== 'title' && l.category === asset.category && l.name === asset.name)
    if (existing) {
      if (existing.removingAt != null) {
        // Mid-exit — bring it back rather than removing.
        setLayers(prev => prev.map(l => (l.id === existing.id ? { ...l, removingAt: null, addedAt: performance.now() } : l)))
      } else {
        beginRemove(existing.id)
      }
      return
    }
    setLayers(prev => [...prev, {
      id: `layer-${++layerSeq}`,
      kind: asset.kind,
      name: asset.name,
      category: asset.category,
      url: asset.url,
      opacity: 1,
      blend: DEFAULT_BLEND,
      addedAt: performance.now(),
      removingAt: null,
    }])
  }, [beginRemove])

  const toggleTitle = useCallback((template: TitleTemplate) => {
    const existing = layersRef.current.find(l => l.kind === 'title' && l.template === template)
    if (existing) {
      if (existing.removingAt != null) {
        setLayers(prev => prev.map(l => (l.id === existing.id ? { ...l, removingAt: null, addedAt: performance.now() } : l)))
      } else {
        beginRemove(existing.id)
      }
      return
    }
    const label = TITLE_TEMPLATES.find(t => t.template === template)?.label ?? template
    setLayers(prev => [...prev, {
      id: `layer-${++layerSeq}`,
      kind: 'title',
      template,
      name: label,
      category: 'titles',
      url: '',
      opacity: 1,
      blend: DEFAULT_BLEND,
      addedAt: performance.now(),
      removingAt: null,
    }])
  }, [beginRemove])

  const removeLayer = useCallback((id: string) => {
    beginRemove(id)
  }, [beginRemove])

  const setOpacity = useCallback((id: string, opacity: number) => {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, opacity } : l)))
  }, [])

  const setBlend = useCallback((id: string, blend: GlobalCompositeOperation) => {
    setLayers(prev => prev.map(l => (l.id === id ? { ...l, blend } : l)))
  }, [])

  const raiseLayer = useCallback((id: string) => {
    setLayers(prev => {
      const i = prev.findIndex(l => l.id === id)
      if (i < 0 || i === prev.length - 1) return prev
      const next = prev.slice()
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      return next
    })
  }, [])

  const openFolder = useCallback((category?: string) => studio?.cgOpenFolder?.(category), [])

  return (
    <Ctx.Provider value={{
      assets, layers, elements, toggleLayer, toggleTitle, removeLayer, setOpacity, setBlend, raiseLayer, openFolder,
      nowPlaying, setNowPlaying, nowPlayingUrl, setNowPlayingUrl,
      captionText, captionsOn, setCaptionsOn, captionsSupported: SPEECH_AVAILABLE,
    }}>
      {/* Off-screen layer elements — decoded/rendered here, drawn onto the program canvas. */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden>
        {layers.map(layer => {
          if (layer.kind === 'title') {
            return <TitleLayer key={layer.id} layer={layer} elements={elements} nowPlaying={nowPlaying} captionText={captionText} />
          }
          if (layer.kind === 'video') {
            return (
              <video
                key={layer.id}
                ref={el => { if (el) elements.current.set(layer.id, el) }}
                src={layer.url}
                autoPlay loop muted playsInline
                width={160} height={90}
              />
            )
          }
          return (
            <img
              key={layer.id}
              ref={el => { if (el) elements.current.set(layer.id, el) }}
              src={layer.url}
              alt=""
            />
          )
        })}
      </div>
      {children}
    </Ctx.Provider>
  )
}

export function useCG() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCG must be used within CGProvider')
  return ctx
}
