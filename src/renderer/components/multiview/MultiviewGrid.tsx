import { CameraPreview } from './CameraPreview'
import { useCameraStreams } from '../../camera/CameraStreamProvider'
import { useEngine } from '../../engine/EngineProvider'
import { useAiTracking } from '../../ai/AiTrackingProvider'

interface Props {
  selectedCamera: number
}

export function MultiviewGrid({ selectedCamera }: Props) {
  const { streams, sources } = useCameraStreams()
  const { programCams, cut } = useEngine()
  const { tracking } = useAiTracking()

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1.5 h-full" style={{ gridAutoRows: '1fr' }}>
      {[0, 1, 2, 3].map(i => {
        const src = sources.find(s => s.index === i)
        return (
          <CameraPreview
            key={i}
            label={`CAM ${i + 1}`}
            cameraIndex={i}
            stream={streams[i]}
            hasSignal={src?.hasSignal ?? false}
            isProgram={programCams.includes(i)}
            isSelected={selectedCamera === i}
            aiTracking={tracking[i]}
            onCut={() => cut(`cam${i}`)}
          />
        )
      })}
    </div>
  )
}
