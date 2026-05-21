// NAR Studio — Visualizer Audio Analyser
// Wraps the Web Audio API AnalyserNode to produce:
//   • 64 mel-scale frequency bands (0..1 normalised log-amplitude)
//   • 256-sample PCM waveform (-1..1)
//   • Per-band energy aggregates: bass / mid / treble
//   • Beat detection via spectral flux onset detection
//   • Decaying beatStrength (0..1) for continuous beat reactivity

export interface AudioData {
  freqBands:   Float32Array  // 64 mel-scale bands, 0..1
  waveform:    Float32Array  // 256 PCM samples, -1..1
  rms:         number        // overall loudness, 0..1
  bass:        number        // 20–250 Hz energy, 0..1
  mid:         number        // 250–4 kHz energy, 0..1
  treble:      number        // 4–20 kHz energy, 0..1
  beat:        boolean       // true on onset this frame
  beatStrength: number       // 0..1, exponentially decays after onset
  time:        number        // seconds since connect()
}

const FFT_SIZE   = 2048          // → 1024 frequency bins
const BANDS      = 64
const WAVE_SIZE  = 256
const FLUX_HIST  = 32            // frames of flux history for adaptive threshold
const BEAT_DECAY = 0.88          // beatStrength decay per frame (~60fps)

export class AudioAnalyser {
  private ctx:       AudioContext | null = null
  private analyser:  AnalyserNode  | null = null
  private stream:    MediaStream   | null = null

  // Scratch buffers
  private freqBuf  = new Float32Array(FFT_SIZE / 2)
  private timeBuf  = new Float32Array(FFT_SIZE)
  private prevFreq = new Float32Array(FFT_SIZE / 2)

  // Mel band mapping: melBins[i] = first FFT bin index for band i
  private melBins: number[] = []

  // Beat detection state
  private fluxHistory: number[] = []
  private beatStrength = 0
  private startTime    = 0

  // Output buffers (reused each frame to avoid GC)
  private freqBands = new Float32Array(BANDS)
  private waveform  = new Float32Array(WAVE_SIZE)

  constructor() {
    this.buildMelBins()
  }

  // ── Build mel-scale band mapping ──────────────────────────────────────────

  private buildMelBins() {
    // Map BANDS+1 edges onto FFT bins using the mel scale
    // fftSize=2048 @ 44100 Hz → nyquist=22050, binWidth=22050/1024 ≈ 21.5 Hz
    const sampleRate = 44100
    const nyquist    = sampleRate / 2
    const fftBins    = FFT_SIZE / 2
    const hzToMel    = (f: number) => 2595 * Math.log10(1 + f / 700)
    const melToHz    = (m: number) => 700 * (Math.pow(10, m / 2595) - 1)

    const minMel = hzToMel(20)
    const maxMel = hzToMel(nyquist)

    this.melBins = []
    for (let i = 0; i <= BANDS; i++) {
      const mel = minMel + (maxMel - minMel) * (i / BANDS)
      const hz  = melToHz(mel)
      this.melBins.push(Math.round((hz / nyquist) * fftBins))
    }
  }

  // ── Connect to a specific audio input device ──────────────────────────────

  async connect(deviceId: string): Promise<void> {
    this.disconnect()
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })

      this.ctx      = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize            = FFT_SIZE
      this.analyser.smoothingTimeConstant = 0.75  // moderate smoothing — visualizer, not metering

      const source = this.ctx.createMediaStreamSource(this.stream)
      source.connect(this.analyser)
      // Note: do NOT connect to ctx.destination — avoids feedback through speakers

      this.startTime = this.ctx.currentTime
    } catch (e) {
      console.error('[AudioAnalyser] connect failed:', e)
    }
  }

  // ── Disconnect and release resources ─────────────────────────────────────

  disconnect(): void {
    this.stream?.getTracks().forEach(t => t.stop())
    this.ctx?.close()
    this.stream   = null
    this.ctx      = null
    this.analyser = null
    this.beatStrength = 0
    this.fluxHistory  = []
  }

  // ── Read current frame — call once per rAF tick ───────────────────────────
  // Returns a stable object (same arrays reused — copy if you need to hold it)

  read(): AudioData {
    const analyser = this.analyser
    const ctx      = this.ctx

    if (!analyser || !ctx) {
      return {
        freqBands:   this.freqBands,
        waveform:    this.waveform,
        rms: 0, bass: 0, mid: 0, treble: 0,
        beat: false, beatStrength: 0, time: 0,
      }
    }

    const time = ctx.currentTime - this.startTime

    // ── Frequency data (dBFS from WebAudio, -∞..0) ───────────────────────
    analyser.getFloatFrequencyData(this.freqBuf)

    // Compute 64 mel-scale bands via log-average of each band's FFT bins
    let totalPower = 0
    for (let b = 0; b < BANDS; b++) {
      const lo  = this.melBins[b]
      const hi  = this.melBins[b + 1]
      let   sum = 0
      const count = Math.max(1, hi - lo)
      for (let k = lo; k < hi; k++) {
        // freqBuf values are dBFS (-100..0 for AnalyserNode silence=-100)
        const linear = Math.pow(10, this.freqBuf[k] / 20)
        sum += linear
      }
      // Normalise: 0 at silence (-100 dB), 1 at 0 dBFS full scale
      const avg = (sum / count)
      const norm = Math.min(1, Math.max(0, (20 * Math.log10(avg + 1e-9) + 100) / 100))
      this.freqBands[b] = norm
      totalPower += norm
    }

    // ── Waveform ─────────────────────────────────────────────────────────
    analyser.getFloatTimeDomainData(this.timeBuf)
    // Downsample from FFT_SIZE to WAVE_SIZE
    const step = FFT_SIZE / WAVE_SIZE
    for (let i = 0; i < WAVE_SIZE; i++) {
      this.waveform[i] = this.timeBuf[Math.floor(i * step)]
    }

    // ── RMS from time-domain ──────────────────────────────────────────────
    let rmsSum = 0
    for (let i = 0; i < this.timeBuf.length; i++) rmsSum += this.timeBuf[i] ** 2
    const rms = Math.sqrt(rmsSum / this.timeBuf.length)

    // ── Band aggregates ───────────────────────────────────────────────────
    // Bass:   bands 0–7   (~20–250 Hz)
    // Mid:    bands 8–43  (~250–4 kHz)
    // Treble: bands 44–63 (~4–20 kHz)
    let bass = 0, mid = 0, treble = 0
    for (let i = 0;  i < 8;  i++) bass   += this.freqBands[i]
    for (let i = 8;  i < 44; i++) mid    += this.freqBands[i]
    for (let i = 44; i < 64; i++) treble += this.freqBands[i]
    bass   = Math.min(1, bass   / 8)
    mid    = Math.min(1, mid    / 36)
    treble = Math.min(1, treble / 20)

    // ── Beat detection — spectral flux in bass/low-mid region ────────────
    // Flux = sum of positive differences in low-frequency FFT bins
    let flux = 0
    const fluxHi = Math.floor(this.freqBuf.length * 0.15)  // bottom 15% of spectrum
    for (let k = 0; k < fluxHi; k++) {
      const delta = this.freqBuf[k] - this.prevFreq[k]
      if (delta > 0) flux += delta
    }
    this.prevFreq.set(this.freqBuf)

    this.fluxHistory.push(flux)
    if (this.fluxHistory.length > FLUX_HIST) this.fluxHistory.shift()

    const mean = this.fluxHistory.reduce((a, b) => a + b, 0) / this.fluxHistory.length
    const beat = flux > mean * 1.4 && flux > 5.0  // suppress false positives at silence

    if (beat) {
      this.beatStrength = 1.0
    } else {
      this.beatStrength *= BEAT_DECAY
    }

    return {
      freqBands:   this.freqBands,
      waveform:    this.waveform,
      rms:         Math.min(1, rms * 3),
      bass, mid, treble,
      beat,
      beatStrength: this.beatStrength,
      time,
    }
  }

  get connected(): boolean { return this.analyser !== null }
}
