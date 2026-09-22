/**
 * surfaceView.js – Aussehen der Oberflaechen-Ebene (Draufsicht).
 *
 * Liefert fuer jeden Zelltyp die Pixelgestaltung eines Zellblocks. Der
 * Renderer ruft paintSurfaceChunk() nur fuer Chunks auf, die als dirty
 * markiert sind.
 */

import { WORLD, FOOD } from '../config.js';
import { SURFACE_CELL, SURFACE_CELL_DEFS, FOOD_OF_CELL } from '../sim/surface.js';
import { pack, shade, mix, PATTERN_A, PATTERN_B, cellBlock } from './paint.js';

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
 * SILHOUETTEN FUER NAHRUNG.
 *
 * Vorher bekam jede Nahrungszelle dasselbe Rauschmuster in ihrer Eigenfarbe
 * – eine Wolke ohne Form. Auf einer Karte, die selbst nur aus Farbflaechen
 * besteht, geht das unter: Blattlaeuse (0x7ec46a) liegen auf Gras
 * (0x4a7a38) als Gruen auf Gruen, Samen (0xc9b183) auf Sand (0xc2ab74)
 * praktisch unsichtbar. Mehr Farben haetten das nicht geloest, weil das
 * Problem nicht die Farbe ist, sondern die fehlende Gestalt.
 *
 * Jede Sorte hat deshalb ein festes 4x4-Zeichen und einen dunklen Rand. Das
 * kostet zur Laufzeit nichts: die Muster sind Bitmasken und werden wie jede
 * andere Zelle in die Chunk-Textur gebacken.
 *
 * Bitreihenfolge wie in cellBlock: Bit = Zeile * 4 + Spalte, links oben ist
 * Bit 0.
 */
function glyph(rows) {
  let m = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) if (rows[y][x] !== '.') m |= 1 << (y * 4 + x);
  }
  return m;
}

/** Form je Nahrungssorte (Schluessel aus FOOD_OF_CELL). */
const FOOD_GLYPH = {
  // Bluete: runder Kopf mit heller Mitte
  flower:    glyph(['.XX.', 'XXXX', 'XXXX', '.XX.']),
  // Blattlaeuse: viele kleine Koerper
  aphids:    glyph(['.X.X', 'X.X.', '.X.X', 'X.X.']),
  // Fallobst: rund mit Stiel
  fruit:     glyph(['..X.', '.XXX', 'XXXX', '.XX.']),
  // Samen: zwei laengliche Koerner
  seeds:     glyph(['XX..', 'XX.X', '..XX', '.XX.']),
  seedpile:  glyph(['XX.X', 'XXXX', 'X.XX', '.XX.']),
  // Aas: Knochenkreuz
  carrion:   glyph(['X..X', '.XX.', '.XX.', 'X..X']),
  // Zuckerwuerfel: voller Block, der Glanz macht die Kante
  sugarcube: glyph(['XXXX', 'XXXX', 'XXXX', 'XXXX']),
  // Fleisch: dicker Brocken
  meat:      glyph(['.XXX', 'XXXX', 'XXX.', '.XX.']),
};
/** Glanzpunkt je Sorte – gibt der Form eine Lichtquelle. */
const FOOD_SHINE = {
  flower:    glyph(['....', '.X..', '....', '....']),
  aphids:    glyph(['....', '....', '..X.', '....']),
  fruit:     glyph(['....', '.X..', '....', '....']),
  seeds:     glyph(['X...', '....', '....', '....']),
  seedpile:  glyph(['X...', '....', '....', '....']),
  carrion:   glyph(['....', '.X..', '....', '....']),
  sugarcube: glyph(['XX..', 'X...', '....', '....']),
  meat:      glyph(['....', '.X..', '....', '....']),
};

/** Form und Glanz je Zelltyp, aus FOOD_OF_CELL aufgeloest. */
const GLYPH_OF_CELL = new Uint16Array(64);
const SHINE_OF_CELL = new Uint16Array(64);
for (let id = 0; id < FOOD_OF_CELL.length; id++) {
  const key = FOOD_OF_CELL[id];
  if (!key) continue;
  GLYPH_OF_CELL[id] = FOOD_GLYPH[key] || 0;
  SHINE_OF_CELL[id] = FOOD_SHINE[key] || 0;
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

/**
 * RUHIGES GELAENDE.
 *
 * Gras, Erde und Sand streuten ihre Zweitfarbe ueber dreissig Prozent der
 * Pixel und legten obendrauf noch Glanzpunkte. Das Ergebnis war ein
 * flimmernder Teppich, in dem jede Nahrungszelle unterging – unabhaengig
 * davon, welche Form sie hat. Ein Untergrund soll Untergrund sein: er
 * traegt Struktur, aber er streitet nicht mit dem, was darauf liegt.
 *
 * Deshalb wird die Streufarbe zur Grundfarbe hin gezogen. Die Struktur
 * bleibt erhalten, ihr Kontrast sinkt.
 */
const QUIET = 0.62;
function calm(base, alt) {
  return pack(mix(base, alt, 1 - QUIET));
}
const CALM_ALT = new Uint32Array(SURFACE_CELL_DEFS.length);
for (const d of SURFACE_CELL_DEFS) {
  CALM_ALT[d.id] = d.category === 'terrain' ? calm(d.color, d.alt) : pack(d.alt);
}

/** Zusatzfarben, die sich nicht aus der Definitionstabelle ergeben. */
const GRASS_BLADE = shade(0x4a7a38, 1.15);
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
      let c0 = BASE[t], c1 = CALM_ALT[t], c2 = 0, pb = 0;

      /**
       * Nahrungsquellen: feste Form, dunkler Rand, Helligkeit zeigt den
       * Restbestand. Der Rand bleibt dunkel, auch wenn die Quelle fast
       * leer ist – sonst verschwindet eine abgeerntete Stelle ganz, und
       * genau dort sollen die Ameisen ja aufhoeren hinzulaufen.
       */
      if (FOOD_MAX[t] > 0) {
        const def = SURFACE_CELL_DEFS[t];
        const frac = 0.45 + 0.55 * Math.min(1, level.meta[i] / FOOD_MAX[t]);
        const form = GLYPH_OF_CELL[t];
        if (form) {
          cellBlock(buf, stride, x * n, y * n, n,
            shade(def.color, 0.32),          // Rand und Schatten
            shade(def.color, frac), form,    // die Form selbst
            shade(def.color, Math.min(1.6, frac * 1.5)), SHINE_OF_CELL[t]);
        } else {
          cellBlock(buf, stride, x * n, y * n, n,
            shade(def.color, frac), shade(def.alt, frac), pa,
            shade(def.color, frac * 1.35), PATTERN_B[v]);
        }
        continue;
      }

      switch (t) {
        case SURFACE_CELL.GRASS:
          // Leichte Helligkeitsschwankung pro Zelle + vereinzelte Halme
          // Nur noch jede vierte Zelle traegt einen Halm, und der ist matter.
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.96 + (v & 7) * 0.012);
          if ((v & 3) === 0) { c2 = GRASS_BLADE; pb = PATTERN_B[v] & 0x1111; }
          break;
        case SURFACE_CELL.DIRT:
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.97 + ((v >> 2) & 7) * 0.008);
          break;
        case SURFACE_CELL.SAND:
          c0 = shade(SURFACE_CELL_DEFS[t].color, 0.98 + ((v >> 1) & 7) * 0.007);
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
