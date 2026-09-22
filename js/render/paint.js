/**
 * paint.js – Gemeinsame Hilfen zum Zeichnen der Terrain-Chunks.
 *
 * Terrain wird nicht mit Grafikprimitiven gezeichnet, sondern als Pixelpuffer:
 * pro Zelle ein Block von CELL_PX x CELL_PX Pixeln in einer Chunk-Textur.
 * Das ergibt echte Pixel-Art, kostet pro Chunk nur einen Texturupload und
 * skaliert problemlos auf 400x400 Zellen.
 *
 * Farbvariation kommt aus zwei vorberechneten Dither-Mustern, die ueber die
 * Zellvariante (level.variant) ausgewaehlt werden – kein Rauschen zur
 * Laufzeit, keine Allokation.
 */

import { hash2i } from '../rng.js';

/** 0xRRGGBB -> ABGR-Uint32 (little endian, volle Deckung). */
export function pack(hex) {
  const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Farbe aufhellen/abdunkeln (f = 1.0 unveraendert). */
export function shade(hex, f) {
  let r = Math.round(((hex >> 16) & 0xff) * f);
  let g = Math.round(((hex >> 8) & 0xff) * f);
  let b = Math.round((hex & 0xff) * f);
  if (r > 255) r = 255; if (g > 255) g = 255; if (b > 255) b = 255;
  if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0;
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** Zwei Farben mischen (t = 0 -> a, 1 -> b), Ergebnis als 0xRRGGBB. */
export function mix(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  return (((ar + (br - ar) * t) | 0) << 16) | (((ag + (bg - ag) * t) | 0) << 8) | ((ab + (bb - ab) * t) | 0);
}

/**
 * 256 Dithermuster fuer ein 4x4-Raster. PATTERN_A ist grob (ca. 30% gesetzt),
 * PATTERN_B fein (ca. 12%) fuer vereinzelte Glanzpunkte.
 */
export const PATTERN_A = new Uint16Array(256);
export const PATTERN_B = new Uint16Array(256);
for (let v = 0; v < 256; v++) {
  let a = 0, b = 0;
  for (let i = 0; i < 16; i++) {
    const h = hash2i(v, i, 9173) / 4294967296;
    if (h < 0.30) a |= 1 << i;
    if (h > 0.88) b |= 1 << i;
  }
  PATTERN_A[v] = a;
  PATTERN_B[v] = b;
}

/**
 * Einen Zellblock in den Pixelpuffer schreiben.
 * @param {Uint32Array} buf   Zielpuffer
 * @param {number} stride     Pufferbreite in Pixeln
 * @param {number} px         linke obere Ecke der Zelle im Puffer (Pixel)
 * @param {number} py         obere Kante der Zelle im Puffer (Pixel)
 * @param {number} n          Kantenlaenge der Zelle in Pixeln
 * @param {number} c0         Grundfarbe (ABGR)
 * @param {number} c1         Streufarbe (ABGR)
 * @param {number} patA       Dithermuster fuer c1
 * @param {number} c2         optionale zweite Streufarbe (ABGR, 0 = aus)
 * @param {number} patB       Dithermuster fuer c2
 */
export function cellBlock(buf, stride, px, py, n, c0, c1, patA, c2, patB) {
  // Schnellpfad fuer die uebliche Zellgroesse (WORLD.CELL_PX === 4).
  if (n === 4) {
    let bit = 0;
    for (let sy = 0; sy < 4; sy++) {
      let o = (py + sy) * stride + px;
      for (let sx = 0; sx < 4; sx++, o++, bit++) {
        let c = ((patA >> bit) & 1) ? c1 : c0;
        if (c2 !== 0 && ((patB >> bit) & 1)) c = c2;
        buf[o] = c;
      }
    }
    return;
  }
  for (let sy = 0; sy < n; sy++) {
    const qy = (sy * 4 / n) | 0;
    let o = (py + sy) * stride + px;
    for (let sx = 0; sx < n; sx++, o++) {
      const bit = qy * 4 + ((sx * 4 / n) | 0);
      let c = c0;
      if (patA !== 0 && ((patA >> bit) & 1)) c = c1;
      if (c2 !== 0 && patB !== 0 && ((patB >> bit) & 1)) c = c2;
      buf[o] = c;
    }
  }
}
