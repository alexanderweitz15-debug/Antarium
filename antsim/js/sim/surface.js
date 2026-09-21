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
  // --- Nahrungsquellen (level.meta traegt den Restbestand) --------------
  APHIDS: 10,
  FRUIT: 11,
  SEEDS: 12,
  CARRION: 13,
  SUGARCUBE: 14,
  MEAT: 15,
  SEEDPILE: 16,
  // --- Mutagene ---------------------------------------------------------
  FUNGUS: 17,
  BERRY: 18,
  // --- Kreaturenbauten --------------------------------------------------
  WEB: 19,
  FUNNEL: 20,
  // --- Befestigungen an der Oberflaeche (Phase 6) -----------------------
  WALL: 21,       // Kieselwall rund um den Eingang
  RESIN_BLOB: 22, // Harzklecks: verlangsamt Feinde
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
  { id: 5, key: 'flower', name: 'Bluete', desc: 'Traegt Nektar (Zucker).', color: 0xd9a0c8, alt: 0xe8c96a, solid: false, category: 'nahrung', food: 'flower' },
  { id: 6, key: 'water', name: 'Wasser', desc: 'Pfuetze. Ameisen meiden sie, Flut fuellt sie.', color: 0x2f6fa8, alt: 0x3a80bd, solid: true, category: 'terrain' },
  { id: 7, key: 'pebble', name: 'Kiesel', desc: 'Baumaterial fuer Waelle und Eingangssperren.', color: 0x9a9a92, alt: 0x8a8a82, solid: false, category: 'struktur' },
  { id: 8, key: 'mound', name: 'Erdhuegel', desc: 'Aushub aus dem Nest. Waechst mit dem Tunnelsystem.', color: 0x8a6a42, alt: 0x795c39, solid: false, category: 'struktur' },
  { id: 9, key: 'entrance', name: 'Nesteingang', desc: 'Portal in die Nest-Ebene der Kolonie.', color: 0x241a12, alt: 0x1a120c, solid: false, category: 'struktur' },

  { id: 10, key: 'aphids', name: 'Blattlaeuse', desc: 'Honigtau: fast reiner Zucker. Waechst schnell nach.', color: 0x7ec46a, alt: 0x9fd98a, solid: false, category: 'nahrung', food: 'aphids' },
  { id: 11, key: 'fruit', name: 'Fallobst', desc: 'Zucker mit etwas Fett. Verdirbt langsam.', color: 0xc85a4a, alt: 0xe07a5a, solid: false, category: 'nahrung', food: 'fruit' },
  { id: 12, key: 'seeds', name: 'Samen', desc: 'Fettreich, dazu etwas Protein.', color: 0xc9b183, alt: 0xa8925f, solid: false, category: 'nahrung', food: 'seeds' },
  { id: 13, key: 'carrion', name: 'Aas', desc: 'Totes Insekt: die wichtigste Proteinquelle.', color: 0x8c4a55, alt: 0x6e3843, solid: false, category: 'nahrung', food: 'carrion' },
  { id: 14, key: 'sugarcube', name: 'Zuckerwuerfel', desc: 'Reiner Zucker. Vom Spieler abgelegt.', color: 0xf0e2a8, alt: 0xd8c877, solid: false, category: 'nahrung', food: 'sugarcube' },
  { id: 15, key: 'meat', name: 'Fleischbrocken', desc: 'Sehr proteinreich. Vom Spieler abgelegt.', color: 0xb5453f, alt: 0x8e3430, solid: false, category: 'nahrung', food: 'meat' },
  { id: 16, key: 'seedpile', name: 'Samenhaufen', desc: 'Fettreich. Vom Spieler abgelegt.', color: 0xd6c08a, alt: 0xb09a64, solid: false, category: 'nahrung', food: 'seedpile' },

  { id: 17, key: 'fungus', name: 'Leuchtender Pilz', desc: 'Mutagen: verdoppelt die Mutationsstaerke der naechsten Generation.', color: 0x6adfc0, alt: 0x9cf0dc, solid: false, category: 'mutagen' },
  { id: 18, key: 'berry', name: 'Giftbeere', desc: 'Mutagen: mehr Stress und Sprungmutationen, kostet Trefferpunkte.', color: 0x9b4fd0, alt: 0x7a36ab, solid: false, category: 'mutagen' },

  { id: 19, key: 'web', name: 'Spinnennetz', desc: 'Haelt Ameisen fest. Von Saeure aufloesbar.', color: 0xd8dde2, alt: 0xa8b2ba, solid: false, category: 'kreatur' },
  { id: 20, key: 'funnel', name: 'Trichter', desc: 'Falle des Ameisenloewen im Sand.', color: 0xb8a276, alt: 0x9a8760, solid: false, category: 'kreatur' },

  { id: 21, key: 'wall', name: 'Kieselwall', desc: 'Schuetzt den Eingang. Unpassierbar fuer Raeuber und Feinde.', color: 0x9e968a, alt: 0x88807a, solid: true, category: 'befestigung' },
  { id: 22, key: 'resinblob', name: 'Harz', desc: 'Klebrig. Verlangsamt alles, was hineinlaeuft.', color: 0xc08c3e, alt: 0xd8a458, solid: false, category: 'befestigung' },
];

/** Zelltyp -> Schluessel des Nahrungsprofils (oder null). */
export const FOOD_OF_CELL = (() => {
  const map = new Array(64).fill(null);
  for (const d of SURFACE_CELL_DEFS) if (d.food) map[d.id] = d.food;
  map[SURFACE_CELL.FLOWER] = 'flower';
  return map;
})();

/**
 * Erzeugt die Oberflaechen-Ebene.
 * @param {import('../rng.js').RNG} rng
 * @param {object} [gen] Generatorparameter (Kartenvorlage), sonst GEN.SURFACE
 * @returns {Level}
 */
export function createSurface(rng, gen) {
  const level = new Level({
    kind: LEVEL_KIND.SURFACE,
    w: WORLD.SURFACE_W,
    h: WORLD.SURFACE_H,
    name: 'Oberflaeche',
  });
  level.setCellDefs(SURFACE_CELL_DEFS);
  generateSurface(level, rng, gen);
  return level;
}

/** Deterministische Terraingenerierung aus dem Seed. */
export function generateSurface(level, rng, gen) {
  const s = gen || GEN.SURFACE;
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
