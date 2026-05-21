import { useEffect, useRef } from 'react'
import { AiOverlay } from '../../ai/AiOverlay'

interface Props {
  label: string
  cameraIndex: number
  stream: MediaStream | null
  hasSignal: boolean
  isProgram: boolean
  isSelected: boolean
  aiTracking?: boolean
  onCut: () => void
}

export function CameraPreview({ label, cameraIndex, stream, hasSignal, isProgram, isSelected, aiTracking, onCut }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (el && el.srcObject !== stream) el.srcObject = stream
  }, [stream])

  const borderClass = isProgram
    ? 'border-2 border-nar-red recording-border'
    : isSelected
    ? 'border-2 border-nar-blue hover:border-nar-red'
    : 'border border-surface-600 hover:border-nar-red'

  return (
    <div
      className={`group relative bg-surface-900 rounded overflow-hidden cursor-pointer transition-all ${borderClass}`}
      onClick={onCut}
      title={isProgram ? `${label} — on air` : `Cut ${label} to air`}
    >
      {hasSignal && stream ? (
        <>
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain bg-black" />
          <AiOverlay index={cameraIndex} />
        </>
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-800">
          <span className="text-slate-600 text-xs uppercase tracking-wider">No Signal</span>
        </div>
      )}

      {/* The whole tile cuts to air on click — show the intent on hover */}
      {!isProgram && (
        <div className="absolute inset-0 flex items-center justify-center bg-nar-red/0 group-hover:bg-nar-red/20 transition-colors pointer-events-none">
          <span className="text-sm font-bold uppercase tracking-widest text-white bg-nar-red px-3 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
            Cut
          </span>
        </div>
      )}

      <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold bg-black/60 px-1.5 py-0.5 rounded text-white">{label}</span>
          <div className="flex gap-1">
            {aiTracking && (
              <span className="text-xs bg-nar-green/80 text-black px-1.5 py-0.5 rounded font-bold">AI TRACK</span>
            )}
            {isProgram && (
              <span className="text-xs bg-nar-red text-white px-1.5 py-0.5 rounded font-bold animate-pulse">PGM</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
