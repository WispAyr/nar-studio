import { useEffect, useState } from 'react'

/** Operator keyboard shortcuts. Some are wired in EngineProvider /
 *  StudioStates / VizPanel; '?' here just documents the full set. */
const SHORTCUTS: { key: string; label: string; section: string }[] = [
  { section: 'Cut', key: '1 / 2 / 3 / 4', label: 'Cut camera N to program' },
  { section: 'Cut', key: 'V', label: 'Cut visualizer to program' },
  { section: 'Cut', key: 'B', label: 'Cut to broadcast slate / bars' },
  { section: 'Program', key: 'R', label: 'Toggle recording' },
  { section: 'Program', key: 'L', label: 'Toggle live stream' },
  { section: 'Program', key: 'M', label: 'Toggle mute' },
  { section: 'Director', key: 'D', label: 'Toggle AI Director' },
  { section: 'Help', key: '?', label: 'Show / hide this panel' },
  { section: 'Help', key: 'Esc', label: 'Close any panel' },
]

export function KeyboardHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept while the user is typing in an input.
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === '?' && !inField) { setOpen(o => !o); e.preventDefault() }
      else if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null

  // Group by section, preserving declaration order.
  const sections: string[] = []
  for (const s of SHORTCUTS) if (!sections.includes(s.section)) sections.push(s.section)

  return (
    <div
      onClick={() => setOpen(false)}
      className="fixed inset-0 z-50 bg-black/72 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="bg-surface-900 border border-surface-700 rounded-lg p-6 max-w-md w-full shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white">Keyboard Shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-white border border-surface-700 rounded px-2 py-0.5"
          >
            Esc
          </button>
        </div>

        {sections.map(section => (
          <div key={section} className="mb-3 last:mb-0">
            <div className="text-[10px] font-bold uppercase tracking-widest text-nar-amber mb-1.5">{section}</div>
            <table className="w-full">
              <tbody>
                {SHORTCUTS.filter(s => s.section === section).map(s => (
                  <tr key={s.key} className="border-b border-surface-800 last:border-0">
                    <td className="py-1 pr-4 w-32">
                      <span className="text-xs font-mono text-white bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5">
                        {s.key}
                      </span>
                    </td>
                    <td className="py-1 text-xs text-slate-300">{s.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="mt-4 text-[10px] text-slate-600 text-center">
          Press <span className="font-mono text-nar-amber font-bold">?</span> any time to open this
        </div>
      </div>
    </div>
  )
}
