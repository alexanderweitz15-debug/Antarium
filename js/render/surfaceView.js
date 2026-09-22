/**
 * surfaceView.js – Aussehen der Oberflaechen-Ebene (Draufsicht).
 *
 * Liefert fuer jeden Zelltyp die Pixelgestaltung eines Zellblocks. Der
 * Renderer ruft paintSurfaceChunk() nur fuer Chunks auf, die als dirty
 * markiert sind.
 */

import { WORLD, FOOD } from '../config.js';
import { SURFACE_CELL, SURFACE_CELL_DEFS, FOOD_OF_CELL } from '../sim/surface.js';
import { pack, shade, PATTERN_A, PATTERN_B, cellBlock } from './paint.js';

/** Vorberechnete Farbpaare je Zelltyp (Basis, Streu, Glanz). */
const BASE = new Uint32Array(SURFACE_CELL_DEFS.length);
const ALT = new Uint32Array(SURFACE_CELL_DEFS.length);
const HI = new Uint32Array(SURFACE_CELL_DEFS.length);
for (const d of SURFACE_CELL_DEFS) {
  BASE[d.id] = pack(d.color);
  ALT[d.id] = pack(d.alt);
  HI[d.id] = shade(d.color, 1.22);
}
/**
 * Nahrungszellen: Hoechstbestand je Typ. Der Restbestand steht in
 * level.meta und wird als Helligkeit dargestellt – eine abgeerntete Quelle
 * sieht man sofort.
 */
const FOOD_MAX = new Uint8Array(64);
for (let id = 0; id < FOOD_OF_CELL.length; id++) {
  const key = FOOD_OF_CELL[id];
  if (key) FOOD_MAX[id] = Math.min(255, FOOD.PROFILES[key].max);
}

/** Zusatzfarben, die sich nicht aus der Definitionstabelle ergeben. */
const GRASS_BLADE = shade(0x4a7a38, 1.35);
const FLOWER_HEART = pack(0xf2d34e);
const WATER_GLINT = shade(0x2f6fa8, 1.45);
const STONE_LIGHT = shade(0x7b7b82, 1.25);
const MOUND_LIGHT = shade(0x8a6a42, 1.18);
const ENTRANCE_DARK = pack(0x0d0a07);

/**
 * Zeichnet einen Chunk der Oberflaeche in einen Pixelpuffer.
 * @param {import('../sim/levels.js').Level} level
 * @param {number} cx0 Zellspalte der linken Chunkkante
 * @param {number} cy0 Zellzeile der oberen Chunkkante
 * @param {number} cw  Breite in Zellen
 * @param {number} ch  Hoehe in Zellen
 * @param {Uint32Array} buf Zielpuffer (cw*CELL_PX breit)
 */
export function paintSurfaceChunk(level, cx0, cy0, cw, ch, buf) {
  const n = WORLD.CELL_PX;
  const stride = cw * n;
  const cells = level.cells;
  const variant = level.variant;
  const lw = level.w;

  for (let y = 0; y < ch; y++) {
    const rowBase = (cy0 + y) * lw;
    for (let x = 0; x < cw; x++) {
      const i = rowBase + cx0 + x;
      const t = cells[i];
      const v = variant[i];
      const pa = PATTERN_A[v];
      let c0 = BASE[t], c1 = ALT[t], c2 = 0, pb = 0;

      // Nahrungsquellen: Helligkeit zeigt den Restbestand
      if (FOOD_MAX[t] > 0) {
        const def = SURFACE_CELL_DEFS[t];
        const frac = 0.45 + 0.55 * Math.min(1, level.meta[i] / FOOD_MAX[t]);
        c0 = shade(def.color, frac);
        c1 = shade(def.alt, frac);
        c2 = shade(def.color, frac * 1.35);
        pb = PATTERN_B[v];
        cellBlock(buf, stride, x * n, y * n, n, c0, c1, pa, c2, pb);
        continue;
      }

      switch (t) {
        case SURFACE_CELL.GRASS:
          // Leichte Helligkeitsschwankung pro Zelle + vereinzelte Halme
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.92 + (v & 7) * 0.025);
          c2 = GRASS_BLADE; pb = PATTERN_B[v];
          break;
        case SURFACE_CELL.DIRT:
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.93 + ((v >> 2) & 7) * 0.02);
          break;
        case SURFACE_CELL.SAND:
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.95 + ((v >> 1) & 7) * 0.015);
          break;
        case SURFACE_CELL.STONE:
          c2 = STONE_LIGHT; pb = PATTERN_B[v] | 0x0003; // Kante oben links
          break;
        case SURFACE_CELL.WATER:
          // Waagerechte Baender: ruhige Wasserflaeche statt Rauschen
          c0 = shade(SURFACE_CELL_DEFS[t].color, ((cy0 + y) & 3) === 0 ? 1.12 : 1.0);
          c2 = WATER_GLINT; pb = PATTERN_B[v] & 0x00f0;
          break;
        case SURFACE_CELL.PLANT:
          c2 = HI[t]; pb = PATTERN_B[v];
          break;
        case SURFACE_CELL.FLOWER:
          c2 = FLOWER_HEART; pb = 0x0660; // Bluetenmitte
          break;
        case SURFACE_CELL.MOUND:
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.9 + ((v >> 3) & 7) * 0.03);
          c2 = MOUND_LIGHT; pb = PATTERN_B[v];
          break;
        case SURFACE_CELL.ENTRANCE:
          c0 = ENTRANCE_DARK; c1 = BASE[t];
          break;
        case SURFACE_CELL.FUNGUS:
          // Leuchtender Pilz: heller Kern mit Schimmer
          c2 = shade(SURFACE_CELL_DEFS[t].color, 1.5); pb = PATTERN_B[v] | 0x0660;
          break;
        case SURFACE_CELL.BERRY:
          c2 = shade(SURFACE_CELL_DEFS[t].color, 1.4); pb = 0x0660;
          break;
        case SURFACE_CELL.WEB:
          // Netz: duennes Gitter statt Flaeche
          c0 = BASE[SURFACE_CELL.GRASS];
          c1 = ALT[t];
          c2 = BASE[t]; pb = 0x8421;
          break;
        case SURFACE_CELL.FUNNEL:
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.8 + ((v & 3) * 0.06));
          c2 = shade(SURFACE_CELL_DEFS[t].color, 1.25); pb = PATTERN_B[v];
          break;
        default:
          break;
      }
      cellBlock(buf, stride, x * n, y * n, n, c0, c1, pa, c2, pb);
    }
  }
}
