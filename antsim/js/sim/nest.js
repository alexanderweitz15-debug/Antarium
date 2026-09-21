/**
 * nest.js – Nest-Grid (seitlicher Querschnitt) und dessen Generator.
 *
 * Aufbau von oben nach unten:
 *   Zeile 0 .. NEST_SURFACE_ROW-1 : Himmel-/Oberflaechenstreifen (Orientierung)
 *   Zeile NEST_SURFACE_ROW        : Erdoberflaeche – HIER liegen alle Portale
 *   darunter                      : Erdreich mit zunehmender Haerte
 *
 * Bewegung: Nur Luftzellen (Tunnel, Kammer, Eingang) sind begehbar. Der
 * Himmel ist bewusst "solide", damit niemand seitlich aus dem Querschnitt
 * herauslaeuft – die Oberflaeche erreicht man ausschliesslich ueber Portale.
 */

import { WORLD, GEN } from '../config.js';
import { Level, LEVEL_KIND } from './levels.js';
import { fbm, hash2, hash2i } from '../rng.js';

export const NEST_CELL = {
  SKY: 0,
  TOPSOIL: 1,
  SOIL: 2,
  HARD_SOIL: 3,
  STONE: 4,
  ROOT: 5,
  PEBBLE: 6,
  TUNNEL: 7,
  CHAMBER: 8,
  DEBRIS: 9,
  WATER: 10,
  ENTRANCE: 11,
};

export const NEST_CELL_DEFS = [
  { id: 0, key: 'sky', name: 'Himmel', desc: 'Orientierungsstreifen oberhalb der Erdoberflaeche.', color: 0x4e7fa8, alt: 0x5a8cb5, solid: true, category: 'terrain' },
  { id: 1, key: 'topsoil', name: 'Erdoberflaeche', desc: 'Grasnarbe. Auf dieser Zeile liegen alle Nesteingaenge.', color: 0x4a7a38, alt: 0x5d442a, solid: true, category: 'terrain' },
  { id: 2, key: 'soil', name: 'Erde', desc: 'Normal grabbar. Braucht Abstuetzung.', color: 0x5a4028, alt: 0x4f381f, solid: true, category: 'terrain' },
  { id: 3, key: 'hardsoil', name: 'Harte Erde', desc: 'Langsam grabbar, dafuer standfest.', color: 0x3b2716, alt: 0x2f1f11, solid: true, category: 'terrain' },
  { id: 4, key: 'stone', name: 'Stein', desc: 'Nicht grabbar. Natuerlicher Stuetzpunkt.', color: 0x6e6e76, alt: 0x5f5f67, solid: true, category: 'terrain' },
  { id: 5, key: 'root', name: 'Wurzel', desc: 'Zaeh, stabilisiert das umgebende Erdreich.', color: 0x7a5a2a, alt: 0x664a22, solid: true, category: 'terrain' },
  { id: 6, key: 'pebble', name: 'Kiesel', desc: 'Abbaubar. Baumaterial fuer Befestigungen.', color: 0x8f8f8a, alt: 0x7d7d79, solid: true, category: 'terrain' },
  { id: 7, key: 'tunnel', name: 'Tunnel', desc: 'Luft. Hier laufen die Ameisen.', color: 0x201711, alt: 0x1a120d, solid: false, category: 'terrain' },
  { id: 8, key: 'chamber', name: 'Kammer', desc: 'Ausgebaute Kammer, Bodenfarbe zeigt den Typ.', color: 0x2a1f16, alt: 0x241a12, solid: false, category: 'kammer' },
  { id: 9, key: 'debris', name: 'Truemmer', desc: 'Eingestuerztes Material. Muss weggeraeumt werden.', color: 0x3a2c1e, alt: 0x453525, solid: true, category: 'terrain' },
  { id: 10, key: 'water', name: 'Wasser', desc: 'Eingedrungenes Wasser. Ertraenkt Brut.', color: 0x2f6fa8, alt: 0x3a80bd, solid: true, category: 'terrain' },
  { id: 11, key: 'entrance', name: 'Nesteingang', desc: 'Portal zur Oberflaeche.', color: 0x14100c, alt: 0x0e0b08, solid: false, category: 'struktur' },
];

/** Kammertypen (stehen in level.meta der Kammerzellen). */
export const CHAMBER = {
  NONE: 0,
  QUEEN: 1,
  ESCAPE: 2,
  BROOD: 3,
  STORE: 4,
  INFIRMARY: 5,
  GUARD: 6,
  GRAVE: 7,
};

export const CHAMBER_DEFS = [
  { id: 0, key: 'none', name: 'Gang', desc: 'Kein besonderer Kammertyp.', color: 0x201711 },
  { id: 1, key: 'queen', name: 'Koeniginnenkammer', desc: 'Tief gelegen. Hier legt die Koenigin Eier.', color: 0x412c3e },
  { id: 2, key: 'escape', name: 'Fluchtkammer', desc: 'Noch tiefer, eigener Zugang. Rueckzug der Koenigin.', color: 0x33294a },
  { id: 3, key: 'brood', name: 'Brutkammer', desc: 'Eier, Larven und Puppen werden hier gepflegt.', color: 0x5c5029 },
  { id: 4, key: 'store', name: 'Vorratskammer', desc: 'Getrennte Bereiche fuer Zucker, Protein und Fett.', color: 0x46351d },
  { id: 5, key: 'infirmary', name: 'Lazarett', desc: 'Verwundete werden hier gepflegt.', color: 0x2b4742 },
  { id: 6, key: 'guard', name: 'Wachkammer', desc: 'Nahe am Eingang, dauerhaft besetzt.', color: 0x472b2b },
  { id: 7, key: 'grave', name: 'Friedhof', desc: 'Abseits gelegene Ablage fuer Tote.', color: 0x2c2c2c },
];

/**
 * Erzeugt eine Nest-Ebene fuer eine Kolonie.
 * @param {import('../rng.js').RNG} rng
 * @param {{colonyId:number, name:string}} opts
 */
export function createNest(rng, opts) {
  const level = new Level({
    kind: LEVEL_KIND.NEST,
    w: WORLD.NEST_W,
    h: WORLD.NEST_H,
    name: opts.name,
    colonyId: opts.colonyId,
  });
  level.setCellDefs(NEST_CELL_DEFS);
  generateNestRock(level, rng);
  return level;
}

/** Erdreich, Steine, Wurzeln, Kiesel – deterministisch. */
export function generateNestRock(level, rng) {
  const g = GEN.NEST;
  const seedHard = rng.int(1 << 30);
  const seedStone = rng.int(1 << 30);
  const seedScatter = rng.int(1 << 30);
  const seedVariant = rng.int(1 << 30);
  const surfRow = WORLD.NEST_SURFACE_ROW;
  const { w, h, cells, variant } = level;

  for (let y = 0; y < h; y++) {
    const depth = y - surfRow;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let t;
      if (y < surfRow) {
        t = NEST_CELL.SKY;
      } else if (y === surfRow) {
        t = NEST_CELL.TOPSOIL;
      } else {
        t = NEST_CELL.SOIL;
        // Steinlinsen
        const st = fbm(x * g.STONE_FREQ, y * g.STONE_FREQ, seedStone, 3);
        if (st > g.STONE_THRESHOLD) {
          t = NEST_CELL.STONE;
        } else {
          // Harte Erde nimmt mit der Tiefe zu
          const hard = fbm(x * g.HARD_SOIL_FREQ, y * g.HARD_SOIL_FREQ, seedHard, 3);
          const depthBias = Math.min(1, Math.max(0, (depth - g.HARD_SOIL_START) / 60));
          if (hard + depthBias > 0.45) t = NEST_CELL.HARD_SOIL;
          const r = hash2(x, y, seedScatter);
          if (r < g.PEBBLE_DENSITY) t = NEST_CELL.PEBBLE;
          else if (depth < 26 && r < g.PEBBLE_DENSITY + g.ROOT_DENSITY) t = NEST_CELL.ROOT;
        }
      }
      cells[i] = t;
      variant[i] = hash2i(x, y, seedVariant) & 0xff;
    }
  }
  level.markAllDirty();
}

/** Setzt eine Luftzelle (Tunnel oder Kammer mit Typ). */
export function carve(level, x, y, chamberType = CHAMBER.NONE) {
  if (!level.inBounds(x, y)) return false;
  if (y <= WORLD.NEST_SURFACE_ROW) return false;      // Oberflaechenzeile bleibt geschlossen
  if (level.get(x, y) === NEST_CELL.STONE) return false; // Stein ist nicht grabbar
  level.set(x, y, chamberType === CHAMBER.NONE ? NEST_CELL.TUNNEL : NEST_CELL.CHAMBER);
  level.setMeta(x, y, chamberType);
  return true;
}

/** Senkrechter Schacht der Breite wCells ab Zeile y0 bis y1. */
export function carveShaft(level, cx, y0, y1, wCells) {
  const half = (wCells - 1) >> 1;
  for (let y = y0; y <= y1; y++) {
    for (let dx = -half; dx <= wCells - 1 - half; dx++) carve(level, cx + dx, y, CHAMBER.NONE);
  }
}

/** Waagerechter Gang. */
export function carveTunnel(level, x0, x1, y, hCells = 1) {
  const step = x1 >= x0 ? 1 : -1;
  for (let x = x0; x !== x1 + step; x += step) {
    for (let dy = 0; dy < hCells; dy++) carve(level, x, y + dy, CHAMBER.NONE);
  }
}

/** Elliptische Kammer. */
export function carveChamber(level, cx, cy, rx, ry, type) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      if (nx * nx + ny * ny <= 1) carve(level, x, y, type);
    }
  }
}

/**
 * Baut das Startnest: Eingang, Schacht, Koeniginnenkammer, kleine
 * Vorratskammer. Liefert die wichtigen Positionen zurueck.
 * @returns {{entrance:{x:number,y:number}, queen:{x:number,y:number}, store:{x:number,y:number}, dugCells:number}}
 */
export function buildStartNest(level, rng) {
  const g = GEN.NEST;
  const surfRow = WORLD.NEST_SURFACE_ROW;
  const ex = level.w >> 1;

  const before = countAir(level);

  // Eingang auf der Oberflaechenzeile
  level.set(ex, surfRow, NEST_CELL.ENTRANCE);
  level.setMeta(ex, surfRow, CHAMBER.NONE);

  // Schacht nach unten
  const shaftBottom = surfRow + g.START_SHAFT_DEPTH;
  carveShaft(level, ex, surfRow + 1, shaftBottom, g.START_SHAFT_W);

  // Koeniginnenkammer am Schachtende
  const qy = shaftBottom + g.START_QUEEN_RY + 1;
  carveChamber(level, ex, qy, g.START_QUEEN_RX, g.START_QUEEN_RY, CHAMBER.QUEEN);

  // Seitengang zur Vorratskammer
  const sideDir = rng.chance(0.5) ? -1 : 1;
  const storeX = ex + sideDir * (g.START_QUEEN_RX + g.START_STORE_RX + 5);
  const storeY = shaftBottom - 6;
  carveTunnel(level, ex, storeX, storeY, 2);
  carveChamber(level, storeX, storeY + 1, g.START_STORE_RX, g.START_STORE_RY, CHAMBER.STORE);

  const dug = countAir(level) - before;
  return {
    entrance: { x: ex, y: surfRow },
    queen: { x: ex, y: qy },
    store: { x: storeX, y: storeY + 1 },
    dugCells: dug,
  };
}

function countAir(level) {
  let n = 0;
  const c = level.cells;
  for (let i = 0; i < c.length; i++) {
    const t = c[i];
    if (t === NEST_CELL.TUNNEL || t === NEST_CELL.CHAMBER || t === NEST_CELL.ENTRANCE) n++;
  }
  return n;
}

/** Zufaellige begehbare Zelle der Ebene (fuer Startpopulation, Debug). */
export function randomAirCell(level, rng) {
  for (let i = 0; i < 4000; i++) {
    const x = rng.int(level.w);
    const y = rng.intRange(WORLD.NEST_SURFACE_ROW + 1, level.h - 1);
    if (!level.isSolid(x, y)) return { x, y };
  }
  return null;
}
