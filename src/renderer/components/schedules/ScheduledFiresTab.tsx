import { ScheduledFiresPanel } from './ScheduledFiresPanel'

/**
 * Tiny wrapper around ScheduledFiresPanel — gives the right-sidebar a
 * consistent padded/scrollable surface to drop the panel into without
 * the panel itself caring about its host's layout.
 */
export function ScheduledFiresTab() {
  return (
    <div className="p-2 h-full overflow-auto">
      <ScheduledFiresPanel />
    </div>
  )
}
