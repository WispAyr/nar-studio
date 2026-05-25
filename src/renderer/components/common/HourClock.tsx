import { useEffect, useState } from 'react'

/**
 * Compact circular hour-clock dial — the signature Myriad Playout visual.
 *
 * 60 tick marks around the rim (one per minute), heavier marks at the
 * quarter-hours. A filled arc sweeps from 12 o'clock through the current
 * minute showing how deep into the hour we are. The current minute number
 * lives at the centre.
 *
 * Optional `events` prop lets the parent paint coloured dots on the rim at
 * specific minute positions — that's how Myriad shows "news at :00",
 * "travel at :15", "ad-break at :40". Each dot is filled with the standard
 * MyriadItemType colour so the operator's eye reads the hour shape without
 * a legend.
 */
export interface HourClockEvent {
  minuteOfHour: number   // 0..59
  color: string          // CSS hex
  label?: string         // tooltip on hover
}

interface Props {
  size?: number              // diameter in px. Default 36.
  events?: HourClockEvent[]
  /** Show the current minute number at the centre. Default true. */
  showCentre?: boolean
  /** Show a thin tick that ticks every second. Default true. */
  showSecondHand?: boolean
}

export function HourClock({ size = 36, events = [], showCentre = true, showSecondHand = true }: Props) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Tick every 200ms — smooth enough for the second hand without burning
    // a per-frame timer. Re-renders are cheap (single SVG).
    const id = window.setInterval(() => setNow(new Date()), 200)
    return () => window.clearInterval(id)
  }, [])

  const m = now.getMinutes()
  const s = now.getSeconds()
  const r = size / 2
  const cx = r, cy = r
  const rOuter = r - 1
  const rTick = rOuter - 1
  const rTickInner = rTick - (size >= 60 ? 4 : 3)
  const rTickInnerMajor = rTick - (size >= 60 ? 6 : 4)
  const rEvent = rTickInner - 2
  const rArcInner = rEvent - 2
  // Convert minute (0..59) to SVG angle. 0 = 12 o'clock (straight up),
  // increasing clockwise. SVG angle 0 is at 3 o'clock so we subtract 90°.
  const minuteToAngle = (mins: number) => (mins / 60) * 360 - 90
  const polar = (angleDeg: number, rad: number) => {
    const a = (angleDeg * Math.PI) / 180
    return [cx + Math.cos(a) * rad, cy + Math.sin(a) * rad] as const
  }

  // Filled-arc path from 12 o'clock to the current minute. SVG arcs require
  // the large-arc flag when the sweep is >180°, so we compute it explicitly.
  const startAngle = -90
  const endAngle = minuteToAngle(m + s / 60)
  const [sx, sy] = polar(startAngle, rArcInner)
  const [ex, ey] = polar(endAngle, rArcInner)
  const largeArc = (endAngle - startAngle) > 180 ? 1 : 0
  const arcPath = `M ${cx} ${cy} L ${sx} ${sy} A ${rArcInner} ${rArcInner} 0 ${largeArc} 1 ${ex} ${ey} Z`

  return (
    <svg
      width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`Minute ${m} of the hour`}
    >
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={rOuter} fill="#0a0a14" stroke="#1f2330" strokeWidth={1} />

      {/* Filled arc — minute progress. Amber on rim so it reads as "elapsed". */}
      <path d={arcPath} fill="#f7931e" opacity={0.22} />

      {/* 60 tick marks */}
      {Array.from({ length: 60 }, (_, i) => {
        const angle = minuteToAngle(i)
        const major = i % 15 === 0
        const minor = i % 5 === 0
        const inner = major ? rTickInnerMajor : rTickInner
        const [x1, y1] = polar(angle, rTick)
        const [x2, y2] = polar(angle, inner)
        return (
          <line
            key={i} x1={x1} y1={y1} x2={x2} y2={y2}
            stroke={major ? '#cbd5e1' : minor ? '#475569' : '#2e3340'}
            strokeWidth={major ? 1.2 : 0.7}
          />
        )
      })}

      {/* Event markers — dots at scheduled minutes */}
      {events.map((ev, i) => {
        const angle = minuteToAngle(ev.minuteOfHour)
        const [x, y] = polar(angle, rEvent)
        return <circle key={i} cx={x} cy={y} r={1.5} fill={ev.color}>
          {ev.label && <title>{ev.label}</title>}
        </circle>
      })}

      {/* Second hand — single thin line from centre toward the current second */}
      {showSecondHand && (() => {
        const [hx, hy] = polar(minuteToAngle(s), rTickInner - 1)
        return <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="#e5202b" strokeWidth={0.8} opacity={0.85} />
      })()}

      {/* Minute hand — heavier, runs to the current minute */}
      {(() => {
        const [hx, hy] = polar(minuteToAngle(m + s / 60), rTickInner - 1)
        return <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="#ffffff" strokeWidth={1.5} />
      })()}

      {/* Centre cap + minute number */}
      {showCentre && (
        <>
          <circle cx={cx} cy={cy} r={size >= 60 ? 9 : 6} fill="#0a0a14" stroke="#1f2330" strokeWidth={0.6} />
          <text
            x={cx} y={cy + (size >= 60 ? 3.5 : 2.5)}
            textAnchor="middle"
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontWeight: 700,
              fontSize: size >= 60 ? 11 : 7.5,
            }}
            fill="#e5e7eb"
          >
            {m.toString().padStart(2, '0')}
          </text>
        </>
      )}
    </svg>
  )
}
