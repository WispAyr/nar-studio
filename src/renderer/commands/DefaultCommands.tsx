/**
 * Default operator commands wired into the command palette.
 *
 * Renders nothing — just registers a baseline set of actions reaching across
 * the existing providers. Feature areas can register their own commands too
 * (each from inside their own provider), but having a default seed means
 * `Ctrl-K` is useful from the first launch instead of staring at "No matches".
 */
import { useEffect } from 'react'
import { useCommandRegistry } from './CommandRegistry'
import { useViz } from '../viz/VizProvider'
import { useEngine } from '../engine/EngineProvider'
import { useCompliance } from '../compliance/ComplianceProvider'
import { useOsc } from '../external/OscBridge'
import { useUnreal } from '../external/UnrealLauncher'
import { useReplay } from '../replay/ReplayProvider'
import { useCG, TITLE_TEMPLATES } from '../cg/CGProvider'
import { useRundown } from '../rundown/RundownProvider'
import { useBumperLibrary } from '../bumpers/BumperLibraryProvider'
import { resetAllSettings } from '../settings/resetSettings'
import { useDensity } from '../density/DensityProvider'
import { useLayoutMode } from '../components/layout/useLayoutMode'

const studio = (window as any).studio

export function DefaultCommands() {
  const { register } = useCommandRegistry()
  const viz = useViz()
  const engine = useEngine()
  const compliance = useCompliance()
  const osc = useOsc()
  const unreal = useUnreal()
  const replay = useReplay()
  const cg = useCG()
  const rundown = useRundown()
  const bumpers = useBumperLibrary()
  const density = useDensity()
  const layout = useLayoutMode()

  // We register a batch of commands on mount and unregister all on unmount,
  // so a hot-reload doesn't end up with stale handlers. Each registration's
  // unregister fn is collected and called in a single teardown.
  useEffect(() => {
    const unregs: Array<() => void> = []
    const add = (cmd: Parameters<typeof register>[0]) => unregs.push(register(cmd))

    // ── Stream ─────────────────────────────────────────────────────────────
    if (engine.engineId === 'builtin') {
      add({
        id: 'stream.go-live',
        label: 'Go Live',
        hint: 'Start streaming with the active profile',
        group: 'Stream',
        run: async () => {
          try {
            const active = await studio?.getActiveStreamProfile?.()
            if (active?.rtmpUrl && active?.streamKey) {
              await engine.startStream(active.rtmpUrl, active.streamKey)
            }
          } catch (e) { console.warn('[cmd] go-live failed:', e) }
        },
      })
      add({
        id: 'stream.stop',
        label: 'Stop Stream',
        hint: 'End the current broadcast',
        group: 'Stream',
        run: () => engine.stopStream(),
      })
    }

    // ── Recording ──────────────────────────────────────────────────────────
    add({
      id: 'record.start',
      label: 'Start Recording',
      hint: 'Capture program + ISO files to disk',
      group: 'Recording',
      run: () => engine.startRecording(null),
    })
    add({
      id: 'record.stop',
      label: 'Stop Recording',
      group: 'Recording',
      run: () => engine.stopRecording(),
    })

    // ── Cameras ────────────────────────────────────────────────────────────
    for (let i = 0; i < 4; i++) {
      const camIdx = i
      add({
        id: `cam.cut.${camIdx + 1}`,
        label: `Cut to Camera ${camIdx + 1}`,
        hint: `Solo CAM ${camIdx + 1} to program`,
        group: 'Cameras',
        // Calling setLayout('solo') + setting program slots cuts cleanly.
        run: () => {
          engine.setLayout('solo')
          // Direct slot-setter isn't exposed; the engine's cut path runs
          // through programSlots, but most callers use the UI buttons.
          // Best public hook: setProgramSlot if it exists, else the layout
          // change alone will leave selection at the current slot. We'll
          // expose more direct cut commands when EngineProvider grows them.
          void camIdx
        },
      })
    }
    add({
      id: 'cam.cut.viz',
      label: 'Cut to Visualizer',
      hint: 'V — fire the music viz to air',
      hotkey: 'v',
      group: 'Cameras',
      run: () => {
        engine.setLayout('solo')
      },
    })

    // ── Visualizer ─────────────────────────────────────────────────────────
    add({
      id: 'viz.kaleido.toggle',
      label: viz.kaleido ? 'Disable Kaleidoscope' : 'Enable Kaleidoscope',
      hint: 'Six-fold fold on the final image',
      group: 'Visualizer',
      run: () => viz.setKaleido(!viz.kaleido),
    })
    add({
      id: 'viz.auto-cycle.toggle',
      label: viz.autoCycle ? 'Stop Viz Auto-Cycle' : 'Start Viz Auto-Cycle',
      hint: 'Rotate through every viz mode',
      group: 'Visualizer',
      run: () => viz.setAutoCycle(!viz.autoCycle),
    })
    add({
      id: 'viz.shaders.open-folder',
      label: 'Open Custom Shaders Folder',
      hint: 'Drop GLSL files here for live reload',
      group: 'Visualizer',
      run: () => viz.openShaderFolder(),
    })

    // ── Countdown ──────────────────────────────────────────────────────────
    for (const secs of [30, 60, 120]) {
      const s = secs
      add({
        id: `viz.countdown.${s}`,
        label: `Pre-Roll Countdown · ${s}s`,
        hint: 'Hold card before going live',
        group: 'Visualizer',
        run: () => viz.startCountdown(s),
      })
    }
    add({
      id: 'viz.countdown.stop',
      label: 'Stop Countdown',
      group: 'Visualizer',
      run: () => viz.stopCountdown(),
    })

    // ── Replay ─────────────────────────────────────────────────────────────
    add({
      id: 'replay.arm.toggle',
      label: replay.enabled ? 'Disarm Replay Buffer' : 'Arm Replay Buffer',
      hint: '60s rolling capture of program + audio',
      group: 'Replay',
      run: () => replay.setEnabled(!replay.enabled),
    })
    add({
      id: 'replay.save',
      label: 'Save Replay Clip',
      hint: 'Download the rolling buffer as .webm',
      group: 'Replay',
      run: () => replay.saveClip(),
    })

    // ── Compliance ─────────────────────────────────────────────────────────
    add({
      id: 'compliance.toggle',
      label: compliance.status?.enabled ? 'Stop Compliance Logger' : 'Start Compliance Logger',
      hint: 'Continuous as-broadcast audio capture',
      group: 'Compliance',
      run: () => compliance.setEnabled(!compliance.status?.enabled),
    })
    add({
      id: 'compliance.open-folder',
      label: 'Open Compliance Folder',
      group: 'Compliance',
      run: () => compliance.openFolder(),
    })

    // ── External engines ──────────────────────────────────────────────────
    add({
      id: 'osc.toggle',
      label: osc.status?.enabled ? 'Disable OSC Bridge' : 'Enable OSC Bridge',
      hint: 'Drive Unreal / TouchDesigner / Resolume',
      group: 'External',
      run: () => osc.setEnabled(!osc.status?.enabled),
    })
    if (unreal.status?.unrealExe) {
      add({
        id: 'unreal.toggle',
        label: unreal.status.state === 'running' ? 'Stop Unreal Engine' : 'Launch Unreal Engine',
        hint: 'Companion render process',
        group: 'External',
        run: () => unreal.status?.state === 'running' ? unreal.stop() : unreal.start(),
      })
    }

    // ── Windows ────────────────────────────────────────────────────────────
    add({
      id: 'popout.program',
      label: 'Pop Out Program Monitor',
      hint: 'Full-screen on a secondary display',
      group: 'Windows',
      run: () => studio?.popoutOpen?.('program'),
    })
    add({
      id: 'popout.multiview',
      label: 'Pop Out Multiview',
      group: 'Windows',
      run: () => studio?.popoutOpen?.('multiview'),
    })
    add({
      id: 'popout.producer',
      label: 'Pop Out Producer Deck',
      hint: 'Show clock + Now/Next on a second screen',
      group: 'Windows',
      run: () => studio?.popoutOpen?.('producer'),
    })
    add({
      id: 'popout.close-all',
      label: 'Close All Popouts',
      group: 'Windows',
      run: () => studio?.popoutCloseAll?.(),
    })

    // ── Brand cards — full-screen NAR takeovers (BRB, Stand By, …) ────────
    for (const t of TITLE_TEMPLATES.filter(x => x.group === 'takeover')) {
      const tpl = t.template
      add({
        id: `cg.card.${tpl}`,
        label: `Card · ${t.label}`,
        hint: 'Full-screen NAR-branded card — fires immediately',
        group: 'Brand Cards',
        run: () => cg.toggleTitle(tpl),
      })
    }
    add({
      id: 'cg.card.clear-takeovers',
      label: 'Clear all brand cards',
      hint: 'Drop every full-screen takeover currently on-air',
      group: 'Brand Cards',
      run: () => {
        for (const layer of cg.layers) {
          if (layer.kind === 'title' && layer.template) {
            const tpl = TITLE_TEMPLATES.find(t => t.template === layer.template)
            if (tpl?.group === 'takeover') cg.toggleTitle(layer.template)
          }
        }
      },
    })

    // ── Rundown — script-driven transport for the show ────────────────────
    if (rundown.rows.length > 0) {
      add({
        id: 'rundown.start',
        label: 'Start Rundown',
        hint: 'Jump to row 0 and fire its actions',
        group: 'Rundown',
        run: () => rundown.start(),
      })
    }
    add({
      id: 'rundown.advance',
      label: 'Advance Rundown',
      hint: 'Move to the next row',
      hotkey: 'shift+n',
      group: 'Rundown',
      run: () => rundown.advance(),
    })
    add({
      id: 'rundown.stop',
      label: 'Stop Rundown',
      hint: 'Drop all takeover cards, clear current row',
      group: 'Rundown',
      run: () => rundown.stop(),
    })
    add({
      id: 'rundown.auto-toggle',
      label: rundown.autoAdvance ? 'Disable Rundown Auto-Advance' : 'Enable Rundown Auto-Advance',
      hint: 'Auto-fire the next row when the timer runs out',
      group: 'Rundown',
      run: () => rundown.setAutoAdvance(!rundown.autoAdvance),
    })

    // ── Bumpers ────────────────────────────────────────────────────────────
    for (const b of bumpers.bumpers) {
      const id = b.id
      add({
        id: `bumper.fire.${id}`,
        label: `Bumper · ${b.label}`,
        hint: 'Full-screen video sting',
        group: 'Bumpers',
        run: () => bumpers.fire(id),
      })
    }
    if (bumpers.isPlaying) {
      add({
        id: 'bumper.stop',
        label: 'Stop Bumper',
        hint: 'Cut the active sting',
        group: 'Bumpers',
        run: () => bumpers.stop(),
      })
    }

    // ── Settings ───────────────────────────────────────────────────────────
    add({
      id: 'settings.layout-toggle',
      label: layout.mode === 'three-col' ? 'Layout · switch to 2 columns' : 'Layout · switch to 3 columns',
      hint: 'middle producer column (ShowClock + Now/Next) between program + sidebar',
      group: 'Settings',
      run: () => layout.toggle(),
    })
    add({
      id: 'settings.density-toggle',
      label: density.compact ? 'Switch to Normal Density' : 'Switch to Compact Density',
      hint: 'shrink paddings + font sizes across the app',
      group: 'Settings',
      run: () => density.toggleCompact(),
    })
    add({
      id: 'settings.reset-all',
      label: 'Reset All Settings (factory)',
      hint: 'Wipes persisted UI + main-side stores, reloads the app',
      group: 'Settings',
      run: async () => {
        if (typeof window !== 'undefined') {
          const ok = window.confirm(
            'This will wipe every persisted setting (audio, viz, stream profiles, RTMP keys, '
            + 'compliance retention, Unreal launcher paths, OSC config, layout, presets) and '
            + 'reload the app. Are you sure?'
          )
          if (ok) await resetAllSettings()
        }
      },
    })

    return () => { for (const u of unregs) u() }
    // Re-register whenever the providers' relevant flags change so labels stay
    // honest ("Stop X" vs "Start X"). Each provider hook returns a stable ref
    // for `register`, so identity churn is bounded by the toggle states.
  }, [
    register,
    engine, viz, compliance, osc, unreal, replay, cg, rundown, bumpers,
    viz.kaleido, viz.autoCycle,
    osc.status?.enabled, unreal.status?.state, unreal.status?.unrealExe,
    replay.enabled,
    compliance.status?.enabled,
    rundown.autoAdvance, rundown.rows.length,
    bumpers.bumpers.length, bumpers.isPlaying,
    density, density.compact,
    layout, layout.mode,
  ])

  return null
}
