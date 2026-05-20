import { useState, useEffect } from 'react'
import { ScheduleBanner } from './components/schedule/ScheduleBanner'
import { AudioPanel } from './components/audio/AudioPanel'
import { ProgramMonitor } from './components/program/ProgramMonitor'
import { MultiviewGrid } from './components/multiview/MultiviewGrid'
import { CameraControls } from './components/cameras/CameraControls'
import { RecordingPanel } from './components/recording/RecordingPanel'
import { StreamPanel } from './components/stream/StreamPanel'
import { VideoRouter } from './components/router/VideoRouter'
import { StatusBar } from './components/layout/StatusBar'
import { StudioStates } from './components/states/StudioStates'
import { CameraStreamProvider } from './camera/CameraStreamProvider'
import { SceneAnalysisProvider } from './ai/SceneAnalysisProvider'
import { CGProvider } from './cg/CGProvider'
import { CGPanel } from './components/cg/CGPanel'
import { EngineProvider } from './engine/EngineProvider'

type RightTab = 'router' | 'stream' | 'recording' | 'cg'

export default function App() {
  return (
    <CameraStreamProvider>
      <SceneAnalysisProvider>
        <CGProvider>
          <EngineProvider>
            <AppInner />
          </EngineProvider>
        </CGProvider>
      </SceneAnalysisProvider>
    </CameraStreamProvider>
  )
}

function AppInner() {
  const [selectedCamera, setSelectedCamera] = useState(() => {
    const v = Number(localStorage.getItem('nar-selected-camera'))
    return v >= 0 && v <= 3 ? v : 0
  })
  const [rightTab, setRightTab] = useState<RightTab>(
    () => (localStorage.getItem('nar-right-tab') as RightTab) || 'router'
  )

  useEffect(() => { localStorage.setItem('nar-selected-camera', String(selectedCamera)) }, [selectedCamera])
  useEffect(() => { localStorage.setItem('nar-right-tab', rightTab) }, [rightTab])

  return (
    <div className="flex flex-col h-screen bg-surface-950 overflow-hidden">
      {/* Top: NAR schedule banner */}
      <ScheduleBanner />

      {/* Audio strip — studio desk feed, not camera mics */}
      <AudioPanel />

      {/* Main area */}
      <div className="flex flex-1 min-h-0 gap-1 p-1">

        {/* Left: program monitor + 2×2 multiview */}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex-[3] min-h-0">
            <ProgramMonitor />
          </div>
          <div className="flex-[2] min-h-0">
            <MultiviewGrid selectedCamera={selectedCamera} />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-72 flex flex-col gap-1 shrink-0">

          {/* Camera controls for selected camera */}
          <div className="bg-surface-900 rounded border border-surface-700 shrink-0" style={{ height: '440px' }}>
            <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-surface-700">
              <div className="w-1.5 h-1.5 rounded-full bg-nar-red" />
              <span className="text-xs font-bold text-slate-300">CAM {selectedCamera + 1}</span>
              {/* Camera selector tabs */}
              <div className="flex gap-1 ml-auto">
                {[0, 1, 2, 3].map(i => (
                  <button
                    key={i}
                    onClick={() => setSelectedCamera(i)}
                    className={`text-xs w-6 py-0.5 rounded transition-colors ${
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
            <div className="h-[calc(100%-37px)]">
              <CameraControls index={selectedCamera} />
            </div>
          </div>

          {/* Global studio states — recall all camera positions at once */}
          <StudioStates />

          {/* Tabbed lower panel: Router / Stream / Recording */}
          <div className="flex-1 bg-surface-900 rounded border border-surface-700 flex flex-col min-h-0">
            <div className="flex border-b border-surface-700 shrink-0">
              {([
                { id: 'router', label: 'Router' },
                { id: 'stream', label: 'Stream' },
                { id: 'recording', label: 'Record' },
                { id: 'cg', label: 'CG' },
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
              {rightTab === 'cg' && <CGPanel />}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom status bar */}
      <StatusBar />
    </div>
  )
}
