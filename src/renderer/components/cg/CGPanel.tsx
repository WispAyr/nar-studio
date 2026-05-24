import { useCG, TITLE_TEMPLATES } from '../../cg/CGProvider'
import { BumperLibraryPanel } from '../bumpers/BumperLibraryPanel'
import { ScheduledFiresPanel } from '../schedules/ScheduledFiresPanel'
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

      {/* Auto-populated overlays — sit on top of the program picture */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Titles · auto</span>
        <div className="grid grid-cols-2 gap-1">
          {TITLE_TEMPLATES.filter(t => t.group !== 'takeover').map(t => {
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

      {/* Full-screen brand takeover cards — break stings, hold cards, show
          opens. Fire one to replace the program output, click again to drop. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600 uppercase tracking-wider">
          Brand Cards · full-screen
        </span>
        <div className="grid grid-cols-2 gap-1">
          {TITLE_TEMPLATES.filter(t => t.group === 'takeover').map(t => {
            const active = cg.layers.some(l => l.kind === 'title' && l.template === t.template)
            return (
              <button
                key={t.template}
                onClick={() => cg.toggleTitle(t.template)}
                title={`Full-screen NAR-branded ${t.label.toLowerCase()} card`}
                className={`relative text-xs px-2 py-1.5 rounded truncate text-left transition-colors overflow-hidden ${
                  active
                    ? 'bg-gradient-to-r from-nar-amber to-nar-red text-white shadow-md'
                    : 'bg-surface-800 text-slate-300 hover:text-white hover:bg-surface-700 border border-surface-700'
                }`}
              >
                <span className={`absolute left-0 top-0 bottom-0 w-1 ${active ? 'bg-white/80' : 'bg-nar-amber'}`} />
                <span className="ml-2">{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Sponsor text — drives the Sponsor takeover card */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Sponsor · text</span>
        <input
          type="text"
          placeholder="Sponsor name (e.g. AYR FARM SHOP)"
          value={cg.sponsorName}
          onChange={e => cg.setSponsor(e.target.value, cg.sponsorTagline)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
        <input
          type="text"
          placeholder="Tagline (optional, e.g. Local. Fresh. Every day.)"
          value={cg.sponsorTagline}
          onChange={e => cg.setSponsor(cg.sponsorName, e.target.value)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
      </div>

      {/* News text — drives the News takeover card */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 uppercase tracking-wider">News · text</span>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer">
            <input
              type="checkbox" checked={cg.newsBreaking}
              onChange={e => cg.setNews({ breaking: e.target.checked })}
              className="accent-nar-red"
            />
            <span className={cg.newsBreaking ? 'text-nar-red font-bold uppercase tracking-wider' : ''}>BREAKING</span>
          </label>
        </div>
        <input
          type="text"
          placeholder="Headline"
          value={cg.newsHeadline}
          onChange={e => cg.setNews({ headline: e.target.value })}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-red/60"
        />
        <div className="grid grid-cols-[1fr_auto] gap-1">
          <input
            type="text"
            placeholder="Source (e.g. BBC News, Sky)"
            value={cg.newsSource}
            onChange={e => cg.setNews({ source: e.target.value })}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-red/60"
          />
          <button
            onClick={() => cg.toggleTitle('news-banner')}
            className={`text-[10px] py-1 px-2 rounded font-bold uppercase tracking-wider transition-colors ${
              cg.layers.some(l => l.kind === 'title' && l.template === 'news-banner')
                ? 'bg-nar-red text-white'
                : 'bg-surface-800 text-slate-400 hover:text-white border border-surface-700'
            }`}
          >
            On Air
          </button>
        </div>
        <input
          type="text"
          placeholder="Ticker text (optional — scrolls along the bottom)"
          value={cg.newsTicker}
          onChange={e => cg.setNews({ ticker: e.target.value })}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-nar-red/60"
        />
      </div>

      {/* Travel text — drives the Travel takeover card */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 uppercase tracking-wider">Travel · text</span>
          <div className="flex gap-1">
            {(['info', 'warning', 'alert'] as const).map(s => (
              <button
                key={s}
                onClick={() => cg.setTravel({ severity: s })}
                className={`text-[10px] py-0.5 px-1.5 rounded font-bold uppercase tracking-wider transition-colors ${
                  cg.travelSeverity === s
                    ? s === 'alert' ? 'bg-nar-red text-white'
                      : s === 'warning' ? 'bg-nar-amber text-white'
                      : 'bg-nar-green text-white'
                    : 'bg-surface-800 text-slate-500 hover:text-slate-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[100px_1fr_auto] gap-1">
          <input
            type="text"
            placeholder="A77"
            value={cg.travelRoute}
            onChange={e => cg.setTravel({ route: e.target.value })}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs font-mono font-bold text-slate-200 outline-none focus:border-nar-amber/60"
          />
          <input
            type="text"
            placeholder="Status (e.g. Long delays northbound near Symington)"
            value={cg.travelStatus}
            onChange={e => cg.setTravel({ status: e.target.value })}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-amber/60"
          />
          <button
            onClick={() => cg.toggleTitle('travel-banner')}
            className={`text-[10px] py-1 px-2 rounded font-bold uppercase tracking-wider transition-colors ${
              cg.layers.some(l => l.kind === 'title' && l.template === 'travel-banner')
                ? 'bg-nar-amber text-white'
                : 'bg-surface-800 text-slate-400 hover:text-white border border-surface-700'
            }`}
          >
            On Air
          </button>
        </div>
      </div>

      {/* Now Playing inputs — drive the Now Playing title template */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Now Playing · text</span>
        <input
          type="text"
          placeholder="Track title"
          value={cg.nowPlaying.track}
          onChange={e => cg.setNowPlaying(e.target.value, cg.nowPlaying.artist)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
        <input
          type="text"
          placeholder="Artist"
          value={cg.nowPlaying.artist}
          onChange={e => cg.setNowPlaying(cg.nowPlaying.track, e.target.value)}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-nar-blue/60"
        />
        <input
          type="url"
          placeholder="Auto-poll URL (Icecast / custom JSON / Artist - Track text)"
          value={cg.nowPlayingUrl}
          onChange={e => cg.setNowPlayingUrl(e.target.value)}
          title="Optional — points at a station endpoint that returns track metadata. Polled every 10s. Empty for manual entry."
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[10px] text-slate-300 outline-none focus:border-nar-blue/60"
        />
        {cg.nowPlayingUrl && (
          <span className="text-[10px] text-slate-600 italic">Auto-polling every 10s</span>
        )}
      </div>

      {/* Live captions — Web Speech recognition feeding the Captions title */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-slate-600 uppercase tracking-wider">Captions · live ASR</span>
        <button
          onClick={() => cg.setCaptionsOn(!cg.captionsOn)}
          disabled={!cg.captionsSupported}
          title={
            cg.captionsSupported
              ? 'Toggle live Web Speech captions. Add the "Captions" title to show them on air.'
              : 'Speech recognition is not available in this build'
          }
          className={`text-xs px-2 py-1.5 rounded font-bold uppercase tracking-wider transition-colors ${
            !cg.captionsSupported
              ? 'bg-surface-800 text-slate-700 cursor-not-allowed'
              : cg.captionsOn
              ? 'bg-nar-red text-white animate-pulse'
              : 'bg-surface-800 text-slate-400 hover:text-white hover:bg-surface-700'
          }`}
        >
          {!cg.captionsSupported ? 'Captions · unsupported' : cg.captionsOn ? '● Captions LIVE' : 'Captions · OFF'}
        </button>
        {cg.captionsOn && (
          <div className="text-[10px] text-slate-500 italic truncate" title={cg.captionText}>
            {cg.captionText ? `“${cg.captionText.slice(-80)}”` : 'listening…'}
          </div>
        )}
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

      {/* Bumper library — fire .mp4/.webm stings through the existing engine
          bumper path (full-screen takeover video, returns to program when done). */}
      <details className="rounded border border-surface-800 bg-surface-900/50 group">
        <summary className="px-2 py-1.5 text-xs text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 select-none flex items-center justify-between">
          <span>Bumper Library · video stings</span>
          <span className="text-[10px] text-slate-700 group-open:hidden">▾</span>
          <span className="text-[10px] text-slate-700 hidden group-open:inline">▴</span>
        </summary>
        <div className="border-t border-surface-800">
          <BumperLibraryPanel />
        </div>
      </details>

      {/* Scheduled auto-fires — cron-style rules that toggle takeover cards
          at minute-of-hour marks (e.g. sponsor at xx:15, BRB at xx:55). */}
      <details className="rounded border border-surface-800 bg-surface-900/50 group">
        <summary className="px-2 py-1.5 text-xs text-slate-500 uppercase tracking-wider cursor-pointer hover:text-slate-300 select-none flex items-center justify-between">
          <span>Scheduled Auto-Fires</span>
          <span className="text-[10px] text-slate-700 group-open:hidden">▾</span>
          <span className="text-[10px] text-slate-700 hidden group-open:inline">▴</span>
        </summary>
        <div className="border-t border-surface-800">
          <ScheduledFiresPanel />
        </div>
      </details>
    </div>
  )
}
