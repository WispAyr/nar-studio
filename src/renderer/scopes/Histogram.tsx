import { useCallback, useRef } from 'react';
import { useScopeSampler, type ScopeSource } from './useScopeSampler';
import {
  prepareCanvas,
  drawBlank,
  drawTitle,
  SCOPE_BG,
  SCOPE_GRID,
} from './scopeUtils';

export interface HistogramProps {
  /** Video or canvas element to monitor. Null renders a blank scope. */
  source: ScopeSource;
  /** Optional extra classes for the wrapper element. */
  className?: string;
}

const BINS = 256;

/**
 * RGB histogram — overlaid per-channel tonal distribution with additive
 * blending so overlapping regions read as white/grey.
 */
export function Histogram({ source, className }: HistogramProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onFrame = useCallback((data: ImageData | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prep = prepareCanvas(canvas);
    if (!prep) return;
    const { ctx, width, height } = prep;

    if (!data) {
      drawBlank(ctx, width, height, 'HISTOGRAM');
      return;
    }

    const { width: sw, height: sh, data: px } = data;
    const rHist = new Float32Array(BINS);
    const gHist = new Float32Array(BINS);
    const bHist = new Float32Array(BINS);

    for (let i = 0; i < px.length; i += 4) {
      rHist[px[i]]++;
      gHist[px[i + 1]]++;
      bHist[px[i + 2]]++;
    }

    // Use a robust peak (ignore the very top pure-black/white spikes which
    // would otherwise flatten the rest of the curve).
    let peak = 1;
    for (let b = 1; b < BINS - 1; b++) {
      if (rHist[b] > peak) peak = rHist[b];
      if (gHist[b] > peak) peak = gHist[b];
      if (bHist[b] > peak) peak = bHist[b];
    }
    void sw;
    void sh;

    ctx.fillStyle = SCOPE_BG;
    ctx.fillRect(0, 0, width, height);

    // Quartile grid lines.
    ctx.strokeStyle = SCOPE_GRID;
    ctx.lineWidth = 1;
    for (let q = 0; q <= 4; q++) {
      const x = (q / 4) * width;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }

    const drawChannel = (hist: Float32Array, rgb: string): void => {
      ctx.beginPath();
      ctx.moveTo(0, height);
      for (let b = 0; b < BINS; b++) {
        const x = (b / (BINS - 1)) * width;
        const h = Math.min(1, hist[b] / peak) * (height - 2);
        ctx.lineTo(x, height - h);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fillStyle = `rgba(${rgb}, 0.55)`;
      ctx.fill();
    };

    ctx.globalCompositeOperation = 'lighter';
    drawChannel(rHist, '248, 113, 113');
    drawChannel(gHist, '74, 222, 128');
    drawChannel(bHist, '96, 165, 250');
    ctx.globalCompositeOperation = 'source-over';

    drawTitle(ctx, 'RGB HISTOGRAM');
  }, []);

  useScopeSampler(source, onFrame);

  return (
    <div className={`bg-surface-900 rounded ${className ?? ''}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export default Histogram;
