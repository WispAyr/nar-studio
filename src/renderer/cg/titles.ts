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

/**
 * Templates whose contents change every frame (breathing scale, pulsing
 * dots, animated ON AIR ring, drifting dashes) — the TitleLayer redraws
 * these per-frame instead of caching a single static base canvas.
 */
export const ANIMATED_TEMPLATES: ReadonlySet<TitleTemplate> = new Set<TitleTemplate>([
  'be-right-back',
  'stand-by',
  'now-on-air',
])

export function isAnimatedTemplate(t: TitleTemplate | undefined): boolean {
  return !!t && ANIMATED_TEMPLATES.has(t)
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
  if (template === 'be-right-back') return beRightBack(ctx)
  if (template === 'stand-by') return standBy(ctx)
  if (template === 'coming-up') return comingUp(ctx, data)
  if (template === 'technical-difficulty') return technicalDifficulty(ctx)
  if (template === 'now-on-air') return nowOnAir(ctx, data)
  return clock(ctx, data)
}

/**
 * Shared backdrop for every full-screen takeover card — a deep navy radial
 * gradient with a soft brand-orange glow off-centre and a quiet diagonal
 * grain. Every card layers its typography over this so the family feels
 * unified rather than five separate posters.
 */
function brandBackdrop(ctx: CanvasRenderingContext2D, opts: { glowAt?: 'left' | 'right' } = {}) {
  const W = 1920, H = 1080
  // Deep navy base, just shy of pure black so highlights pop without bloom.
  const base = ctx.createLinearGradient(0, 0, 0, H)
  base.addColorStop(0, '#0f1226')
  base.addColorStop(1, '#070914')
  ctx.fillStyle = base
  ctx.fillRect(0, 0, W, H)

  // Off-centre brand glow — orange→red→transparent. Painted with screen
  // blending so it lifts the navy without flattening the gradient.
  const gx = opts.glowAt === 'right' ? W * 0.78 : W * 0.22
  const gy = H * 0.36
  const glow = ctx.createRadialGradient(gx, gy, 30, gx, gy, 1100)
  glow.addColorStop(0, 'rgba(247,147,30,0.32)')
  glow.addColorStop(0.35, 'rgba(229,32,43,0.18)')
  glow.addColorStop(1, 'rgba(229,32,43,0)')
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  // Subtle diagonal grain — built from a couple of cheap line passes rather
  // than per-pixel noise. Keeps the file size sensible while killing the
  // "flat gradient" feel under bloom.
  ctx.save()
  ctx.globalCompositeOperation = 'overlay'
  ctx.strokeStyle = 'rgba(255,255,255,0.025)'
  ctx.lineWidth = 1
  for (let y = -H; y < W + H; y += 8) {
    ctx.beginPath()
    ctx.moveTo(y, 0)
    ctx.lineTo(y + H, H)
    ctx.stroke()
  }
  ctx.restore()

  // Bottom-edge brand-stripe — orange→red sliver, the wordmark accent.
  const stripeH = 6
  ctx.fillStyle = accent(ctx, H - stripeH, H)
  ctx.fillRect(0, H - stripeH, W, stripeH)

  // Top-left small dot + REC-style label so the operator instantly knows
  // this is a station card, not stale content.
  ctx.save()
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.arc(72, 64, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = WHITE
  ctx.font = '700 14px Poppins, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText('NOW AYRSHIRE RADIO', 92, 65)
  ctx.restore()
}

/** Centred long-form logo at a fixed y. Returns the bottom edge for layout. */
function logoCentred(ctx: CanvasRenderingContext2D, cy: number, height: number): number {
  if (!narLogo.complete || narLogo.naturalWidth === 0) return cy + height / 2
  const w = Math.round(height * narLogo.naturalWidth / narLogo.naturalHeight)
  const x = (1920 - w) / 2
  const y = cy - height / 2
  ctx.drawImage(narLogo, x, y, w, height)
  return y + height
}

/** Subtle live "breathing" multiplier — drives card pulsations from a single
 *  source so every card breathes in unison. Range ~[0.985, 1.015]. */
function breathe(): number {
  return 1 + 0.015 * Math.sin(Date.now() / 1200)
}

/**
 * "Be Right Back" — the most-fired card. Massive BRB headline, NAR logo,
 * "back in a moment" subtitle, animated three-dot loader pinning the eye.
 */
function beRightBack(ctx: CanvasRenderingContext2D): TitleRect | null {
  brandBackdrop(ctx, { glowAt: 'left' })

  const W = 1920, H = 1080
  const bRev = breathe()
  ctx.save()
  ctx.translate(W / 2, H / 2)
  ctx.scale(bRev, bRev)
  ctx.translate(-W / 2, -H / 2)

  // Brand logo
  logoCentred(ctx, 332, 92)

  // Massive headline — track to dramatic letter-spacing.
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = WHITE
  ctx.font = '900 220px Poppins, sans-serif'
  // Soft shadow lifts it off the gradient
  ctx.save()
  ctx.shadowColor = 'rgba(247,147,30,0.55)'
  ctx.shadowBlur = 60
  ctx.fillText('BE RIGHT BACK', W / 2, 640)
  ctx.restore()

  // Orange→red underline accent
  const lineY = 686
  const grad = accent(ctx, lineY - 4, lineY + 4)
  ctx.fillStyle = grad
  roundRect(ctx, W / 2 - 320, lineY, 640, 8, 4)
  ctx.fill()

  // Subtitle
  ctx.fillStyle = '#d8d8e8'
  ctx.font = '500 36px Poppins, sans-serif'
  ctx.fillText('We will return shortly — stay tuned', W / 2, 768)

  // Animated three-dot loader — phase off Date.now so it never freezes
  const t = Date.now() / 480
  for (let i = 0; i < 3; i++) {
    const phase = (t - i * 0.18) % 1.4
    const lift = phase < 0.5 ? Math.sin(phase * Math.PI * 2) * 14 : 0
    ctx.beginPath()
    ctx.arc(W / 2 - 40 + i * 40, 860 - lift, 9, 0, Math.PI * 2)
    ctx.fillStyle = i === 0 ? ORANGE : i === 1 ? RED : WHITE
    ctx.fill()
  }

  ctx.restore()
  return null  // full-screen takeover — no sheen sweep
}

/**
 * "Stand By" — pre-show hold card. Slightly less dramatic typographic weight
 * than BRB, with a live wall-clock readout so the operator can see at a
 * glance how long the audience has been waiting.
 */
function standBy(ctx: CanvasRenderingContext2D): TitleRect | null {
  brandBackdrop(ctx, { glowAt: 'right' })

  const W = 1920, H = 1080
  logoCentred(ctx, 360, 100)

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'

  // "STAND BY" — extended letter spacing for that broadcast slate feel.
  ctx.fillStyle = WHITE
  ctx.font = '800 188px Poppins, sans-serif'
  ctx.save()
  ctx.shadowColor = 'rgba(247,147,30,0.45)'
  ctx.shadowBlur = 40
  // Hand-track the letter spacing by drawing each char with a measured gap.
  const text = 'STAND BY'
  const gap = 16
  const totalW = ctx.measureText(text).width + gap * (text.length - 1)
  let x = W / 2 - totalW / 2
  for (const ch of text) {
    const w = ctx.measureText(ch).width
    ctx.fillText(ch, x + w / 2, 640)
    x += w + gap
  }
  ctx.restore()

  // Centre live clock — pulses subtly with the breathing multiplier.
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  ctx.fillStyle = ORANGE
  ctx.font = '700 64px Poppins, sans-serif'
  ctx.fillText(`${hh}:${mm}:${ss}`, W / 2, 760)

  // Subtitle
  ctx.fillStyle = '#c0c4d4'
  ctx.font = '500 32px Poppins, sans-serif'
  ctx.fillText('Live in moments', W / 2, 822)

  // Bottom row of subtle dashes — broadcast-leader style, animated drift.
  const drift = (Date.now() / 60) % 40
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  for (let i = -2; i < 50; i++) {
    const dx = i * 40 + drift
    ctx.fillRect(W / 2 - 600 + dx, 920, 22, 4)
  }
  ctx.restore()

  return null
}

/**
 * "Coming Up" — preview card pulled from the schedule data. Left-aligned
 * editorial layout so the show name has room to breathe.
 */
function comingUp(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect | null {
  brandBackdrop(ctx, { glowAt: 'left' })

  const W = 1920
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'

  // Logo top-left rather than centred — gives the show name the headline real estate.
  if (narLogo.complete && narLogo.naturalWidth > 0) {
    const lh = 72
    const lw = Math.round(lh * narLogo.naturalWidth / narLogo.naturalHeight)
    ctx.drawImage(narLogo, 140, 140, lw, lh)
  }

  // Eyebrow — small label above the headline.
  ctx.fillStyle = ORANGE
  ctx.font = '700 30px Poppins, sans-serif'
  // Manual letter-spacing for the broadcast eyebrow vibe.
  const eyebrow = 'COMING UP NEXT'
  let ex = 140
  const eyeGap = 8
  for (const ch of eyebrow) {
    ctx.fillText(ch, ex, 380)
    ex += ctx.measureText(ch).width + eyeGap
  }

  // Vertical accent stripe to the left of the show name.
  const stripeY = 410
  const stripeH = 320
  ctx.fillStyle = accent(ctx, stripeY, stripeY + stripeH)
  ctx.fillRect(140, stripeY, 8, stripeH)

  // Show name — big, white, may wrap. Auto-shrink to fit.
  const showName = (d.nextName || 'NOW AYRSHIRE RADIO').toUpperCase()
  ctx.fillStyle = WHITE
  let fontSize = 156
  ctx.font = `900 ${fontSize}px Poppins, sans-serif`
  while (ctx.measureText(showName).width > W - 320 && fontSize > 64) {
    fontSize -= 8
    ctx.font = `900 ${fontSize}px Poppins, sans-serif`
  }
  ctx.save()
  ctx.shadowColor = 'rgba(247,147,30,0.4)'
  ctx.shadowBlur = 38
  ctx.fillText(showName, 180, 520)
  ctx.restore()

  // Time tag — large numeral pinned right.
  if (d.nextTime) {
    ctx.textAlign = 'right'
    ctx.fillStyle = '#d8d8e8'
    ctx.font = '600 84px Poppins, sans-serif'
    ctx.fillText(d.nextTime, W - 140, 660)
  }

  // Presenter or subtitle on the next line — borrows the presenter field.
  if (d.presenter) {
    ctx.textAlign = 'left'
    ctx.fillStyle = '#9095b0'
    ctx.font = '500 36px Poppins, sans-serif'
    ctx.fillText(d.presenter, 180, 660)
  }

  // Bottom-right footer
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = '500 22px Poppins, sans-serif'
  ctx.fillText('nowayrshireradio.co.uk', W - 140, 940)

  return null
}

/**
 * "Technical Difficulty" — the apologetic card. Calmer palette (more navy,
 * less orange), smaller headline, longer subtitle. Designed to read as
 * "we know, we're on it" rather than "panic".
 */
function technicalDifficulty(ctx: CanvasRenderingContext2D): TitleRect | null {
  brandBackdrop(ctx, { glowAt: 'left' })

  const W = 1920
  logoCentred(ctx, 372, 84)

  // Centred warning glyph — a soft triangle outline with an exclamation. SDF
  // would be cleaner but we're in canvas-2d; geometry primitives are fine.
  ctx.save()
  ctx.translate(W / 2, 560)
  const tri = 110
  ctx.lineWidth = 8
  ctx.strokeStyle = ORANGE
  ctx.beginPath()
  ctx.moveTo(0, -tri)
  ctx.lineTo(tri, tri * 0.86)
  ctx.lineTo(-tri, tri * 0.86)
  ctx.closePath()
  ctx.stroke()
  ctx.fillStyle = WHITE
  ctx.font = '900 100px Poppins, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('!', 0, 22)
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = WHITE
  ctx.font = '800 96px Poppins, sans-serif'
  ctx.fillText('TECHNICAL DIFFICULTY', W / 2, 790)

  ctx.fillStyle = '#c0c4d4'
  ctx.font = '500 34px Poppins, sans-serif'
  ctx.fillText('Apologies — we are working to restore the broadcast', W / 2, 850)

  ctx.fillStyle = '#6e7390'
  ctx.font = '500 26px Poppins, sans-serif'
  ctx.fillText('Thank you for your patience', W / 2, 904)

  return null
}

/**
 * "Now On Air" — show-open card. High-energy: big animated red NOW badge in
 * the corner, large show name centred. Designed to be flashed for ~3 seconds
 * at the top of a show then cut to cameras.
 */
function nowOnAir(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect | null {
  brandBackdrop(ctx, { glowAt: 'right' })

  const W = 1920
  const t = Date.now() / 1000

  // Big pulsing NOW dot top-left so the operator + audience clock the on-air state.
  ctx.save()
  const pulse = 0.5 + 0.5 * Math.sin(t * 4)
  const ringR = 60 + pulse * 20
  ctx.strokeStyle = `rgba(229,32,43,${(1 - pulse) * 0.7})`
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.arc(180, 200, ringR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = RED
  ctx.beginPath()
  ctx.arc(180, 200, 56, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = WHITE
  ctx.font = '800 30px Poppins, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('ON AIR', 180, 200)
  ctx.restore()

  // Logo centred above headline.
  logoCentred(ctx, 360, 92)

  // Eyebrow
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = ORANGE
  ctx.font = '700 32px Poppins, sans-serif'
  const eyebrow = 'NOW LIVE'
  let ex = W / 2 - ctx.measureText(eyebrow).width / 2 - 6 * (eyebrow.length - 1)
  for (const ch of eyebrow) {
    ctx.fillText(ch, ex, 470)
    ex += ctx.measureText(ch).width + 12
  }

  // Show name — auto-shrinks to fit.
  const showName = (d.showName || 'NOW AYRSHIRE RADIO').toUpperCase()
  ctx.fillStyle = WHITE
  let fontSize = 168
  ctx.font = `900 ${fontSize}px Poppins, sans-serif`
  while (ctx.measureText(showName).width > W - 360 && fontSize > 60) {
    fontSize -= 8
    ctx.font = `900 ${fontSize}px Poppins, sans-serif`
  }
  ctx.save()
  ctx.shadowColor = 'rgba(247,147,30,0.5)'
  ctx.shadowBlur = 48
  ctx.fillText(showName, W / 2, 640)
  ctx.restore()

  // Brand gradient underline
  const lineY = 686
  ctx.fillStyle = accent(ctx, lineY - 4, lineY + 4)
  roundRect(ctx, W / 2 - 220, lineY, 440, 6, 3)
  ctx.fill()

  // Presenter
  if (d.presenter) {
    ctx.fillStyle = '#c0c4d4'
    ctx.font = '500 40px Poppins, sans-serif'
    ctx.fillText(`with ${d.presenter}`, W / 2, 770)
  }

  // Bottom right URL
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(255,255,255,0.4)'
  ctx.font = '500 24px Poppins, sans-serif'
  ctx.fillText('nowayrshireradio.co.uk', W - 110, 1004)

  return null
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
