/**
 * nestView.js – Aussehen einer Nest-Ebene (Querschnitt).
 *
 * Besonderheiten gegenueber der Oberflaeche:
 *  - Erdschichten werden mit der Tiefe dunkler (Farbrauschen bleibt erhalten)
 *  - Kammerboeden bekommen die Farbe ihres Kammertyps aus level.meta
 *  - Oben liegt ein schmaler Himmelstreifen mit Grasnarbe als Orientierung
 */

import { WORLD } from '../config.js';
import { NEST_CELL, NEST_CELL_DEFS, CHAMBER_DEFS } from '../sim/nest.js';
import { pack, shade, mix, PATTERN_A, PATTERN_B, cellBlock } from './paint.js';

const BASE = new Uint32Array(NEST_CELL_DEFS.length);
const ALT = new Uint32Array(NEST_CELL_DEFS.length);
for (const d of NEST_CELL_DEFS) {
  BASE[d.id] = pack(d.color);
  ALT[d.id] = pack(d.alt);
}
const CHAMBER_BASE = new Uint32Array(CHAMBER_DEFS.length);
const CHAMBER_ALT = new Uint32Array(CHAMBER_DEFS.length);
for (const d of CHAMBER_DEFS) {
  CHAMBER_BASE[d.id] = pack(d.color);
  CHAMBER_ALT[d.id] = shade(d.color, 0.78);
}
const SKY_TOP = 0x3c6c96;
const SKY_LOW = 0x7fb0d2;
const GRASS = 0x4a7a38;
const TUNNEL_FLOOR = shade(0x201711, 1.5);
const STONE_LIGHT = shade(0x6e6e76, 1.3);
const ROOT_LIGHT = shade(0x7a5a2a, 1.25);

/**
 * Zeichnet einen Chunk einer Nest-Ebene.
 * @param {import('../sim/levels.js').Level} level
 */
export function paintNestChunk(level, cx0, cy0, cw, ch, buf) {
  const n = WORLD.CELL_PX;
  const stride = cw * n;
  const cells = level.cells;
  const meta = level.meta;
  const variant = level.variant;
  const lw = level.w;
  const surfRow = WORLD.NEST_SURFACE_ROW;
  const maxDepth = level.h - surfRow;

  for (let y = 0; y < ch; y++) {
    const gy = cy0 + y;
    const rowBase = gy * lw;
    const depth = (gy - surfRow) / maxDepth; // 0 = Oberflaeche, 1 = Kartenboden
    // Tiefe dunkelt ab, zusaetzlich deuten weiche Baender Erdschichten an.
    const band = 1 + 0.055 * Math.sin(gy * 0.33) + 0.03 * Math.sin(gy * 0.11);
    const dark = (1 - Math.min(0.42, Math.max(0, depth) * 0.42)) * band;

    for (let x = 0; x < cw; x++) {
      const i = rowBase + cx0 + x;
      const t = cells[i];
      const v = variant[i];
      const pa = PATTERN_A[v];
      let c0 = BASE[t], c1 = ALT[t], c2 = 0, pb = 0;

      switch (t) {
        case NEST_CELL.SKY: {
          // Senkrechter Verlauf im Himmelstreifen
          const tt = gy / Math.max(1, surfRow);
          const col = mix(SKY_TOP, SKY_LOW, tt);
          c0 = pack(col); c1 = shade(col, 1.06);
          break;
        }
        case NEST_CELL.TOPSOIL:
          c0 = pack(GRASS); c1 = shade(GRASS, 0.82);
          c2 = shade(GRASS, 1.3); pb = PATTERN_B[v];
          break;
        case NEST_CELL.SOIL:
        case NEST_CELL.HARD_SOIL:
          c0 = shade(NEST_CELL_DEFS[t].color, dark * (0.94 + (v & 7) * 0.02));
          c1 = shade(NEST_CELL_DEFS[t].alt, dark);
          break;
        case NEST_CELL.STONE:
          c2 = STONE_LIGHT; pb = PATTERN_B[v];
          break;
        case NEST_CELL.ROOT:
          c2 = ROOT_LIGHT; pb = PATTERN_B[v];
          break;
        case NEST_CELL.TUNNEL:
          // Angedeuteter Boden: unterste Pixelreihe heller, wenn darunter Erde
          c0 = BASE[t]; c1 = ALT[t];
          if (cells[i + lw] !== undefined && cells[i + lw] !== NEST_CELL.TUNNEL && cells[i + lw] !== NEST_CELL.CHAMBER) {
            c2 = TUNNEL_FLOOR; pb = 0xf000;
          }
          break;
        case NEST_CELL.CHAMBER: {
          const m = meta[i];
          c0 = CHAMBER_BASE[m] || BASE[t];
          c1 = CHAMBER_ALT[m] || ALT[t];
          break;
        }
        case NEST_CELL.ENTRANCE:
          c0 = BASE[t]; c1 = ALT[t];
          break;
        default:
          break;
      }
      cellBlock(buf, stride, x * n, y * n, n, c0, c1, pa, c2, pb);
    }
  }
}
