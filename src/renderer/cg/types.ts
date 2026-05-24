export type CgKind = 'image' | 'video' | 'title'

export type TitleTemplate =
  | 'show-lower-third'
  | 'up-next'
  | 'clock'
  | 'now-playing'
  | 'captions'
  // Full-screen brand takeover cards — fire one for a "be right back" pause,
  // a "stand by" pre-show hold, a "coming up" preview, a "technical
  // difficulty" apology, or an "on-air" show open.
  | 'be-right-back'
  | 'stand-by'
  | 'coming-up'
  | 'technical-difficulty'
  | 'now-on-air'

export interface CgAsset {
  category: string
  name: string
  url: string
  kind: 'image' | 'video'
}

export interface CgLayer {
  id: string
  kind: CgKind
  name: string
  category: string
  url: string
  /** Set when kind === 'title'. */
  template?: TitleTemplate
  opacity: number
  blend: GlobalCompositeOperation
  /** performance.now() when the layer was added — drives the entrance animation. */
  addedAt: number
  /** performance.now() when removal began, else null — drives the exit animation. */
  removingAt: number | null
}
