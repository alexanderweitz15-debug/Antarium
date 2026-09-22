/**
 * digscent.js – Grabduft: der Spieler malt, wo gegraben werden soll.
 *
 * WARUM EIN EIGENES FELD UND NICHT DAS PHEROMONSYSTEM
 *
 * Die Pheromone in pheromones.js liegen nur auf der Oberflaeche und
 * gehoeren den Ameisen: sie legen sie ab, sie folgen ihnen. Der Grabduft
 * ist etwas anderes – ein Befehl des Spielers an eine Nest-Ebene. Er wird
 * nie von einer Ameise abgelegt, er gilt je Ebene statt je Volk, und er
 * braucht weder Sensorkegel noch Spurverfolgung. Ihn in das bestehende
 * System zu pressen haette beiden geschadet.
 *
 * Was er tut: eine bemalte Zelle wird zur Baustelle. Je staerker der Duft,
 * desto mehr Graeberinnen gehen hin. Er verdunstet – ein Befehl, den man
 * nicht erneuert, verfaellt. Das ist die ganze Mechanik.
 *
 * Gespeichert wird duenn besetzt: eine Nest-Ebene ist fast ganz Fels, und
 * bemalt ist immer nur ein schmaler Streifen davon.
 */

import { DIGSCENT } from '../config.js';

export class DigScent {
  constructor() {
    /** @type {Map<number, {grid:Uint8Array, active:Int32Array, count:number, sum:number}>} */
    this.byLevel = new Map();
  }

  /** Puffer fuer eine Ebene anlegen (nur Nest-Ebenen brauchen ihn). */
  registerLevel(level) {
    if (this.byLevel.has(level.id)) return;
    this.byLevel.set(level.id, {
      grid: new Uint8Array(level.w * level.h),
      active: new Int32Array(DIGSCENT.MAX_ACTIVE),
      count: 0,
      sum: 0,
    });
  }

  forget(levelId) { this.byLevel.delete(levelId); }

  /** Duft auf eine Zelle geben. */
  deposit(level, x, y, amount) {
    const f = this.byLevel.get(level.id);
    if (!f || !level.inBounds(x, y)) return false;
    const i = y * level.w + x;
    const before = f.grid[i];
    const v = Math.min(DIGSCENT.MAX, before + amount);
    if (v === before) return false;
    f.sum += v - before;
    f.grid[i] = v;
    // Neue Zelle in die Liste der aktiven aufnehmen
    if (before === 0) {
      if (f.count >= DIGSCENT.MAX_ACTIVE) return true;
      f.active[f.count++] = i;
    }
    return true;
  }

  /** Duft einer Zelle (0, wenn nichts). */
  at(levelId, idx) {
    const f = this.byLevel.get(levelId);
    return f ? f.grid[idx] : 0;
  }

  /** Summe des Dufts einer Ebene – Massstab fuer die Zahl der Graeberinnen. */
  total(levelId) {
    const f = this.byLevel.get(levelId);
    return f ? f.sum : 0;
  }

  /** Eine bemalte Zelle loeschen (z. B. weil sie fertig gegraben ist). */
  clear(levelId, idx) {
    const f = this.byLevel.get(levelId);
    if (!f || f.grid[idx] === 0) return;
    f.sum -= f.grid[idx];
    f.grid[idx] = 0;
  }

  /**
   * Staerkste bemalte Zelle, die ein Praedikat erfuellt.
   * @param {number} levelId
   * @param {(idx:number)=>boolean} ok
   * @returns {number} Zellindex oder -1
   */
  best(levelId, ok) {
    const f = this.byLevel.get(levelId);
    if (!f || f.count === 0) return -1;
    let bi = -1, bv = 0;
    for (let k = 0; k < f.count; k++) {
      const i = f.active[k];
      const v = f.grid[i];
      if (v <= bv) continue;
      if (!ok(i)) continue;
      bv = v; bi = i;
    }
    return bi;
  }

  /**
   * Verdunstung. Laeuft nur alle DIGSCENT.DECAY_INTERVAL Ticks und nur
   * ueber die aktiven Zellen – ein voller Durchlauf ueber 30000 Zellen je
   * Ebene und Tick waere Verschwendung.
   */
  decay(tick) {
    if (tick % DIGSCENT.DECAY_INTERVAL !== 0) return;
    for (const f of this.byLevel.values()) {
      if (f.count === 0) continue;
      let w = 0;
      for (let k = 0; k < f.count; k++) {
        const i = f.active[k];
        const v = f.grid[i];
        if (v === 0) continue;                 // anderweitig geloescht
        const nv = (v * DIGSCENT.DECAY) | 0;
        f.sum -= v - nv;
        f.grid[i] = nv;
        if (nv > 0) f.active[w++] = i;
        else f.sum -= 0;
      }
      f.count = w;
    }
  }

  // --- Speicherstand ------------------------------------------------------

  toJSON(encode) {
    const out = [];
    for (const [levelId, f] of this.byLevel) {
      if (f.count === 0) continue;
      const idx = new Int32Array(f.count);
      const val = new Uint8Array(f.count);
      for (let k = 0; k < f.count; k++) { idx[k] = f.active[k]; val[k] = f.grid[f.active[k]]; }
      out.push({ levelId, count: f.count, idx: encode(idx, f.count), val: encode(val, f.count) });
    }
    return out;
  }

  fromJSON(data, decodeInto) {
    for (const f of this.byLevel.values()) { f.grid.fill(0); f.count = 0; f.sum = 0; }
    for (const e of data || []) {
      const f = this.byLevel.get(e.levelId);
      if (!f) continue;
      const idx = new Int32Array(e.count);
      const val = new Uint8Array(e.count);
      decodeInto(e.idx, idx, e.count);
      decodeInto(e.val, val, e.count);
      for (let k = 0; k < e.count; k++) {
        f.grid[idx[k]] = val[k];
        f.active[k] = idx[k];
        f.sum += val[k];
      }
      f.count = e.count;
    }
  }
}
