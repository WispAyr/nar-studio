/**
 * Built-in engine RTMP streamer — receives encoded media chunks from the
 * renderer's MediaRecorder over IPC and pipes them through a bundled FFmpeg
 * which transcodes to H.264/AAC and pushes to an RTMP destination.
 *
 * Emits 'ended' when FFmpeg exits *unexpectedly* (an RTMP/network drop) — never
 * on a clean operator stop — so the renderer can reconnect. Also emits 'stats'
 * (parsed from FFmpeg stderr) at ~1 Hz so the operator can see encoder fps,
 * bitrate, drops and processing speed before YouTube notices a problem.
 */
import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import ffmpegStatic from 'ffmpeg-static'

// In a packaged build the FFmpeg binary is unpacked from the asar archive
// (see build.asarUnpack in package.json), but ffmpeg-static still reports the
// in-asar path — which can't be spawned. Rewrite it to the unpacked location.
// In dev the path has no 'app.asar' segment, so this is a no-op.
const ffmpegPath = ffmpegStatic?.replace('app.asar', 'app.asar.unpacked') ?? null

/**
 * Encoder + bitrate tradeoffs. Each preset shapes the libx264/NVENC argv.
 * Operators pick from the StreamPanel; defaults to 'standard' which suits
 * a modern desktop CPU comfortably while looking clearly better than the
 * old 4.5 Mbps / veryfast baseline.
 */
export type StreamQualityPreset =
  | 'performance'  // veryfast 4500k — falling-behind safety net for older CPUs
  | 'standard'     // faster 6000k — balanced default
  | 'high'         // medium 7500k — modern Ryzen / i7 territory
  | 'maximum'      // slow 9000k — flagship CPU only
  | 'nvenc-high'   // NVENC GPU encode @ 7500k — frees the CPU
  | 'nvenc-max'    // NVENC GPU encode @ 9000k

interface PresetSpec {
  /** Human label for logs + UI. */
  label: string
  /** Encoder family — picks the right ffmpeg codec and preset namespace. */
  encoder: 'libx264' | 'h264_nvenc'
  /** Encoder preset string (veryfast/medium/p4/p7 etc). */
  preset: string
  /** Target bitrate in kbps for video. */
  bitrateK: number
}

const PRESETS: Record<StreamQualityPreset, PresetSpec> = {
  performance: { label: 'Performance', encoder: 'libx264',     preset: 'veryfast', bitrateK: 4500 },
  standard:    { label: 'Standard',    encoder: 'libx264',     preset: 'faster',   bitrateK: 6000 },
  high:        { label: 'High',        encoder: 'libx264',     preset: 'medium',   bitrateK: 7500 },
  maximum:     { label: 'Maximum',     encoder: 'libx264',     preset: 'slow',     bitrateK: 9000 },
  'nvenc-high':{ label: 'NVENC High',  encoder: 'h264_nvenc',  preset: 'p5',       bitrateK: 7500 },
  'nvenc-max': { label: 'NVENC Max',   encoder: 'h264_nvenc',  preset: 'p7',       bitrateK: 9000 },
}

export interface StreamStats {
  frames: number
  fps: number
  bitrateK: number
  /** Encoder speed multiplier (1.0 = real-time; <1.0 = falling behind). */
  speed: number
  drops: number
  /** Average quantizer — lower is cleaner. */
  q: number
}

class BuiltinStreamer extends EventEmitter {
  private proc: ChildProcess | null = null
  private streaming = false
  /** Retires the current process so its exit is treated as intentional. */
  private retire: (() => void) | null = null
  private lastError = ''

  /** Build the FFmpeg argv for a preset (shared by single + tee branches). */
  private encArgsFor(preset: StreamQualityPreset): string[] {
    const spec = PRESETS[preset] ?? PRESETS.standard
    const { encoder, preset: encPreset, bitrateK } = spec
    // Bufsize at 2× target keeps short bursts inside VBV without letting an
    // outlier scene swing the bitrate wildly.
    const bufK = bitrateK * 2

    const common = ['-fflags', '+genpts', '-i', 'pipe:0']

    // Without explicit BT.709 metadata YouTube and Twitch fall back to
    // BT.601, which subtly washes out reds and crushes saturated blues —
    // the difference between "broadcast" and "looks fine I guess".
    const colorTags = [
      '-color_primaries', 'bt709',
      '-color_trc', 'bt709',
      '-colorspace', 'bt709',
      '-color_range', 'tv',
    ]
    const audioArgs = [
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    ]
    const rateControl = [
      '-b:v', `${bitrateK}k`,
      '-maxrate', `${bitrateK}k`,
      '-bufsize', `${bufK}k`,
    ]
    const rateShape = ['-r', '30', '-g', '60', '-sc_threshold', '0']

    if (encoder === 'h264_nvenc') {
      // NVENC fast-path — burns GPU cycles instead of CPU. vbr_hq holds a
      // tight bitrate cap with high-quality internal heuristics; spatial +
      // temporal AQ catch the same low-detail areas x264 does.
      return [
        ...common,
        '-c:v', 'h264_nvenc',
        '-preset', encPreset,
        '-profile:v', 'high',
        '-rc', 'vbr_hq',
        '-bf', '2', '-b_ref_mode', 'middle',
        '-spatial-aq', '1', '-temporal-aq', '1',
        '-pix_fmt', 'yuv420p',
        ...rateControl,
        ...rateShape,
        ...colorTags,
        ...audioArgs,
      ]
    }

    // libx264 — broadcast workhorse. The x264-params bundle pushes visible
    // quality wins without moving off `faster`/`medium`/`slow`:
    //   rc-lookahead=40   — deeper queue → smarter B-frame placement
    //   aq-mode=3         — variance-AQ + auto-variance, protects shadow detail
    //   aq-strength=1.0   — moderate, avoids over-flattening highlights
    //   psy-rd=0.85,0.05  — small bias toward perceived sharpness
    return [
      ...common,
      '-c:v', 'libx264',
      '-preset', encPreset,
      '-profile:v', 'high', '-level', '4.0',
      '-bf', '2',
      ...rateControl,
      '-pix_fmt', 'yuv420p',
      ...rateShape,
      '-x264-params', 'rc-lookahead=40:aq-mode=3:aq-strength=1.0:psy-rd=0.85,0.05',
      '-threads', '0',
      ...colorTags,
      ...audioArgs,
    ]
  }

  start(
    rtmpUrl: string,
    streamKey: string,
    additionalUrls: string[] = [],
    quality: StreamQualityPreset = 'standard',
  ): { ok: boolean; error?: string } {
    if (this.proc) this.stop()
    if (!ffmpegPath) return { ok: false, error: 'FFmpeg binary not available' }

    const primary = streamKey
      ? `${rtmpUrl.replace(/\/+$/, '')}/${streamKey}`
      : rtmpUrl
    // Trim/dedupe additional RTMP URLs (each expected to include its own key).
    const additionals = (additionalUrls || [])
      .map(u => (u || '').trim())
      .filter((u, i, arr) => !!u && u !== primary && arr.indexOf(u) === i)
    const allTargets = [primary, ...additionals]

    const encArgs = this.encArgsFor(quality)

    // Single destination → cheap flv mux. Multiple → tee muxer with
    // onfail=ignore so one platform dropping doesn't kill the rest.
    const outArgs = allTargets.length === 1
      ? ['-f', 'flv', allTargets[0]]
      : [
          '-map', '0:v', '-map', '0:a',
          '-f', 'tee',
          allTargets.map(t => `[f=flv:onfail=ignore]${t}`).join('|'),
        ]
    const args = [...encArgs, ...outArgs]

    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    this.proc = proc
    this.streaming = true
    this.lastError = ''

    // Per-process flags so a restart's stale exit can't trigger a reconnect,
    // and so exit + error don't both announce the same death.
    let retired = false
    let announced = false
    this.retire = () => { retired = true }

    const onGone = (code: number | null) => {
      if (announced) return
      announced = true
      if (this.proc === proc) { this.proc = null; this.streaming = false }
      if (!retired) {
        console.error(`[builtin-stream] ffmpeg ended unexpectedly (${code}): ${this.lastError}`)
        this.emit('ended', { code })
      }
    }

    // Throttle stats emissions — FFmpeg prints a stats line per second, but
    // we receive partial chunks so dedupe by clock time.
    let lastStatsAt = 0
    proc.stderr?.on('data', (d: Buffer) => {
      const text = d.toString()
      this.lastError = text.slice(-500)
      const stats = parseFfmpegStats(text)
      const now = Date.now()
      if (stats && now - lastStatsAt > 400) {
        lastStatsAt = now
        this.emit('stats', stats)
      }
    })
    proc.on('exit', code => onGone(code))
    proc.on('error', err => {
      console.error('[builtin-stream] ffmpeg spawn error:', err)
      onGone(null)
    })

    const presetLabel = PRESETS[quality]?.label ?? quality
    if (allTargets.length === 1) {
      console.log(`[builtin-stream] streaming (${presetLabel}) to ${rtmpUrl}`)
    } else {
      console.log(`[builtin-stream] simulcasting (${presetLabel}) to ${allTargets.length} destinations`)
    }
    return { ok: true }
  }

  write(chunk: ArrayBuffer) {
    const stdin = this.proc?.stdin
    if (stdin && stdin.writable) stdin.write(Buffer.from(chunk))
  }

  stop() {
    const proc = this.proc
    if (!proc) return
    this.retire?.()       // mark this process retired — its exit won't reconnect
    this.retire = null
    this.proc = null
    this.streaming = false
    try { proc.stdin?.end() } catch { /* ignore */ }
    // Give FFmpeg a moment to flush, then ensure it exits.
    setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 1500)
    console.log('[builtin-stream] stopped')
  }

  isStreaming() {
    return this.streaming
  }

  listPresets(): { id: StreamQualityPreset; label: string; encoder: string; bitrateK: number }[] {
    return (Object.keys(PRESETS) as StreamQualityPreset[]).map(id => ({
      id, label: PRESETS[id].label, encoder: PRESETS[id].encoder, bitrateK: PRESETS[id].bitrateK,
    }))
  }
}

/**
 * Parse a FFmpeg progress line into stats. Lines look like:
 *   frame=  293 fps= 30 q=22.0 size=    1532kB time=00:00:09.86 bitrate=1273.4kbits/s speed=1.01x
 * Reverse-scan to pick up the most recent fragment.
 */
function parseFfmpegStats(text: string): StreamStats | null {
  const idx = text.lastIndexOf('frame=')
  if (idx < 0) return null
  const slice = text.slice(idx)
  const pickN = (re: RegExp) => {
    const m = slice.match(re)
    return m ? Number(m[1]) : NaN
  }
  const frames = pickN(/frame=\s*(\d+)/)
  const fps = pickN(/fps=\s*([0-9.]+)/)
  const q = pickN(/q=\s*(-?[0-9.]+)/)
  const bitrateK = pickN(/bitrate=\s*([0-9.]+)\s*kbits\/s/)
  const speedM = slice.match(/speed=\s*([0-9.]+)x/)
  const speed = speedM ? Number(speedM[1]) : NaN
  const drops = pickN(/drop=\s*(\d+)/) || 0
  if (Number.isNaN(frames) && Number.isNaN(fps)) return null
  return {
    frames: Number.isFinite(frames) ? frames : 0,
    fps: Number.isFinite(fps) ? fps : 0,
    bitrateK: Number.isFinite(bitrateK) ? bitrateK : 0,
    speed: Number.isFinite(speed) ? speed : 0,
    drops,
    q: Number.isFinite(q) ? q : 0,
  }
}

export const builtinStreamer = new BuiltinStreamer()
