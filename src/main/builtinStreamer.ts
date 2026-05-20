/**
 * Built-in engine RTMP streamer — receives encoded media chunks from the
 * renderer's MediaRecorder over IPC and pipes them through a bundled FFmpeg
 * which transcodes to H.264/AAC and pushes to an RTMP destination.
 */
import { spawn, type ChildProcess } from 'child_process'
import ffmpegPath from 'ffmpeg-static'

class BuiltinStreamer {
  private proc: ChildProcess | null = null
  private streaming = false
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
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
      '-b:v', '4500k', '-maxrate', '4500k', '-bufsize', '9000k',
      '-pix_fmt', 'yuv420p', '-g', '60',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '44100',
      '-f', 'flv', target,
    ]

    this.proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    this.lastError = ''
    this.proc.stderr?.on('data', (d: Buffer) => {
      this.lastError = d.toString().slice(-500)
    })
    this.proc.on('exit', code => {
      if (code !== 0 && code !== null) {
        console.error(`[builtin-stream] ffmpeg exited ${code}: ${this.lastError}`)
      }
      this.proc = null
      this.streaming = false
    })
    this.proc.on('error', err => {
      console.error('[builtin-stream] ffmpeg spawn error:', err)
      this.proc = null
      this.streaming = false
    })

    this.streaming = true
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
    this.proc = null
    this.streaming = false
    try { proc.stdin?.end() } catch {}
    // Give FFmpeg a moment to flush, then ensure it exits.
    setTimeout(() => { try { proc.kill() } catch {} }, 1500)
    console.log('[builtin-stream] stopped')
  }

  isStreaming() {
    return this.streaming
  }
}

export const builtinStreamer = new BuiltinStreamer()
