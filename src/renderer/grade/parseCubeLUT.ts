// Adobe `.cube` 3D LUT parser.
// Self-contained — no imports outside src/renderer/grade/.

import type { CubeLUT, RGB } from './types';

/**
 * Parse the text of an Adobe `.cube` 3D LUT file.
 *
 * Supports:
 *  - `TITLE "..."`
 *  - `LUT_3D_SIZE n`            (required for a 3D LUT)
 *  - `DOMAIN_MIN r g b`
 *  - `DOMAIN_MAX r g b`
 *  - `# comments` and blank lines
 *  - the RGB triplet data rows (R fastest, then G, then B)
 *
 * 1D LUTs (`LUT_1D_SIZE`) are rejected — this engine only consumes 3D LUTs.
 *
 * @throws Error if the file is malformed (missing size, wrong row count, etc.).
 */
export function parseCubeLUT(text: string): CubeLUT {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('parseCubeLUT: empty input');
  }

  let size = 0;
  let title: string | undefined;
  const domainMin: RGB = { r: 0, g: 0, b: 0 };
  const domainMax: RGB = { r: 1, g: 1, b: 1 };
  const triplets: number[] = [];

  // Normalise line endings, then iterate.
  const lines = text.split(/\r\n|\r|\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip inline comments (everything after a #) and trim.
    const hashIdx = raw.indexOf('#');
    const line = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).trim();
    if (line.length === 0) continue;

    const upper = line.toUpperCase();

    if (upper.startsWith('TITLE')) {
      // TITLE "My LUT"  — capture text inside quotes if present.
      const m = line.match(/"([^"]*)"/);
      title = m ? m[1] : line.slice(5).trim() || undefined;
      continue;
    }

    if (upper.startsWith('LUT_1D_SIZE')) {
      throw new Error('parseCubeLUT: 1D LUTs are not supported (3D only)');
    }

    if (upper.startsWith('LUT_3D_SIZE')) {
      const n = Number.parseInt(line.split(/\s+/)[1] ?? '', 10);
      if (!Number.isFinite(n) || n < 2) {
        throw new Error(`parseCubeLUT: invalid LUT_3D_SIZE "${line}"`);
      }
      size = n;
      continue;
    }

    if (upper.startsWith('DOMAIN_MIN')) {
      const v = parseTriplet(line, 'DOMAIN_MIN');
      domainMin.r = v[0];
      domainMin.g = v[1];
      domainMin.b = v[2];
      continue;
    }

    if (upper.startsWith('DOMAIN_MAX')) {
      const v = parseTriplet(line, 'DOMAIN_MAX');
      domainMax.r = v[0];
      domainMax.g = v[1];
      domainMax.b = v[2];
      continue;
    }

    // Any other keyword line we don't recognise — skip it gracefully.
    if (/^[A-Za-z_]/.test(line)) continue;

    // Otherwise this must be a data row of three floats.
    const parts = line.split(/\s+/);
    if (parts.length !== 3) {
      throw new Error(`parseCubeLUT: malformed data row "${line}"`);
    }
    const r = Number.parseFloat(parts[0]);
    const g = Number.parseFloat(parts[1]);
    const b = Number.parseFloat(parts[2]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      throw new Error(`parseCubeLUT: non-numeric data row "${line}"`);
    }
    triplets.push(r, g, b);
  }

  if (size === 0) {
    throw new Error('parseCubeLUT: missing LUT_3D_SIZE');
  }

  const expected = size * size * size;
  if (triplets.length !== expected * 3) {
    throw new Error(
      `parseCubeLUT: expected ${expected} entries for size ${size}, got ${triplets.length / 3}`
    );
  }

  return {
    size,
    domainMin,
    domainMax,
    data: new Float32Array(triplets),
    title,
  };
}

function parseTriplet(line: string, keyword: string): [number, number, number] {
  const parts = line.split(/\s+/);
  // parts[0] is the keyword.
  const r = Number.parseFloat(parts[1]);
  const g = Number.parseFloat(parts[2]);
  const b = Number.parseFloat(parts[3]);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    throw new Error(`parseCubeLUT: malformed ${keyword} line "${line}"`);
  }
  return [r, g, b];
}
