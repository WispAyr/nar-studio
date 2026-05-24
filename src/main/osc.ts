/**
 * Minimal OSC 1.0 UDP sender — drives an external visualization engine
 * (Unreal Engine, TouchDesigner, Resolume, Notch, vvvv, …) with the same
 * audio metrics the built-in WebGL viz consumes.
 *
 * Why we roll our own: the wire format is 60 lines, every existing OSC
 * library on npm hasn't been touched in three years, and we only ever
 * SEND. Receiving requires a server, which we don't need.
 */
import dgram from 'dgram'
import Store from 'electron-store'

interface StoreSchema {
  enabled: boolean
  host: string
  port: number
}

const store = new Store<StoreSchema>({
  name: 'osc-bridge',
  defaults: {
    enabled: false,
    host: '127.0.0.1',
    port: 9000,
  },
})

export interface OscStatus {
  enabled: boolean
  host: string
  port: number
  /** Outgoing message rate over the last second, for the UI. */
  rate: number
  /** Last UDP send error, or null. */
  lastError: string | null
}

/** Pad a Buffer to the next multiple of 4 with trailing nulls (OSC alignment). */
function pad4(b: Buffer): Buffer {
  const rem = b.length % 4
  if (rem === 0) return b
  return Buffer.concat([b, Buffer.alloc(4 - rem)])
}

/** Encode an OSC string: ASCII bytes + null terminator + pad-to-4. */
function oscString(s: string): Buffer {
  return pad4(Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])]))
}

/** Encode a single OSC message. Floats and ints are 32-bit big-endian. */
function oscMessage(address: string, args: (number | string)[], floats: boolean[]): Buffer {
  const addr = oscString(address)
  // Type tags — ',' prefix + one tag per arg ('f' float, 'i' int, 's' string).
  const tags = ',' + args.map((a, i) => typeof a === 'string' ? 's' : floats[i] ? 'f' : 'i').join('')
  const tagsBuf = oscString(tags)
  const argsBufs = args.map((a, i) => {
    if (typeof a === 'string') return oscString(a)
    const b = Buffer.alloc(4)
    if (floats[i]) b.writeFloatBE(a, 0)
    else b.writeInt32BE(a | 0, 0)
    return b
  })
  return Buffer.concat([addr, tagsBuf, ...argsBufs])
}

class OscBridge {
  private socket: dgram.Socket | null = null
  private lastError: string | null = null
  // Rolling rate counter — incremented on send, reset every second.
  private sendsThisWindow = 0
  private currentRate = 0
  private rateTimer: NodeJS.Timeout | null = null

  start() {
    if (this.socket) return
    this.socket = dgram.createSocket('udp4')
    this.socket.on('error', err => {
      this.lastError = err.message
      console.error('[osc] socket error:', err.message)
    })
    if (!this.rateTimer) {
      this.rateTimer = setInterval(() => {
        this.currentRate = this.sendsThisWindow
        this.sendsThisWindow = 0
      }, 1000)
      this.rateTimer.unref?.()
    }
  }

  stop() {
    try { this.socket?.close() } catch { /* ignore */ }
    this.socket = null
    if (this.rateTimer) { clearInterval(this.rateTimer); this.rateTimer = null }
    this.currentRate = 0
    this.sendsThisWindow = 0
  }

  /**
   * Send a batch of named float metrics in a single UDP packet. We bundle as
   * separate messages (no OSC bundle prefix — most UE/TD receivers accept
   * either, and one packet per metric is simpler than a sub-bundle).
   */
  sendMetrics(metrics: Record<string, number>) {
    if (!store.get('enabled')) return
    this.start()
    const sock = this.socket
    if (!sock) return
    const host = store.get('host')
    const port = store.get('port')
    for (const [name, value] of Object.entries(metrics)) {
      const addr = name.startsWith('/') ? name : `/nar/${name}`
      const msg = oscMessage(addr, [value], [true])
      sock.send(msg, port, host, err => {
        if (err) this.lastError = err.message
      })
      this.sendsThisWindow += 1
    }
  }

  /** Generic event — string addresses get one int "argument" for sequencing. */
  sendEvent(address: string, n = 1) {
    if (!store.get('enabled')) return
    this.start()
    const sock = this.socket
    if (!sock) return
    const msg = oscMessage(address.startsWith('/') ? address : `/nar/${address}`, [n], [false])
    sock.send(msg, store.get('port'), store.get('host'), err => {
      if (err) this.lastError = err.message
    })
    this.sendsThisWindow += 1
  }

  getStatus(): OscStatus {
    return {
      enabled: store.get('enabled'),
      host: store.get('host'),
      port: store.get('port'),
      rate: this.currentRate,
      lastError: this.lastError,
    }
  }

  setEnabled(enabled: boolean) {
    store.set('enabled', enabled)
    if (!enabled) this.stop()
    else this.start()
  }

  setHost(host: string) {
    // Trim + reject empty so we don't UDP-spam a bogus '' target.
    const clean = (host || '').trim()
    if (clean) store.set('host', clean)
  }

  setPort(port: number) {
    const p = Math.max(1, Math.min(65535, Math.round(port) || 9000))
    store.set('port', p)
  }
}

export const oscBridge = new OscBridge()
