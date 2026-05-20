import { useState, useEffect } from 'react'

export interface OBSState {
  connected: boolean
  streaming: boolean
  recording: boolean
  programScene: string
  scenes: string[]
  streamTimecode: string | null
  recordTimecode: string | null
}

const studio = (window as any).studio

export function useOBS() {
  const [state, setState] = useState<OBSState>({
    connected: false, streaming: false, recording: false,
    programScene: '', scenes: [], streamTimecode: null, recordTimecode: null,
  })

  useEffect(() => {
    studio?.getObsState?.().then((s: OBSState) => { if (s) setState(s) })
    const unsub = studio?.onObsState?.((s: OBSState) => setState(s))
    return () => unsub?.()
  }, [])

  const cutTo = (sceneName: string) => studio?.obsCut?.(sceneName)

  return { ...state, cutTo }
}
