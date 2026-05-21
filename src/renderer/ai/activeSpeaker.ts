/**
 * Audio-visual active-speaker detection.
 *
 * With a single mixed audio feed you cannot tell *who* is talking from sound
 * alone. This detector instead correlates each camera's mouth motion against
 * the audio envelope over a short window: the face whose mouth movement tracks
 * the sound is the speaker. Correlation — not merely "a mouth is moving" —
 * rejects chewing, smiling and nodding.
 */

const WINDOW_MS = 3200      // analysis window
const BIN_MS = 260          // resample bucket (≈ the per-camera mouth sample rate)
const BINS = Math.round(WINDOW_MS / BIN_MS)
const MIN_AUDIO = 0.05      // window audio below this ⇒ treat the room as silent
const CORR_FLOOR = 0.25     // a moving mouth still scores this with weak correlation
const MOTION_FULL = 0.05    // mean mouth-motion that maps to a full energy score

export interface SpeakerResult {
  /** Camera index of the active speaker, or -1 when none is confident. */
  speaker: number
  /** Confidence 0..1 — the winning camera's speaking score. */
  confidence: number
  /** Per-camera speaking score 0..1. */
  scores: number[]
}

interface Sample { t: number; v: number }

function trim(buf: Sample[], now: number): void {
  const cutoff = now - WINDOW_MS - BIN_MS
  while (buf.length > 0 && buf[0].t < cutoff) buf.shift()
}

/** Pearson correlation of two equal-length series; 0 when either is flat. */
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  let ma = 0, mb = 0
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] }
  ma /= n; mb /= n
  let cov = 0, va = 0, vb = 0
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb
    cov += da * db; va += da * da; vb += db * db
  }
  if (va < 1e-9 || vb < 1e-9) return 0
  return cov / Math.sqrt(va * vb)
}

/** Bin samples into BINS buckets over [now-WINDOW, now]; empty buckets read 0. */
function bin(samples: Sample[], now: number): number[] {
  const out = new Array(BINS).fill(0)
  const cnt = new Array(BINS).fill(0)
  const start = now - WINDOW_MS
  for (const s of samples) {
    const idx = Math.floor((s.t - start) / BIN_MS)
    if (idx >= 0 && idx < BINS) { out[idx] += s.v; cnt[idx] += 1 }
  }
  for (let i = 0; i < BINS; i++) if (cnt[i] > 0) out[i] /= cnt[i]
  return out
}

export class ActiveSpeakerDetector {
  private audio: Sample[] = []
  private jaw: Sample[][] = [[], [], [], []]

  pushAudio(t: number, level: number): void {
    this.audio.push({ t, v: level })
    trim(this.audio, t)
  }

  /** Push a mouth-openness reading for a camera. `hasFace=false` records a gap. */
  pushMouth(cam: number, t: number, mouthOpen: number, hasFace: boolean): void {
    if (cam < 0 || cam > 3) return
    const buf = this.jaw[cam]
    buf.push({ t, v: hasFace ? mouthOpen : NaN })
    trim(buf, t)
  }

  reset(): void {
    this.audio = []
    this.jaw = [[], [], [], []]
  }

  /** Score every camera and return the most likely active speaker. */
  evaluate(now: number): SpeakerResult {
    const scores = [0, 0, 0, 0]
    const audioBins = bin(this.audio, now)
    const audioMean = audioBins.reduce((s, v) => s + v, 0) / BINS
    if (audioMean < MIN_AUDIO) return { speaker: -1, confidence: 0, scores }

    for (let c = 0; c < 4; c++) {
      const samples = this.jaw[c].filter(s => Number.isFinite(s.v))
      if (samples.length < 3) continue
      // Mouth-motion — absolute change between consecutive openness readings.
      const motion: Sample[] = []
      for (let i = 1; i < samples.length; i++) {
        motion.push({ t: samples[i].t, v: Math.abs(samples[i].v - samples[i - 1].v) })
      }
      const motionBins = bin(motion, now)
      const energy = motionBins.reduce((s, v) => s + v, 0) / BINS
      const corr = pearson(audioBins, motionBins)
      const energyScore = Math.min(1, energy / MOTION_FULL)
      // Energy says "this mouth is busy"; correlation says "busy with the sound".
      scores[c] = energyScore * (CORR_FLOOR + (1 - CORR_FLOOR) * Math.max(0, corr))
    }

    let speaker = -1
    let best = 0
    for (let c = 0; c < 4; c++) {
      if (scores[c] > best) { best = scores[c]; speaker = c }
    }
    return { speaker, confidence: best, scores }
  }
}
