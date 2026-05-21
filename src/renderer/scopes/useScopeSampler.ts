import { useEffect, useRef } from 'react';

/**
 * Source a scope can read from.
 */
export type ScopeSource = HTMLVideoElement | HTMLCanvasElement | null;

/**
 * Width (in px) of the offscreen canvas the source is downscaled to before
 * pixels are read back. Keeping this small (~256px) avoids sampling full
 * 1080p frames every tick — the scope statistics are virtually identical at
 * this resolution while the per-frame cost drops by ~30x.
 */
export const SAMPLE_WIDTH = 256;

/**
 * Target sampling rate. Scopes do not need 60fps — 15fps is smooth enough
 * for colour-grading feedback and leaves the main thread free.
 */
export const SAMPLE_FPS = 15;

/**
 * Natural dimensions of a source element, or null if it has none yet.
 */
function sourceSize(source: ScopeSource): { w: number; h: number } | null {
  if (!source) return null;
  if (source instanceof HTMLVideoElement) {
    if (source.videoWidth === 0 || source.videoHeight === 0) return null;
    return { w: source.videoWidth, h: source.videoHeight };
  }
  if (source.width === 0 || source.height === 0) return null;
  return { w: source.width, h: source.height };
}

/**
 * Runs a throttled requestAnimationFrame loop that downscales `source` onto a
 * private offscreen canvas, reads its pixels via getImageData, and hands the
 * resulting ImageData to `onFrame`. When `source` is null (or has no frame
 * yet) `onFrame` is called with null so the scope can render a blank state.
 *
 * The rAF is always cancelled on unmount / dependency change.
 */
export function useScopeSampler(
  source: ScopeSource,
  onFrame: (data: ImageData | null) => void,
): void {
  // Keep the latest callback in a ref so changing it does not restart the loop.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    const offscreen = document.createElement('canvas');
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });

    let rafId = 0;
    let lastTime = 0;
    const minInterval = 1000 / SAMPLE_FPS;

    const tick = (time: number): void => {
      rafId = requestAnimationFrame(tick);

      if (time - lastTime < minInterval) return;
      lastTime = time;

      const size = sourceSize(source);
      // `source` is non-null whenever `size` is non-null; capture it in a
      // locally-narrowed binding so TS accepts it as a CanvasImageSource.
      if (!size || !ctx || !source) {
        onFrameRef.current(null);
        return;
      }
      const drawSource: HTMLVideoElement | HTMLCanvasElement = source;

      const w = SAMPLE_WIDTH;
      const h = Math.max(1, Math.round((size.h / size.w) * SAMPLE_WIDTH));
      if (offscreen.width !== w) offscreen.width = w;
      if (offscreen.height !== h) offscreen.height = h;

      try {
        ctx.drawImage(drawSource, 0, 0, w, h);
        onFrameRef.current(ctx.getImageData(0, 0, w, h));
      } catch {
        // drawImage can throw if the source is not yet decodable.
        onFrameRef.current(null);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [source]);
}
