import type { TitleTemplate } from './types'

/** Live data for the auto-populated title templates. */
export interface TitleData {
  showName: string
  presenter: string
  nextName: string
  nextTime: string
  clock: string
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
export function drawTitle(canvas: HTMLCanvasElement, template: TitleTemplate, data: TitleData) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (template === 'show-lower-third') lowerThird(ctx, data)
  else if (template === 'up-next') upNext(ctx, data)
  else clock(ctx, data)
}

function lowerThird(ctx: CanvasRenderingContext2D, d: TitleData) {
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
}

function upNext(ctx: CanvasRenderingContext2D, d: TitleData) {
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
}

function clock(ctx: CanvasRenderingContext2D, d: TitleData) {
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
}
