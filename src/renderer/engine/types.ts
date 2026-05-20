export type EngineId = 'obs' | 'builtin'

export type TransitionType = 'cut' | 'fade' | 'dip'

export type LayoutType = 'solo' | 'split' | 'pip'

export const SLOT_COUNT: Record<LayoutType, number> = { solo: 1, split: 2, pip: 2 }

export interface EngineSource {
  /** Stable key: 'cam0'..'cam3', later 'ndi:<name>'. */
  key: string
  label: string
  hasSignal: boolean
}
