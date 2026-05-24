/**
 * Per-show + global-stream data model.
 *
 * Two tiers:
 *   • NarShow — a named production configuration recalled when that show goes
 *     on-air. Owns its presenter, viz defaults, layout, sponsor list, rundown,
 *     and asset bindings.
 *   • GlobalStreamConfig — station-wide, always-on configuration that the
 *     stream falls back to when no show is current (sustaining) and that
 *     overlays show config for behaviours that should never be overridden by
 *     a show (top-of-hour station ID, station ident, etc).
 *
 * The shape intentionally mirrors Myriad Playout's show/clock data model so a
 * future bridge (when MM_TRIGGER fires "advert X", play matching video Y) is
 * a binding layer, not a refactor. The fields below noted as `Myriad: …`
 * match the equivalent Myriad concept by name.
 *
 *   NarShow.id            ←→ Myriad Show / Program ID (string for now)
 *   NarShow.name          ←→ Myriad Show Title
 *   NarShow.presenter     ←→ Myriad Show Presenter field
 *   NarShow.startTime     ←→ Myriad Schedule Start
 *   NarSponsor.name       ←→ Myriad Sponsor / Advertiser
 *   ScheduledFire         ←→ Myriad Clock event (minute-of-hour trigger)
 *   MyriadEvent           ←→ MM_TRIGGER UDP payload (see docs/myriad-integration.md)
 */

import type { TitleTemplate } from '../cg/types'
import type { LayoutType } from '../engine/types'
import type { RundownAction } from '../rundown/RundownProvider'

// ── Show production defaults ─────────────────────────────────────────────────

/** Sponsor entry within a show — the show can rotate through several. */
export interface NarSponsor {
  id: string
  name: string
  tagline?: string
  /** Stable across sessions even when name changes — used by future Myriad sync. */
  myriadId?: string
}

/** Rundown row as stored inside a NarShow definition. Mirrors the runtime
 *  RundownRow without runtime fields (no `status`, no `currentStartedAt`). */
export interface NarShowRundownRow {
  id: string
  type: 'intro' | 'music' | 'talk' | 'news' | 'interview' | 'ad-break' | 'sponsor' | 'outro' | 'other'
  title: string
  durationSec: number
  notes?: string
  actions: RundownAction[]
}

/** A named production configuration. The operator's "Drive Time" show is a
 *  NarShow; so is "Weekend Breakfast". They're saved, edited, and recalled
 *  by reference. */
export interface NarShow {
  /** Stable id (UUID-ish). Survives renames. */
  id: string
  /** Operator-facing label, also used for schedule auto-binding by name. */
  name: string
  /** Presenter name shown in lower-thirds + the Now-On-Air card. */
  presenter: string
  /** Optional Twitter/Instagram handle for end-of-show CGs. */
  social?: string
  /** Free-text producer notes; not shown on-air. */
  description?: string

  // Schedule binding — optional. When set, the show auto-binds to a matching
  // entry in the siphon schedule by name; the operator can also bind manually.
  /** "17:00" (24h). Documentation only — auto-detect uses the schedule API. */
  startTime?: string
  durationMinutes?: number
  /** Days of week the show airs (0 = Sun … 6 = Sat). Empty = doesn't recur. */
  dayOfWeek?: number[]

  // Production defaults — applied when the show becomes current.
  defaultVizMode?: number
  defaultVizPalette?: number
  defaultLayout?: LayoutType
  /** Per-show accent colour for the CG eyebrow, overrides brand red→orange when set. */
  accentColor?: string
  /** Set ON when this show starts: lower-third (named presenter), now-playing, clock, etc. */
  defaultTitleTemplates?: TitleTemplate[]

  // Show-local content libraries — references into the global cart / bumper /
  // sponsor lists. Empty = inherit everything from global.
  sponsorIds?: string[]
  cartIds?: string[]
  bumperIds?: string[]

  // Rundown owned by this show. When the operator selects the show, this
  // becomes the active rundown. Empty = blank rundown.
  rundown?: NarShowRundownRow[]

  // Myriad mirror — empty for now; populated when a bridge is wired up.
  /** Myriad Show / Program ID — populated by the bridge sync. */
  myriadShowId?: string
}

// ── Global stream configuration ──────────────────────────────────────────────

/** Always-on, station-wide configuration. Sustaining and ident behaviours
 *  live here so they survive show changes. */
export interface GlobalStreamConfig {
  /** Station name — overrides showName when no show is on. */
  stationName: string
  /** Default presenter shown when no show context (e.g. overnight sustaining). */
  defaultPresenter: string

  /** Viz mode to display when no show is on-air (sustaining). */
  sustainingVizMode: number
  /** Audio compressor preset used by default. Operator's per-show choice overrides. */
  defaultCompressorPreset?: 'off' | 'voice' | 'music' | 'loud'

  /** Auto-fire a station-ident card at the top of every hour. */
  topOfHourIdentEnabled: boolean
  /** Which card to fire at xx:00 — typically 'now-on-air' or 'be-right-back'. */
  topOfHourTemplate: TitleTemplate
  /** Hold the top-of-hour card for this long (seconds) then drop. */
  topOfHourHoldSeconds: number
}

/** Reasonable defaults — used as the initial GlobalStreamConfig until the
 *  operator changes anything. */
export const DEFAULT_GLOBAL_STREAM: GlobalStreamConfig = {
  stationName: 'Now Ayrshire Radio',
  defaultPresenter: '',
  sustainingVizMode: 34,        // Brand Backdrop — calm audio-reactive bg
  defaultCompressorPreset: 'music',
  topOfHourIdentEnabled: false,
  topOfHourTemplate: 'now-on-air',
  topOfHourHoldSeconds: 8,
}

// ── Myriad bridge protocol ───────────────────────────────────────────────────

/**
 * Event payload shape used by the future Myriad bridge. The UDP listener in
 * main parses MM_TRIGGER packets into one of these shapes and broadcasts to
 * the renderer. Today this is documented + stubbed; the actual binding from
 * `event → NAR action` is in `applyMyriadEvent`.
 *
 * Myriad's MM_TRIGGER macro sends arbitrary UDP strings to a host:port. We
 * adopt a simple JSON envelope so the operator can configure their Myriad
 * triggers without us shipping a parser per Myriad version:
 *
 *   {"event":"advert-start","name":"AYR CARPETS","duration":30}
 *   {"event":"show-start","name":"DRIVE TIME","presenter":"Sarah"}
 *   {"event":"news-start","duration":180}
 *   {"event":"item-start","name":"Top Of The World","artist":"Carpenters","duration":222}
 *
 * If the operator's Myriad version can only send raw text, the bridge also
 * accepts `NAME=value` lines and infers `event` from a name-prefix mapping
 * (configurable). See docs/myriad-integration.md.
 */
export interface MyriadEvent {
  /** Event kind. Mirrors Myriad's item types loosely. */
  event:
    | 'show-start'
    | 'show-end'
    | 'advert-start'
    | 'advert-end'
    | 'news-start'
    | 'news-end'
    | 'item-start'      // a track / jingle / sweeper starting
    | 'item-end'
    | 'cart-fire'       // hot-cart fired from Myriad's cart wall
  /** Item / show / advertiser name. */
  name?: string
  /** Item duration in seconds, if known. */
  duration?: number
  /** Presenter name (for show events). */
  presenter?: string
  /** Artist (for item events). */
  artist?: string
  /** Myriad's item ID, if exposed. */
  myriadId?: string
  /** Original raw text payload, for debugging. */
  raw?: string
}
