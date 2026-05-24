import { contextBridge, ipcRenderer } from 'electron'

const invoke = (channel: string, args?: unknown) => ipcRenderer.invoke(channel, args)
const on = (channel: string, cb: (...args: any[]) => void) => {
  ipcRenderer.on(channel, (_e, ...args) => cb(...args))
  return () => ipcRenderer.removeAllListeners(channel)
}

contextBridge.exposeInMainWorld('studio', {
  // Schedule
  getSchedule: () => invoke('schedule:get'),
  onScheduleUpdate: (cb: (s: any) => void) => on('schedule:updated', cb),

  // Cameras
  listCameras: () => invoke('cameras:list'),
  onCamerasUpdate: (cb: (c: any[]) => void) => on('cameras:updated', cb),
  cameraPtz: (index: number, direction: number, speed?: number) =>
    invoke('camera:ptz', { index, direction, speed }),
  cameraZoom: (index: number, direction: string, speed?: number) =>
    invoke('camera:zoom', { index, direction, speed }),
  cameraAi: (index: number, enabled: boolean) =>
    invoke('camera:ai', { index, enabled }),
  cameraTrackingMode: (index: number, mode: string) =>
    invoke('camera:tracking-mode', { index, mode }),
  cameraPresetSave: (index: number, slot: number) =>
    invoke('camera:preset-save', { index, slot }),
  cameraPresetGoto: (index: number, slot: number) =>
    invoke('camera:preset-goto', { index, slot }),
  cameraExposure: (index: number, mode: string, value?: number) =>
    invoke('camera:exposure', { index, mode, value }),
  cameraWhiteBalance: (index: number, mode: string, kelvin?: number) =>
    invoke('camera:white-balance', { index, mode, kelvin }),
  cameraResetHome: (index: number) =>
    invoke('camera:reset-home', { index }),
  cameraRename: (index: number, label: string) =>
    invoke('camera:rename', { index, label }),

  // OBS
  getObsState: () => invoke('obs:state'),
  connectObs: (password: string) => invoke('obs:connect', { password }),
  obsCut: (sceneName: string) => invoke('obs:cut', { sceneName }),
  onObsState: (cb: (s: any) => void) => on('obs:state', cb),

  // Recording
  getRecordingSession: () => invoke('recording:session'),
  startRecording: (show: any) => invoke('recording:start', { show }),
  stopRecording: () => invoke('recording:stop'),
  setAutoRecord: (enabled: boolean) => invoke('recording:auto', { enabled }),
  setRecordingDir: (dir: string) => invoke('recording:set-dir', { dir }),
  onRecordingSession: (cb: (s: any) => void) => on('recording:session', cb),

  // Built-in engine recording
  builtinRecStart: (show: unknown, name: string, ext: string) =>
    invoke('builtin-rec:start', { show, name, ext }),
  builtinRecWrite: (id: string, chunk: ArrayBuffer) => invoke('builtin-rec:write', { id, chunk }),
  builtinRecStop: (id: string) => invoke('builtin-rec:stop', { id }),
  builtinRecOpenFolder: () => invoke('builtin-rec:open-folder'),
  onRecError: (cb: (msg: string) => void) => on('rec:error', cb),

  // Built-in engine streaming
  builtinStreamStart: (rtmpUrl: string, streamKey: string, additionalUrls?: string[], quality?: string) =>
    invoke('builtin-stream:start', { rtmpUrl, streamKey, additionalUrls, quality }),
  builtinStreamWrite: (chunk: ArrayBuffer) => invoke('builtin-stream:write', { chunk }),
  builtinStreamStop: () => invoke('builtin-stream:stop'),
  builtinStreamPresets: () => invoke('builtin-stream:presets'),
  onStreamEnded: (cb: () => void) => on('stream:ended', cb),
  onStreamStats: (cb: (s: any) => void) => on('stream:stats', cb),

  // Health monitor
  healthActive: () => invoke('health:active'),
  healthDismiss: (id: string) => invoke('health:dismiss', { id }),
  onHealthAlert: (cb: (a: any) => void) => on('health:alert', cb),

  // Compliance audio logger
  complianceStatus: () => invoke('compliance:status'),
  complianceSetEnabled: (enabled: boolean) => invoke('compliance:set-enabled', { enabled }),
  complianceSetRetention: (days: number) => invoke('compliance:set-retention', { days }),
  complianceSetSegment: (minutes: number) => invoke('compliance:set-segment', { minutes }),
  complianceStartSegment: (ext: string) => invoke('compliance:start-segment', { ext }),
  complianceWrite: (id: string, chunk: ArrayBuffer) => invoke('compliance:write', { id, chunk }),
  complianceStopSegment: (id: string) => invoke('compliance:stop-segment', { id }),
  complianceSweep: () => invoke('compliance:sweep'),
  complianceOpenFolder: () => invoke('compliance:open-folder'),

  // OSC bridge to external visualization engines
  oscStatus: () => invoke('osc:status'),
  oscSetEnabled: (enabled: boolean) => invoke('osc:set-enabled', { enabled }),
  oscSetHost: (host: string) => invoke('osc:set-host', { host }),
  oscSetPort: (port: number) => invoke('osc:set-port', { port }),
  oscSendMetrics: (metrics: Record<string, number>) => invoke('osc:metrics', { metrics }),
  oscSendEvent: (address: string, n?: number) => invoke('osc:event', { address, n: n ?? 1 }),

  // Unreal Engine companion launcher
  unrealStatus: () => invoke('unreal:status'),
  unrealStart: () => invoke('unreal:start'),
  unrealStop: () => invoke('unreal:stop'),
  unrealConfig: (patch: Record<string, unknown>) => invoke('unreal:config', { patch }),
  unrealPickExe: () => invoke('unreal:pick-exe'),
  unrealPickProject: () => invoke('unreal:pick-project'),
  onUnrealStatus: (cb: (s: any) => void) => on('unreal:status', cb),

  // Factory reset
  settingsResetStores: (names: string[]) => invoke('settings:reset-stores', { names }),

  // CG asset library
  cgList: () => invoke('cg:list'),
  cgOpenFolder: (category?: string) => invoke('cg:open-folder', { category }),
  onCgChanged: (cb: () => void) => on('cg:changed', cb),

  // Custom visualizer shaders
  vizShadersList: () => invoke('viz-shaders:list'),
  vizShadersOpenFolder: () => invoke('viz-shaders:open-folder'),
  onVizShadersChanged: (cb: () => void) => on('viz-shaders:changed', cb),

  // Audio
  setAudioDevice: (deviceId: string) => invoke('audio:set-device', { deviceId }),

  // Streaming
  getStreamProfiles: () => invoke('stream:profiles'),
  getActiveStreamProfile: () => invoke('stream:active-profile'),
  saveStreamProfile: (profile: any) => invoke('stream:save-profile', { profile }),
  deleteStreamProfile: (id: string) => invoke('stream:delete-profile', { id }),
  startStream: (profileId?: string) => invoke('stream:start', { profileId }),
  stopStream: () => invoke('stream:stop'),

  // Multi-monitor popout windows
  popoutOpen: (view: string) => invoke('popout:open', { view }),
  popoutCloseAll: () => invoke('popout:close-all'),
  popoutList: () => invoke('popout:list'),
})
