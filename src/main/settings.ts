/**
 * Reset-stores helper — wipes the JSON file behind each electron-store
 * namespace the operator asks to clear. Used by the renderer's factory-reset
 * flow so we drop persistent server-side state alongside the localStorage
 * wipe (otherwise stream profiles, compliance retention, UE launcher paths
 * etc. would survive a "reset everything" gesture).
 */
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

/** Allow-list of store names we'll touch. Belt-and-braces so a malformed
 *  IPC payload can't ever delete an unrelated file under userData/. */
const ALLOWED = new Set([
  'stream-profiles',
  'compliance-logger',
  'osc-bridge',
  'myriad-bridge',
  'unreal-launcher',
  'broadcast-compressor',
])

export function resetStores(names: string[]): { removed: string[] } {
  const dir = app.getPath('userData')
  const removed: string[] = []
  for (const raw of names) {
    if (typeof raw !== 'string') continue
    if (!ALLOWED.has(raw)) continue
    const file = path.join(dir, `${raw}.json`)
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file)
        removed.push(raw)
      }
    } catch (e: any) {
      console.warn(`[settings] could not remove ${file}: ${e?.message ?? e}`)
    }
  }
  return { removed }
}
