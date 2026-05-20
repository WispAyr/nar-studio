/**
 * OBSBot Tiny 2 USB HID protocol.
 *
 * Protocol reverse-engineered from OBSBot Center app.
 * HID reports are 64 bytes, sent as output reports to endpoint 0.
 *
 * VID: 0x2B6D  PID: 0x0003 (Tiny 2)
 * Confirmed against firmware 5.x
 */

export const OBSBOT_VID = 0x2b6d
export const OBSBOT_TINY2_PID = 0x0003

// Command IDs
const CMD = {
  PTZ_CONTROL:    0x01,
  ZOOM_CONTROL:   0x02,
  AI_TRACKING:    0x03,
  PRESET_SAVE:    0x10,
  PRESET_GOTO:    0x11,
  EXPOSURE:       0x20,
  WHITE_BALANCE:  0x21,
  FLIP:           0x30,
  RESET_HOME:     0x40,
} as const

// PTZ direction flags
export const PTZ = {
  STOP:       0x00,
  PAN_LEFT:   0x01,
  PAN_RIGHT:  0x02,
  TILT_UP:    0x04,
  TILT_DOWN:  0x08,
} as const

export type PtzDirection = typeof PTZ[keyof typeof PTZ]

function buildReport(cmd: number, params: number[]): number[] {
  const report = new Array(64).fill(0)
  report[0] = 0x00  // report ID
  report[1] = cmd
  for (let i = 0; i < params.length && i < 62; i++) {
    report[2 + i] = params[i]
  }
  return report
}

export interface ObsBotDevice {
  ptz(direction: PtzDirection, speed?: number): void
  zoom(direction: 'in' | 'out' | 'stop', speed?: number): void
  setAiTracking(enabled: boolean): void
  setTrackingMode(mode: 'body' | 'face' | 'desk' | 'whiteboard'): void
  savePreset(slot: number): void
  gotoPreset(slot: number): void
  setExposure(mode: 'auto' | 'manual', value?: number): void
  setWhiteBalance(mode: 'auto' | 'manual', kelvin?: number): void
  resetHome(): void
  close(): void
}

const TRACKING_MODES = { body: 0x01, face: 0x02, desk: 0x03, whiteboard: 0x04 }

export function createObsBotDevice(device: HIDDevice): ObsBotDevice {
  function send(cmd: number, params: number[]) {
    try {
      device.write(buildReport(cmd, params))
    } catch (e) {
      console.error('[obsbot] write error', e)
    }
  }

  return {
    ptz(direction, speed = 50) {
      const spd = Math.max(1, Math.min(100, speed))
      send(CMD.PTZ_CONTROL, [direction, spd])
    },
    zoom(direction, speed = 50) {
      const dir = direction === 'in' ? 0x01 : direction === 'out' ? 0x02 : 0x00
      send(CMD.ZOOM_CONTROL, [dir, Math.max(1, Math.min(100, speed))])
    },
    setAiTracking(enabled) {
      send(CMD.AI_TRACKING, [enabled ? 0x01 : 0x00])
    },
    setTrackingMode(mode) {
      send(CMD.AI_TRACKING, [0x02, TRACKING_MODES[mode]])
    },
    savePreset(slot) {
      send(CMD.PRESET_SAVE, [Math.max(1, Math.min(9, slot))])
    },
    gotoPreset(slot) {
      send(CMD.PRESET_GOTO, [Math.max(1, Math.min(9, slot))])
    },
    setExposure(mode, value = 0) {
      send(CMD.EXPOSURE, [mode === 'auto' ? 0x00 : 0x01, value])
    },
    setWhiteBalance(mode, kelvin = 5500) {
      const k = Math.max(2500, Math.min(8000, kelvin))
      send(CMD.WHITE_BALANCE, [mode === 'auto' ? 0x00 : 0x01, k >> 8, k & 0xff])
    },
    resetHome() {
      send(CMD.RESET_HOME, [])
    },
    close() {
      try { device.close() } catch {}
    },
  }
}

// Type shim — node-hid device interface subset we use
interface HIDDevice {
  write(data: number[]): number
  close(): void
}
