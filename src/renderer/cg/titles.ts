import type { TitleTemplate } from './types'
import { NAR_LOGO_DATA_URI } from './narLogo'

/** Live data for the auto-populated title templates. */
export interface TitleData {
  showName: string
  presenter: string
  nextName: string
  nextTime: string
  clock: string
  track: string
  artist: string
  captionText: string
}

/** Bounding box of a rendered title bar — used to clip the reactive sheen. */
export interface TitleRect {
  x: number
  y: number
  w: number
  h: number
  r: number
}

// ── Now Ayrshire Radio brand palette ────────────────────────────────────────
// Sampled from the station logo (nowayrshireradio.co.uk): a deep navy wordmark
// and an orange→red "NOW" tag. The previous purple palette was off-brand.
const NAVY = '#181b33'        // bar background — the brand's dark navy
const NAVY_HI = '#262a4d'     // lifted navy for a subtle top-down bar sheen
const ORANGE = '#f7931e'      // NOW-tag gradient start
const RED = '#e5202b'         // NOW-tag gradient end
const WHITE = '#ffffff'

// Station ident — the long logo (white wordmark + NOW tag), drawn on the bars.
const narLogo = new Image()
narLogo.src = NAR_LOGO_DATA_URI

/**
 * Resolves once the embedded CG assets (the logo) have decoded. Title layers
 * redraw on this so the logo is never missing from the first paint.
 */
export const cgAssetsReady: Promise<void> = new Promise(resolve => {
  if (narLogo.complete && narLogo.naturalWidth > 0) { resolve(); return }
  narLogo.addEventListener('load', () => resolve(), { once: true })
  narLogo.addEventListener('error', () => resolve(), { once: true })
})

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Vertical orange→red gradient — the brand "NOW tag" accent. */
function accent(ctx: CanvasRenderingContext2D, top: number, bottom: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom)
  g.addColorStop(0, ORANGE)
  g.addColorStop(1, RED)
  return g
}

/** Navy bar fill with a subtle top-down sheen so it never reads as dead flat. */
function barFill(ctx: CanvasRenderingContext2D, top: number, bottom: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom)
  g.addColorStop(0, NAVY_HI)
  g.addColorStop(1, NAVY)
  return g
}

/** Render a NAR-branded title onto a 1920×1080 transparent canvas. */
export function drawTitle(
  canvas: HTMLCanvasElement, template: TitleTemplate, data: TitleData,
): TitleRect | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (template === 'show-lower-third') return lowerThird(ctx, data)
  if (template === 'up-next') return upNext(ctx, data)
  if (template === 'now-playing') return nowPlaying(ctx, data)
  if (template === 'captions') return captions(ctx, data)
  return clock(ctx, data)
}

function lowerThird(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect {
  const title = (d.showName || 'NOW AYRSHIRE RADIO').toUpperCase()
  const sub = d.presenter || ''
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  ctx.font = '700 58px Poppins, sans-serif'
  const titleW = ctx.measureText(title).width
  ctx.font = '400 32px Poppins, sans-serif'
  const subW = sub ? ctx.measureText(sub).width : 0
  const textW = Math.max(titleW, subW)

  const barH = sub ? 178 : 122
  const hasLogo = narLogo.complete && narLogo.naturalWidth > 0
  const logoH = 46
  const logoW = hasLogo ? Math.round(logoH * narLogo.naturalWidth / narLogo.naturalHeight) : 0

  const stripeW = 16
  const padL = 34                       // gap after the brand stripe
  const logoBlock = hasLogo ? logoW + 32 : 0   // logo + divider + gaps
  const padR = 64
  const radius = 14

  const barW = Math.ceil(stripeW + padL + logoBlock + textW + padR)
  const x = 110
  const y = 1080 - 120 - barH

  // navy bar + drop shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 32
  ctx.shadowOffsetY = 10
  ctx.fillStyle = barFill(ctx, y, y + barH)
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.fill()
  ctx.restore()

  // orange→red brand stripe down the left edge
  ctx.save()
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.clip()
  ctx.fillStyle = accent(ctx, y, y + barH)
  ctx.fillRect(x, y, stripeW, barH)
  ctx.restore()

  let cx = x + stripeW + padL

  // station logo + a thin gradient divider
  if (hasLogo) {
    ctx.drawImage(narLogo, cx, y + (barH - logoH) / 2, logoW, logoH)
    cx += logoW + 16
    ctx.fillStyle = accent(ctx, y + 24, y + barH - 24)
    ctx.fillRect(cx, y + 24, 3, barH - 48)
    cx += 3 + 13
  }

  // show name + presenter
  ctx.fillStyle = WHITE
  ctx.font = '700 58px Poppins, sans-serif'
  ctx.fillText(title, cx, y + (sub ? 86 : barH / 2 + 20))
  if (sub) {
    ctx.fillStyle = ORANGE
    ctx.font = '400 32px Poppins, sans-serif'
    ctx.fillText(sub, cx, y + 140)
  }

  return { x, y, w: barW, h: barH, r: radius }
}

function upNext(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect {
  const name = (d.nextName || '—').toUpperCase()
  const time = d.nextTime || ''
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  ctx.font = '700 38px Poppins, sans-serif'
  const nameW = ctx.measureText(name).width
  const stripeW = 14
  const padL = 44
  const padR = 46
  const barH = 132
  const radius = 14
  const barW = Math.ceil(Math.max(nameW, 240)) + stripeW + padL + padR
  const x = 1920 - 110 - barW
  const y = 1080 - 120 - barH

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 9
  ctx.fillStyle = barFill(ctx, y, y + barH)
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.fill()
  ctx.restore()

  // orange→red brand stripe
  ctx.save()
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.clip()
  ctx.fillStyle = accent(ctx, y, y + barH)
  ctx.fillRect(x, y, stripeW, barH)
  ctx.restore()

  const tx = x + stripeW + padL
  ctx.fillStyle = ORANGE
  ctx.font = '700 22px Poppins, sans-serif'
  ctx.fillText('UP NEXT', tx, y + 48)
  if (time) {
    ctx.textAlign = 'right'
    ctx.fillStyle = WHITE
    ctx.fillText(time, x + barW - padR, y + 48)
    ctx.textAlign = 'left'
  }

  ctx.fillStyle = WHITE
  ctx.font = '700 38px Poppins, sans-serif'
  ctx.fillText(name, tx, y + 102)

  return { x, y, w: barW, h: barH, r: radius }
}

function clock(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect {
  const t = d.clock || '--:--:--'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  ctx.font = '700 44px Poppins, sans-serif'
  const padX = 40
  const dotGap = 34
  const barW = Math.ceil(ctx.measureText(t).width) + padX + dotGap + padX
  const barH = 86
  const radius = 12
  const x = 1920 - 90 - barW
  const y = 80

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 7
  ctx.fillStyle = barFill(ctx, y, y + barH)
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.fill()
  ctx.restore()

  // orange→red brand dot
  const dotX = x + padX
  const dotY = y + barH / 2
  const dot = ctx.createLinearGradient(dotX, dotY - 9, dotX, dotY + 9)
  dot.addColorStop(0, ORANGE)
  dot.addColorStop(1, RED)
  ctx.fillStyle = dot
  ctx.beginPath()
  ctx.arc(dotX, dotY, 9, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = WHITE
  ctx.font = '700 44px Poppins, sans-serif'
  ctx.fillText(t, dotX + dotGap, dotY + 3)

  return { x, y, w: barW, h: barH, r: radius }
}

function nowPlaying(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect {
  const track = d.track || 'Now Playing'
  const artist = d.artist || ''
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  ctx.font = '700 30px Poppins, sans-serif'
  const trackW = ctx.measureText(track).width
  ctx.font = '400 22px Poppins, sans-serif'
  const artistW = artist ? ctx.measureText(artist).width : 0
  const textW = Math.max(trackW, artistW)

  const stripeW = 12
  const padL = 28
  const iconW = artist ? 38 : 32
  const padR = 38
  const barH = artist ? 96 : 64
  const radius = 12
  const barW = Math.ceil(stripeW + padL + iconW + textW + padR)
  const x = Math.round(1920 / 2 - barW / 2)
  const y = 1080 - 60 - barH

  // navy bar + shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 8
  ctx.fillStyle = barFill(ctx, y, y + barH)
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.fill()
  ctx.restore()

  // orange→red brand stripe
  ctx.save()
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.clip()
  ctx.fillStyle = accent(ctx, y, y + barH)
  ctx.fillRect(x, y, stripeW, barH)
  ctx.restore()

  // music-note glyph (♪) in brand orange
  ctx.fillStyle = ORANGE
  ctx.font = '700 34px Poppins, sans-serif'
  ctx.fillText('♪', x + stripeW + padL, y + (artist ? 48 : barH / 2 + 12))

  // track + artist
  const textX = x + stripeW + padL + iconW
  ctx.fillStyle = WHITE
  ctx.font = '700 30px Poppins, sans-serif'
  ctx.fillText(track, textX, y + (artist ? 48 : barH / 2 + 12))
  if (artist) {
    ctx.fillStyle = ORANGE
    ctx.font = '400 22px Poppins, sans-serif'
    ctx.fillText(artist, textX, y + 80)
  }

  return { x, y, w: barW, h: barH, r: radius }
}

function captions(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect {
  const text = (d.captionText || '').slice(-200)
  if (!text) return { x: 0, y: 0, w: 0, h: 0, r: 0 }
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  ctx.font = '600 34px Poppins, sans-serif'
  const tw = ctx.measureText(text).width
  const barW = Math.min(1700, Math.ceil(tw) + 80)
  const barH = 72
  const x = Math.round(1920 / 2 - barW / 2)
  const y = 1080 - 36 - barH
  const radius = 10

  // Semi-transparent black bar — broadcast subtitle style
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 18
  ctx.shadowOffsetY = 6
  ctx.fillStyle = 'rgba(0, 0, 0, 0.78)'
  roundRect(ctx, x, y, barW, barH, radius)
  ctx.fill()
  ctx.restore()

  // White text — slightly oversized for readability at distance
  ctx.fillStyle = WHITE
  ctx.font = '600 34px Poppins, sans-serif'
  // Crop overflow: if text wider than bar inner, show only the tail
  const inner = barW - 60
  let display = text
  if (tw > inner) {
    // Trim characters from the left until it fits
    while (display.length > 0 && ctx.measureText(display).width > inner) {
      display = display.slice(1)
    }
    if (display !== text) display = '…' + display.slice(1)
  }
  ctx.fillText(display, 1920 / 2, y + 48)

  return { x, y, w: barW, h: barH, r: radius }
}

/**
 * A subtle, broadcast-grade audio-reactive sheen drawn over a title bar:
 * a slow specular sweep plus a few high-end-reactive sparkle motes. Clipped
 * to the bar so it never bleeds onto the program. Kept deliberately gentle.
 */
export function drawSparkle(
  ctx: CanvasRenderingContext2D, rect: TitleRect, time: number, treble: number, beat: number,
  bpm: number, bpmConfident: boolean,
) {
  const { x, y, w, h, r } = rect
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.globalCompositeOperation = 'screen'

  // Specular sweep — paced to 4 bars (16 beats) when a stable tempo is locked,
  // else a fixed 8s cycle. The bar sheen breathes with the music.
  const period = bpmConfident && bpm > 0 ? (60 / bpm) * 16 : 8
  const phase = (time % period) / period
  const band = 240
  const cx = x - band + (w + band * 2) * phase
  const sheen = 0.09 + beat * 0.10
  const grad = ctx.createLinearGradient(cx - band, 0, cx + band, 0)
  grad.addColorStop(0, 'rgba(255,255,255,0)')
  grad.addColorStop(0.5, `rgba(255,255,255,${sheen.toFixed(3)})`)
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = grad
  ctx.fillRect(x, y, w, h)

  // Sparkle motes — a few fixed points that twinkle with the high end.
  const innerW = Math.max(1, Math.floor(w - 52))
  const innerH = Math.max(1, Math.floor(h - 36))
  for (let i = 0; i < 5; i++) {
    const sx = x + 26 + ((i * 1973) % innerW)
    const sy = y + 18 + ((i * 911) % innerH)
    const twinkle = 0.5 + 0.5 * Math.sin(time * 2.6 + i * 2.1)
    const a = Math.min(0.5, (0.05 + treble * 0.55 + beat * 0.15) * twinkle)
    if (a < 0.012) continue
    const rad = 7
    const mote = ctx.createRadialGradient(sx, sy, 0, sx, sy, rad)
    mote.addColorStop(0, `rgba(255,250,235,${a.toFixed(3)})`)
    mote.addColorStop(1, 'rgba(255,250,235,0)')
    ctx.fillStyle = mote
    ctx.fillRect(sx - rad, sy - rad, rad * 2, rad * 2)
  }

  ctx.restore()
}
