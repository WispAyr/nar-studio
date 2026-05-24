import { RundownPanel } from './RundownPanel'

/**
 * Sidebar tab wrapper for the rundown — fills the available height so the
 * scrolling row list inside RundownPanel gets a constrained container.
 */
export function RundownTab() {
  return (
    <div className="h-full flex flex-col">
      <RundownPanel />
    </div>
  )
}
