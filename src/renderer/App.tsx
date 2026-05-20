import { useState } from 'react'
import { ScheduleBanner } from './components/schedule/ScheduleBanner'
import { AudioPanel } from './components/audio/AudioPanel'
import { MultiviewGrid } from './components/multiview/MultiviewGrid'
import { CameraControls } from './components/cameras/CameraControls'
import { RecordingPanel } from './components/recording/RecordingPanel'
import { StreamPanel } from './components/stream/StreamPanel'
import { VideoRouter } from './components/router/VideoRouter'
import { StatusBar } from './components/layout/StatusBar'
import { useCameras } from './hooks/useCameras'

type RightTab = 'router' | 'stream' | 'recording'

export default function App() {
  const [selectedCamera, setSelectedCamera] = useState(0)
  const [rightTab, setRightTab] = useState<RightTab>('router')
  const { cameras } = useCameras()

  // Always have a camera object — use placeholder if HID not yet connected
  const PLACEHOLDER = {
    index: selectedCamera, path: '', serialNumber: '',
    label: `Camera ${selectedCamera + 1}`, connected: false,
    aiTracking: false, currentPreset: null,
  }
  const selectedCam = cameras[selectedCamera] ?? PLACEHOLDER

  return (
    <div className="flex flex-col h-screen bg-surface-950 overflow-hidden">
      {/* Top: NAR schedule banner */}
      <ScheduleBanner />

      {/* Audio strip — studio desk feed, not camera mics */}
      <AudioPanel />

      {/* Main area */}
      <div className="flex flex-1 min-h-0 gap-1 p-1">

        {/* Left: 2×2 multiview */}
        <div className="flex-1 min-w-0">
          <MultiviewGrid
            selectedCamera={selectedCamera}
            onSelectCamera={setSelectedCamera}
          />
        </div>

        {/* Right sidebar */}
        <div className="w-72 flex flex-col gap-1 shrink-0">

          {/* Camera controls for selected camera */}
          <div className="bg-surface-900 rounded border border-surface-700 shrink-0" style={{ height: '260px' }}>
            <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-b border-surface-700">
              <div className="w-1.5 h-1.5 rounded-full bg-nar-red" />
              <span className="text-xs font-bold text-slate-300">
                {cameras[selectedCamera]?.label ?? `Camera ${selectedCamera + 1}`}
              </span>
              {/* Camera selector tabs */}
              <div className="flex gap-0.5 ml-auto">
                {[0, 1, 2, 3].map(i => (
                  <button
                    key={i}
                    onClick={() => setSelectedCamera(i)}
                    className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                      selectedCamera === i
                        ? 'bg-nar-red text-white'
                        : 'bg-surface-700 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[calc(100%-32px)]">
              <CameraControls camera={selectedCam} index={selectedCamera} />
            </div>
          </div>

          {/* Tabbed lower panel: Router / Stream / Recording */}
          <div className="flex-1 bg-surface-900 rounded border border-surface-700 flex flex-col min-h-0">
            <div className="flex border-b border-surface-700 shrink-0">
              {([
                { id: 'router', label: 'Router' },
                { id: 'stream', label: 'Stream' },
                { id: 'recording', label: 'Record' },
              ] as { id: RightTab; label: string }[]).map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setRightTab(tab.id)}
                  className={`flex-1 text-xs py-1.5 transition-colors ${
                    rightTab === tab.id
                      ? 'text-white border-b border-nar-red'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              {rightTab === 'router' && <VideoRouter />}
              {rightTab === 'stream' && <StreamPanel />}
              {rightTab === 'recording' && <RecordingPanel />}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <StatusBar />
    </div>
  )
}
