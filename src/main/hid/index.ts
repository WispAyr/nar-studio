import HID from 'node-hid'
import { OBSBOT_VID, OBSBOT_TINY2_PID, createObsBotDevice, type ObsBotDevice, type PtzDirection } from './obsbot'
import { getMainWindow } from '../index'

export interface CameraInfo {
  index: number         // 0-3
  path: string
  serialNumber: string
  label: string         // "Camera 1" etc, user-renameable
  connected: boolean
  aiTracking: boolean
  currentPreset: number | null
}

class HIDManager {
  private devices: Map<number, { hid: HID.HID; bot: ObsBotDevice }> = new Map()
  private scanInterval: ReturnType<typeof setInterval> | null = null
  private cameras: CameraInfo[] = []

  start() {
    this.scan()
    this.scanInterval = setInterval(() => this.scan(), 5000)
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval)
      this.scanInterval = null
    }
    for (const [, { bot }] of this.devices) bot.close()
    this.devices.clear()
  }

  private scan() {
    const found = HID.devices(OBSBOT_VID, OBSBOT_TINY2_PID)

    // Remove disconnected
    for (const [idx, entry] of this.devices) {
      const still = found.find(d => d.path === this.cameras[idx]?.path)
      if (!still) {
        entry.bot.close()
        this.devices.delete(idx)
        if (this.cameras[idx]) this.cameras[idx].connected = false
      }
    }

    // Add newly connected
    let cameraIndex = 0
    for (const info of found) {
      if (!info.path) continue
      const existing = this.cameras.findIndex(c => c.path === info.path)
      const idx = existing >= 0 ? existing : cameraIndex

      if (!this.devices.has(idx)) {
        try {
          const hid = new HID.HID(info.path)
          const bot = createObsBotDevice(hid as any)
          this.devices.set(idx, { hid, bot })

          if (existing < 0) {
            this.cameras[idx] = {
              index: idx,
              path: info.path!,
              serialNumber: info.serialNumber ?? `cam-${idx}`,
              label: `Camera ${idx + 1}`,
              connected: true,
              aiTracking: false,
              currentPreset: null,
            }
          } else {
            this.cameras[idx].connected = true
          }
        } catch (e) {
          console.error(`[hid] failed to open camera ${idx}:`, e)
        }
      }
      cameraIndex++
    }

    this.emit('cameras:updated', this.getCameraList())
  }

  getCameraList(): CameraInfo[] {
    return this.cameras.map(c => ({ ...c }))
  }

  getDevice(index: number): ObsBotDevice | null {
    return this.devices.get(index)?.bot ?? null
  }

  ptz(index: number, direction: PtzDirection, speed = 50) {
    this.getDevice(index)?.ptz(direction, speed)
  }

  zoom(index: number, direction: 'in' | 'out' | 'stop', speed = 50) {
    this.getDevice(index)?.zoom(direction, speed)
  }

  setAiTracking(index: number, enabled: boolean) {
    this.getDevice(index)?.setAiTracking(enabled)
    if (this.cameras[index]) {
      this.cameras[index].aiTracking = enabled
      this.emit('cameras:updated', this.getCameraList())
    }
  }

  setTrackingMode(index: number, mode: 'body' | 'face' | 'desk' | 'whiteboard') {
    this.getDevice(index)?.setTrackingMode(mode)
  }

  savePreset(index: number, slot: number) {
    this.getDevice(index)?.savePreset(slot)
    if (this.cameras[index]) this.cameras[index].currentPreset = slot
  }

  gotoPreset(index: number, slot: number) {
    this.getDevice(index)?.gotoPreset(slot)
    if (this.cameras[index]) this.cameras[index].currentPreset = slot
  }

  setExposure(index: number, mode: 'auto' | 'manual', value?: number) {
    this.getDevice(index)?.setExposure(mode, value)
  }

  setWhiteBalance(index: number, mode: 'auto' | 'manual', kelvin?: number) {
    this.getDevice(index)?.setWhiteBalance(mode, kelvin)
  }

  resetHome(index: number) {
    this.getDevice(index)?.resetHome()
  }

  renameCamera(index: number, label: string) {
    if (this.cameras[index]) {
      this.cameras[index].label = label
      this.emit('cameras:updated', this.getCameraList())
    }
  }

  private emit(channel: string, data: unknown) {
    const win = getMainWindow()
    if (win) win.webContents.send(channel, data)
  }
}

export const hidManager = new HIDManager()
