export type EngineId = 'obs' | 'builtin'

export interface EngineSource {
  /** Stable key: 'cam0'..'cam3', later 'ndi:<name>'. */
  key: string
  label: string
  hasSignal: boolean
}
