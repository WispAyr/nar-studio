import { useDirector } from '../../ai/DirectorProvider'
import { DIRECTOR_STYLES } from '../../ai/directorStyles'
import { PeopleSection } from './PeopleSection'

/**
 * AI Director control panel — on/off, directing style, and a live readout of
 * what the director sees (per-camera speaking scores) and what it is doing.
 */
export function DirectorPanel() {
  const { enabled, setEnabled, styleId, setStyleId, status } = useDirector()

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">AI Director</span>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`text-xs px-2 py-0.5 rounded transition-colors font-bold ${
            enabled
              ? 'bg-nar-green/20 text-nar-green border border-nar-green/30'
              : 'bg-surface-700 text-slate-500'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Live readout — speaking scores + current action */}
      <div className="flex flex-col gap-1.5 rounded bg-surface-800 border border-surface-700 p-2">
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${enabled ? 'bg-nar-green animate-pulse' : 'bg-surface-600'}`} />
          <span className="text-xs text-slate-300 truncate">
            {enabled ? status.action : 'Director is off'}
          </span>
        </div>
        {[0, 1, 2, 3].map(i => {
          const score = status.scores[i] ?? 0
          const isSpeaker = status.speaker === i
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 w-10 shrink-0">CAM {i + 1}</span>
              <div className="flex-1 h-1.5 bg-surface-900 rounded overflow-hidden">
                <div
                  className="h-full rounded transition-[width] duration-150"
                  style={{
                    width: `${Math.round(score * 100)}%`,
                    background: isSpeaker ? '#22c55e' : '#3b82f6',
                  }}
                />
              </div>
              <span className={`text-[10px] font-bold w-7 text-right ${isSpeaker ? 'text-nar-green' : 'text-slate-700'}`}>
                {isSpeaker ? 'SPK' : ''}
              </span>
            </div>
          )
        })}
      </div>

      {/* Directing style */}
      <span className="text-xs text-slate-600 uppercase tracking-wider mt-1">Directing style</span>
      <div className="flex flex-col gap-1">
        {DIRECTOR_STYLES.map(s => (
          <button
            key={s.id}
            onClick={() => setStyleId(s.id)}
            className={`text-left p-2 rounded border transition-colors ${
              styleId === s.id
                ? 'bg-surface-700 border-nar-blue/60'
                : 'bg-surface-800 border-transparent hover:bg-surface-700'
            }`}
          >
            <span className={`text-xs font-bold ${styleId === s.id ? 'text-white' : 'text-slate-300'}`}>
              {s.label}
            </span>
            <span className="text-[10px] text-slate-500 block leading-snug mt-0.5">
              {s.description}
            </span>
          </button>
        ))}
      </div>

      <div className="border-t border-surface-700 pt-2 mt-1">
        <PeopleSection />
      </div>

      <span className="text-[10px] text-slate-700 mt-1">
        The director follows whoever is speaking using audio-visual analysis.
        A manual cut always overrides it; tracking keeps off-air shots framed.
      </span>
    </div>
  )
}
