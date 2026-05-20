import { useEffect, useRef } from 'react'

interface Props {
  label: string
  stream: MediaStream | null
  hasSignal: boolean
  isProgram: boolean
  isSelected: boolean
  aiTracking?: boolean
  onClick: () => void
  onCut: () => void
}

export function CameraPreview({ label, stream, hasSignal, isProgram, isSelected, aiTracking, onClick, onCut }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const el = videoRef.current
    if (el && el.srcObject !== stream) el.srcObject = stream
  }, [stream])

  const borderClass = isProgram
    ? 'border-2 border-nar-red recording-border'
    : isSelected
    ? 'border-2 border-nar-blue'
    : 'border border-surface-600 hover:border-surface-500'

  return (
    <div
      className={`relative bg-surface-900 rounded overflow-hidden cursor-pointer transition-all ${borderClass} cam-preview`}
      onClick={onClick}
    >
      {hasSignal && stream ? (
        <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-contain bg-black" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-800">
          <span className="text-slate-600 text-xs uppercase tracking-wider">No Signal</span>
        </div>
      )}

      <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold bg-black/60 px-1.5 py-0.5 rounded text-white">{label}</span>
          <div className="flex gap-1">
            {aiTracking && (
              <span className="text-xs bg-nar-green/80 text-black px-1.5 py-0.5 rounded font-bold">AI</span>
            )}
            {isProgram && (
              <span className="text-xs bg-nar-red text-white px-1.5 py-0.5 rounded font-bold animate-pulse">PGM</span>
            )}
          </div>
        </div>

        <div className="cam-overlay flex justify-center pb-1 pointer-events-auto">
          <button
            onClick={e => { e.stopPropagation(); onCut() }}
            className="text-xs bg-nar-red hover:bg-red-600 text-white px-3 py-1 rounded font-bold uppercase tracking-wider transition-colors"
          >
            CUT
          </button>
        </div>
      </div>
    </div>
  )
}
