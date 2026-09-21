/**
 * levels.js – Ebenenverwaltung.
 *
 * Eine Ebene ist ein in sich geschlossener Simulationsraum:
 *   Grid (Typed Arrays) + Metadaten + Spatial Hash + Dirty-Chunk-Liste +
 *   gemerkte Kameraposition.
 *
 * WICHTIG: Alle Ebenen werden jeden Tick simuliert, unabhaengig davon, welche
 * gerade sichtbar ist. Nur das RENDERING beschraenkt sich auf die aktive
 * Ebene (plus Bild-in-Bild ab Phase 4). Unsichtbare Ebenen sammeln geaenderte
 * Chunks in dirtyList und laden sie beim Wechsel hoch.
 */

import { WORLD, LIMITS } from '../config.js';
import { SpatialHash } from './spatial.js';

export const LEVEL_KIND = {
  SURFACE: 0, // Draufsicht
  NEST: 1,    // Querschnitt
};

export class Level {
  /**
   * @param {{kind:number, w:number, h:number, name:string, colonyId?:number}} opts
   */
  constructor(opts) {
    /**
     * Ebenen-ID. Wird erst von LevelManager.add() vergeben, damit ein
     * Neustart mit gleichem Seed exakt die gleichen IDs erzeugt (keine
     * modulglobalen Zaehler).
     */
    this.id = -1;
    this.kind = opts.kind;
    this.w = opts.w;
    this.h = opts.h;
    this.name = opts.name;
    this.colonyId = opts.colonyId !== undefined ? opts.colonyId : -1;
    /** Verlassenes Nest (Phase 5+): bleibt simuliert, ist aber herrenlos. */
    this.abandoned = false;

    const n = this.w * this.h;
    /** Zelltyp (Werte aus SURFACE_CELL bzw. NEST_CELL). */
    this.cells = new Uint8Array(n);
    /** Zusatzinfo pro Zelle: Kammertyp, Besitzer, Bauzustand. */
    this.meta = new Uint8Array(n);
    /** Visuelle Variante pro Zelle (Rauschen, einmalig erzeugt). */
    this.variant = new Uint8Array(n);

    /** Tabelle: Zelltyp -> 1, wenn unpassierbar. Wird von setCellDefs gefuellt. */
    this.solidTable = new Uint8Array(256);
    this.cellDefs = null;

    // --- Chunks -----------------------------------------------------------
    this.chunkSize = WORLD.CHUNK;
    this.chunkCols = Math.ceil(this.w / this.chunkSize);
    this.chunkRows = Math.ceil(this.h / this.chunkSize);
    this.chunkCount = this.chunkCols * this.chunkRows;
    /** 1 = Chunk muss neu in die Textur gezeichnet werden. */
    this.chunkDirty = new Uint8Array(this.chunkCount).fill(1);
    /** Liste der dirty Chunks, um nicht alles scannen zu muessen. */
    this.dirtyList = new Int32Array(this.chunkCount);
    this.dirtyCount = this.chunkCount;
    for (let i = 0; i < this.chunkCount; i++) this.dirtyList[i] = i;

    // --- Raumindex --------------------------------------------------------
    this.spatial = new SpatialHash(this.w, this.h, 8, LIMITS.MAX_ANTS);

    // --- Kamera (pro Ebene gemerkt) --------------------------------------
    this.view = { x: (this.w * WORLD.CELL_SIZE) / 2, y: (this.h * WORLD.CELL_SIZE) / 2, zoom: 0, init: false };

    // --- Laufzeitstatistik ------------------------------------------------
    this.antCount = 0;
    this.simMs = 0;
  }

  /** @param {Array} defs Array von Zelltyp-Definitionen (Index = Zelltyp-ID). */
  setCellDefs(defs) {
    this.cellDefs = defs;
    this.solidTable.fill(1); // unbekannte Typen gelten als solide
    for (let i = 0; i < defs.length; i++) {
      this.solidTable[defs[i].id] = defs[i].solid ? 1 : 0;
    }
  }

  idx(x, y) { return y * this.w + x; }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  /** Zelltyp lesen; ausserhalb der Karte wird 255 (= solide) geliefert. */
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 255;
    return this.cells[y * this.w + x];
  }

  /** Zelltyp setzen und den betroffenen Chunk als dirty markieren. */
  set(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.cells[i] === v) return;
    this.cells[i] = v;
    this.markDirtyAt(x, y);
  }

  getMeta(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.meta[y * this.w + x];
  }

  setMeta(x, y, v) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.meta[i] === v) return;
    this.meta[i] = v;
    this.markDirtyAt(x, y);
  }

  /** Schnelle Solid-Abfrage fuer die Bewegung (ausserhalb = solide). */
  isSolid(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    return this.solidTable[this.cells[y * this.w + x]] === 1;
  }

  /** Solid-Abfrage mit Gleitkommakoordinaten. */
  isSolidF(fx, fy) {
    return this.isSolid(fx | 0, fy | 0);
  }

  markDirtyAt(x, y) {
    const ci = ((y / this.chunkSize) | 0) * this.chunkCols + ((x / this.chunkSize) | 0);
    if (this.chunkDirty[ci]) return;
    this.chunkDirty[ci] = 1;
    this.dirtyList[this.dirtyCount++] = ci;
  }

  markAllDirty() {
    this.dirtyCount = 0;
    for (let i = 0; i < this.chunkCount; i++) {
      this.chunkDirty[i] = 1;
      this.dirtyList[this.dirtyCount++] = i;
    }
  }

  /**
   * Bis zu max dirty Chunks abarbeiten. Der Callback bekommt den Chunk-Index.
   * @returns {number} Anzahl abgearbeiteter Chunks
   */
  consumeDirty(max, cb) {
    let done = 0;
    while (this.dirtyCount > 0 && done < max) {
      const ci = this.dirtyList[--this.dirtyCount];
      if (!this.chunkDirty[ci]) continue; // schon erledigt (Doppeleintrag)
      this.chunkDirty[ci] = 0;
      cb(ci);
      done++;
    }
    return done;
  }

  get worldW() { return this.w * WORLD.CELL_SIZE; }
  get worldH() { return this.h * WORLD.CELL_SIZE; }
}

export class LevelManager {
  constructor() {
    /** @type {Level[]} */
    this.levels = [];
    /** @type {Map<number, Level>} */
    this.byId = new Map();
    this.activeId = -1;
    /** @type {Level|null} */
    this.surface = null;
  }

  add(level) {
    if (level.kind === LEVEL_KIND.NEST && this.nestCount >= LIMITS.MAX_NEST_LEVELS) {
      throw new Error('Maximale Anzahl Nest-Ebenen erreicht (' + LIMITS.MAX_NEST_LEVELS + ')');
    }
    level.id = this.levels.length;
    this.levels.push(level);
    this.byId.set(level.id, level);
    if (level.kind === LEVEL_KIND.SURFACE) this.surface = level;
    if (this.activeId < 0) this.activeId = level.id;
    return level;
  }

  get(id) { return this.byId.get(id) || null; }

  get active() { return this.byId.get(this.activeId) || null; }

  get nestCount() {
    let c = 0;
    for (const l of this.levels) if (l.kind === LEVEL_KIND.NEST) c++;
    return c;
  }

  /** Nest-Ebenen einer Kolonie (eine Kolonie kann mehrere besitzen). */
  nestsOf(colonyId) {
    return this.levels.filter((l) => l.kind === LEVEL_KIND.NEST && l.colonyId === colonyId && !l.abandoned);
  }

  setActive(id) {
    if (!this.byId.has(id)) return false;
    this.activeId = id;
    return true;
  }
}
