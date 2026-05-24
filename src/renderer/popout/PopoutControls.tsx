/**
 * Small toolbar for spawning / closing multi-monitor popouts. Not mounted
 * automatically — drop `<PopoutControls />` anywhere in the workspace
 * sidebar where the operator can reach it. The buttons are deliberately
 * compact so this strip can sit alongside the workspace shortcuts.
 */
const studio = (window as any).studio as {
  popoutOpen: (view: string) => Promise<unknown>
  popoutCloseAll: () => Promise<unknown>
  popoutList: () => Promise<unknown>
}

export default function PopoutControls() {
  const openProgram = () => { void studio.popoutOpen('program') }
  const openMultiview = () => { void studio.popoutOpen('multiview') }
  const closeAll = () => { void studio.popoutCloseAll() }

  return (
    <div className="flex gap-1">
      <button
        type="button"
        onClick={openProgram}
        title="Open the program monitor on a secondary display"
        className="text-[10px] py-1 px-2 rounded bg-surface-800 hover:bg-surface-700 border border-surface-700 text-slate-300 hover:text-white font-bold uppercase tracking-wider transition-colors"
      >
        PGM Popout
      </button>
      <button
        type="button"
        onClick={openMultiview}
        title="Open the 2×2 multiview on a secondary display"
        className="text-[10px] py-1 px-2 rounded bg-surface-800 hover:bg-surface-700 border border-surface-700 text-slate-300 hover:text-white font-bold uppercase tracking-wider transition-colors"
      >
        Multiview Popout
      </button>
      <button
        type="button"
        onClick={closeAll}
        title="Close every popout window"
        className="text-[10px] py-1 px-2 rounded bg-surface-800 hover:bg-surface-700 border border-surface-700 text-slate-400 hover:text-white font-bold uppercase tracking-wider transition-colors"
      >
        Close Popouts
      </button>
    </div>
  )
}
