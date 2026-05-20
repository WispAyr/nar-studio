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
  builtinRecStart: (show: unknown, ext: string) => invoke('builtin-rec:start', { show, ext }),
  builtinRecWrite: (id: string, chunk: ArrayBuffer) => invoke('builtin-rec:write', { id, chunk }),
  builtinRecStop: () => invoke('builtin-rec:stop'),

  // Built-in engine streaming
  builtinStreamStart: (rtmpUrl: string, streamKey: string) => invoke('builtin-stream:start', { rtmpUrl, streamKey }),
  builtinStreamWrite: (chunk: ArrayBuffer) => invoke('builtin-stream:write', { chunk }),
  builtinStreamStop: () => invoke('builtin-stream:stop'),

  // CG asset library
  cgList: () => invoke('cg:list'),
  cgOpenFolder: (category?: string) => invoke('cg:open-folder', { category }),
  onCgChanged: (cb: () => void) => on('cg:changed', cb),

  // Audio
  setAudioDevice: (deviceId: string) => invoke('audio:set-device', { deviceId }),

  // Streaming
  getStreamProfiles: () => invoke('stream:profiles'),
  getActiveStreamProfile: () => invoke('stream:active-profile'),
  saveStreamProfile: (profile: any) => invoke('stream:save-profile', { profile }),
  deleteStreamProfile: (id: string) => invoke('stream:delete-profile', { id }),
  startStream: (profileId?: string) => invoke('stream:start', { profileId }),
  stopStream: () => invoke('stream:stop'),
})
