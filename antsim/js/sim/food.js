/**
 * food.js – Nahrungsquellen, Naehrstoffprofile und Nachwachsen.
 *
 * Eine Nahrungsquelle ist eine Oberflaechenzelle mit einem Nahrungstyp
 * (SURFACE_CELL.APHIDS, .FRUIT, …). Der Restbestand steht in level.meta
 * derselben Zelle (0..255) – dadurch braucht es keine zweite Datenstruktur
 * und der Bestand faellt beim Zeichnen automatisch mit ab.
 *
 * Ein Register je Ebene haelt die Indizes aller Quellen, damit Nachwachsen
 * und Verderben nicht ueber das ganze Grid laufen muessen. Das Register wird
 * beim Nachwachsdurchlauf verdichtet.
 *
 * Regionale Verteilung: ein grobes Rauschfeld teilt die Karte in zucker-,
 * protein- und samenreiche Gegenden. Kolonien in verschiedenen Gegenden
 * bekommen dadurch verschiedene Ernaehrungslagen – die Grundlage dafuer,
 * dass sich Linien in Phase 8 auseinanderentwickeln.
 */

import { FOOD, NUTRIENT } from '../config.js';
import { SURFACE_CELL, SURFACE_CELL_DEFS, FOOD_OF_CELL } from './surface.js';
import { fbm, hash2 } from '../rng.js';

/** Vorberechnet: Zelltyp -> Profil bzw. dominanter Naehrstoff. */
const PROFILE = new Array(64).fill(null);
const DOMINANT = new Int8Array(64).fill(-1);
for (let id = 0; id < FOOD_OF_CELL.length; id++) {
  const key = FOOD_OF_CELL[id];
  if (!key) continue;
  const p = FOOD.PROFILES[key];
  PROFILE[id] = p;
  let best = 0;
  for (let n = 1; n < 3; n++) if (p.n[n] > p.n[best]) best = n;
  DOMINANT[id] = best;
}

export function foodProfile(cellType) { return PROFILE[cellType] || null; }
export function dominantNutrient(cellType) { return DOMINANT[cellType]; }
export function isFoodCell(cellType) { return PROFILE[cellType] !== null; }

export class FoodSystem {
  constructor(world) {
    this.world = world;
    /** @type {Map<number, {list:Int32Array, count:number, flag:Uint8Array}>} */
    this.reg = new Map();
    /** Kennzahlen fuers Overlay. */
    this.stats = { sources: 0, total: 0 };
  }

  registerLevel(level) {
    if (this.reg.has(level.id)) return;
    this.reg.set(level.id, {
      list: new Int32Array(Math.min(60000, level.w * level.h)),
      count: 0,
      flag: new Uint8Array(level.w * level.h),
    });
  }

  /** Quelle setzen oder auffuellen. */
  place(level, x, y, cellType, amount) {
    if (!level.inBounds(x, y)) return false;
    if (!isFoodCell(cellType)) return false;
    const r = this.reg.get(level.id);
    if (!r) return false;
    const i = y * level.w + x;
    const prof = PROFILE[cellType];
    const amt = Math.max(1, Math.min(prof.max, Math.round(amount)));
    level.set(x, y, cellType);
    level.setMeta(x, y, amt);
    if (!r.flag[i]) {
      if (r.count >= r.list.length) return true;   // Register voll
      r.flag[i] = 1;
      r.list[r.count++] = i;
    }
    return true;
  }

  /** Aas ablegen (tote Ameisen, erlegte Kreaturen). */
  dropCarrion(level, x, y, amount) {
    if (!level.inBounds(x, y)) return false;
    const cur = level.cells[y * level.w + x];
    // Nicht auf Portale, Wasser, Stein oder bestehende Nahrung legen
    if (cur === SURFACE_CELL.ENTRANCE || cur === SURFACE_CELL.WATER
        || cur === SURFACE_CELL.STONE) return false;
    if (isFoodCell(cur) && cur !== SURFACE_CELL.CARRION) return false;
    const have = cur === SURFACE_CELL.CARRION ? level.meta[y * level.w + x] : 0;
    return this.place(level, x, y, SURFACE_CELL.CARRION, have + amount);
  }

  /** Bestand einer Zelle. */
  amountAt(level, x, y) {
    if (!level.inBounds(x, y)) return 0;
    const i = y * level.w + x;
    return isFoodCell(level.cells[i]) ? level.meta[i] : 0;
  }

  /**
   * Nahrung entnehmen.
   * @returns {number} tatsaechlich entnommene Einheiten
   */
  take(level, x, y, units) {
    if (!level.inBounds(x, y)) return 0;
    const i = y * level.w + x;
    const type = level.cells[i];
    if (!isFoodCell(type)) return 0;
    const have = level.meta[i];
    const got = Math.min(have, units);
    if (got <= 0) return 0;
    level.setMeta(x, y, have - got);
    return got;
  }

  /** Nachwachsen und Verderben (alle FOOD.REGROW_INTERVAL Ticks). */
  update(level, tick) {
    if (tick % FOOD.REGROW_INTERVAL !== 0) return;
    const r = this.reg.get(level.id);
    if (!r) return;
    const cells = level.cells, meta = level.meta, w = level.w;
    let write = 0;
    let total = 0;
    for (let k = 0; k < r.count; k++) {
      const i = r.list[k];
      const type = cells[i];
      const prof = PROFILE[type];
      if (!prof) { r.flag[i] = 0; continue; }          // Zelle ist keine Quelle mehr
      let amt = meta[i];
      if (prof.regrow > 0) amt += prof.regrow * FOOD.REGROW_SCALE;
      if (prof.decay > 0) amt -= prof.decay;
      if (amt > prof.max) amt = prof.max;
      if (amt < 0) amt = 0;
      const rounded = Math.round(amt);
      if (rounded !== meta[i]) {
        const x = i % w, y = (i / w) | 0;
        level.setMeta(x, y, rounded);
      }
      if (rounded <= 0 && prof.regrow <= 0) {
        // Verbrauchte Einmalquelle verschwindet
        const x = i % w, y = (i / w) | 0;
        level.set(x, y, SURFACE_CELL.DIRT);
        level.setMeta(x, y, 0);
        r.flag[i] = 0;
        continue;
      }
      total += rounded;
      r.list[write++] = i;
    }
    r.count = write;
    this.stats.sources = write;
    this.stats.total = total;
  }

  /**
   * Nahrung auf einer frischen Karte verteilen – regional unterschiedlich.
   * @param {import('./levels.js').Level} level
   * @param {import('../rng.js').RNG} rng
   */
  generate(level, rng) {
    this.registerLevel(level);
    const seedRegion = rng.int(1 << 30);
    const seedScatter = rng.int(1 << 30);
    const d = FOOD.DENSITY;

    for (let y = 2; y < level.h - 2; y++) {
      for (let x = 2; x < level.w - 2; x++) {
        const base = level.cells[y * level.w + x];
        if (base !== SURFACE_CELL.GRASS && base !== SURFACE_CELL.DIRT && base !== SURFACE_CELL.SAND) continue;

        // Region: >0 zuckerreich, <0 proteinreich, dazwischen samenreich
        const reg = fbm(x * FOOD.REGION_FREQ, y * FOOD.REGION_FREQ, seedRegion, 3);
        const sugarAff = Math.max(0, reg) * 2.0 + 0.35;
        const proteinAff = Math.max(0, -reg) * 2.0 + 0.35;
        const seedAff = 1.2 - Math.abs(reg) * 1.4;

        const h = hash2(x, y, seedScatter);
        let acc = 0;
        acc += d.flower * sugarAff;
        if (h < acc && base === SURFACE_CELL.GRASS) { this.place(level, x, y, SURFACE_CELL.FLOWER, rng.range(20, 60)); continue; }
        acc += d.aphids * sugarAff;
        if (h < acc && base === SURFACE_CELL.GRASS) { this.place(level, x, y, SURFACE_CELL.APHIDS, rng.range(60, 180)); continue; }
        acc += d.fruit * sugarAff;
        if (h < acc) { this.place(level, x, y, SURFACE_CELL.FRUIT, rng.range(40, 140)); continue; }
        acc += d.seeds * Math.max(0.15, seedAff);
        if (h < acc) { this.place(level, x, y, SURFACE_CELL.SEEDS, rng.range(30, 120)); continue; }
        acc += d.carrion * proteinAff;
        if (h < acc) { this.place(level, x, y, SURFACE_CELL.CARRION, rng.range(40, 160)); continue; }
        // Mutagene sind selten und brauchen feuchte bzw. schattige Stellen
        acc += 0.00025 * Math.max(0, reg);
        if (h < acc) { level.set(x, y, SURFACE_CELL.FUNGUS); level.setMeta(x, y, 0); continue; }
        acc += 0.00020 * Math.max(0, -reg);
        if (h < acc) { level.set(x, y, SURFACE_CELL.BERRY); level.setMeta(x, y, 0); continue; }
      }
    }
    return this;
  }

  /** Summe aller Bestaende (Kennzahl). */
  totalOn(level) {
    const r = this.reg.get(level.id);
    if (!r) return 0;
    let s = 0;
    for (let k = 0; k < r.count; k++) s += level.meta[r.list[k]];
    return s;
  }
}

export { NUTRIENT, SURFACE_CELL_DEFS };
