import { useCallback, useRef } from 'react';
import { useScopeSampler, type ScopeSource } from './useScopeSampler';
import {
  prepareCanvas,
  drawBlank,
  drawTitle,
  SCOPE_BG,
  SCOPE_GRID,
} from './scopeUtils';

export interface ParadeProps {
  /** Video or canvas element to monitor. Null renders a blank scope. */
  source: ScopeSource;
  /** Optional extra classes for the wrapper element. */
  className?: string;
}

const BINS = 256;

/** R, G, B channel offsets paired with their plot colours. */
const CHANNELS: ReadonlyArray<{ offset: number; rgb: string }> = [
  { offset: 0, rgb: '248, 113, 113' }, // red
  { offset: 1, rgb: '74, 222, 128' }, // green
  { offset: 2, rgb: '96, 165, 250' }, // blue
];

/**
 * RGB parade — three side-by-side waveforms, one per colour channel.
 */
export function Parade({ source, className }: ParadeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onFrame = useCallback((data: ImageData | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prep = prepareCanvas(canvas);
    if (!prep) return;
    const { ctx, width, height } = prep;

    if (!data) {
      drawBlank(ctx, width, height, 'PARADE');
      return;
    }

    const { width: sw, height: sh, data: px } = data;
    ctx.fillStyle = SCOPE_BG;
    ctx.fillRect(0, 0, width, height);

    const sectionW = width / 3;
    const colsPerSection = Math.min(sw, Math.max(48, Math.round(sectionW)));

    for (let ch = 0; ch < 3; ch++) {
      const { offset, rgb } = CHANNELS[ch];
      const x0 = ch * sectionW;

      // Per-section [column][value] histogram.
      const hist = new Float32Array(colsPerSection * BINS);
      let peak = 1;
      for (let y = 0; y < sh; y++) {
        const rowOff = y * sw * 4;
        for (let x = 0; x < sw; x++) {
          const value = px[rowOff + x * 4 + offset];
          const col = ((x / sw) * colsPerSection) | 0;
          const idx = col * BINS + value;
          const v = hist[idx] + 1;
          hist[idx] = v;
          if (v > peak) peak = v;
        }
      }

      // Grid for this section.
      ctx.strokeStyle = SCOPE_GRID;
      ctx.lineWidth = 1;
      for (let p = 0; p <= 100; p += 25) {
        const y = height - (p / 100) * height;
        ctx.beginPath();
        ctx.moveTo(x0, y + 0.5);
        ctx.lineTo(x0 + sectionW, y + 0.5);
        ctx.stroke();
      }
      // Section divider.
      if (ch > 0) {
        ctx.beginPath();
        ctx.moveTo(x0 + 0.5, 0);
        ctx.lineTo(x0 + 0.5, height);
        ctx.stroke();
      }

      const colW = sectionW / colsPerSection;
      for (let c = 0; c < colsPerSection; c++) {
        const x = x0 + c * colW;
        for (let b = 0; b < BINS; b++) {
          const count = hist[c * BINS + b];
          if (count === 0) continue;
          const intensity = Math.min(1, (count / peak) * 4);
          const y = height - (b / (BINS - 1)) * height;
          ctx.fillStyle = `rgba(${rgb}, ${0.12 + intensity * 0.7})`;
          ctx.fillRect(x, y, Math.max(1, colW), 1.4);
        }
      }
    }

    drawTitle(ctx, 'RGB PARADE');
  }, []);

  useScopeSampler(source, onFrame);

  return (
    <div className={`bg-surface-900 rounded ${className ?? ''}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export default Parade;
