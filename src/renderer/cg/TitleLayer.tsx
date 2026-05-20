import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useSchedule } from '../hooks/useSchedule'
import { drawTitle, type TitleData } from './titles'
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
 * compositor draws over the program. Data comes live from the siphon schedule.
 */
export function TitleLayer({ layer, elements }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const schedule = useSchedule()
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !layer.template) return
    const data: TitleData = {
      showName: schedule.current?.name ?? '',
      presenter: schedule.presenter ?? '',
      nextName: schedule.next?.name ?? '',
      nextTime: schedule.next ? fmtTime(schedule.next.broadcaststart) : '',
      clock: new Date(now).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
    }
    const render = () => drawTitle(canvas, layer.template!, data)
    render()
    // Poppins may load after first paint — redraw once the font is ready.
    document.fonts?.ready.then(render).catch(() => {})
  }, [layer.template, schedule.current, schedule.next, schedule.presenter, now])

  return <canvas ref={canvasRef} width={1920} height={1080} />
}
