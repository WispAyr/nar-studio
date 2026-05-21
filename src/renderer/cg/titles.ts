import type { TitleTemplate } from './types'

/** Live data for the auto-populated title templates. */
export interface TitleData {
  showName: string
  presenter: string
  nextName: string
  nextTime: string
  clock: string
}

/** Bounding box of a rendered title bar — used to clip the reactive sheen. */
export interface TitleRect {
  x: number
  y: number
  w: number
  h: number
  r: number
}

// Now Ayrshire Radio brand palette.
const PURPLE = '#2d1646'
const AMBER = '#faa61a'
const WHITE = '#ffffff'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
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

  const padL = 74
  const padR = 66
  const barW = Math.ceil(Math.max(titleW, subW)) + padL + padR
  const barH = sub ? 178 : 122
  const x = 110
  const y = 1080 - 120 - barH

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 32
  ctx.shadowOffsetY = 10
  ctx.fillStyle = PURPLE
  roundRect(ctx, x, y, barW, barH, 12)
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundRect(ctx, x, y, barW, barH, 12)
  ctx.clip()
  ctx.fillStyle = AMBER
  ctx.fillRect(x, y, 18, barH)
  ctx.restore()

  ctx.fillStyle = WHITE
  ctx.font = '700 58px Poppins, sans-serif'
  ctx.fillText(title, x + padL, y + (sub ? 86 : barH / 2 + 20))
  if (sub) {
    ctx.fillStyle = AMBER
    ctx.font = '400 32px Poppins, sans-serif'
    ctx.fillText(sub, x + padL, y + 140)
  }

  return { x, y, w: barW, h: barH, r: 12 }
}

function upNext(ctx: CanvasRenderingContext2D, d: TitleData): TitleRect {
  const name = (d.nextName || '—').toUpperCase()
  const time = d.nextTime || ''
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  ctx.font = '700 38px Poppins, sans-serif'
  const nameW = ctx.measureText(name).width
  const padL = 46
  const padR = 46
  const barW = Math.ceil(Math.max(nameW, 240)) + padL + padR
  const barH = 132
  const x = 1920 - 110 - barW
  const y = 1080 - 120 - barH

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 28
  ctx.shadowOffsetY = 9
  ctx.fillStyle = PURPLE
  roundRect(ctx, x, y, barW, barH, 12)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = AMBER
  ctx.font = '700 22px Poppins, sans-serif'
  ctx.fillText('UP NEXT', x + padL, y + 48)
  if (time) {
    ctx.textAlign = 'right'
    ctx.fillText(time, x + barW - padR, y + 48)
    ctx.textAlign = 'left'
  }

  ctx.fillStyle = WHITE
  ctx.font = '700 38px Poppins, sans-serif'
  ctx.fillText(name, x + padL, y + 102)

  return { x, y, w: barW, h: barH, r: 12 }
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
  const x = 1920 - 90 - barW
  const y = 80

  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 22
  ctx.shadowOffsetY = 7
  ctx.fillStyle = PURPLE
  roundRect(ctx, x, y, barW, barH, 10)
  ctx.fill()
  ctx.restore()

  ctx.fillStyle = AMBER
  ctx.beginPath()
  ctx.arc(x + padX, y + barH / 2, 8, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = WHITE
  ctx.font = '700 44px Poppins, sans-serif'
  ctx.fillText(t, x + padX + dotGap, y + barH / 2 + 3)

  return { x, y, w: barW, h: barH, r: 10 }
}

/**
 * A subtle, broadcast-grade audio-reactive sheen drawn over a title bar:
 * a slow specular sweep plus a few high-end-reactive sparkle motes. Clipped
 * to the bar so it never bleeds onto the program. Kept deliberately gentle.
 */
export function drawSparkle(
  ctx: CanvasRenderingContext2D, rect: TitleRect, time: number, treble: number, beat: number,
) {
  const { x, y, w, h, r } = rect
  ctx.save()
  roundRect(ctx, x, y, w, h, r)
  ctx.clip()
  ctx.globalCompositeOperation = 'screen'

  // Specular sweep — one soft sheen crossing the bar roughly every 8s.
  const phase = (time % 8) / 8
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
