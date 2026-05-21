/**
 * Shared drawing helpers and colour constants for the broadcast scopes.
 */

/** Background of every scope graph — near-black to mimic hardware monitors. */
export const SCOPE_BG = '#0a0d12';

/** Grid / graticule line colour. */
export const SCOPE_GRID = 'rgba(148, 163, 184, 0.22)';

/** Label / axis text colour (matches Tailwind text-slate-400). */
export const SCOPE_LABEL = 'rgba(148, 163, 184, 0.9)';

/** Rec. 709 luma coefficients. */
export const LUMA_R = 0.2126;
export const LUMA_G = 0.7152;
export const LUMA_B = 0.0722;

/**
 * Resize a canvas to match its CSS box at the current devicePixelRatio.
 * Returns the 2D context already scaled so callers can draw in CSS pixels.
 * Returns null if the canvas has no layout box yet.
 */
export function prepareCanvas(
  canvas: HTMLCanvasElement,
): { ctx: CanvasRenderingContext2D; width: number; height: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const cssW = Math.max(1, Math.round(rect.width));
  const cssH = Math.max(1, Math.round(rect.height));

  const pxW = Math.round(cssW * dpr);
  const pxH = Math.round(cssH * dpr);
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssW, height: cssH };
}

/**
 * Fill the scope background and draw a centred "no signal" label.
 * Used by every scope when `source` is null.
 */
export function drawBlank(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  label: string,
): void {
  ctx.fillStyle = SCOPE_BG;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = SCOPE_LABEL;
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, height / 2);
  ctx.fillText('no signal', width / 2, height / 2 + 14);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Draw a small title in the top-left corner of a scope.
 */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  title: string,
): void {
  ctx.fillStyle = SCOPE_LABEL;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(title, 6, 5);
}
