/**
 * surface.js – Oberflaechen-Grid (Draufsicht) und dessen Generator.
 *
 * Zelltypen werden hier als DATEN definiert (Name, Beschreibung, Farbe,
 * Passierbarkeit, Kategorie). Legende, Tooltip und Renderer lesen diese
 * Tabelle – nichts davon ist im HTML verdrahtet.
 */

import { WORLD, GEN } from '../config.js';
import { Level, LEVEL_KIND } from './levels.js';
import { fbm, hash2, hash2i } from '../rng.js';

/** Zelltyp-IDs der Oberflaeche. */
export const SURFACE_CELL = {
  GRASS: 0,
  DIRT: 1,
  STONE: 2,
  SAND: 3,
  PLANT: 4,
  FLOWER: 5,
  WATER: 6,
  PEBBLE: 7,
  MOUND: 8,
  ENTRANCE: 9,
};

/**
 * Definitionstabelle. Reihenfolge = Zelltyp-ID.
 *  color / alt : Basis- und Streufarbe fuer die Pixel-Art-Textur
 *  solid       : unpassierbar fuer Laufende
 *  category    : Gruppierung in der Legende
 */
export const SURFACE_CELL_DEFS = [
  { id: 0, key: 'grass', name: 'Gras', desc: 'Normaler Untergrund, gut begehbar.', color: 0x4a7a38, alt: 0x3f6b30, solid: false, category: 'terrain' },
  { id: 1, key: 'dirt', name: 'Erde', desc: 'Offener Boden, hier graben Ameisen gerne.', color: 0x6b4f31, alt: 0x5d442a, solid: false, category: 'terrain' },
  { id: 2, key: 'stone', name: 'Stein', desc: 'Unpassierbar. Bietet Deckung und Netzanker.', color: 0x7b7b82, alt: 0x6a6a71, solid: true, category: 'terrain' },
  { id: 3, key: 'sand', name: 'Sand', desc: 'Trocken und locker. Lieblingsplatz des Ameisenloewen.', color: 0xc2ab74, alt: 0xb29c68, solid: false, category: 'terrain' },
  { id: 4, key: 'plant', name: 'Pflanze', desc: 'Quelle fuer Harz, Ankerpunkt fuer Spinnennetze.', color: 0x2f6b2c, alt: 0x275a25, solid: false, category: 'terrain' },
  { id: 5, key: 'flower', name: 'Bluete', desc: 'Traegt Nektar (Zucker).', color: 0xd9a0c8, alt: 0xe8c96a, solid: false, category: 'terrain' },
  { id: 6, key: 'water', name: 'Wasser', desc: 'Pfuetze. Ameisen meiden sie, Flut fuellt sie.', color: 0x2f6fa8, alt: 0x3a80bd, solid: true, category: 'terrain' },
  { id: 7, key: 'pebble', name: 'Kiesel', desc: 'Baumaterial fuer Waelle und Eingangssperren.', color: 0x9a9a92, alt: 0x8a8a82, solid: false, category: 'struktur' },
  { id: 8, key: 'mound', name: 'Erdhuegel', desc: 'Aushub aus dem Nest. Waechst mit dem Tunnelsystem.', color: 0x8a6a42, alt: 0x795c39, solid: false, category: 'struktur' },
  { id: 9, key: 'entrance', name: 'Nesteingang', desc: 'Portal in die Nest-Ebene der Kolonie.', color: 0x241a12, alt: 0x1a120c, solid: false, category: 'struktur' },
];

/**
 * Erzeugt die Oberflaechen-Ebene.
 * @param {import('../rng.js').RNG} rng
 * @returns {Level}
 */
export function createSurface(rng) {
  const level = new Level({
    kind: LEVEL_KIND.SURFACE,
    w: WORLD.SURFACE_W,
    h: WORLD.SURFACE_H,
    name: 'Oberflaeche',
  });
  level.setCellDefs(SURFACE_CELL_DEFS);
  generateSurface(level, rng);
  return level;
}

/** Deterministische Terraingenerierung aus dem Seed. */
export function generateSurface(level, rng) {
  const s = GEN.SURFACE;
  // Seeds fuer die einzelnen Rauschfelder – aus dem RNG, damit der Weltseed wirkt.
  const seedBiome = rng.int(1 << 30);
  const seedDetail = rng.int(1 << 30);
  const seedScatter = rng.int(1 << 30);
  const seedVariant = rng.int(1 << 30);

  const { w, h, cells, variant } = level;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const b = fbm(x * s.BIOME_FREQ, y * s.BIOME_FREQ, seedBiome, 4);
      const d = fbm(x * s.DETAIL_FREQ, y * s.DETAIL_FREQ, seedDetail, 2);

      let t;
      if (b < s.WATER_LEVEL) t = SURFACE_CELL.WATER;
      else if (b < s.SAND_LEVEL) t = SURFACE_CELL.SAND;
      else if (b < s.DIRT_LEVEL && d > 0.05) t = SURFACE_CELL.DIRT;
      else t = SURFACE_CELL.GRASS;

      // Streuobjekte: nur auf begehbarem Boden, deterministisch gehasht.
      if (t === SURFACE_CELL.GRASS || t === SURFACE_CELL.DIRT) {
        const r = hash2(x, y, seedScatter);
        if (r < s.STONE_DENSITY) t = SURFACE_CELL.STONE;
        else if (r < s.STONE_DENSITY + s.PEBBLE_DENSITY) t = SURFACE_CELL.PEBBLE;
        else if (t === SURFACE_CELL.GRASS && r < s.STONE_DENSITY + s.PEBBLE_DENSITY + s.PLANT_DENSITY) t = SURFACE_CELL.PLANT;
        else if (t === SURFACE_CELL.GRASS && r < s.STONE_DENSITY + s.PEBBLE_DENSITY + s.PLANT_DENSITY + s.FLOWER_DENSITY) t = SURFACE_CELL.FLOWER;
      }

      cells[i] = t;
      variant[i] = hash2i(x, y, seedVariant) & 0xff;
    }
  }
  level.markAllDirty();
}

/**
 * Sucht einen geeigneten Platz fuer einen Nesteingang: begehbar, trocken,
 * mit Abstand zu Wasser/Stein und zu bereits vergebenen Plaetzen.
 * @param {Level} level
 * @param {import('../rng.js').RNG} rng
 * @param {{x:number,y:number}[]} taken bereits belegte Positionen
 * @param {number} minDist Mindestabstand zu belegten Positionen (Zellen)
 */
export function findNestSite(level, rng, taken = [], minDist = 60) {
  const margin = 24;
  for (let attempt = 0; attempt < 4000; attempt++) {
    const x = rng.intRange(margin, level.w - margin - 1);
    const y = rng.intRange(margin, level.h - margin - 1);
    if (!isOpenArea(level, x, y, 4)) continue;
    let ok = true;
    for (const t of taken) {
      const dx = t.x - x, dy = t.y - y;
      if (dx * dx + dy * dy < minDist * minDist) { ok = false; break; }
    }
    if (ok) return { x, y };
  }
  // Notfall: Kartenmitte freiraeumen.
  const x = level.w >> 1, y = level.h >> 1;
  clearArea(level, x, y, 4);
  return { x, y };
}

function isOpenArea(level, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const c = level.get(x, y);
      if (c === SURFACE_CELL.WATER || c === SURFACE_CELL.STONE || c === 255) return false;
    }
  }
  return true;
}

function clearArea(level, cx, cy, r) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if (level.get(x, y) === 255) continue;
      level.set(x, y, SURFACE_CELL.DIRT);
    }
  }
}

/**
 * Baut einen Nesteingang an der Oberflaeche: freie Flaeche, Erdhuegel-Ring,
 * Eingangszelle. Die Zelle selbst wird spaeter als Portal registriert.
 */
export function buildEntrance(level, x, y) {
  const r = 3;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const dist2 = dx * dx + dy * dy;
      if (dist2 > r * r) continue;
      const c = level.get(x + dx, y + dy);
      if (c === 255) continue;
      if (c === SURFACE_CELL.STONE || c === SURFACE_CELL.WATER) level.set(x + dx, y + dy, SURFACE_CELL.DIRT);
      if (dist2 >= 1) level.set(x + dx, y + dy, SURFACE_CELL.MOUND);
    }
  }
  level.set(x, y, SURFACE_CELL.ENTRANCE);
  return { x, y };
}

/**
 * Legt Aushub als Erdhuegel neben dem Eingang ab (Phase 3 nutzt das beim
 * Graben; Phase 1 baut damit den Starthuegel auf).
 */
export function dumpSoil(level, ex, ey, rng) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const a = rng.angle();
    const r = 1 + rng.float() * 5;
    const x = Math.round(ex + Math.cos(a) * r);
    const y = Math.round(ey + Math.sin(a) * r);
    const c = level.get(x, y);
    if (c === 255 || c === SURFACE_CELL.ENTRANCE) continue;
    if (c === SURFACE_CELL.MOUND || c === SURFACE_CELL.STONE || c === SURFACE_CELL.WATER) continue;
    level.set(x, y, SURFACE_CELL.MOUND);
    return true;
  }
  return false;
}
