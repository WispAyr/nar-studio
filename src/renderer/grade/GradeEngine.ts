// WebGL2 colour-grading engine.
// Framework-agnostic. Self-contained — no imports outside src/renderer/grade/.

import { FRAGMENT_SHADER, VERTEX_SHADER } from './shaders';
import type { CubeLUT, Grade } from './types';

/** Output resolution of the engine's internal canvas. */
const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;

/** A source the engine can grade. */
export type GradeSource = HTMLVideoElement | HTMLCanvasElement;

interface GLState {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  sourceTex: WebGLTexture;
  lutTex: WebGLTexture;
  uniforms: {
    source: WebGLUniformLocation | null;
    lut: WebGLUniformLocation | null;
    lift: WebGLUniformLocation | null;
    gamma: WebGLUniformLocation | null;
    gain: WebGLUniformLocation | null;
    contrast: WebGLUniformLocation | null;
    saturation: WebGLUniformLocation | null;
    temperature: WebGLUniformLocation | null;
    tint: WebGLUniformLocation | null;
    useLut: WebGLUniformLocation | null;
    lutSize: WebGLUniformLocation | null;
    lutDomainMin: WebGLUniformLocation | null;
    lutDomainMax: WebGLUniformLocation | null;
  };
}

/**
 * A WebGL2 colour-grading engine.
 *
 * Owns an offscreen 1920x1080 canvas. `process()` uploads a source frame,
 * runs the grade shader, and returns the engine's canvas — callers then
 * `drawImage()` it onto their compositor canvas.
 *
 * If WebGL2 is unavailable (or context creation fails), the engine falls
 * back to a 2D canvas and `process()` returns the source drawn unmodified.
 */
export class GradeEngine {
  /** The engine's offscreen output canvas (always valid). */
  readonly canvas: HTMLCanvasElement;

  private gl: GLState | null = null;
  private fallback2d: CanvasRenderingContext2D | null = null;
  private disposed = false;

  /** Identity of the LUT currently uploaded to the GPU (to skip re-uploads). */
  private uploadedLut: CubeLUT | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = OUTPUT_WIDTH;
    this.canvas.height = OUTPUT_HEIGHT;

    try {
      this.gl = this.initGL();
    } catch {
      this.gl = null;
    }

    if (!this.gl) {
      // Fall back to a plain 2D context.
      this.fallback2d = this.canvas.getContext('2d');
    }
  }

  /** True if hardware-accelerated grading is active; false in 2D fallback. */
  get isAccelerated(): boolean {
    return this.gl !== null;
  }

  /**
   * Grade one frame from `source` and return the engine's canvas.
   *
   * The returned canvas is reused every call — copy/draw it before the next
   * `process()` if you need to retain the pixels.
   *
   * Never throws: on any failure it falls back to drawing the source
   * unmodified onto the canvas.
   */
  process(source: GradeSource, grade: Grade): HTMLCanvasElement {
    if (this.disposed) return this.canvas;

    if (!this.gl) {
      this.drawFallback(source);
      return this.canvas;
    }

    try {
      this.renderGL(this.gl, source, grade);
    } catch {
      // GL error mid-render — degrade gracefully for this frame.
      this.drawFallback(source);
    }
    return this.canvas;
  }

  /** Release all GL resources. The engine must not be used after this. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const state = this.gl;
    if (state) {
      const { gl } = state;
      gl.deleteProgram(state.program);
      gl.deleteVertexArray(state.vao);
      gl.deleteTexture(state.sourceTex);
      gl.deleteTexture(state.lutTex);
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
    this.gl = null;
    this.fallback2d = null;
    this.uploadedLut = null;
  }

  // ---- internals --------------------------------------------------------

  private initGL(): GLState | null {
    const gl = this.canvas.getContext('webgl2', {
      premultipliedAlpha: false,
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;

    const program = this.buildProgram(gl);

    // Full-screen quad: position (clip space) + texcoord. Flip V so the
    // uploaded frame (top-left origin) appears upright.
    const quad = new Float32Array([
      // x,  y,   u, v
      -1, -1, 0, 1,
      1, -1, 1, 1,
      -1, 1, 0, 0,
      1, 1, 1, 0,
    ]);

    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      gl.deleteProgram(program);
      return null;
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * Float32Array.BYTES_PER_ELEMENT);
    gl.bindVertexArray(null);

    const sourceTex = this.createSourceTexture(gl);
    const lutTex = this.createLutTexture(gl);
    if (!sourceTex || !lutTex) {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      return null;
    }

    const u = (name: string): WebGLUniformLocation | null =>
      gl.getUniformLocation(program, name);

    return {
      gl,
      program,
      vao,
      sourceTex,
      lutTex,
      uniforms: {
        source: u('u_source'),
        lut: u('u_lut'),
        lift: u('u_lift'),
        gamma: u('u_gamma'),
        gain: u('u_gain'),
        contrast: u('u_contrast'),
        saturation: u('u_saturation'),
        temperature: u('u_temperature'),
        tint: u('u_tint'),
        useLut: u('u_useLut'),
        lutSize: u('u_lutSize'),
        lutDomainMin: u('u_lutDomainMin'),
        lutDomainMax: u('u_lutDomainMax'),
      },
    };
  }

  private buildProgram(gl: WebGL2RenderingContext): WebGLProgram {
    const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      throw new Error('GradeEngine: failed to create program');
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Shaders can be detached/deleted once linked.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`GradeEngine: program link failed: ${log}`);
    }
    return program;
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    type: number,
    src: string
  ): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('GradeEngine: failed to create shader');
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
      gl.deleteShader(shader);
      throw new Error(`GradeEngine: shader compile failed: ${log}`);
    }
    return shader;
  }

  private createSourceTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  /** Creates a 1x1x1 neutral LUT so the sampler is always bound to something. */
  private createLutTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      1,
      1,
      1,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0])
    );
    gl.bindTexture(gl.TEXTURE_3D, null);
    return tex;
  }

  /** Uploads a CubeLUT into the 3D texture. Skips if already current. */
  private uploadLut(gl: WebGL2RenderingContext, tex: WebGLTexture, lut: CubeLUT): void {
    if (this.uploadedLut === lut) return;
    const n = lut.size;
    // Convert interleaved float RGB -> RGB8 bytes.
    const bytes = new Uint8Array(n * n * n * 3);
    for (let i = 0; i < bytes.length; i++) {
      const v = lut.data[i];
      bytes[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB8,
      n,
      n,
      n,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      bytes
    );
    gl.bindTexture(gl.TEXTURE_3D, null);
    this.uploadedLut = lut;
  }

  private renderGL(state: GLState, source: GradeSource, grade: Grade): void {
    const { gl, uniforms } = state;

    // Skip frames where the source has no pixels yet (e.g. video not ready).
    const sw = sourceWidth(source);
    const sh = sourceHeight(source);
    if (sw === 0 || sh === 0) {
      this.drawFallback(source);
      return;
    }

    gl.viewport(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(state.program);
    gl.bindVertexArray(state.vao);

    // Upload the source frame to texture unit 0.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.sourceTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      source as TexImageSource
    );
    gl.uniform1i(uniforms.source, 0);

    // LUT on texture unit 1.
    const useLut = grade.lut != null;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, state.lutTex);
    if (useLut && grade.lut) {
      this.uploadLut(gl, state.lutTex, grade.lut);
    }
    gl.uniform1i(uniforms.lut, 1);

    // Grade uniforms.
    gl.uniform3f(uniforms.lift, grade.lift.r, grade.lift.g, grade.lift.b);
    gl.uniform3f(uniforms.gamma, grade.gamma.r, grade.gamma.g, grade.gamma.b);
    gl.uniform3f(uniforms.gain, grade.gain.r, grade.gain.g, grade.gain.b);
    gl.uniform1f(uniforms.contrast, grade.contrast);
    gl.uniform1f(uniforms.saturation, grade.saturation);
    gl.uniform1f(uniforms.temperature, grade.temperature);
    gl.uniform1f(uniforms.tint, grade.tint);

    gl.uniform1i(uniforms.useLut, useLut ? 1 : 0);
    if (useLut && grade.lut) {
      const { size, domainMin, domainMax } = grade.lut;
      gl.uniform1f(uniforms.lutSize, size);
      gl.uniform3f(uniforms.lutDomainMin, domainMin.r, domainMin.g, domainMin.b);
      gl.uniform3f(uniforms.lutDomainMax, domainMax.r, domainMax.g, domainMax.b);
    } else {
      gl.uniform1f(uniforms.lutSize, 1);
      gl.uniform3f(uniforms.lutDomainMin, 0, 0, 0);
      gl.uniform3f(uniforms.lutDomainMax, 1, 1, 1);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindVertexArray(null);
  }

  /** Draw the source unmodified onto the canvas (fallback / not-ready path). */
  private drawFallback(source: GradeSource): void {
    let ctx = this.fallback2d;
    if (!ctx) {
      // Only valid if no GL context grabbed the canvas. If GL is active we
      // cannot also get a 2D context from the same canvas, so do nothing.
      if (this.gl) return;
      ctx = this.canvas.getContext('2d');
      this.fallback2d = ctx;
    }
    if (!ctx) return;
    ctx.clearRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    const sw = sourceWidth(source);
    const sh = sourceHeight(source);
    if (sw === 0 || sh === 0) return;
    try {
      ctx.drawImage(source, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    } catch {
      // Source not drawable yet — leave the canvas cleared.
    }
  }
}

function sourceWidth(source: GradeSource): number {
  return source instanceof HTMLVideoElement ? source.videoWidth : source.width;
}

function sourceHeight(source: GradeSource): number {
  return source instanceof HTMLVideoElement ? source.videoHeight : source.height;
}
