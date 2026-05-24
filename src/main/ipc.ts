import { type IpcMain, shell } from 'electron'
import { hidManager } from './hid'
import { obsManager } from './obs'
import { schedulePoller } from './schedule'
import { recordingManager } from './recording'
import { streamManager } from './stream'
import { builtinRecorder } from './builtinRecorder'
import { builtinStreamer } from './builtinStreamer'
import { complianceLogger } from './complianceLogger'
import { healthMonitor } from './healthMonitor'
import { oscBridge } from './osc'
import { unrealLauncher } from './unrealLauncher'
import { resetStores } from './settings'
import { dialog } from 'electron'
import { cgAssets } from './cgAssets'
import { vizShaders } from './vizShaders'
import { popoutWindows, type PopoutView } from './popoutWindows'

export function registerIpcHandlers(ipc: IpcMain) {

  // ── Schedule ──────────────────────────────────────────────────────────────
  ipc.handle('schedule:get', () => schedulePoller.getState())

  // ── Cameras / HID ─────────────────────────────────────────────────────────
  ipc.handle('cameras:list', () => hidManager.getCameraList())

  ipc.handle('camera:ptz', (_e, { index, direction, speed }) =>
    hidManager.ptz(index, direction, speed))

  ipc.handle('camera:zoom', (_e, { index, direction, speed }) =>
    hidManager.zoom(index, direction, speed))

  ipc.handle('camera:ai', (_e, { index, enabled }) =>
    hidManager.setAiTracking(index, enabled))

  ipc.handle('camera:tracking-mode', (_e, { index, mode }) =>
    hidManager.setTrackingMode(index, mode))

  ipc.handle('camera:preset-save', (_e, { index, slot }) =>
    hidManager.savePreset(index, slot))

  ipc.handle('camera:preset-goto', (_e, { index, slot }) =>
    hidManager.gotoPreset(index, slot))

  ipc.handle('camera:exposure', (_e, { index, mode, value }) =>
    hidManager.setExposure(index, mode, value))

  ipc.handle('camera:white-balance', (_e, { index, mode, kelvin }) =>
    hidManager.setWhiteBalance(index, mode, kelvin))

  ipc.handle('camera:reset-home', (_e, { index }) =>
    hidManager.resetHome(index))

  ipc.handle('camera:rename', (_e, { index, label }) =>
    hidManager.renameCamera(index, label))

  // ── OBS / Switching ───────────────────────────────────────────────────────
  ipc.handle('obs:state', () => obsManager.getState())
  ipc.handle('obs:connect', (_e, { password }) => obsManager.connect(password))
  ipc.handle('obs:cut', (_e, { sceneName }) => obsManager.cutTo(sceneName))

  // ── Recording ─────────────────────────────────────────────────────────────
  ipc.handle('recording:session', () => recordingManager.getActiveSession())

  ipc.handle('recording:start', (_e, { show }) =>
    recordingManager.startSession(show, false))

  ipc.handle('recording:stop', () => recordingManager.stopAll())

  ipc.handle('recording:auto', (_e, { enabled }) =>
    recordingManager.setAutoRecord(enabled))

  ipc.handle('recording:set-dir', (_e, { dir }) =>
    recordingManager.setBaseDir(dir))

  // ── Built-in engine recording (renderer MediaRecorder → disk) ─────────────
  ipc.handle('builtin-rec:start', (_e, { show, name, ext }) => builtinRecorder.start(show, name, ext))
  ipc.handle('builtin-rec:write', (_e, { id, chunk }) => builtinRecorder.write(id, chunk))
  ipc.handle('builtin-rec:stop', (_e, { id }) => builtinRecorder.stop(id))
  ipc.handle('builtin-rec:open-folder', () => builtinRecorder.openFolder())

  // ── Built-in engine streaming (renderer MediaRecorder → FFmpeg → RTMP) ────
  ipc.handle('builtin-stream:start', (_e, { rtmpUrl, streamKey, additionalUrls, quality }) =>
    builtinStreamer.start(rtmpUrl, streamKey, additionalUrls ?? [], quality))
  ipc.handle('builtin-stream:write', (_e, { chunk }) => builtinStreamer.write(chunk))
  ipc.handle('builtin-stream:stop', () => builtinStreamer.stop())
  ipc.handle('builtin-stream:presets', () => builtinStreamer.listPresets())

  // ── Compliance audio logger (continuous as-broadcast capture) ─────────────
  ipc.handle('compliance:status', () => complianceLogger.getStatus())
  ipc.handle('compliance:set-enabled', (_e, { enabled }) => complianceLogger.setEnabled(enabled))
  ipc.handle('compliance:set-retention', (_e, { days }) => complianceLogger.setRetentionDays(days))
  ipc.handle('compliance:set-segment', (_e, { minutes }) => complianceLogger.setSegmentMinutes(minutes))
  ipc.handle('compliance:start-segment', (_e, { ext }) => complianceLogger.startSegment(ext))
  ipc.handle('compliance:write', (_e, { id, chunk }) => complianceLogger.write(id, chunk))
  ipc.handle('compliance:stop-segment', (_e, { id }) => complianceLogger.stopSegment(id))
  ipc.handle('compliance:sweep', () => complianceLogger.sweep())
  ipc.handle('compliance:open-folder', () => complianceLogger.openFolder())

  // ── Health monitor (disk + encoder + recorder + compliance alerts) ───────
  ipc.handle('health:active', () => healthMonitor.getActive())
  ipc.handle('health:dismiss', (_e, { id }) => healthMonitor.dismiss(id))

  // ── OSC bridge to external visualization engines (Unreal / TouchDesigner / …)
  ipc.handle('osc:status', () => oscBridge.getStatus())
  ipc.handle('osc:set-enabled', (_e, { enabled }) => oscBridge.setEnabled(enabled))
  ipc.handle('osc:set-host', (_e, { host }) => oscBridge.setHost(host))
  ipc.handle('osc:set-port', (_e, { port }) => oscBridge.setPort(port))
  ipc.handle('osc:metrics', (_e, { metrics }) => oscBridge.sendMetrics(metrics))
  ipc.handle('osc:event', (_e, { address, n }) => oscBridge.sendEvent(address, n))

  // ── Unreal Engine companion launcher ──────────────────────────────────────
  ipc.handle('unreal:status', () => unrealLauncher.getStatus())
  ipc.handle('unreal:start', () => unrealLauncher.start())
  ipc.handle('unreal:stop', () => { unrealLauncher.stop(); return { ok: true } })
  ipc.handle('unreal:config', (_e, { patch }) => { unrealLauncher.setConfig(patch); return { ok: true } })
  ipc.handle('unreal:pick-exe', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Locate UnrealEditor.exe (or a packaged build .exe)',
      properties: ['openFile'],
      filters: [{ name: 'Executable', extensions: ['exe'] }],
    })
    return res.canceled ? '' : (res.filePaths[0] ?? '')
  })
  ipc.handle('unreal:pick-project', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Locate your .uproject',
      properties: ['openFile'],
      filters: [{ name: 'Unreal Project', extensions: ['uproject'] }],
    })
    return res.canceled ? '' : (res.filePaths[0] ?? '')
  })

  // ── Factory-reset persistence (called by the renderer reset flow) ─────────
  ipc.handle('settings:reset-stores', (_e, { names }) => resetStores(names ?? []))

  // ── Custom visualizer shaders ─────────────────────────────────────────────
  ipc.handle('viz-shaders:list', () => vizShaders.list())
  ipc.handle('viz-shaders:open-folder', () => vizShaders.openFolder())

  // ── CG asset library ──────────────────────────────────────────────────────
  ipc.handle('cg:list', () => cgAssets.list())
  ipc.handle('cg:open-folder', (_e, { category }) =>
    shell.openPath(category ? cgAssets.categoryDir(category) : cgAssets.getRoot()))

  // ── Audio ─────────────────────────────────────────────────────────────────
  ipc.handle('audio:set-device', async (_e, { deviceId }) => {
    const obs = obsManager.getObs()
    if (!obsManager.getState().connected) return
    // Add/update audio input capture source in OBS pointing to the selected device
    // Disable audio on all video capture sources (camera mics)
    try {
      // Mute all camera video sources
      for (const scene of ['CAM1', 'CAM2', 'CAM3', 'CAM4']) {
        await obs.call('SetInputMute', { inputName: `Camera ${scene.slice(-1)}`, inputMuted: true }).catch(() => {})
      }
      // Create or update the main audio input source
      await obs.call('CreateInput', {
        sceneName: 'CAM1',
        inputName: 'NAR Studio Feed',
        inputKind: 'wasapi_input_capture',
        inputSettings: { device_id: deviceId },
      }).catch(async () => {
        // Already exists — just update the device
        await obs.call('SetInputSettings', {
          inputName: 'NAR Studio Feed',
          inputSettings: { device_id: deviceId },
        }).catch(() => {})
      })
    } catch (e) {
      console.error('[audio] OBS device set failed:', e)
    }
  })

  // ── Streaming ─────────────────────────────────────────────────────────────
  ipc.handle('stream:profiles', () => streamManager.getProfiles())
  ipc.handle('stream:active-profile', () => streamManager.getActiveProfile())
  ipc.handle('stream:save-profile', (_e, { profile }) => streamManager.saveProfile(profile))
  ipc.handle('stream:delete-profile', (_e, { id }) => streamManager.deleteProfile(id))
  ipc.handle('stream:start', (_e, { profileId }) => streamManager.startStream(profileId))
  ipc.handle('stream:stop', () => streamManager.stopStream())

  // ── Multi-monitor popout windows ──────────────────────────────────────────
  ipc.handle('popout:open', (_e, { view }: { view: PopoutView }) => popoutWindows.openPopout(view))
  ipc.handle('popout:close-all', () => { popoutWindows.closeAll(); return { ok: true } })
  ipc.handle('popout:list', () => popoutWindows.list())
}
