import type { TransitionType } from '../engine/types'

/**
 * Director styles — named directing personalities. A style bundles both
 * *pacing* (how the decision engine cuts) and *look* (letterbox, transition,
 * whether the director composes shot sizes), so switching style changes how
 * the program feels, not just how fast it cuts.
 */
export interface DirectorStyle {
  id: string
  label: string
  description: string
  // ── pacing ────────────────────────────────────────────────────────────────
  /** Never cut faster than this (ms). */
  minHold: number
  /** Always find a fresh angle by this point (ms). */
  maxHold: number
  /** Speaker confidence (0..1) required before chasing a new speaker. */
  speakerSwitchConfidence: number
  /** A new speaker must hold the lead this long before the director cuts (ms). */
  speakerSwitchHold: number
  /** Insert listener cutaways during long monologues. */
  reactionShots: boolean
  /** Monologue length before a reaction shot is considered (ms). */
  reactionAfter: number
  /** How long a reaction cutaway is held (ms). */
  reactionHold: number
  /** 0..1 — how strongly variety cuts wait for a conversational pause. */
  pauseBias: number
  // ── look ──────────────────────────────────────────────────────────────────
  /** Letterbox matte aspect ratio (e.g. 2.39); 0 = none. */
  letterbox: number
  /** Transition the director uses for its cuts; 'auto' = the global setting. */
  transition: TransitionType | 'auto'
  /** Compose shot sizes by driving camera zoom (close-up on the speaker, etc.). */
  shotComposition: boolean
}

export const DIRECTOR_STYLES: DirectorStyle[] = [
  {
    id: 'conversational',
    label: 'Conversational',
    description: 'Calm and patient — long holds, gentle cuts on clear turns. Best for interviews.',
    minHold: 5000, maxHold: 22000,
    speakerSwitchConfidence: 0.55, speakerSwitchHold: 1100,
    reactionShots: true, reactionAfter: 15000, reactionHold: 2600,
    pauseBias: 0.85,
    letterbox: 0, transition: 'auto', shotComposition: false,
  },
  {
    id: 'dynamic',
    label: 'Dynamic',
    description: 'Energetic chat-show pace — quick cuts on every turn, frequent reactions.',
    minHold: 2600, maxHold: 9000,
    speakerSwitchConfidence: 0.42, speakerSwitchHold: 550,
    reactionShots: true, reactionAfter: 6500, reactionHold: 1700,
    pauseBias: 0.4,
    letterbox: 0, transition: 'auto', shotComposition: false,
  },
  {
    id: 'reactive',
    label: 'Reactive',
    description: 'Tightly chases the conversation — fast onto the speaker, eager reactions.',
    minHold: 2000, maxHold: 11000,
    speakerSwitchConfidence: 0.36, speakerSwitchHold: 420,
    reactionShots: true, reactionAfter: 8000, reactionHold: 1500,
    pauseBias: 0.3,
    letterbox: 0, transition: 'auto', shotComposition: false,
  },
  {
    id: 'observational',
    label: 'Observational',
    description: 'Documentary restraint — very long holds, minimal cutting, lets moments breathe.',
    minHold: 9000, maxHold: 32000,
    speakerSwitchConfidence: 0.66, speakerSwitchHold: 1800,
    reactionShots: false, reactionAfter: 0, reactionHold: 0,
    pauseBias: 0.95,
    letterbox: 0, transition: 'auto', shotComposition: false,
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    description: 'Filmic — slow deliberate cuts that dissolve, a 2.39:1 matte, and close-ups composed on the speaker.',
    minHold: 6500, maxHold: 26000,
    speakerSwitchConfidence: 0.6, speakerSwitchHold: 1400,
    reactionShots: true, reactionAfter: 16000, reactionHold: 3000,
    pauseBias: 0.9,
    letterbox: 2.39, transition: 'fade', shotComposition: true,
  },
  {
    id: 'news',
    label: 'News',
    description: 'Crisp broadcast cutting — fast, decisive hard cuts that follow the speaker. No fluff.',
    minHold: 2400, maxHold: 8000,
    speakerSwitchConfidence: 0.4, speakerSwitchHold: 500,
    reactionShots: false, reactionAfter: 0, reactionHold: 0,
    pauseBias: 0.3,
    letterbox: 0, transition: 'cut', shotComposition: false,
  },
  {
    id: 'interview',
    label: 'Interview',
    description: 'Classic two-person grammar — balanced holds, follows turns cleanly, measured reaction shots.',
    minHold: 4500, maxHold: 15000,
    speakerSwitchConfidence: 0.5, speakerSwitchHold: 850,
    reactionShots: true, reactionAfter: 11000, reactionHold: 2300,
    pauseBias: 0.7,
    letterbox: 0, transition: 'auto', shotComposition: false,
  },
]

export const DEFAULT_STYLE_ID = 'conversational'

export function getStyle(id: string): DirectorStyle {
  return DIRECTOR_STYLES.find(s => s.id === id) ?? DIRECTOR_STYLES[0]
}
