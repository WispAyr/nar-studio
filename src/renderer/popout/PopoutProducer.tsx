import { NowNextStack } from '../components/rundown/NowNextStack'
import { ShowClock } from '../components/rundown/ShowClock'

/**
 * Producer pop-out — a borderless full-window view designed for the
 * producer / director station: the Show Clock on top so the operator
 * can see the hour at a glance, and the Now/Next stack underneath
 * showing what's firing now and what's queued.
 *
 * Renders inside the main provider tree on each pop-out window, so it
 * reads the same rundown + scheduled-fires state the main window does
 * (each window is a separate React tree but the provider state derives
 * from the same localStorage keys + main-side IPC).
 */
export function PopoutProducer() {
  return (
    <div className="fixed inset-0 bg-surface-950 flex flex-col p-6 gap-6 overflow-hidden">
      <div className="flex items-center justify-center">
        <ShowClock size={420} />
      </div>
      <div className="flex-1 min-h-0 max-w-3xl mx-auto w-full">
        <NowNextStack header={null} />
      </div>
    </div>
  )
}
