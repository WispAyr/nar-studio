import { useCallback, useEffect, useRef, useState } from 'react'
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
import { RecognitionProvider } from './ai/RecognitionProvider'
import { AiTrackingProvider } from './ai/AiTrackingProvider'
import { CGProvider } from './cg/CGProvider'
import { CGPanel } from './components/cg/CGPanel'
import { VizProvider } from './viz/VizProvider'
import { VizPanel } from './components/viz/VizPanel'
import { GradeProvider } from './grade/GradeProvider'
import { SegmentationProvider } from './segmentation/SegmentationProvider'
import { ColourView } from './components/colour/ColourView'
import { DirectorProvider } from './ai/DirectorProvider'
import { DirectorPanel } from './components/director/DirectorPanel'
import { StreamDeckProvider } from './streamdeck/StreamDeckProvider'
import { StreamDeckView } from './components/streamdeck/StreamDeckView'
import { StudioView } from './components/studio/StudioView'
import { EngineProvider } from './engine/EngineProvider'
import { KeyboardHelp } from './components/help/KeyboardHelp'
import { ReplayProvider } from './replay/ReplayProvider'
import { ComplianceProvider } from './compliance/ComplianceProvider'
import { BroadcastAudioProvider } from './audio/BroadcastAudioProvider'
import { OscBridgeProvider } from './external/OscBridge'
import { UnrealLauncherProvider } from './external/UnrealLauncher'
import { ToastProvider } from './toast/ToastProvider'
import { CommandRegistryProvider } from './commands/CommandRegistry'
import { CommandPalette } from './commands/CommandPalette'
import { DefaultCommands } from './commands/DefaultCommands'
import { HealthMonitorProvider } from './health/HealthMonitorProvider'
import { CartWallProvider } from './cartwall/CartWallProvider'
import { CartWallBroadcastBridge } from './cartwall/CartWallBroadcastBridge'
import { BumperLibraryProvider } from './bumpers/BumperLibraryProvider'
import { ScheduledFiresProvider } from './schedules/ScheduledFiresProvider'
import { RundownProvider } from './rundown/RundownProvider'
import { RundownTab } from './components/rundown/RundownTab'
import { NowNextStack } from './components/rundown/NowNextStack'
import { ShowsProvider } from './shows/ShowsProvider'
import { ShowsPanel } from './components/shows/ShowsPanel'
import { MyriadBridgeProvider } from './myriad/MyriadBridgeProvider'
import { MyriadActionBinder } from './myriad/MyriadActionBinder'
import { PopoutHost } from './popout/PopoutHost'
import { SidebarMenu } from './components/layout/SidebarMenu'
import { Splitter, usePersistedSize } from './components/layout/Splitter'

type RightTab = 'router' | 'stream' | 'recording' | 'cg' | 'viz' | 'director' | 'rundown' | 'shows'
type View = 'switcher' | 'colour' | 'streamdeck' | 'studio'

export default function App() {
  return (
    <CameraStreamProvider>
      <SceneAnalysisProvider>
        <RecognitionProvider>
          <BroadcastAudioProvider>
          <VizProvider>
            <CGProvider>
              <GradeProvider>
                <SegmentationProvider>
                  <EngineProvider>
                    <DirectorProvider>
                      {/* AiTracking sits below EngineProvider so it can see which
                          cameras are live and pause tracking on them. */}
                      <AiTrackingProvider>
                        <StreamDeckProvider>
                          <ReplayProvider>
                            <ComplianceProvider>
                              <OscBridgeProvider>
                                <UnrealLauncherProvider>
                                  <HealthMonitorProvider>
                                    <CartWallProvider>
                                      <BumperLibraryProvider>
                                        <ScheduledFiresProvider>
                                          <RundownProvider>
                                            <ShowsProvider>
                                            <MyriadBridgeProvider>
                                            <ToastProvider>
                                              <CommandRegistryProvider>
                                                <PopoutHost>
                                                  <CartWallBroadcastBridge />
                                                  <MyriadActionBinder />
                                                  <DefaultCommands />
                                                  <Workspace />
                                                  <KeyboardHelp />
                                                  <CommandPalette />
                                                </PopoutHost>
                                              </CommandRegistryProvider>
                                            </ToastProvider>
                                            </MyriadBridgeProvider>
                                            </ShowsProvider>
                                          </RundownProvider>
                                        </ScheduledFiresProvider>
                                      </BumperLibraryProvider>
                                    </CartWallProvider>
                                  </HealthMonitorProvider>
                                </UnrealLauncherProvider>
                              </OscBridgeProvider>
                            </ComplianceProvider>
                          </ReplayProvider>
                        </StreamDeckProvider>
                      </AiTrackingProvider>
                    </DirectorProvider>
                  </EngineProvider>
                </SegmentationProvider>
              </GradeProvider>
            </CGProvider>
          </VizProvider>
          </BroadcastAudioProvider>
        </RecognitionProvider>
      </SceneAnalysisProvider>
    </CameraStreamProvider>
  )
}

// Top-level view switch. The provider tree stays mounted across views, so
// opening the Colour grading workspace never interrupts a live program.
function Workspace() {
  const [view, setView] = useState<View>('switcher')
  if (view === 'colour') return <ColourView onExit={() => setView('switcher')} />
  if (view === 'streamdeck') return <StreamDeckView onExit={() => setView('switcher')} />
  if (view === 'studio') return <StudioView onExit={() => setView('switcher')} />
  return (
    <AppInner
      onOpenColour={() => setView('colour')}
      onOpenStreamDeck={() => setView('streamdeck')}
      onOpenStudio={() => setView('studio')}
    />
  )
}

function AppInner({ onOpenColour, onOpenStreamDeck, onOpenStudio }: {
  onOpenColour: () => void
  onOpenStreamDeck: () => void
  onOpenStudio: () => void
}) {
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

      {/* Main area — resizable splits so the operator can give a panel more
          room when they need it. Sidebar width + program/multiview split
          both persist to localStorage. */}
      <ResizableMain selectedCamera={selectedCamera}>
        <SidebarBody
          onOpenColour={onOpenColour}
          onOpenStreamDeck={onOpenStreamDeck}
          onOpenStudio={onOpenStudio}
          selectedCamera={selectedCamera}
          setSelectedCamera={setSelectedCamera}
          rightTab={rightTab}
          setRightTab={setRightTab}
        />
      </ResizableMain>

      {/* Bottom status bar */}
      <StatusBar />
    </div>
  )
}

/**
 * Two-axis resizable main area:
 *   horizontal splitter: sidebar width (default 288px, range 240-560)
 *   vertical splitter:   program monitor / multiview split (default 60% of left height)
 *
 * The right sidebar grows when the operator drags the vertical handle
 * LEFT; we use `flex-row-reverse` so the sidebar is the first child and
 * its width is the value Splitter controls directly. The left content
 * fills the remainder.
 */
function ResizableMain({ selectedCamera, children }: {
  selectedCamera: number
  children: React.ReactNode
}) {
  const [sidebarPx, setSidebarPx] = usePersistedSize('nar-sidebar-w', 288, 240, 560)
  // Drag-LEFT should GROW the sidebar (it's on the right). The Splitter
  // reports `size + delta`; since "size" we pass is the sidebar width,
  // the delta as captured (xMove - xDown) is opposite the desired
  // direction — so we negate it via a small wrapper.
  const [, setLastReported] = useState(sidebarPx)
  const onSidebarSize = useCallback((rawNext: number) => {
    // The wrapper assumes positive delta = sidebar grows. The Splitter
    // sends `startSize + (clientX - startX)`. We want `startSize - (clientX - startX)`
    // because dragging LEFT (negative delta) should grow the sidebar.
    // Easiest fix: invert around startSize. We don't know startSize, so
    // we instead compute the delta-from-current and apply it inverted.
    // setLastReported keeps the last value to derive a delta.
    setLastReported(prev => {
      const delta = rawNext - prev
      const next = Math.max(240, Math.min(560, sidebarPx - delta))
      setSidebarPx(next)
      return rawNext
    })
  }, [sidebarPx, setSidebarPx])

  return (
    <div className="flex flex-1 min-h-0 gap-1 p-1">
      <LeftMainColumn selectedCamera={selectedCamera} />
      <Splitter
        axis="v"
        size={sidebarPx}
        min={240} max={560} defaultSize={288}
        onSize={onSidebarSize}
      />
      <div className="flex flex-col gap-1 shrink-0" style={{ width: `${sidebarPx}px` }}>
        {children}
      </div>
    </div>
  )
}

/** Left main column with a draggable horizontal splitter between
 *  program monitor and multiview. */
function LeftMainColumn({ selectedCamera }: { selectedCamera: number }) {
  const [pgmPx, setPgmPx] = usePersistedSize('nar-pgm-h', 0, 0, 9999)
  const containerRef = useRef<HTMLDivElement>(null)
  // Defer to flex-3/flex-2 until the operator drags. Once they drag, the
  // pgm height is locked to pixels and the multiview takes the remainder.
  const usePixel = pgmPx > 0
  return (
    <div ref={containerRef} className="flex-1 min-w-0 flex flex-col gap-1">
      <div
        className={usePixel ? 'min-h-0' : 'flex-[3] min-h-0'}
        style={usePixel ? { height: `${pgmPx}px`, flex: 'none' } : undefined}
      >
        <ProgramMonitor />
      </div>
      <Splitter
        axis="h"
        size={pgmPx}
        min={120} max={1600} defaultSize={0}
        onSize={(n) => setPgmPx(n)}
      />
      <div className={usePixel ? 'flex-1 min-h-0' : 'flex-[2] min-h-0'}>
        <MultiviewGrid selectedCamera={selectedCamera} />
      </div>
    </div>
  )
}

/** The contents of the right sidebar — extracted so the resizable wrapper
 *  doesn't need to know about its internals. */
function SidebarBody({
  onOpenColour, onOpenStreamDeck, onOpenStudio,
  selectedCamera, setSelectedCamera,
  rightTab, setRightTab,
}: {
  onOpenColour: () => void
  onOpenStreamDeck: () => void
  onOpenStudio: () => void
  selectedCamera: number
  setSelectedCamera: (i: number) => void
  rightTab: RightTab
  setRightTab: (t: RightTab) => void
}) {
  const [camOpen, setCamOpen] = useState<boolean>(() => localStorage.getItem('nar-cam-card-open') !== 'off')
  const toggleCam = useCallback(() => {
    const next = !camOpen
    setCamOpen(next)
    try { localStorage.setItem('nar-cam-card-open', next ? 'on' : 'off') } catch { /* ignore */ }
  }, [camOpen])

  return (
    <>
      {/* Compact ≡ menu — workspaces, pop-outs, factory reset */}
      <SidebarMenu
        onOpenColour={onOpenColour}
        onOpenStreamDeck={onOpenStreamDeck}
        onOpenStudio={onOpenStudio}
      />

      {/* Camera controls — collapses to header on chevron click so the
          tab body + Now/Next + studio states get the full sidebar height
          when the operator isn't flying a camera. */}
      <div
        className={`bg-surface-900 rounded border border-surface-700 shrink-0 overflow-hidden`}
        style={{ height: camOpen ? 440 : 36 }}
      >
        <button
          onClick={toggleCam}
          className="w-full flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-surface-700 hover:bg-surface-800 transition-colors"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-nar-red shrink-0" />
          <span className="text-xs font-bold text-slate-300">CAM {selectedCamera + 1}</span>
          <div className="flex gap-1 ml-auto" onClick={e => e.stopPropagation()}>
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
          <span className="text-[10px] text-slate-600 ml-1">{camOpen ? '▴' : '▾'}</span>
        </button>
        {camOpen && (
          <div className="h-[calc(100%-37px)]">
            <CameraControls index={selectedCamera} />
          </div>
        )}
      </div>

      {/* Now / Next stack — Myriad-style live playout deck */}
      <NowNextStack />

      {/* Global studio states */}
      <StudioStates />

      {/* Tabbed lower panel — Production / I/O grouped 2-row grid */}
      <div className="flex-1 bg-surface-900 rounded border border-surface-700 flex flex-col min-h-0">
        <SidebarTabs tab={rightTab} onChange={setRightTab} />
      </div>
    </>
  )
}

/**
 * Two-row tabbed strip for the right sidebar.
 *
 * Row 1 — Production: the operator's per-show workspace.
 * Row 2 — Input/Output: routing, broadcasting, recording, AI direction.
 *
 * Each tab is a compact pill with a single-glyph icon + short label, so the
 * whole grid fits inside a 288px-wide column without truncating. The active
 * tab gets a brand-red underline and white text; idle tabs are slate-500.
 */
function SidebarTabs({ tab, onChange }: { tab: RightTab; onChange: (t: RightTab) => void }) {
  const PRODUCTION: { id: RightTab; label: string; icon: string; hint: string }[] = [
    { id: 'shows', label: 'Shows', icon: '★', hint: 'Show definitions + global stream' },
    { id: 'rundown', label: 'Run', icon: '▶', hint: 'Script-driven transport' },
    { id: 'cg', label: 'CG', icon: 'T', hint: 'Titles + brand cards' },
    { id: 'viz', label: 'Viz', icon: '◐', hint: 'Visualizer modes' },
  ]
  const IO: { id: RightTab; label: string; icon: string; hint: string }[] = [
    { id: 'router', label: 'Route', icon: '⇄', hint: 'Source routing' },
    { id: 'stream', label: 'Live', icon: '●', hint: 'Go live · simulcast · health' },
    { id: 'recording', label: 'Rec', icon: '◉', hint: 'Recording + replay' },
    { id: 'director', label: 'Direct', icon: '◇', hint: 'AI auto-cut' },
  ]

  const renderTab = (t: { id: RightTab; label: string; icon: string; hint: string }) => {
    const active = tab === t.id
    return (
      <button
        key={t.id}
        onClick={() => onChange(t.id)}
        title={t.hint}
        className={`flex-1 flex items-center justify-center gap-1 px-1 py-1.5 transition-colors border-b ${
          active
            ? 'text-white border-nar-red bg-surface-800/60'
            : 'text-slate-500 hover:text-slate-200 border-transparent'
        }`}
      >
        <span className={`text-[11px] ${active ? 'text-nar-red' : 'text-slate-600'}`}>{t.icon}</span>
        <span className="text-[11px] font-bold uppercase tracking-wider">{t.label}</span>
      </button>
    )
  }

  return (
    <>
      <div className="shrink-0">
        <div className="px-2 pt-1 text-[9px] text-slate-700 uppercase tracking-wider">Production</div>
        <div className="flex">{PRODUCTION.map(renderTab)}</div>
        <div className="px-2 pt-1 text-[9px] text-slate-700 uppercase tracking-wider border-t border-surface-800">I / O</div>
        <div className="flex">{IO.map(renderTab)}</div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <SidebarTabBody tab={tab} />
      </div>
    </>
  )
}

/** Renderer for the active sidebar tab's body. Kept separate from
 *  SidebarTabs so the conditional cascade stays in one place — adding a new
 *  tab is one entry in the registry array + one branch here. */
function SidebarTabBody({ tab }: { tab: RightTab }) {
  if (tab === 'shows') return <ShowsPanel />
  if (tab === 'rundown') return <RundownTab />
  if (tab === 'router') return <VideoRouter />
  if (tab === 'stream') return <StreamPanel />
  if (tab === 'recording') return <RecordingPanel />
  if (tab === 'cg') return <CGPanel />
  if (tab === 'viz') return <VizPanel />
  if (tab === 'director') return <DirectorPanel />
  return null
}
