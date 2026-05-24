import { ProgramMonitor } from '../components/program/ProgramMonitor'

/**
 * Borderless full-viewport host for the program monitor when shown on a
 * secondary display. Sits inside the same provider tree as Workspace (a
 * fresh renderer process re-mounts everything), so the engine, cameras
 * and audio bus all initialise here independently.
 */
export function PopoutProgram() {
  return (
    <div className="fixed inset-0 bg-black">
      <ProgramMonitor />
    </div>
  )
}
