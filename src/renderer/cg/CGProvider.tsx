import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type MutableRefObject } from 'react'
import { TitleLayer } from './TitleLayer'
import type { CgAsset, CgLayer, TitleTemplate } from './types'

const studio = (window as any).studio

const DEFAULT_BLEND: GlobalCompositeOperation = 'source-over'

/** Exit-animation length — kept in step with the compositor's LAYER_OUT_MS. */
const LAYER_EXIT_MS = 380

export const TITLE_TEMPLATES: { template: TitleTemplate; label: string; group?: 'overlay' | 'takeover' }[] = [
  // Overlays — sit on top of the live picture, don't replace it.
  { template: 'show-lower-third', label: 'Show Lower-Third', group: 'overlay' },
  { template: 'up-next', label: 'Up Next', group: 'overlay' },
  { template: 'now-playing', label: 'Now Playing', group: 'overlay' },
  { template: 'captions', label: 'Captions', group: 'overlay' },
  { template: 'clock', label: 'Clock', group: 'overlay' },
  // Full-screen brand takeover cards — fire one of these and it replaces
  // the program output entirely until removed. Designed for breaks,
  // pre-show holds, show opens, recovery from technical issues.
  { template: 'be-right-back', label: 'Be Right Back', group: 'takeover' },
  { template: 'stand-by', label: 'Stand By', group: 'takeover' },
  { template: 'coming-up', label: 'Coming Up', group: 'takeover' },
  { template: 'technical-difficulty', label: 'Technical Difficulty', group: 'takeover' },
  { template: 'now-on-air', label: 'Now On Air', group: 'takeover' },
  { template: 'music-sweeper', label: 'Music Sweeper', group: 'takeover' },
  { template: 'sponsor', label: 'Sponsor', group: 'takeover' },
  { template: 'news-banner', label: 'News', group: 'takeover' },
  { template: 'travel-banner', label: 'Travel', group: 'takeover' },
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
  /** Sponsor name shown on the Sponsor takeover card. */
  sponsorName: string
  /** Optional sponsor strapline shown below the name. */
  sponsorTagline: string
  setSponsor: (name: string, tagline?: string) => void

  /** Headline rendered on the News takeover card. */
  newsHeadline: string
  /** Source attribution on the News card (e.g. "BBC News"). */
  newsSource: string
  /** Looping ticker text on the News card. Empty = no ticker. */
  newsTicker: string
  /** When true the News card uses the BREAKING NEWS treatment. */
  newsBreaking: boolean
  setNews: (patch: Partial<{ headline: string; source: string; ticker: string; breaking: boolean }>) => void

  /** Route reference (A77 / M77) on the Travel card. */
  travelRoute: string
  /** Status text on the Travel card. */
  travelStatus: string
  /** Severity tier on the Travel card. */
  travelSeverity: 'info' | 'warning' | 'alert'
  setTravel: (patch: Partial<{ route: string; status: string; severity: 'info' | 'warning' | 'alert' }>) => void
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

  // Sponsor name + tagline, persisted between launches so a Friday-night
  // operator doesn't have to retype the night's sponsor.
  const [sponsorName, setSponsorNameState] = useState(() => localStorage.getItem('nar-sponsor-name') || '')
  const [sponsorTagline, setSponsorTaglineState] = useState(() => localStorage.getItem('nar-sponsor-tagline') || '')
  const setSponsor = useCallback((name: string, tagline?: string) => {
    setSponsorNameState(name)
    try { localStorage.setItem('nar-sponsor-name', name) } catch { /* ignore */ }
    if (typeof tagline === 'string') {
      setSponsorTaglineState(tagline)
      try { localStorage.setItem('nar-sponsor-tagline', tagline) } catch { /* ignore */ }
    }
  }, [])

  // News + Travel takeover state, persisted so operator's last headline /
  // route survives a relaunch. Bound to the news-banner / travel-banner
  // takeover cards; also wired into the Myriad bridge so a `news-start`
  // packet that carries a name uses that as the headline.
  const [newsHeadline, setNewsHeadlineState] = useState(() => localStorage.getItem('nar-news-headline') || '')
  const [newsSource, setNewsSourceState] = useState(() => localStorage.getItem('nar-news-source') || '')
  const [newsTicker, setNewsTickerState] = useState(() => localStorage.getItem('nar-news-ticker') || '')
  const [newsBreaking, setNewsBreakingState] = useState(() => localStorage.getItem('nar-news-breaking') === '1')
  const setNews = useCallback((patch: Partial<{ headline: string; source: string; ticker: string; breaking: boolean }>) => {
    if (typeof patch.headline === 'string') { setNewsHeadlineState(patch.headline); try { localStorage.setItem('nar-news-headline', patch.headline) } catch {} }
    if (typeof patch.source === 'string') { setNewsSourceState(patch.source); try { localStorage.setItem('nar-news-source', patch.source) } catch {} }
    if (typeof patch.ticker === 'string') { setNewsTickerState(patch.ticker); try { localStorage.setItem('nar-news-ticker', patch.ticker) } catch {} }
    if (typeof patch.breaking === 'boolean') { setNewsBreakingState(patch.breaking); try { localStorage.setItem('nar-news-breaking', patch.breaking ? '1' : '0') } catch {} }
  }, [])

  const [travelRoute, setTravelRouteState] = useState(() => localStorage.getItem('nar-travel-route') || 'A77')
  const [travelStatus, setTravelStatusState] = useState(() => localStorage.getItem('nar-travel-status') || '')
  const [travelSeverity, setTravelSeverityState] = useState<'info' | 'warning' | 'alert'>(() => {
    const v = localStorage.getItem('nar-travel-severity')
    return v === 'warning' || v === 'alert' ? v : 'info'
  })
  const setTravel = useCallback((patch: Partial<{ route: string; status: string; severity: 'info' | 'warning' | 'alert' }>) => {
    if (typeof patch.route === 'string') { setTravelRouteState(patch.route); try { localStorage.setItem('nar-travel-route', patch.route) } catch {} }
    if (typeof patch.status === 'string') { setTravelStatusState(patch.status); try { localStorage.setItem('nar-travel-status', patch.status) } catch {} }
    if (patch.severity) { setTravelSeverityState(patch.severity); try { localStorage.setItem('nar-travel-severity', patch.severity) } catch {} }
  }, [])

  // Live captions via Web Speech Recognition (Chromium-only). Persists so the
  // operator doesn't have to re-enable after every restart.
  const [captionsOn, setCaptionsOnState] = useState(() => localStorage.getItem('nar-captions-on') === 'on')
  const setCaptionsOn = useCallback((on: boolean) => {
    localStorage.setItem('nar-captions-on', on ? 'on' : 'off')
    setCaptionsOnState(on)
  }, [])
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
      sponsorName, sponsorTagline, setSponsor,
      newsHeadline, newsSource, newsTicker, newsBreaking, setNews,
      travelRoute, travelStatus, travelSeverity, setTravel,
    }}>
      {/* Off-screen layer elements — decoded/rendered here, drawn onto the program canvas. */}
      <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden>
        {layers.map(layer => {
          if (layer.kind === 'title') {
            return <TitleLayer key={layer.id} layer={layer} elements={elements} nowPlaying={nowPlaying} captionText={captionText} sponsorName={sponsorName} sponsorTagline={sponsorTagline} newsHeadline={newsHeadline} newsSource={newsSource} newsTicker={newsTicker} newsBreaking={newsBreaking} travelRoute={travelRoute} travelStatus={travelStatus} travelSeverity={travelSeverity} />
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
