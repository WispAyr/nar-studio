import { useState } from 'react'
import { useRundown } from '../../rundown/RundownProvider'
import { RundownPanel } from './RundownPanel'
import { ShowClock } from './ShowClock'

/**
 * Sidebar tab wrapper for the rundown. Houses two views:
 *   • List — the Myriad-style row editor (default)
 *   • Clock — the Show Clock visualisation (rundown rows as pie segments)
 *
 * The clock toggle lives at the top so the operator can flick between
 * "what should I do next" (list) and "what does this hour look like" (clock).
 */
export function RundownTab() {
  const [view, setView] = useState<'list' | 'clock'>('list')
  const r = useRundown()
  return (
    <div className="h-full flex flex-col">
      {/* View toggle — only meaningful when there's a rundown to visualise */}
      {r.rows.length > 0 && (
        <div className="flex items-center justify-center gap-1 px-2 py-1.5 border-b border-surface-800 shrink-0">
          <button
            onClick={() => setView('list')}
            className={`text-[10px] py-1 px-3 rounded font-bold uppercase tracking-wider transition-colors ${
              view === 'list' ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
            }`}
          >
            ▤ List
          </button>
          <button
            onClick={() => setView('clock')}
            className={`text-[10px] py-1 px-3 rounded font-bold uppercase tracking-wider transition-colors ${
              view === 'clock' ? 'bg-nar-blue text-white' : 'bg-surface-800 text-slate-400 hover:text-white'
            }`}
          >
            ◐ Clock
          </button>
        </div>
      )}
      {view === 'list' || r.rows.length === 0 ? (
        <RundownPanel />
      ) : (
        <div className="flex-1 overflow-auto p-3 flex items-start justify-center">
          <ShowClock size={260} />
        </div>
      )}
    </div>
  )
}
