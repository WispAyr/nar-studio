import { useState } from 'react'
import { CameraPreview } from './CameraPreview'
import { useCameras } from '../../hooks/useCameras'
import { useOBS } from '../../hooks/useOBS'

const SCENE_MAP = ['CAM1', 'CAM2', 'CAM3', 'CAM4']

// Placeholder cameras when no HID devices are connected
const PLACEHOLDER_CAMERAS = [0, 1, 2, 3].map(i => ({
  index: i,
  path: '',
  serialNumber: '',
  label: `Camera ${i + 1}`,
  connected: false,
  aiTracking: false,
  currentPreset: null,
}))

interface Props {
  selectedCamera: number
  onSelectCamera: (index: number) => void
}

export function MultiviewGrid({ selectedCamera, onSelectCamera }: Props) {
  const { cameras: hidCameras } = useCameras()
  const { programScene, cutTo } = useOBS()

  const cameras = PLACEHOLDER_CAMERAS.map((placeholder, i) =>
    hidCameras[i] ?? placeholder
  )

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1.5 p-1.5 h-full" style={{ gridAutoRows: '1fr' }}>
      {cameras.map((cam, i) => (
        <CameraPreview
          key={i}
          index={i}
          camera={cam}
          isProgram={programScene === SCENE_MAP[i]}
          isSelected={selectedCamera === i}
          onClick={() => onSelectCamera(i)}
          onCut={() => cutTo(SCENE_MAP[i])}
        />
      ))}
    </div>
  )
}
