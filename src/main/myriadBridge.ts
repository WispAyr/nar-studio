/**
 * Myriad Playout UDP bridge — listens for MM_TRIGGER packets from Broadcast
 * Radio's Myriad Playout and re-emits them as typed `MyriadEvent`s.
 *
 * Myriad's MM_TRIGGER macro can send arbitrary UDP strings to a host:port
 * whenever an item plays. Operators configure the macro inside Myriad
 * (Configuration → Triggers / Macros) and point it at NAR Studio's listener.
 * We deliberately accept several payload shapes so operators don't have to
 * fight Myriad's macro language to produce a specific format:
 *
 *   1. JSON envelope    {"event":"advert-start","name":"…","duration":30}
 *   2. Pipe-delimited   EVENT|NAME|DURATION|EXTRA
 *   3. KEY=VALUE lines  TYPE=ADV\nNAME=AYR CARPETS\nDURATION=30
 *
 * The bridge is OFF by default — the operator opts in via the Settings UI.
 * Every parse is wrapped in try/catch so a malformed packet from a
 * misconfigured Myriad never crashes the studio.
 *
 * The actual `event → NAR action` binding (advert fires bumper, show-start
 * applies the matching NarShow, etc.) lives in the renderer and is wired up
 * in a follow-up commit. This module's job stops at "parsed event emitted".
 *
 * See docs/myriad-integration.md for the full protocol + configuration walk-
 * through, and src/main/osc.ts for the sibling outbound UDP bridge (same
 * electron-store + EventEmitter + getStatus pattern).
 */
import dgram from 'dgram'
import { EventEmitter } from 'events'
import Store from 'electron-store'

// Mirror of the renderer's MyriadEvent shape — duplicated here so main has no
// dependency on renderer source. Keep these in lockstep; the canonical
// definition lives in src/renderer/shows/types.ts.
export type MyriadEventKind =
  | 'show-start'
  | 'show-end'
  | 'advert-start'
  | 'advert-end'
  | 'news-start'
  | 'news-end'
  | 'item-start'
  | 'item-end'
  | 'cart-fire'

export interface MyriadEvent {
  event: MyriadEventKind
  name?: string
  duration?: number
  presenter?: string
  artist?: string
  myriadId?: string
  raw?: string
}

interface StoreSchema {
  enabled: boolean
  port: number
  bindHost: string
}

const store = new Store<StoreSchema>({
  name: 'myriad-bridge',
  defaults: {
    // Off by default — operator opts in once Myriad is configured to send.
    enabled: false,
    // 5000 is Myriad's typical MM_TRIGGER default target port; operators can
    // change it inside Myriad's macro config if 5000 conflicts on the host.
    port: 5000,
    // 0.0.0.0 — listen on every interface so Myriad on the same LAN can hit us
    // regardless of which NIC is "primary". Restrict to 127.0.0.1 if same-host.
    bindHost: '0.0.0.0',
  },
})

export interface MyriadStatus {
  enabled: boolean
  listening: boolean
  port: number
  bindHost: string
  messagesReceived: number
  eventsParsed: number
  parseErrors: number
  /** Wall-clock ms of the last successfully parsed event, or null. */
  lastEventAt: number | null
}

/** Map a raw Myriad item-type token (case-insensitive) to a MyriadEvent kind.
 *  Returns null for tokens we don't recognise (caller falls back to
 *  `item-start`). */
function mapTypeToken(token: string): MyriadEventKind | null {
  const t = token.trim().toUpperCase()
  if (!t) return null
  // Myriad's built-in item types — see Myriad Playout v6 documentation.
  // Some installs send a verb-form (start/end), others send just the type;
  // we tolerate both and lean on the operator's macro choice for end events.
  if (t === 'ADV' || t === 'ADVERT' || t === 'COMMERCIAL') return 'advert-start'
  if (t === 'ADV-END' || t === 'ADVERT-END') return 'advert-end'
  if (t === 'NEWS') return 'news-start'
  if (t === 'NEWS-END') return 'news-end'
  if (t === 'SHOW' || t === 'PROGRAM' || t === 'PROGRAMME') return 'show-start'
  if (t === 'SHOW-END' || t === 'PROGRAM-END') return 'show-end'
  if (t === 'CART' || t === 'JINGLE' || t === 'SWEEPER') return 'cart-fire'
  if (t === 'ITEM' || t === 'MUSIC' || t === 'SONG' || t === 'TRACK') return 'item-start'
  if (t === 'ITEM-END') return 'item-end'
  return null
}

/** Allow-list for MyriadEvent.event when parsing JSON envelopes — keeps
 *  garbage values from leaking into the typed event stream. */
const VALID_EVENTS: ReadonlySet<MyriadEventKind> = new Set<MyriadEventKind>([
  'show-start', 'show-end',
  'advert-start', 'advert-end',
  'news-start', 'news-end',
  'item-start', 'item-end',
  'cart-fire',
])

/** Coerce an arbitrary value to a finite number, or undefined. */
function toDuration(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  if (typeof v === 'string') {
    const n = Number(v.trim())
    if (Number.isFinite(n) && n >= 0) return n
  }
  return undefined
}

/** Coerce a value to a non-empty trimmed string, or undefined. */
function toStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.trim()
  return s ? s : undefined
}

/**
 * Parse one received UDP payload into a MyriadEvent, or null if we can't make
 * sense of it. NEVER throws — caller relies on this for crash-safety.
 *
 * Accepted shapes, tried in this order:
 *   1. JSON object with an `event` field
 *   2. Pipe-delimited "TYPE|NAME|DURATION|EXTRA"
 *   3. KEY=VALUE lines (newline-separated; tokens like TYPE/NAME/DURATION)
 */
export function parseMyriadPayload(payload: string): MyriadEvent | null {
  const text = payload.trim()
  if (!text) return null

  // ── 1. JSON envelope ──────────────────────────────────────────────────────
  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text) as Record<string, unknown>
      const evRaw = typeof obj.event === 'string' ? obj.event.trim() : ''
      if (evRaw && VALID_EVENTS.has(evRaw as MyriadEventKind)) {
        const ev: MyriadEvent = {
          event: evRaw as MyriadEventKind,
          name: toStr(obj.name),
          duration: toDuration(obj.duration),
          presenter: toStr(obj.presenter),
          artist: toStr(obj.artist),
          myriadId: toStr(obj.myriadId) ?? toStr(obj.id),
          raw: text,
        }
        return ev
      }
      return null
    } catch {
      // Looked like JSON but wasn't — fall through to the text parsers in case
      // someone sent `{not really json|but pipe delimited|30}`.
    }
  }

  // ── 2. Pipe-delimited "EVENT|NAME|DURATION|EXTRA" ─────────────────────────
  if (text.includes('|')) {
    const parts = text.split('|').map(p => p.trim())
    const typeTok = parts[0] ?? ''
    const kind = mapTypeToken(typeTok) ?? (typeTok ? 'item-start' : null)
    if (kind) {
      return {
        event: kind,
        name: toStr(parts[1]),
        duration: toDuration(parts[2]),
        // Heuristic — common Myriad macros put presenter in field 4 for SHOW,
        // artist in field 4 for music. Caller code can disambiguate by event.
        presenter: kind === 'show-start' ? toStr(parts[3]) : undefined,
        artist: kind === 'item-start' ? toStr(parts[3]) : undefined,
        raw: text,
      }
    }
  }

  // ── 3. KEY=VALUE lines ────────────────────────────────────────────────────
  if (text.includes('=')) {
    const kv: Record<string, string> = {}
    // Split on either newline or semicolon — Myriad macros sometimes flatten
    // newlines to ; when crossing into UDP. Robust against both.
    for (const line of text.split(/[\r\n;]+/)) {
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const k = line.slice(0, eq).trim().toUpperCase()
      const v = line.slice(eq + 1).trim()
      if (k) kv[k] = v
    }
    const typeTok = kv['TYPE'] ?? kv['EVENT'] ?? kv['ITEMTYPE'] ?? ''
    const kind = mapTypeToken(typeTok)
      ?? (VALID_EVENTS.has(typeTok as MyriadEventKind) ? (typeTok as MyriadEventKind) : null)
      ?? (typeTok ? 'item-start' : null)
    if (kind) {
      return {
        event: kind,
        name: toStr(kv['NAME'] ?? kv['TITLE']),
        duration: toDuration(kv['DURATION'] ?? kv['LENGTH'] ?? kv['SECS']),
        presenter: toStr(kv['PRESENTER'] ?? kv['HOST']),
        artist: toStr(kv['ARTIST']),
        myriadId: toStr(kv['ID'] ?? kv['MYRIADID'] ?? kv['ITEMID']),
        raw: text,
      }
    }
  }

  return null
}

class MyriadBridge extends EventEmitter {
  private socket: dgram.Socket | null = null
  private listening = false

  // Stats — exposed via getStatus() for the inspector UI.
  private messagesReceived = 0
  private eventsParsed = 0
  private parseErrors = 0
  private lastEventAt: number | null = null

  /**
   * Open the UDP socket. Idempotent: if already started, this is a no-op.
   * Bound to the configured host:port; binds errors set listening=false and
   * surface via the 'error' event but never throw to the caller.
   */
  start() {
    if (this.socket) return
    const port = store.get('port')
    const bindHost = store.get('bindHost')
    let sock: dgram.Socket
    try {
      sock = dgram.createSocket('udp4')
    } catch (e: any) {
      console.error('[myriad] failed to create UDP socket:', e?.message ?? e)
      return
    }
    this.socket = sock

    sock.on('error', err => {
      // Don't tear down state from inside the error handler — Node closes the
      // socket itself. Log + flag so the next start() is clean.
      console.error('[myriad] socket error:', err.message)
      this.listening = false
      this.emit('error', err)
    })

    sock.on('listening', () => {
      const a = sock.address()
      this.listening = true
      console.log(`[myriad] listening on ${a.address}:${a.port}`)
    })

    sock.on('message', (buf, rinfo) => {
      this.messagesReceived += 1
      // Emit the raw buffer first so the inspector UI shows EVERY packet,
      // even ones we can't parse. Cheap, and very useful while operators are
      // figuring out their MM_TRIGGER macro syntax.
      try { this.emit('raw', buf) } catch (e: any) {
        console.warn('[myriad] raw emit threw:', e?.message ?? e)
      }
      let parsed: MyriadEvent | null = null
      try {
        // latin1 is a deliberate choice — Myriad's macros emit Windows-1252
        // text in practice, and latin1 round-trips bytes 0x00–0xFF cleanly so
        // we never throw on non-UTF8 input. UTF-8 fast path is rare here.
        const text = buf.toString('latin1')
        parsed = parseMyriadPayload(text)
      } catch (e: any) {
        // parseMyriadPayload should never throw, but if it does (e.g. exotic
        // JSON edge case) treat the packet as malformed rather than fatal.
        this.parseErrors += 1
        console.warn(`[myriad] parse threw on packet from ${rinfo.address}:${rinfo.port}:`, e?.message ?? e)
        return
      }
      if (!parsed) {
        this.parseErrors += 1
        return
      }
      this.eventsParsed += 1
      this.lastEventAt = Date.now()
      try {
        this.emit('event', parsed)
      } catch (e: any) {
        // A buggy listener must NOT crash the socket — log and move on.
        console.warn('[myriad] event listener threw:', e?.message ?? e)
      }
    })

    try {
      sock.bind(port, bindHost)
    } catch (e: any) {
      console.error(`[myriad] bind ${bindHost}:${port} failed:`, e?.message ?? e)
      try { sock.close() } catch { /* ignore */ }
      this.socket = null
      this.listening = false
    }
  }

  /** Close the UDP socket. Idempotent. */
  stop() {
    if (!this.socket) return
    try { this.socket.close() } catch { /* ignore */ }
    this.socket = null
    this.listening = false
  }

  /** Restart the socket — used after a port / host change. */
  private restartIfRunning() {
    if (this.socket) {
      this.stop()
      // Defer one tick so the underlying handle is fully released before
      // bind() — otherwise rapid host changes can race on Windows.
      setImmediate(() => { if (store.get('enabled')) this.start() })
    }
  }

  setEnabled(enabled: boolean) {
    store.set('enabled', !!enabled)
    if (!enabled) this.stop()
    else this.start()
  }

  setPort(port: number) {
    // Clamp to a valid ephemeral / well-known UDP range. Default to 5000 if
    // the input is junk so we never persist NaN into the store.
    const p = Math.max(1, Math.min(65535, Math.round(port) || 5000))
    store.set('port', p)
    this.restartIfRunning()
  }

  setBindHost(host: string) {
    const clean = (host || '').trim()
    // Empty / whitespace input is rejected — we'd otherwise silently fail to
    // bind. Operators can re-supply '0.0.0.0' explicitly.
    if (!clean) return
    store.set('bindHost', clean)
    this.restartIfRunning()
  }

  getStatus(): MyriadStatus {
    return {
      enabled: store.get('enabled'),
      listening: this.listening,
      port: store.get('port'),
      bindHost: store.get('bindHost'),
      messagesReceived: this.messagesReceived,
      eventsParsed: this.eventsParsed,
      parseErrors: this.parseErrors,
      lastEventAt: this.lastEventAt,
    }
  }
}

export const myriadBridge = new MyriadBridge()
