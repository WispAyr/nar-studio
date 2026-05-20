import { useCG, TITLE_TEMPLATES } from '../../cg/CGProvider'
import { useEngine } from '../../engine/EngineProvider'

const BLENDS: { value: GlobalCompositeOperation; label: string }[] = [
  { value: 'source-over', label: 'Normal' },
  { value: 'screen', label: 'Screen' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'lighter', label: 'Add' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'difference', label: 'Difference' },
]

// Categories that play full-screen as a program takeover rather than overlay.
const ROLL_CATEGORIES = ['bumpers', 'ad-breaks']

export function CGPanel() {
  const cg = useCG()
  const engine = useEngine()

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 uppercase tracking-wider">CG / Overlays</span>
        <button onClick={() => cg.openFolder()} className="text-xs text-slate-500 hover:text-slate-300">
          Open folder
        </button>
      </div>

      {/* Bumper / ad-break taking over the program */}
      {engine.bumper && (
        <div className="flex items-center gap-2 p-2 rounded bg-nar-red/20 border border-nar-red/40">
          <span className="text-xs font-bold text-nar-red shrink-0">▶ ON AIR</span>
          <span className="text-xs text-white truncate flex-1">{engine.bumper.label}</span>
          <button onClick={engine.stopBumper} className="text-xs text-slate-300 hover:text-white shrink-0">
            Stop
          </button>
        </div>
      )}

      {/* Active overlay layers */}
      {cg.layers.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-nar-red uppercase tracking-wider">On Air · {cg.layers.length}</span>
          {cg.layers.map(layer => (
            <div key={layer.id} className="flex flex-col gap-1 p-2 rounded bg-surface-800 border border-surface-700">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-white truncate flex-1">{layer.name}</span>
                <button
                  onClick={() => cg.raiseLayer(layer.id)}
                  title="Bring forward"
                  className="text-xs text-slate-500 hover:text-white px-1"
                >
                  ↑
                </button>
                <button
                  onClick={() => cg.removeLayer(layer.id)}
                  title="Remove"
                  className="text-xs text-slate-500 hover:text-nar-red px-1"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="range" min={0} max={100} value={Math.round(layer.opacity * 100)}
                  onChange={e => cg.setOpacity(layer.id, Number(e.target.value) / 100)}
                  className="flex-1 accent-nar-blue"
                />
                <select
                  value={layer.blend}
                  onChange={e => cg.setBlend(layer.id, e.target.value as GlobalCompositeOperation)}
                  className="bg-surface-700 border border-surface-600 rounded text-xs text-slate-300 outline-none px-1"
                >
                  {BLENDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Auto-populated titles — fed live from the siphon schedule */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Titles · auto</span>
        <div className="grid grid-cols-2 gap-1">
          {TITLE_TEMPLATES.map(t => {
            const active = cg.layers.some(l => l.kind === 'title' && l.template === t.template)
            return (
              <button
                key={t.template}
                onClick={() => cg.toggleTitle(t.template)}
                className={`text-xs px-2 py-1.5 rounded truncate text-left transition-colors ${
                  active
                    ? 'bg-nar-red text-white'
                    : 'bg-surface-800 text-slate-400 hover:text-white hover:bg-surface-700'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Asset library, by category */}
      {Object.entries(cg.assets).map(([category, items]) => {
        const isRoll = ROLL_CATEGORIES.includes(category)
        return (
          <div key={category} className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600 uppercase tracking-wider">{category.replace(/-/g, ' ')}</span>
              <button
                onClick={() => cg.openFolder(category)}
                title={`Open the ${category} folder`}
                className="text-xs text-slate-600 hover:text-slate-300"
              >
                + files
              </button>
            </div>
            {items.length === 0 ? (
              <span className="text-xs text-slate-700">empty — drop files in</span>
            ) : (
              <div className="grid grid-cols-2 gap-1">
                {items.map(asset => {
                  const active = isRoll
                    ? engine.bumper?.label === asset.name
                    : cg.layers.some(l => l.category === asset.category && l.name === asset.name)
                  return (
                    <button
                      key={asset.name}
                      onClick={() => isRoll
                        ? engine.rollBumper(asset.url, asset.name)
                        : cg.toggleLayer(asset)}
                      title={isRoll ? `Roll ${asset.name} to air` : asset.name}
                      className={`text-xs px-2 py-1.5 rounded truncate text-left transition-colors ${
                        active
                          ? 'bg-nar-red text-white'
                          : 'bg-surface-800 text-slate-400 hover:text-white hover:bg-surface-700'
                      }`}
                    >
                      {asset.kind === 'video' ? '▶ ' : ''}{asset.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
