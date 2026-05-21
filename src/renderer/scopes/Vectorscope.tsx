import { useCallback, useRef } from 'react';
import { useScopeSampler, type ScopeSource } from './useScopeSampler';
import { prepareCanvas, drawBlank, drawTitle, SCOPE_BG, SCOPE_GRID, SCOPE_LABEL } from './scopeUtils';

export interface VectorscopeProps {
  /** Video or canvas element to monitor. Null renders a blank scope. */
  source: ScopeSource;
  /** Optional extra classes for the wrapper element. */
  className?: string;
}

/**
 * Standard 75% colour-bar target positions on the vectorscope, given as the
 * hue angle (degrees, 0 = +U / right, counter-clockwise) and label.
 * Angles follow the conventional broadcast vectorscope layout.
 */
const TARGETS: ReadonlyArray<{ angle: number; label: string }> = [
  { angle: 103, label: 'R' },
  { angle: 241, label: 'G' },
  { angle: 347, label: 'B' },
  { angle: 167, label: 'Cy' },
  { angle: 61, label: 'Mg' },
  { angle: 283, label: 'Yl' },
];

/** Skin-tone (I-line) reference angle ≈ 123° from +U axis. */
const SKIN_TONE_ANGLE = 123;

/**
 * Vectorscope with the standard graticule, target boxes and skin-tone line.
 * Plots each sampled pixel's chroma (Cb/Cr) as an additive point.
 */
export function Vectorscope({ source, className }: VectorscopeProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const onFrame = useCallback((data: ImageData | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const prep = prepareCanvas(canvas);
    if (!prep) return;
    const { ctx, width, height } = prep;

    if (!data) {
      drawBlank(ctx, width, height, 'VECTORSCOPE');
      return;
    }

    ctx.fillStyle = SCOPE_BG;
    ctx.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 8;

    // --- Graticule ---------------------------------------------------------
    ctx.strokeStyle = SCOPE_GRID;
    ctx.lineWidth = 1;
    // Concentric rings.
    for (const frac of [0.4, 0.75, 1]) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius * frac, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Cross-hair.
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();

    // Skin-tone / I-line.
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.55)';
    const sa = (SKIN_TONE_ANGLE * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(sa) * radius, cy - Math.sin(sa) * radius);
    ctx.stroke();

    // Colour-bar target boxes + labels.
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const { angle, label } of TARGETS) {
      const a = (angle * Math.PI) / 180;
      const tx = cx + Math.cos(a) * radius * 0.75;
      const ty = cy - Math.sin(a) * radius * 0.75;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.strokeRect(tx - 4, ty - 4, 8, 8);
      ctx.fillStyle = SCOPE_LABEL;
      const lx = cx + Math.cos(a) * radius * 0.92;
      const ly = cy - Math.sin(a) * radius * 0.92;
      ctx.fillText(label, lx, ly);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // --- Trace -------------------------------------------------------------
    const { width: sw, height: sh, data: px } = data;
    // Chroma at full saturation reaches ±0.5 in Cb/Cr; scale so the 75%
    // targets land on the 0.75 ring.
    const scale = radius / 0.5;
    ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
    // Sub-sample to keep the trace cheap.
    const step = 4;
    for (let y = 0; y < sh; y += 2) {
      const rowOff = y * sw * 4;
      for (let x = 0; x < sw; x += step) {
        const i = rowOff + x * 4;
        const r = px[i] / 255;
        const g = px[i + 1] / 255;
        const b = px[i + 2] / 255;
        // Rec.601 Cb/Cr (centred on 0).
        const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
        const dotX = cx + cb * scale;
        const dotY = cy - cr * scale;
        ctx.fillRect(dotX, dotY, 1.3, 1.3);
      }
    }

    drawTitle(ctx, 'VECTORSCOPE');
  }, []);

  useScopeSampler(source, onFrame);

  return (
    <div className={`bg-surface-900 rounded ${className ?? ''}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

export default Vectorscope;
