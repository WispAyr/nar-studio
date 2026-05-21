import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useSchedule } from '../hooks/useSchedule'
import { useViz } from '../viz/VizProvider'
import { drawTitle, drawSparkle, type TitleData, type TitleRect } from './titles'
import type { CgLayer } from './types'

type ElementMap = Map<string, HTMLImageElement | HTMLVideoElement | HTMLCanvasElement>

interface Props {
  layer: CgLayer
  elements: MutableRefObject<ElementMap>
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * Renders an auto-populated NAR title onto an off-screen 1080p canvas which the
 * compositor draws over the program. The static title is cached in a base
 * canvas; a per-frame loop composites it with a subtle audio-reactive sheen.
 */
export function TitleLayer({ layer, elements }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baseRef = useRef<HTMLCanvasElement | null>(null)
  if (!baseRef.current) {
    const c = document.createElement('canvas')
    c.width = 1920
    c.height = 1080
    baseRef.current = c
  }
  const rectRef = useRef<TitleRect | null>(null)
  const schedule = useSchedule()
  const viz = useViz()
  const vizRef = useRef(viz)
  vizRef.current = viz
  const [now, setNow] = useState(() => Date.now())

  // Only the clock needs a per-second tick; other titles redraw on data change.
  useEffect(() => {
    if (layer.template !== 'clock') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [layer.template])

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) elements.current.set(layer.id, canvas)
    return () => { elements.current.delete(layer.id) }
  }, [layer.id, elements])

  // Render the static title into the off-screen base canvas on data change.
  useEffect(() => {
    const base = baseRef.current
    if (!base || !layer.template) return
    const data: TitleData = {
      showName: schedule.current?.name ?? '',
      presenter: schedule.presenter ?? '',
      nextName: schedule.next?.name ?? '',
      nextTime: schedule.next ? fmtTime(schedule.next.broadcaststart) : '',
      clock: new Date(now).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
    }
    const render = () => { rectRef.current = drawTitle(base, layer.template!, data) }
    render()
    // Poppins may load after first paint — redraw once the font is ready.
    document.fonts?.ready.then(render).catch(() => {})
  }, [layer.template, schedule.current, schedule.next, schedule.presenter, now])

  // Per-frame: composite the cached title + a subtle audio-reactive sheen.
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const vis = canvasRef.current
      const base = baseRef.current
      if (!vis || !base) return
      const ctx = vis.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, 1920, 1080)
      ctx.drawImage(base, 0, 0)
      const rect = rectRef.current
      if (rect) {
        const lv = vizRef.current.levelsRef.current
        drawSparkle(ctx, rect, (performance.now() - start) / 1000, lv.treble, lv.beat)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return <canvas ref={canvasRef} width={1920} height={1080} />
}
