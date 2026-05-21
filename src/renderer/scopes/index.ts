/**
 * Broadcast video scopes for the colour-grading workspace.
 *
 * Every scope component accepts a `source` prop
 * (`HTMLVideoElement | HTMLCanvasElement | null`), downscales it to a small
 * offscreen canvas, samples pixels at ~15fps and paints the result.
 *
 * Import the bundled panel:
 *   import { Scopes } from './scopes';
 * or individual scopes:
 *   import { Waveform, Parade, Vectorscope, Histogram } from './scopes';
 */
export { Scopes } from './Scopes';
export type { ScopesProps } from './Scopes';

export { Waveform } from './Waveform';
export type { WaveformProps } from './Waveform';

export { Parade } from './Parade';
export type { ParadeProps } from './Parade';

export { Vectorscope } from './Vectorscope';
export type { VectorscopeProps } from './Vectorscope';

export { Histogram } from './Histogram';
export type { HistogramProps } from './Histogram';

export type { ScopeSource } from './useScopeSampler';
