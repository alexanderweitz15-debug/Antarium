/**
 * swatch.js – Farbfelder fuer Legende und Werkzeugleiste.
 *
 * Erzeugt das Vorschaubild eines Zelltyps mit DEMSELBEN Maler, der auch das
 * Terrain zeichnet. Was in der Legende oder auf einem Werkzeugknopf steht,
 * sieht deshalb garantiert aus wie im Spiel. Ergebnisse werden gecacht.
 */

import { WORLD } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { paintSurfaceChunk } from '../render/surfaceView.js';
import { paintNestChunk } from '../render/nestView.js';

const CELLS = 4;
const cache = new Map();

/**
 * @param {number} levelKind LEVEL_KIND.SURFACE oder LEVEL_KIND.NEST
 * @param {number} cellId Zelltyp-ID
 * @param {number} [meta] Kammertyp (nur Nest)
 * @returns {string} data:-URL
 */
export function cellSwatch(levelKind, cellId, meta = 0) {
  const key = levelKind + ':' + cellId + ':' + meta;
  if (cache.has(key)) return cache.get(key);

  const n = CELLS;
  const fake = {
    w: n, h: n, kind: levelKind,
    cells: new Uint8Array(n * n).fill(cellId),
    meta: new Uint8Array(n * n).fill(meta),
    variant: new Uint8Array(n * n),
  };
  for (let i = 0; i < n * n; i++) fake.variant[i] = (i * 37 + cellId * 11) & 0xff;

  const px = n * WORLD.CELL_PX;
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(px, px);
  const buf = new Uint32Array(img.data.buffer);
  (levelKind === LEVEL_KIND.SURFACE ? paintSurfaceChunk : paintNestChunk)(fake, 0, 0, n, n, buf);
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
}
