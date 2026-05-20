import { useState } from 'react'
import { useStudioStates } from '../../hooks/useStudioStates'

export function StudioStates() {
  const { states, saveState, recallState, deleteState } = useStudioStates()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [editMode, setEditMode] = useState(false)

  const commit = () => {
    const n = name.trim()
    if (n) saveState(n)
    setName('')
    setAdding(false)
  }

  return (
    <div className="bg-surface-900 rounded border border-surface-700 shrink-0">
      <div className="flex items-center gap-2 px-3 pt-2 pb-1.5 border-b border-surface-700">
        <div className="w-1.5 h-1.5 rounded-full bg-nar-blue" />
        <span className="text-xs font-bold text-slate-300">GLOBAL STATES</span>
        <div className="flex gap-1 ml-auto">
          {states.length > 0 && (
            <button
              onClick={() => setEditMode(e => !e)}
              className={`text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider transition-colors ${
                editMode ? 'bg-nar-amber text-black' : 'bg-surface-700 text-slate-400 hover:text-white'
              }`}
            >
              {editMode ? 'Done' : 'Edit'}
            </button>
          )}
          <button
            onClick={() => { setAdding(true); setEditMode(false) }}
            className="text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-surface-700 text-slate-400 hover:text-white transition-colors"
          >
            + Save
          </button>
        </div>
      </div>

      <div className="p-2 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
        {states.length === 0 && !adding && (
          <span className="text-xs text-slate-600 py-1 leading-relaxed">
            No states saved. Frame up every camera, then Save to recall the whole studio in one click.
          </span>
        )}

        {states.map(s => (
          <button
            key={s.id}
            onClick={() => (editMode ? deleteState(s.id) : recallState(s.id))}
            title={editMode ? `Delete "${s.name}"` : `Recall "${s.name}" — move all cameras`}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors ${
              editMode
                ? 'bg-nar-red/20 text-nar-red border border-nar-red/40 hover:bg-nar-red hover:text-white'
                : 'bg-surface-700 text-slate-200 hover:bg-nar-blue hover:text-white'
            }`}
          >
            {editMode && '✕ '}{s.name}
          </button>
        ))}

        {adding && (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setName(''); setAdding(false) }
            }}
            onBlur={commit}
            placeholder="State name…"
            className="text-xs px-2 py-1.5 rounded bg-surface-800 border border-nar-blue text-white outline-none w-32"
          />
        )}
      </div>
    </div>
  )
}
