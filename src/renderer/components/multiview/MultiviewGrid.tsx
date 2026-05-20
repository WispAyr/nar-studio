import { CameraPreview } from './CameraPreview'
import { useCameraStreams } from '../../camera/CameraStreamProvider'
import { useEngine } from '../../engine/EngineProvider'
import { useSceneAnalysis } from '../../ai/SceneAnalysisProvider'
import { useCameras } from '../../hooks/useCameras'

interface Props {
  selectedCamera: number
}

export function MultiviewGrid({ selectedCamera }: Props) {
  const { streams, sources } = useCameraStreams()
  const { programCams, cut } = useEngine()
  const { analysis } = useSceneAnalysis()
  const { cameras: hidCameras } = useCameras()

  return (
    <div className="grid grid-cols-2 grid-rows-2 gap-1.5 h-full" style={{ gridAutoRows: '1fr' }}>
      {[0, 1, 2, 3].map(i => {
        const src = sources.find(s => s.index === i)
        return (
          <CameraPreview
            key={i}
            label={`CAM ${i + 1}`}
            stream={streams[i]}
            hasSignal={src?.hasSignal ?? false}
            isProgram={programCams.includes(i)}
            isSelected={selectedCamera === i}
            aiTracking={hidCameras[i]?.aiTracking ?? false}
            peopleCount={analysis[i]?.people ?? 0}
            onCut={() => cut(`cam${i}`)}
          />
        )
      })}
    </div>
  )
}
