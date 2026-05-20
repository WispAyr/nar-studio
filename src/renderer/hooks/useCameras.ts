import { useState, useEffect } from 'react'

export interface CameraInfo {
  index: number
  path: string
  serialNumber: string
  label: string
  connected: boolean
  aiTracking: boolean
  currentPreset: number | null
}

const studio = (window as any).studio

export function useCameras() {
  const [cameras, setCameras] = useState<CameraInfo[]>([])

  useEffect(() => {
    studio?.listCameras?.().then((c: CameraInfo[]) => { if (c) setCameras(c) })
    const unsub = studio?.onCamerasUpdate?.((c: CameraInfo[]) => setCameras(c))
    return () => unsub?.()
  }, [])

  return { cameras }
}
