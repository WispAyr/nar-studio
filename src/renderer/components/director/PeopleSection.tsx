import { useState } from 'react'
import { useRecognition, COVERAGE_RECENT_MS } from '../../ai/RecognitionProvider'

/**
 * People panel — the identities face recognition has discovered this session,
 * with live per-person camera coverage. Names are editable; tapping two colour
 * dots merges duplicate entries of the same person.
 */
export function PeopleSection() {
  const { ready, identities, coverage, rename, merge, remove } = useRecognition()
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const now = Date.now()
  const covById = new Map(coverage.map(c => [c.identityId, c.cameras]))
  const offCount = identities.filter(p => {
    const cams = covById.get(p.id) ?? []
    return cams.length === 0 && now - p.lastSeen < COVERAGE_RECENT_MS
  }).length

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-600 uppercase tracking-wider">People in studio</span>
        <span className="text-[10px] text-slate-500 tabular-nums">{identities.length}</span>
      </div>

      {!ready && <span className="text-[10px] text-slate-600">Recognition starting…</span>}
      {ready && identities.length === 0 && (
        <span className="text-[10px] text-slate-600">No faces recognised yet.</span>
      )}

      {offCount > 0 && (
        <div className="flex items-center gap-1.5 rounded bg-nar-red/15 border border-nar-red/40 px-2 py-1">
          <span className="text-[10px] font-bold text-nar-red">
            ⚠ {offCount} {offCount === 1 ? 'person' : 'people'} off camera
          </span>
        </div>
      )}

      {identities.map(p => {
        const cams = covById.get(p.id) ?? []
        const offCamera = cams.length === 0 && now - p.lastSeen < COVERAGE_RECENT_MS
        const isSource = mergeSource === p.id
        return (
          <div
            key={p.id}
            className={`flex flex-col gap-1 rounded px-1.5 py-1 ${
              isSource ? 'bg-surface-700 ring-1 ring-nar-amber/50' : 'bg-surface-800'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setMergeSource(isSource ? null : p.id)}
                title={isSource ? 'Cancel merge' : 'Merge this person into another'}
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: p.color }}
              />
              {mergeSource && !isSource ? (
                <button
                  onClick={() => { merge(mergeSource, p.id); setMergeSource(null) }}
                  className="flex-1 min-w-0 text-left text-[11px] text-nar-amber truncate"
                >
                  ← merge into {p.name}
                </button>
              ) : (
                <input
                  value={p.name}
                  onChange={e => rename(p.id, e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-200 outline-none focus:text-white"
                />
              )}
              <span className="text-[10px] text-slate-600 tabular-nums shrink-0">{p.count}</span>
              <button
                onClick={() => remove(p.id)}
                className="text-slate-600 hover:text-nar-red text-sm leading-none shrink-0 px-0.5"
                title="Remove this person"
              >
                ×
              </button>
            </div>

            {/* Coverage — which cameras currently frame this person. */}
            <div className="flex items-center gap-1 pl-[18px]">
              {[0, 1, 2, 3].map(c => (
                <span
                  key={c}
                  className={`text-[9px] font-bold px-1 rounded ${
                    cams.includes(c)
                      ? 'bg-nar-green/25 text-nar-green'
                      : 'bg-surface-900 text-slate-700'
                  }`}
                >
                  {c + 1}
                </span>
              ))}
              {offCamera ? (
                <span className="text-[9px] font-bold text-nar-red ml-1">⚠ OFF CAMERA</span>
              ) : cams.length > 0 ? (
                <span className="text-[9px] text-slate-600 ml-1">
                  on {cams.length} {cams.length === 1 ? 'camera' : 'cameras'}
                </span>
              ) : (
                <span className="text-[9px] text-slate-700 ml-1">not in studio</span>
              )}
            </div>
          </div>
        )
      })}

      {identities.length > 1 && (
        <span className="text-[10px] text-slate-700">
          Tap a colour dot, then another, to merge two entries of the same person.
        </span>
      )}
    </div>
  )
}
