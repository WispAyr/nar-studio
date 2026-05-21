import { useCallback, useRef } from 'react';
import { useScopeSampler, type ScopeSource } from './useScopeSampler';
import {
  prepareCanvas,
  drawBlank,
  drawTitle,
  SCOPE_BG,
  SCOPE_GRID,
  SCOPE_LABEL,
  LUMA_R,
  LUMA_G,
  LUMA_B,
} from './scopeUtils';

export interface WaveformProps {
  /** Video or canvas element to monitor. Null renders a blank scope. */
  source: ScopeSource;
  /** Optional extra classes for the wrapper element. */
  className?: string;
}

/** Vertical IRE-style buckets the waveform accumulates into. */
const BINS = 256;

/**
 * Luma waveform monitor — classic green-on-dark broadcast look.
 * Each source column maps to a canvas column; brightness of a plotted dot is
 * proportional to how many pixels in that column share that luma value.
 */
export function Waveform({ source, className }: WaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onFrame = useCallback((data: ImageData | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prep = prepareCanvas(canvas);
    if (!prep) return;
    const { ctx, width, height } = prep;

    if (!data) {
      drawBlank(ctx, width, height, 'WAVEFORM');
      return;
    }

    const { width: sw, height: sh, data: px } = data;

    // Accumulate a [column][luma-bin] histogram.
    const cols = Math.min(sw, Math.max(64, Math.round(width)));
    const hist = new Float32Array(cols * BINS);
    let peak = 1;
    for (let y = 0; y < sh; y++) {
      const rowOff = y * sw * 4;
      for (let x = 0; x < sw; x++) {
        const i = rowOff + x * 4;
        const luma =
          px[i] * LUMA_R + px[i + 1] * LUMA_G + px[i + 2] * LUMA_B;
        const col = ((x / sw) * cols) | 0;
        const bin = Math.min(BINS - 1, luma | 0);
        const idx = col * BINS + bin;
        const v = hist[idx] + 1;
        hist[idx] = v;
        if (v > peak) peak = v;
      }
    }

    // Background + reference grid (0/25/50/75/100 IRE-ish lines).
    ctx.fillStyle = SCOPE_BG;
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = SCOPE_GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = SCOPE_LABEL;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let p = 0; p <= 100; p += 25) {
      const y = height - (p / 100) * height;
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
      ctx.fillText(String(p), 4, Math.min(height - 6, Math.max(6, y)));
    }

    // Plot luma values as additive green dots.
    const colW = width / cols;
    for (let c = 0; c < cols; c++) {
      const x = c * colW;
      for (let b = 0; b < BINS; b++) {
        const count = hist[c * BINS + b];
        if (count === 0) continue;
        const intensity = Math.min(1, (count / peak) * 4);
        const y = height - (b / (BINS - 1)) * height;
        ctx.fillStyle = `rgba(74, 222, 128, ${0.12 + intensity * 0.7})`;
        ctx.fillRect(x, y, Math.max(1, colW), 1.4);
      }
    }

    drawTitle(ctx, 'WAVEFORM (luma)');
  }, []);

  useScopeSampler(source, onFrame);

  return (
    <div className={`bg-surface-900 rounded ${className ?? ''}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export default Waveform;
