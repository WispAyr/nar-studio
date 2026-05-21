// NAR Studio Visualizer — WebGPU Engine
// Full HDR rendering pipeline ported from CHROMATIC (C++/OpenGL 4.6):
//
//   Scene layer renders into rgba16float HDR texture (unclamped HDR values)
//   ↓
//   Jimenez dual-kawase bloom (6-level mip chain, Karis + Eero Mutka firefly clamp)
//   ↓
//   Post-process: ACES tonemap + CA + vignette + grain + dither → rgba8unorm
//   ↓
//   Fullscreen blit to canvas

import bloomShaderSrc    from './shaders/bloom.wgsl?raw'
import postShaderSrc     from './shaders/post.wgsl?raw'
import spectrumShaderSrc from './shaders/spectrum.wgsl?raw'
import waveformShaderSrc from './shaders/waveform.wgsl?raw'
import particlesShaderSrc from './shaders/particles.wgsl?raw'
import blitShaderSrc     from './shaders/blit.wgsl?raw'
import type { AudioData } from './AudioAnalyser'

// ── Post-process parameters (matches PostParams struct in post.wgsl) ──────────

export interface PostParams {
  bloomStrength:    number   // default 0.15
  bloomThreshold:   number   // default 0.80
  vignetteStrength: number   // default 0.32
  aberrationBase:   number   // default 0.0008
  aberrationBeat:   number   // default 0.009
  grainStrength:    number   // default 0.012
  exposure:         number   // default 1.10
  lensDistortion:   number   // default 0.012
  saturation:       number   // default 1.15
}

export interface VizParams {
  spectrumEnabled:  boolean
  waveformEnabled:  boolean
  particlesEnabled: boolean
  primaryColor:     [number, number, number]   // linear RGB
  accentColor:      [number, number, number]
  post:             PostParams
}

const BLOOM_LEVELS   = 6
const PARTICLE_COUNT = 200_000
const BANDS          = 64

// Default params matching CHROMATIC's defaults
export const DEFAULT_POST_PARAMS: PostParams = {
  bloomStrength:    0.15,
  bloomThreshold:   0.80,
  vignetteStrength: 0.32,
  aberrationBase:   0.0008,
  aberrationBeat:   0.009,
  grainStrength:    0.012,
  exposure:         1.10,
  lensDistortion:   0.012,
  saturation:       1.15,
}

export const DEFAULT_VIZ_PARAMS: VizParams = {
  spectrumEnabled:  true,
  waveformEnabled:  true,
  particlesEnabled: true,
  primaryColor:     [0.91, 0.0, 0.24],  // NAR red #E8003C in linear
  accentColor:      [0.0, 0.45, 1.0],   // blue accent
  post:             DEFAULT_POST_PARAMS,
}

// ── WebGPUEngine ─────────────────────────────────────────────────────────────

export class WebGPUEngine {
  private device!:    GPUDevice
  private context!:   GPUCanvasContext
  private canvasFmt!: GPUTextureFormat

  private width  = 1920
  private height = 1080

  // HDR scene FBO
  private hdrTex!: GPUTexture

  // Bloom chain: 6 × down + 6 × up (ping-pong, no read-write storage needed)
  private bloomDown: GPUTexture[] = []
  private bloomUp:   GPUTexture[] = []
  private bloomW:    number[] = []
  private bloomH:    number[] = []

  // Post output (rgba8unorm)
  private outputTex!: GPUTexture

  // Particle buffer (PARTICLE_COUNT × Particle struct = 8 floats = 32 bytes each)
  private particleBuf!: GPUBuffer

  // GPU uniform/storage buffers
  private bandBuf!:       GPUBuffer   // 64 f32 band heights
  private waveformBuf!:   GPUBuffer   // 256 f32 waveform samples
  private spectrumUniBuf!: GPUBuffer
  private waveformUniBuf!: GPUBuffer
  private particleUniBuf!: GPUBuffer
  private postParamsBuf!:  GPUBuffer

  // Pipelines
  private bloomDownPipeline!:   GPUComputePipeline
  private bloomUpPipeline!:     GPUComputePipeline
  private postPipeline!:        GPUComputePipeline
  private spectrumPipeline!:    GPURenderPipeline
  private waveformPipeline!:    GPURenderPipeline
  private particleComputePipeline!: GPUComputePipeline
  private particleRenderPipeline!:  GPURenderPipeline
  private blitPipeline!:        GPURenderPipeline

  // Samplers
  private linearSampler!: GPUSampler

  // Audio state (updated each frame)
  private lastAudio: AudioData | null = null
  private params: VizParams = { ...DEFAULT_VIZ_PARAMS, post: { ...DEFAULT_POST_PARAMS } }
  private startTime = 0

  // ── Initialise ──────────────────────────────────────────────────────────────

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported')

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    })
    if (!adapter) throw new Error('No WebGPU adapter found')

    this.device = await adapter.requestDevice({
      label: 'NAR Visualizer',
    })

    this.context   = canvas.getContext('webgpu') as GPUCanvasContext
    this.canvasFmt = navigator.gpu.getPreferredCanvasFormat()

    this.context.configure({
      device: this.device,
      format: this.canvasFmt,
      alphaMode: 'opaque',
    })

    this.width  = canvas.width
    this.height = canvas.height
    this.startTime = performance.now()

    this.linearSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })

    this.createTextures()
    this.createBuffers()
    this.createPipelines()
    this.initParticles()
  }

  // ── Textures ─────────────────────────────────────────────────────────────────

  private createTextures() {
    const dev = this.device

    // HDR scene FBO — rgba16float, no clamping
    this.hdrTex = dev.createTexture({
      label: 'hdrScene',
      size: [this.width, this.height],
      format: 'rgba16float',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })

    // Bloom mip chain
    this.bloomDown = []
    this.bloomUp   = []
    this.bloomW    = []
    this.bloomH    = []
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const w = Math.max(1, this.width  >> (i + 1))
      const h = Math.max(1, this.height >> (i + 1))
      this.bloomW.push(w)
      this.bloomH.push(h)
      this.bloomDown.push(dev.createTexture({
        label: `bloomDown${i}`,
        size: [w, h],
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }))
      this.bloomUp.push(dev.createTexture({
        label: `bloomUp${i}`,
        size: [w, h],
        format: 'rgba16float',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
      }))
    }

    // Post output — rgba8unorm (storage-capable)
    this.outputTex = dev.createTexture({
      label: 'output',
      size: [this.width, this.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    })
  }

  private destroyTextures() {
    this.hdrTex?.destroy()
    this.bloomDown.forEach(t => t.destroy())
    this.bloomUp.forEach(t => t.destroy())
    this.outputTex?.destroy()
    this.bloomDown = []
    this.bloomUp   = []
  }

  // ── Buffers ───────────────────────────────────────────────────────────────────

  private createBuffers() {
    const dev = this.device
    const U = GPUBufferUsage

    this.bandBuf = dev.createBuffer({
      label: 'bandHeights',
      size: BANDS * 4,
      usage: U.STORAGE | U.COPY_DST,
    })
    this.waveformBuf = dev.createBuffer({
      label: 'waveform',
      size: 256 * 4,
      usage: U.STORAGE | U.COPY_DST,
    })

    // Spectrum uniform: colorLow(3) + pad + colorHigh(3) + pad + glow + beat + aspect + pad
    this.spectrumUniBuf = dev.createBuffer({
      label: 'spectrumUni',
      size: 48,
      usage: U.UNIFORM | U.COPY_DST,
    })

    // Waveform uniform: color(3) + pad + beat + thickness + aspect + pad
    this.waveformUniBuf = dev.createBuffer({
      label: 'waveformUni',
      size: 32,
      usage: U.UNIFORM | U.COPY_DST,
    })

    // Particle uniform: colorA(3)+pad + colorB(3)+pad + beat+beatStr+dt+time + bass+rms+aspect+pad
    this.particleUniBuf = dev.createBuffer({
      label: 'particleUni',
      size: 64,
      usage: U.UNIFORM | U.COPY_DST,
    })

    // Post params: imageSize(2) + 12 floats + 3 pad = 16 floats = 64 bytes
    this.postParamsBuf = dev.createBuffer({
      label: 'postParams',
      size: 64,
      usage: U.UNIFORM | U.COPY_DST,
    })

    // Particle storage buffer: PARTICLE_COUNT × 8 floats (32 bytes)
    this.particleBuf = dev.createBuffer({
      label: 'particles',
      size: PARTICLE_COUNT * 32,
      usage: U.STORAGE,
    })
  }

  // ── Particle initialisation ───────────────────────────────────────────────────

  private initParticles() {
    // All particles start dead (life=0) — GPU compute will spawn them naturally
    // They only need a unique seed value so each particle's hash gives different results
    const buf = new Float32Array(PARTICLE_COUNT * 8)
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const base = i * 8
      buf[base + 7] = i * 0.00013 + 0.0001  // seed — unique per particle
    }
    const staging = this.device.createBuffer({
      size: buf.byteLength,
      usage: GPUBufferUsage.MAP_WRITE | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    })
    new Float32Array(staging.getMappedRange()).set(buf)
    staging.unmap()

    const enc = this.device.createCommandEncoder()
    enc.copyBufferToBuffer(staging, 0, this.particleBuf, 0, buf.byteLength)
    this.device.queue.submit([enc.finish()])
    staging.destroy()
  }

  // ── Pipelines ─────────────────────────────────────────────────────────────────

  private createPipelines() {
    const dev = this.device

    const bloomModule    = dev.createShaderModule({ code: bloomShaderSrc    })
    const postModule     = dev.createShaderModule({ code: postShaderSrc     })
    const spectrumModule = dev.createShaderModule({ code: spectrumShaderSrc })
    const waveformModule = dev.createShaderModule({ code: waveformShaderSrc })
    const particleModule = dev.createShaderModule({ code: particlesShaderSrc })
    const blitModule     = dev.createShaderModule({ code: blitShaderSrc     })

    // ── Bloom down ────────────────────────────────────────────────────────
    this.bloomDownPipeline = dev.createComputePipeline({
      label: 'bloomDown',
      layout: 'auto',
      compute: { module: bloomModule, entryPoint: 'cs_down' },
    })

    // ── Bloom up ──────────────────────────────────────────────────────────
    this.bloomUpPipeline = dev.createComputePipeline({
      label: 'bloomUp',
      layout: 'auto',
      compute: { module: bloomModule, entryPoint: 'cs_up' },
    })

    // ── Post composite ────────────────────────────────────────────────────
    this.postPipeline = dev.createComputePipeline({
      label: 'post',
      layout: 'auto',
      compute: { module: postModule, entryPoint: 'cs_main' },
    })

    // ── Spectrum bars ─────────────────────────────────────────────────────
    this.spectrumPipeline = dev.createRenderPipeline({
      label: 'spectrum',
      layout: 'auto',
      vertex:   { module: spectrumModule, entryPoint: 'vs_main' },
      fragment: {
        module: spectrumModule,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })

    // ── Waveform ──────────────────────────────────────────────────────────
    this.waveformPipeline = dev.createRenderPipeline({
      label: 'waveform',
      layout: 'auto',
      vertex:   { module: waveformModule, entryPoint: 'vs_main' },
      fragment: {
        module: waveformModule,
        entryPoint: 'fs_main',
        targets: [{
          format: 'rgba16float',
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })

    // ── Particle compute ──────────────────────────────────────────────────
    this.particleComputePipeline = dev.createComputePipeline({
      label: 'particleUpdate',
      layout: 'auto',
      compute: { module: particleModule, entryPoint: 'cs_update' },
    })

    // ── Particle render ───────────────────────────────────────────────────
    this.particleRenderPipeline = dev.createRenderPipeline({
      label: 'particleRender',
      layout: 'auto',
      vertex:   { module: particleModule, entryPoint: 'vs_render' },
      fragment: {
        module: particleModule,
        entryPoint: 'fs_render',
        targets: [{
          format: 'rgba16float',
          // Additive blending — particles accumulate into the HDR buffer
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one',       dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    })

    // ── Fullscreen blit ───────────────────────────────────────────────────
    this.blitPipeline = dev.createRenderPipeline({
      label: 'blit',
      layout: 'auto',
      vertex:   { module: blitModule, entryPoint: 'vs_main' },
      fragment: {
        module: blitModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.canvasFmt }],
      },
      primitive: { topology: 'triangle-list' },
    })
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  setAudioData(data: AudioData): void {
    this.lastAudio = data
  }

  setParams(params: Partial<VizParams>): void {
    this.params = {
      ...this.params,
      ...params,
      post: { ...this.params.post, ...(params.post ?? {}) },
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return
    this.width  = width
    this.height = height
    this.destroyTextures()
    this.createTextures()
  }

  destroy(): void {
    this.destroyTextures()
    this.bandBuf?.destroy()
    this.waveformBuf?.destroy()
    this.spectrumUniBuf?.destroy()
    this.waveformUniBuf?.destroy()
    this.particleUniBuf?.destroy()
    this.postParamsBuf?.destroy()
    this.particleBuf?.destroy()
    this.device?.destroy()
  }

  // ── Per-frame render ──────────────────────────────────────────────────────────

  render(): void {
    const dev   = this.device
    const audio = this.lastAudio
    const time  = (performance.now() - this.startTime) / 1000
    const p     = this.params

    // ── Upload audio data to GPU ────────────────────────────────────────
    if (audio) {
      dev.queue.writeBuffer(this.bandBuf, 0, audio.freqBands)
      dev.queue.writeBuffer(this.waveformBuf, 0, audio.waveform)
    }

    const beat  = audio?.beatStrength ?? 0
    const bass  = audio?.bass  ?? 0
    const rms   = audio?.rms   ?? 0
    const aspect = this.width / this.height

    // Spectrum uniforms: colorLow(3)+pad + colorHigh(3)+pad + glow + beat + aspect + pad
    const specUni = new Float32Array(12)
    specUni.set(p.primaryColor, 0)   // colorLow at 0..2
    specUni.set(p.accentColor,  4)   // colorHigh at 4..6
    specUni[8] = 0.5 + beat * 0.5   // glow
    specUni[9] = beat                 // beat
    specUni[10] = aspect
    dev.queue.writeBuffer(this.spectrumUniBuf, 0, specUni)

    // Waveform uniforms: color(3)+pad + beat + thickness + aspect + pad
    const waveUni = new Float32Array(8)
    waveUni.set(p.accentColor, 0)
    waveUni[4] = beat
    waveUni[5] = 0.004
    waveUni[6] = aspect
    dev.queue.writeBuffer(this.waveformUniBuf, 0, waveUni)

    // Particle uniforms: colorA(3)+pad + colorB(3)+pad + beat+beatStr+dt+time + bass+rms+aspect+pad
    const partUni = new Float32Array(16)
    partUni.set(p.primaryColor, 0)
    partUni.set(p.accentColor,  4)
    partUni[8]  = audio?.beat ? 1 : 0
    partUni[9]  = beat
    partUni[10] = 1 / 60  // dt — assume 60fps; refined in future
    partUni[11] = time
    partUni[12] = bass
    partUni[13] = rms
    partUni[14] = aspect
    dev.queue.writeBuffer(this.particleUniBuf, 0, partUni)

    // Post params
    const pp = p.post
    const postUni = new Float32Array(16)
    postUni[0]  = this.width
    postUni[1]  = this.height
    postUni[2]  = pp.bloomStrength
    postUni[3]  = 0                       // bloomDirt
    postUni[4]  = pp.vignetteStrength
    postUni[5]  = pp.aberrationBase
    postUni[6]  = pp.aberrationBeat
    postUni[7]  = beat
    postUni[8]  = pp.grainStrength
    postUni[9]  = pp.exposure
    postUni[10] = pp.lensDistortion
    postUni[11] = pp.saturation
    postUni[12] = time
    dev.queue.writeBuffer(this.postParamsBuf, 0, postUni)

    // ── Build command buffer ────────────────────────────────────────────
    const enc = dev.createCommandEncoder({ label: 'frame' })

    // ── 1. Particle compute update ──────────────────────────────────────
    if (p.particlesEnabled) {
      const cpass = enc.beginComputePass({ label: 'particleUpdate' })
      cpass.setPipeline(this.particleComputePipeline)
      cpass.setBindGroup(0, dev.createBindGroup({
        layout: this.particleComputePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.particleBuf } },
          { binding: 1, resource: { buffer: this.particleUniBuf } },
        ],
      }))
      cpass.dispatchWorkgroups(Math.ceil(PARTICLE_COUNT / 64))
      cpass.end()
    }

    // ── 2. Scene render into HDR texture ────────────────────────────────
    const hdrView = this.hdrTex.createView()

    if (p.spectrumEnabled && audio) {
      const rpass = enc.beginRenderPass({
        colorAttachments: [{
          view: hdrView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      })
      rpass.setPipeline(this.spectrumPipeline)
      rpass.setBindGroup(0, dev.createBindGroup({
        layout: this.spectrumPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.bandBuf } },
          { binding: 1, resource: { buffer: this.spectrumUniBuf } },
        ],
      }))
      rpass.draw(6, BANDS)
      rpass.end()
    } else {
      // Clear HDR texture even if spectrum is disabled
      const rpass = enc.beginRenderPass({
        colorAttachments: [{
          view: hdrView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      })
      rpass.end()
    }

    if (p.waveformEnabled && audio) {
      const rpass = enc.beginRenderPass({
        colorAttachments: [{
          view: hdrView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      })
      rpass.setPipeline(this.waveformPipeline)
      rpass.setBindGroup(0, dev.createBindGroup({
        layout: this.waveformPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.waveformBuf } },
          { binding: 1, resource: { buffer: this.waveformUniBuf } },
        ],
      }))
      rpass.draw(6, 255)  // 255 segments × 6 verts
      rpass.end()
    }

    if (p.particlesEnabled) {
      const rpass = enc.beginRenderPass({
        colorAttachments: [{
          view: hdrView,
          loadOp: 'load',
          storeOp: 'store',
        }],
      })
      rpass.setPipeline(this.particleRenderPipeline)
      rpass.setBindGroup(0, dev.createBindGroup({
        layout: this.particleRenderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.particleBuf } },
          { binding: 1, resource: { buffer: this.particleUniBuf } },
        ],
      }))
      rpass.draw(6, PARTICLE_COUNT)
      rpass.end()
    }

    // ── 3. Bloom — downsample chain ──────────────────────────────────────
    this.dispatchBloomDown(enc)

    // ── 4. Bloom — upsample + accumulate chain ───────────────────────────
    this.dispatchBloomUp(enc)

    // ── 5. Post-process ──────────────────────────────────────────────────
    {
      const cpass = enc.beginComputePass({ label: 'post' })
      cpass.setPipeline(this.postPipeline)
      cpass.setBindGroup(0, dev.createBindGroup({
        layout: this.postPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.outputTex.createView() },
          { binding: 1, resource: this.hdrTex.createView() },
          { binding: 2, resource: this.bloomUp[0].createView() },
          { binding: 3, resource: this.linearSampler },
        ],
      }))
      cpass.setBindGroup(1, dev.createBindGroup({
        layout: this.postPipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: this.postParamsBuf } }],
      }))
      cpass.dispatchWorkgroups(
        Math.ceil(this.width  / 8),
        Math.ceil(this.height / 8),
      )
      cpass.end()
    }

    // ── 6. Blit output → canvas ──────────────────────────────────────────
    {
      const canvasView = this.context.getCurrentTexture().createView()
      const rpass = enc.beginRenderPass({
        colorAttachments: [{
          view: canvasView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      })
      rpass.setPipeline(this.blitPipeline)
      rpass.setBindGroup(0, dev.createBindGroup({
        layout: this.blitPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.outputTex.createView() },
          { binding: 1, resource: this.linearSampler },
        ],
      }))
      rpass.draw(3)  // single oversized triangle
      rpass.end()
    }

    dev.queue.submit([enc.finish()])
  }

  // ── Bloom dispatch helpers ────────────────────────────────────────────────────

  private makeBloomParamsBuf(
    srcW: number, srcH: number,
    dstW: number, dstH: number,
    threshold: number, radius: number,
    isFirst: number,
  ): GPUBuffer {
    const buf = this.device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    })
    const data = new Float32Array(buf.getMappedRange())
    data[0] = srcW;  data[1] = srcH
    data[2] = dstW;  data[3] = dstH
    data[4] = threshold
    data[5] = radius
    data[6] = isFirst
    buf.unmap()
    return buf
  }

  private dispatchBloomDown(enc: GPUCommandEncoder) {
    const dev = this.device
    const cpass = enc.beginComputePass({ label: 'bloomDown' })
    cpass.setPipeline(this.bloomDownPipeline)

    // Pass 0: scene HDR → bloom_down[0]  (threshold + karis + firefly)
    {
      const paramsBuf = this.makeBloomParamsBuf(
        this.width, this.height,
        this.bloomW[0], this.bloomH[0],
        this.params.post.bloomThreshold, 1.0, 1.0,
      )
      cpass.setBindGroup(0, dev.createBindGroup({
        layout: this.bloomDownPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.bloomDown[0].createView() },
          { binding: 1, resource: this.hdrTex.createView() },
          { binding: 2, resource: this.linearSampler },
          { binding: 3, resource: this.bloomDown[0].createView() },  // unused in down pass
        ],
      }))
      cpass.setBindGroup(1, dev.createBindGroup({
        layout: this.bloomDownPipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: paramsBuf } }],
      }))
      cpass.dispatchWorkgroups(
        Math.ceil(this.bloomW[0] / 8),
        Math.ceil(this.bloomH[0] / 8),
      )
      paramsBuf.destroy()
    }

    // Passes 1..BLOOM_LEVELS-1: bloom_down[i-1] → bloom_down[i]
    for (let i = 1; i < BLOOM_LEVELS; i++) {
      const paramsBuf = this.makeBloomParamsBuf(
        this.bloomW[i-1], this.bloomH[i-1],
        this.bloomW[i],   this.bloomH[i],
        0.0, 1.0, 0.0,
      )
      cpass.setBindGroup(0, dev.createBindGroup({
        layout: this.bloomDownPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.bloomDown[i].createView() },
          { binding: 1, resource: this.bloomDown[i-1].createView() },
          { binding: 2, resource: this.linearSampler },
          { binding: 3, resource: this.bloomDown[i].createView() }, // unused
        ],
      }))
      cpass.setBindGroup(1, dev.createBindGroup({
        layout: this.bloomDownPipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: paramsBuf } }],
      }))
      cpass.dispatchWorkgroups(
        Math.ceil(this.bloomW[i] / 8),
        Math.ceil(this.bloomH[i] / 8),
      )
      paramsBuf.destroy()
    }

    cpass.end()
  }

  private dispatchBloomUp(enc: GPUCommandEncoder) {
    const dev = this.device
    const cpass = enc.beginComputePass({ label: 'bloomUp' })
    cpass.setPipeline(this.bloomUpPipeline)

    // Upsample from highest level (BLOOM_LEVELS-1) down to 0
    // For i = BLOOM_LEVELS-2 .. 0:
    //   src   = bloom_up[i+1]  (or bloom_down[BLOOM_LEVELS-1] for first pass)
    //   accum = bloom_down[i]
    //   dst   = bloom_up[i]

    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const isFirst = (i === BLOOM_LEVELS - 2)
      const srcTex  = isFirst ? this.bloomDown[BLOOM_LEVELS - 1] : this.bloomUp[i + 1]
      const srcW    = isFirst ? this.bloomW[BLOOM_LEVELS - 1]    : this.bloomW[i + 1]
      const srcH    = isFirst ? this.bloomH[BLOOM_LEVELS - 1]    : this.bloomH[i + 1]

      const paramsBuf = this.makeBloomParamsBuf(
        srcW, srcH,
        this.bloomW[i], this.bloomH[i],
        0.0, 1.0, 0.0,
      )
      cpass.setBindGroup(0, dev.createBindGroup({
        layout: this.bloomUpPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.bloomUp[i].createView() },
          { binding: 1, resource: srcTex.createView() },
          { binding: 2, resource: this.linearSampler },
          { binding: 3, resource: this.bloomDown[i].createView() },
        ],
      }))
      cpass.setBindGroup(1, dev.createBindGroup({
        layout: this.bloomUpPipeline.getBindGroupLayout(1),
        entries: [{ binding: 0, resource: { buffer: paramsBuf } }],
      }))
      cpass.dispatchWorkgroups(
        Math.ceil(this.bloomW[i] / 8),
        Math.ceil(this.bloomH[i] / 8),
      )
      paramsBuf.destroy()
    }

    cpass.end()
  }
}
