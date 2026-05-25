/**
 * Show Clock — the iconic Myriad Playout visualisation.
 *
 * A large circular hour view where each rundown row becomes a pie segment
 * around the rim, painted in its item-type colour. The current row's
 * segment pulses red; completed segments fade. Minute ticks, hour-clock
 * hands and the current minute number live inside.
 *
 * The geometry: rows are laid out CONSECUTIVELY around the dial starting
 * at the 12 o'clock position. Each segment's arc length is proportional
 * to that row's duration. If the total exceeds 60 minutes, the clock is
 * "more than one hour of show" — segments compress to fit; we paint a
 * thin grey ring at 60-minute boundaries so the operator can see the
 * spillover.
 *
 * This is a read-only display. The Run tab is where the operator edits
 * the rundown; the Show Clock is the at-a-glance status view designed to
 * sit on a second monitor or as a permanent corner widget.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRundown, type RundownRow } from '../../rundown/RundownProvider'
import { MYRIAD_COLORS, MYRIAD_LABELS, rundownTypeToMyriad } from '../common/itemTypeColors'

interface Props {
  /** Diameter in px. The dial scales every detail proportionally. */
  size?: number
}

interface Segment {
  row: RundownRow
  startMin: number    // 0..60 — start position on the dial
  endMin: number      // can wrap if total > 60
  isCurrent: boolean
  isDone: boolean
}

function arcPath(cx: number, cy: number, rInner: number, rOuter: number, a0: number, a1: number) {
  const polar = (rad: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const
  }
  const [oxs, oys] = polar(rOuter, a0)
  const [oxe, oye] = polar(rOuter, a1)
  const [ixs, iys] = polar(rInner, a0)
  const [ixe, iye] = polar(rInner, a1)
  const large = (a1 - a0) > 180 ? 1 : 0
  return `M ${oxs} ${oys} A ${rOuter} ${rOuter} 0 ${large} 1 ${oxe} ${oye} L ${ixe} ${iye} A ${rInner} ${rInner} 0 ${large} 0 ${ixs} ${iys} Z`
}

export function ShowClock({ size = 260 }: Props) {
  const r = useRundown()
  // 1Hz heartbeat for the minute/second hands + "current row" pulse.
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  // Segments: each row gets a slice proportional to its duration, packed
  // consecutively from the dial start (12 o'clock).
  const { segments, totalMin, hoursSpanned } = useMemo(() => {
    let acc = 0
    const segs: Segment[] = []
    for (let i = 0; i < r.rows.length; i++) {
      const row = r.rows[i]
      const dMin = Math.max(0.05, row.durationSec / 60)
      const start = acc
      const end = acc + dMin
      segs.push({
        row,
        startMin: start,
        endMin: end,
        isCurrent: r.currentRowIndex === i,
        isDone: r.currentRowIndex != null && i < r.currentRowIndex,
      })
      acc += dMin
    }
    return { segments: segs, totalMin: acc, hoursSpanned: Math.max(1, Math.ceil(acc / 60)) }
  }, [r.rows, r.currentRowIndex])

  // Geometry constants. We scale so the design works at any size, but the
  // numbers below are tuned for 260 px and read fine at 200-360 px.
  const cx = size / 2, cy = size / 2
  const rOuter = size / 2 - 6
  const rSegInner = rOuter - size * 0.16
  const rTickOuter = rSegInner - 4
  const rTickInner = rTickOuter - 5
  const rTickInnerMajor = rTickOuter - 9
  const rHand = rTickInner - 8

  const now = new Date()
  const liveMin = now.getMinutes()
  const liveSec = now.getSeconds()
  const minuteHandAngle = (liveMin + liveSec / 60) / 60 * 360 - 90
  const secondHandAngle = liveSec / 60 * 360 - 90

  // Convert a minute position into an SVG angle. We render the whole
  // rundown around the dial regardless of hour spread (compress >60 min).
  const minuteToAngle = (min: number) => (min / totalMin) * 360 - 90

  const polar = (rad: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {/* Outer disc */}
        <circle cx={cx} cy={cy} r={rOuter} fill="#0a0a14" stroke="#1f2330" strokeWidth={1} />

        {/* Rundown segments around the rim */}
        {totalMin > 0 && segments.map((seg, i) => {
          const a0 = minuteToAngle(seg.startMin)
          const a1 = minuteToAngle(seg.endMin)
          const m = rundownTypeToMyriad(seg.row.type)
          const baseColor = MYRIAD_COLORS[m].hex
          // Done = grey-out, current = full, pending = full-but-slightly-darker.
          const fill = seg.isDone ? '#22252e' : baseColor
          const opacity = seg.isDone ? 0.55 : seg.isCurrent ? 1 : 0.85
          return (
            <path
              key={seg.row.id}
              d={arcPath(cx, cy, rSegInner, rOuter, a0, a1)}
              fill={fill}
              opacity={opacity}
              stroke="#0a0a14" strokeWidth={1}
            >
              <title>{`${(i + 1).toString().padStart(2, '0')} · ${MYRIAD_LABELS[m]} · ${seg.row.title}`}</title>
            </path>
          )
        })}

        {/* Current-row outline pulse — a thin red ring outside the segment band */}
        {segments.find(s => s.isCurrent) && (() => {
          const seg = segments.find(s => s.isCurrent)!
          const a0 = minuteToAngle(seg.startMin)
          const a1 = minuteToAngle(seg.endMin)
          return (
            <path
              d={arcPath(cx, cy, rOuter - 2, rOuter + 2, a0, a1)}
              fill="#e5202b"
              opacity={0.6 + 0.4 * Math.sin(liveSec * Math.PI)}
              stroke="none"
            />
          )
        })()}

        {/* Minute / quarter ticks */}
        {Array.from({ length: 60 }, (_, i) => {
          const angle = (i / 60) * 360 - 90
          const major = i % 15 === 0
          const minor = i % 5 === 0
          const inner = major ? rTickInnerMajor : rTickInner
          const [x1, y1] = polar(rTickOuter, angle)
          const [x2, y2] = polar(inner, angle)
          return (
            <line
              key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={major ? '#cbd5e1' : minor ? '#475569' : '#2e3340'}
              strokeWidth={major ? 1.4 : 0.8}
            />
          )
        })}

        {/* Hour-of-day live minute hand (white) + second hand (red) — shows
            the operator's *real* time relative to the scheduled segments. */}
        {(() => {
          const [hx, hy] = polar(rHand, minuteHandAngle)
          return <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="#ffffff" strokeWidth={1.8} />
        })()}
        {(() => {
          const [hx, hy] = polar(rHand, secondHandAngle)
          return <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="#e5202b" strokeWidth={0.9} opacity={0.85} />
        })()}

        {/* Centre cap + live minute readout */}
        <circle cx={cx} cy={cy} r={size * 0.10} fill="#0a0a14" stroke="#1f2330" strokeWidth={0.8} />
        <text
          x={cx} y={cy + size * 0.035}
          textAnchor="middle"
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontWeight: 700, fontSize: size * 0.10 }}
          fill="#e5e7eb"
        >
          {liveMin.toString().padStart(2, '0')}
        </text>
      </svg>

      {/* Compact summary below */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500 tabular-nums">
        <span>
          <span className="text-slate-700 mr-1 uppercase tracking-wider">Rows</span>
          <span className="text-slate-300 font-bold">{r.rows.length}</span>
        </span>
        <span>
          <span className="text-slate-700 mr-1 uppercase tracking-wider">Total</span>
          <span className="text-slate-300 font-mono font-bold">
            {Math.floor(totalMin / 60).toString().padStart(2, '0')}:
            {Math.floor(totalMin % 60).toString().padStart(2, '0')}
          </span>
        </span>
        {hoursSpanned > 1 && (
          <span className="text-nar-amber" title={`Rundown spans ${hoursSpanned} hours; segments are compressed to fit`}>
            {hoursSpanned}× hour
          </span>
        )}
        {r.currentRowIndex != null && (
          <span>
            <span className="text-slate-700 mr-1 uppercase tracking-wider">Row</span>
            <span className="text-nar-red font-bold">{(r.currentRowIndex + 1).toString().padStart(2, '0')}</span>
            <span className="text-slate-700">/{r.rows.length.toString().padStart(2, '0')}</span>
          </span>
        )}
      </div>
    </div>
  )
}
