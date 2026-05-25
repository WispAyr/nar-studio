/**
 * Central item-type colour map — the visual lingua franca every Myriad
 * operator already reads in 0.1 seconds.
 *
 * The palette mirrors Myriad Playout's standard library colours so an
 * operator switching between Myriad and NAR Studio doesn't have to
 * relearn anything. We use these everywhere a "type" appears:
 *   • Rundown row left-edge stripe + badge
 *   • Cart-wall slot tint
 *   • Brand-card category indicators
 *   • Schedule-banner show-type chip (future)
 *   • Bumper library category badges (future)
 *
 * Item types are intentionally a SHORT vocabulary — every NAR row maps to
 * one of these. Producers familiar with Myriad's full taxonomy will get
 * the same mental model.
 */

export type MyriadItemType =
  | 'music'        // Songs / tracks — blue
  | 'jingle'       // Station idents / linkers — orange
  | 'sweeper'      // Voiced transitions over music — cyan
  | 'voice-track'  // Pre-recorded presenter mic / voicer — violet
  | 'advert'       // Commercials — amber
  | 'sponsor'      // Sponsor mentions — gold
  | 'news'         // News bulletins / breaking — red
  | 'travel'       // Travel + traffic bulletins — yellow
  | 'weather'      // Forecast spots — sky-blue
  | 'show'         // Show-level segments (intro / outro / link) — emerald
  | 'interview'    // Live or pre-recorded interview — magenta
  | 'ad-break'     // Ad-break container (multiple adverts) — slate
  | 'other'        // Catch-all — neutral

/** Display label for the type — already operator-readable, ALL-CAPS. */
export const MYRIAD_LABELS: Record<MyriadItemType, string> = {
  music: 'MUSIC',
  jingle: 'JINGLE',
  sweeper: 'SWEEP',
  'voice-track': 'V/T',
  advert: 'ADVERT',
  sponsor: 'SPONSOR',
  news: 'NEWS',
  travel: 'TRAVEL',
  weather: 'WX',
  show: 'SHOW',
  interview: 'INTV',
  'ad-break': 'BREAK',
  other: '—',
}

/**
 * Full colour record per type. We expose the raw CSS string so non-Tailwind
 * consumers (SVG fills, canvas-2d, inline backgrounds) can use the same
 * palette. Tailwind-side consumers use the matching class names.
 */
export interface ItemTypeStyle {
  /** CSS hex for solid fills (SVG, canvas, inline style). */
  hex: string
  /** Tailwind bg class for the type's accent block. */
  bg: string
  /** Tailwind text class — the legible foreground on `bg`. */
  text: string
  /** Tailwind faded-bg class for chips + tag pills (lower-alpha variant). */
  bgFaded: string
  /** Tailwind text class on `bgFaded` (the slightly desaturated foreground). */
  textOnFaded: string
}

/** The palette. Hexes chosen to match Myriad Playout's defaults closely. */
export const MYRIAD_COLORS: Record<MyriadItemType, ItemTypeStyle> = {
  music:       { hex: '#3b82f6', bg: 'bg-[#3b82f6]', text: 'text-white',   bgFaded: 'bg-[#3b82f6]/20', textOnFaded: 'text-[#93c5fd]' },
  jingle:      { hex: '#f97316', bg: 'bg-[#f97316]', text: 'text-white',   bgFaded: 'bg-[#f97316]/20', textOnFaded: 'text-[#fdba74]' },
  sweeper:     { hex: '#06b6d4', bg: 'bg-[#06b6d4]', text: 'text-white',   bgFaded: 'bg-[#06b6d4]/20', textOnFaded: 'text-[#67e8f9]' },
  'voice-track': { hex: '#8b5cf6', bg: 'bg-[#8b5cf6]', text: 'text-white', bgFaded: 'bg-[#8b5cf6]/20', textOnFaded: 'text-[#c4b5fd]' },
  advert:      { hex: '#f7931e', bg: 'bg-[#f7931e]', text: 'text-black',   bgFaded: 'bg-[#f7931e]/20', textOnFaded: 'text-[#fcd34d]' },
  sponsor:     { hex: '#fbbf24', bg: 'bg-[#fbbf24]', text: 'text-black',   bgFaded: 'bg-[#fbbf24]/20', textOnFaded: 'text-[#fde68a]' },
  news:        { hex: '#e5202b', bg: 'bg-[#e5202b]', text: 'text-white',   bgFaded: 'bg-[#e5202b]/20', textOnFaded: 'text-[#fca5a5]' },
  travel:      { hex: '#facc15', bg: 'bg-[#facc15]', text: 'text-black',   bgFaded: 'bg-[#facc15]/20', textOnFaded: 'text-[#fde047]' },
  weather:     { hex: '#0ea5e9', bg: 'bg-[#0ea5e9]', text: 'text-white',   bgFaded: 'bg-[#0ea5e9]/20', textOnFaded: 'text-[#7dd3fc]' },
  show:        { hex: '#10b981', bg: 'bg-[#10b981]', text: 'text-white',   bgFaded: 'bg-[#10b981]/20', textOnFaded: 'text-[#6ee7b7]' },
  interview:   { hex: '#ec4899', bg: 'bg-[#ec4899]', text: 'text-white',   bgFaded: 'bg-[#ec4899]/20', textOnFaded: 'text-[#f9a8d4]' },
  'ad-break':  { hex: '#64748b', bg: 'bg-[#64748b]', text: 'text-white',   bgFaded: 'bg-[#64748b]/20', textOnFaded: 'text-[#cbd5e1]' },
  other:       { hex: '#475569', bg: 'bg-[#475569]', text: 'text-white',   bgFaded: 'bg-[#475569]/20', textOnFaded: 'text-[#94a3b8]' },
}

/**
 * Map the rundown's own RundownRowType vocabulary onto the Myriad palette.
 * The rundown predates this module so we mirror its types here rather than
 * refactor every callsite — when the rundown grows new types they just
 * fall through to 'other'.
 */
export function rundownTypeToMyriad(
  t: 'intro' | 'music' | 'talk' | 'news' | 'interview' | 'ad-break' | 'sponsor' | 'outro' | 'other'
): MyriadItemType {
  switch (t) {
    case 'music': return 'music'
    case 'news': return 'news'
    case 'interview': return 'interview'
    case 'ad-break': return 'ad-break'
    case 'sponsor': return 'sponsor'
    case 'intro':
    case 'outro': return 'show'
    case 'talk': return 'voice-track'
    default: return 'other'
  }
}
