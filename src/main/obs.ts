/**
 * OBS WebSocket manager.
 * Connects to OBS on localhost:4455, auto-configures sources + scenes on first run.
 */
import OBSWebSocket from 'obs-websocket-js'
import { getMainWindow } from './index'

const OBS_WS_URL = 'ws://127.0.0.1:4455'
const RECONNECT_DELAY_MS = 5_000

export interface OBSState {
  connected: boolean
  streaming: boolean
  recording: boolean
  programScene: string
  scenes: string[]
  streamTimecode: string | null
  recordTimecode: string | null
}

const CAMERA_SOURCES = [
  { name: 'Camera 1', scene: 'CAM1' },
  { name: 'Camera 2', scene: 'CAM2' },
  { name: 'Camera 3', scene: 'CAM3' },
  { name: 'Camera 4', scene: 'CAM4' },
]

const MULTIVIEW_SCENE = 'MULTIVIEW'
const PROGRAM_SCENE = 'PROGRAM'

class OBSManager {
  private obs = new OBSWebSocket()
  private state: OBSState = {
    connected: false,
    streaming: false,
    recording: false,
    programScene: '',
    scenes: [],
    streamTimecode: null,
    recordTimecode: null,
  }
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private password: string = ''

  async connect(password = '') {
    this.password = password
    try {
      await this.obs.connect(OBS_WS_URL, password || undefined)
      await this.onConnected()
    } catch (e) {
      console.warn('[obs] connect failed, retrying in 5s:', (e as Error).message)
      this.scheduleReconnect()
    }
  }

  private async onConnected() {
    console.log('[obs] connected')
    this.state.connected = true

    // Wire event handlers
    this.obs.on('ConnectionClosed', () => {
      this.state.connected = false
      this.emit('obs:state', this.state)
      this.scheduleReconnect()
    })

    this.obs.on('StreamStateChanged', (ev) => {
      this.state.streaming = ev.outputActive
      this.emit('obs:state', this.state)
    })

    this.obs.on('RecordStateChanged', (ev) => {
      this.state.recording = ev.outputActive
      this.emit('obs:state', this.state)
    })

    this.obs.on('CurrentProgramSceneChanged', ({ sceneName }) => {
      this.state.programScene = sceneName
      this.emit('obs:state', this.state)
    })

    await this.syncState()
    await this.ensureScenes()
    this.emit('obs:state', this.state)
  }

  private async syncState() {
    const [sceneList, status] = await Promise.allSettled([
      this.obs.call('GetSceneList'),
      this.obs.call('GetStreamStatus'),
    ])

    if (sceneList.status === 'fulfilled') {
      this.state.scenes = sceneList.value.scenes.map((s: any) => String(s.sceneName))
      this.state.programScene = String(sceneList.value.currentProgramSceneName)
    }
    if (status.status === 'fulfilled') {
      this.state.streaming = status.value.outputActive
      this.state.streamTimecode = status.value.outputTimecode ?? null
    }
  }

  /** Create per-camera scenes + multiview if they don't exist. */
  private async ensureScenes() {
    const existing = new Set(this.state.scenes)

    for (const cam of CAMERA_SOURCES) {
      if (!existing.has(cam.scene)) {
        await this.obs.call('CreateScene', { sceneName: cam.scene })
        // Add video capture device source
        await this.obs.call('CreateInput', {
          sceneName: cam.scene,
          inputName: cam.name,
          inputKind: 'dshow_input',
          inputSettings: { video_device_id: '' },
        }).catch(() => {})
      }
    }

    if (!existing.has(PROGRAM_SCENE)) {
      await this.obs.call('CreateScene', { sceneName: PROGRAM_SCENE })
    }
  }

  async cutTo(sceneName: string) {
    if (!this.state.connected) return
    await this.obs.call('SetCurrentProgramScene', { sceneName })
  }

  async startStream(rtmpUrl: string, streamKey: string) {
    if (!this.state.connected) throw new Error('OBS not connected')
    await this.obs.call('SetStreamServiceSettings', {
      streamServiceType: 'rtmp_custom',
      streamServiceSettings: {
        server: rtmpUrl,
        key: streamKey,
      },
    })
    await this.obs.call('StartStream')
  }

  async stopStream() {
    if (!this.state.connected) return
    await this.obs.call('StopStream')
  }

  async startRecording(outputPath: string) {
    if (!this.state.connected) return
    await this.obs.call('SetProfileParameter', {
      parameterCategory: 'SimpleOutput',
      parameterName: 'FilePath',
      parameterValue: outputPath,
    })
    await this.obs.call('StartRecord')
  }

  async stopRecording() {
    if (!this.state.connected) return
    await this.obs.call('StopRecord')
  }

  async setRecordingPath(outputPath: string) {
    if (!this.state.connected) return
    await this.obs.call('SetRecordDirectory', { recordDirectory: outputPath })
  }

  getState(): OBSState {
    return { ...this.state }
  }

  getObs() { return this.obs }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null
      await this.connect(this.password)
    }, RECONNECT_DELAY_MS)
  }

  private emit(channel: string, data: unknown) {
    const win = getMainWindow()
    if (win) win.webContents.send(channel, data)
  }
}

export const obsManager = new OBSManager()
