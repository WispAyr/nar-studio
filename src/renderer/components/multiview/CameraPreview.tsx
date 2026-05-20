import { useEffect, useRef } from 'react'
import type { CameraInfo } from '../../hooks/useCameras'

interface Props {
  camera: CameraInfo
  isProgram: boolean
  isSelected: boolean
  onClick: () => void
  onCut: () => void
  index: number
}

export function CameraPreview({ camera, isProgram, isSelected, onClick, onCut, index }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  // Attach webcam feed when component mounts / camera connects
  useEffect(() => {
    if (!camera.connected || !videoRef.current) return

    let stream: MediaStream | null = null

    navigator.mediaDevices.enumerateDevices().then(devices => {
      const videoDevices = devices.filter(d => d.kind === 'videoinput')
      const device = videoDevices[index]
      if (!device) return

      navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: device.deviceId }, width: 1280, height: 720 },
        audio: false,
      }).then(s => {
        stream = s
        if (videoRef.current) videoRef.current.srcObject = s
      }).catch(console.error)
    })

    return () => {
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [camera.connected, index])

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
      {/* Video feed */}
      {camera.connected ? (
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-surface-800">
          <span className="text-slate-600 text-xs uppercase tracking-wider">No Signal</span>
        </div>
      )}

      {/* Overlay: camera label + status badges */}
      <div className="absolute inset-0 flex flex-col justify-between p-2 pointer-events-none">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold bg-black/60 px-1.5 py-0.5 rounded text-white">
            {camera.label}
          </span>
          <div className="flex gap-1">
            {camera.aiTracking && (
              <span className="text-xs bg-nar-green/80 text-black px-1.5 py-0.5 rounded font-bold">AI</span>
            )}
            {isProgram && (
              <span className="text-xs bg-nar-red text-white px-1.5 py-0.5 rounded font-bold animate-pulse">PGM</span>
            )}
          </div>
        </div>

        {/* Cut button overlay */}
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
