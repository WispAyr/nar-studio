/**
 * Built-in engine RTMP streamer — receives encoded media chunks from the
 * renderer's MediaRecorder over IPC and pipes them through a bundled FFmpeg
 * which transcodes to H.264/AAC and pushes to an RTMP destination.
 *
 * Emits 'ended' when FFmpeg exits *unexpectedly* (an RTMP/network drop) — never
 * on a clean operator stop — so the renderer can reconnect.
 */
import { spawn, type ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import ffmpegPath from 'ffmpeg-static'

class BuiltinStreamer extends EventEmitter {
  private proc: ChildProcess | null = null
  private streaming = false
  /** Retires the current process so its exit is treated as intentional. */
  private retire: (() => void) | null = null
  private lastError = ''

  start(rtmpUrl: string, streamKey: string): { ok: boolean; error?: string } {
    if (this.proc) this.stop()
    if (!ffmpegPath) return { ok: false, error: 'FFmpeg binary not available' }

    const target = streamKey
      ? `${rtmpUrl.replace(/\/+$/, '')}/${streamKey}`
      : rtmpUrl

    const args = [
      '-fflags', '+genpts',
      '-i', 'pipe:0',
      // YouTube buffers ~10s, so favour efficiency over latency: the 'medium'
      // preset + B-frames + high profile is markedly cleaner than veryfast /
      // zerolatency at the same bitrate. The studio CPU has ample headroom.
      '-c:v', 'libx264', '-preset', 'medium', '-profile:v', 'high', '-bf', '3',
      '-b:v', '4500k', '-maxrate', '4500k', '-bufsize', '9000k',
      '-pix_fmt', 'yuv420p', '-g', '60',
      // 48 kHz is the broadcast standard and avoids resampling the 48 kHz
      // capture; 256k AAC is cheap insurance for an audio-led organisation.
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
      '-f', 'flv', target,
    ]

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

    proc.stderr?.on('data', (d: Buffer) => { this.lastError = d.toString().slice(-500) })
    proc.on('exit', code => onGone(code))
    proc.on('error', err => {
      console.error('[builtin-stream] ffmpeg spawn error:', err)
      onGone(null)
    })

    console.log(`[builtin-stream] streaming to ${rtmpUrl}`)
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
}

export const builtinStreamer = new BuiltinStreamer()
