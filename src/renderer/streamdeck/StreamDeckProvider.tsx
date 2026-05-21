import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react'
import {
  requestStreamDecks, getStreamDecks,
  type StreamDeckWeb, type StreamDeckButtonControlDefinition,
} from '@elgato-stream-deck/webhid'
import { useEngine } from '../engine/EngineProvider'
import { useDirector } from '../ai/DirectorProvider'
import { getAction, type DeckAction } from './actions'

const studio = (window as any).studio

const STORAGE_KEY = 'nar-streamdeck-bindings'
const KEY_SLOTS = 32  // covers the largest Stream Deck (XL)

export type DeckStatus = 'disconnected' | 'connecting' | 'connected'

export interface DeckInfo {
  model: string
  keys: number
  columns: number
}

interface StreamDeckContextValue {
  status: DeckStatus
  deck: DeckInfo | null
  /** Action id bound to each key index, or null. */
  bindings: (string | null)[]
  setBinding: (key: number, actionId: string | null) => void
  connect: () => void
  disconnect: () => void
  error: string | null
}

const Ctx = createContext<StreamDeckContextValue | null>(null)

function loadBindings(): (string | null)[] {
  const base: (string | null)[] = new Array(KEY_SLOTS).fill(null)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) {
        for (let i = 0; i < KEY_SLOTS; i++) if (typeof arr[i] === 'string') base[i] = arr[i]
      }
    }
  } catch { /* corrupt store — fall back to empty */ }
  return base
}

/** Render a deck key image — the action's colour and label. */
function renderKey(action: DeckAction, w: number, h: number): ImageData {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const c = cv.getContext('2d')!
  c.fillStyle = action.color
  c.fillRect(0, 0, w, h)
  c.fillStyle = '#ffffff'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  const lines = action.label.split('\n')
  const fs = Math.round(h * (lines.length > 1 ? 0.2 : 0.27))
  c.font = `700 ${fs}px sans-serif`
  lines.forEach((ln, i) => {
    c.fillText(ln, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.18)
  })
  return c.getImageData(0, 0, w, h)
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Stream Deck control over WebHID. The renderer talks to the deck directly —
 * key presses run actions against the live engine / director, and each key's
 * LCD is painted from the operator's bindings.
 */
export function StreamDeckProvider({ children }: { children: ReactNode }) {
  const engine = useEngine()
  const engineRef = useRef(engine)
  engineRef.current = engine
  const director = useDirector()
  const directorRef = useRef(director)
  directorRef.current = director

  const [bindings, setBindings] = useState<(string | null)[]>(() => loadBindings())
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings
  const [status, setStatus] = useState<DeckStatus>('disconnected')
  const [deck, setDeck] = useState<DeckInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const deckRef = useRef<StreamDeckWeb | null>(null)

  // Executor — runs an action id against the live engine / director.
  const runRef = useRef<(id: string) => void>(() => {})
  runRef.current = async (id: string) => {
    const e = engineRef.current
    const d = directorRef.current
    switch (id) {
      case 'cam0': case 'cam1': case 'cam2': case 'cam3': e.cut(id); break
      case 'viz': e.cut('viz'); break
      case 'record':
        if (e.recording) e.stopRecording()
        else e.startRecording(null).catch(() => {})
        break
      case 'stream':
        // Toggle the stream — using the active RTMP profile to go live.
        if (e.streaming) {
          if (e.engineId === 'builtin') e.stopStream()
          else studio?.stopStream?.()
        } else if (e.engineId === 'builtin') {
          const profile = await studio?.getActiveStreamProfile?.()
          if (profile?.rtmpUrl) e.startStream(profile.rtmpUrl, profile.streamKey).catch(() => {})
        } else {
          studio?.startStream?.()
        }
        break
      case 'layout-solo': e.setLayout('solo'); break
      case 'layout-split': e.setLayout('split'); break
      case 'layout-pip': e.setLayout('pip'); break
      case 'director': d.setEnabled(!d.enabled); break
      case 'autovj': e.setAutoVj(!e.autoVj); break
      case 'beatfx': e.setBeatFx(!e.beatFx); break
    }
  }

  const setBinding = useCallback((key: number, actionId: string | null) => {
    setBindings(prev => {
      const next = prev.slice()
      next[key] = actionId
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  /** Paint every key of the connected deck from the current bindings. */
  const renderDeck = useCallback(async () => {
    const d = deckRef.current
    if (!d) return
    const buttons = d.CONTROLS.filter(
      (c): c is StreamDeckButtonControlDefinition => c.type === 'button',
    )
    for (const btn of buttons) {
      const action = getAction(bindingsRef.current[btn.index])
      try {
        if (!action) {
          await d.clearKey(btn.index)
        } else if (btn.feedbackType === 'lcd') {
          const img = renderKey(action, btn.pixelSize.width, btn.pixelSize.height)
          await d.fillKeyBuffer(btn.index, img.data, { format: 'rgba' })
        } else if (btn.feedbackType === 'rgb') {
          const [r, g, b] = hexRgb(action.color)
          await d.fillKeyColor(btn.index, r, g, b)
        }
      } catch { /* one key failed — keep painting the rest */ }
    }
  }, [])

  const attach = useCallback((d: StreamDeckWeb) => {
    deckRef.current = d
    d.on('down', control => {
      if (control.type !== 'button') return
      const id = bindingsRef.current[control.index]
      if (id) runRef.current(id)
    })
    d.on('error', () => { /* swallow transient HID errors */ })
    const buttons = d.CONTROLS.filter(c => c.type === 'button')
    const columns = buttons.length ? Math.max(...buttons.map(b => b.column)) + 1 : 5
    setDeck({ model: d.PRODUCT_NAME, keys: buttons.length, columns })
    setStatus('connected')
    setError(null)
    renderDeck()
  }, [renderDeck])

  const connect = useCallback(async () => {
    setStatus('connecting')
    setError(null)
    try {
      const decks = await requestStreamDecks()
      if (decks.length === 0) {
        setStatus('disconnected')
        setError('No Stream Deck selected.')
        return
      }
      attach(decks[0])
    } catch (e) {
      setStatus('disconnected')
      setError((e as Error).message || 'Could not open the Stream Deck.')
    }
  }, [attach])

  const disconnect = useCallback(() => {
    deckRef.current?.close().catch(() => {})
    deckRef.current = null
    setDeck(null)
    setStatus('disconnected')
  }, [])

  // Silent reconnect — the browser remembers a previously-granted deck.
  useEffect(() => {
    getStreamDecks()
      .then(decks => { if (decks.length > 0) attach(decks[0]) })
      .catch(() => { /* WebHID unavailable or nothing granted yet */ })
  }, [attach])

  // Repaint the deck whenever the bindings change.
  useEffect(() => { renderDeck() }, [bindings, renderDeck])

  return (
    <Ctx.Provider value={{ status, deck, bindings, setBinding, connect, disconnect, error }}>
      {children}
    </Ctx.Provider>
  )
}

export function useStreamDeck() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStreamDeck must be used within StreamDeckProvider')
  return ctx
}
