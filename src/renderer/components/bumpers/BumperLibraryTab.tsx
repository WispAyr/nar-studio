import { BumperLibraryPanel } from './BumperLibraryPanel'

/**
 * Sidebar-tab wrapper for the bumper library. The panel itself is the
 * substance; this just gives the host's tab system a flex-friendly box
 * to mount, with the project's standard 8px gutter + scroll-on-overflow.
 */
export function BumperLibraryTab() {
  return (
    <div className="p-2 h-full overflow-auto">
      <BumperLibraryPanel />
    </div>
  )
}
