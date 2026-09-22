/**
 * pheromones.js – Pheromonfelder der Oberflaeche.
 *
 * Je Kolonie gibt es drei Felder (Heimweg, Nahrung, Alarm) als Uint8Array
 * ueber dem Oberflaechen-Grid. Dazu kommt ein Feld, das fuer jede Zelle den
 * dominanten Naehrstoff der dortigen Nahrungsspur merkt – dadurch koennen
 * Ameisen Spuren nach dem aktuellen Bedarf der Kolonie gewichten.
 *
 * VERDUNSTUNG: Ein vollstaendiger Durchlauf ueber 160 000 Zellen je Feld und
 * Kolonie waere zu teuer. Stattdessen fuehrt jedes Feld eine Liste der
 * Zellen mit Wert > 0. Die Liste wird beim Verdunstungsdurchlauf verdichtet;
 * Zellen, die auf 0 fallen, verschwinden daraus. Eine Zelle kommt genau dann
 * in die Liste, wenn sie von 0 auf > 0 steigt – Doppeleintraege sind dadurch
 * ausgeschlossen, ganz ohne zusaetzliche Merkerarrays.
 *
 * DIFFUSION wird bewusst nicht als eigener Durchlauf gerechnet: die Ablage
 * verteilt sich ueber einen kleinen Kern auf die Nachbarzellen, was optisch
 * und im Verhalten denselben Zweck erfuellt und ein Vielfaches billiger ist.
 */

import { PHERO } from '../config.js';

export const PH = PHERO.TYPES;

class Field {
  constructor(size) {
    this.grid = new Uint8Array(size);
    this.active = new Int32Array(PHERO.MAX_ACTIVE);
    this.count = 0;
  }
}

export class PheromoneSystem {
  /** @param {import('./levels.js').Level} level Oberflaechen-Ebene */
  constructor(level) {
    this.w = level.w;
    this.h = level.h;
    this.size = level.w * level.h;
    /** @type {Map<number, {fields:Field[], nutrient:Uint8Array}>} */
    this.byColony = new Map();
    this.stats = { active: 0 };
  }

  addColony(colonyId) {
    if (this.byColony.has(colonyId)) return;
    const fields = [];
    for (let t = 0; t < PHERO.COUNT; t++) fields.push(new Field(this.size));
    this.byColony.set(colonyId, { fields, nutrient: new Uint8Array(this.size) });
  }

  removeColony(colonyId) { this.byColony.delete(colonyId); }

  /** Rohwert einer Zelle. */
  at(colonyId, type, x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    const c = this.byColony.get(colonyId);
    if (!c) return 0;
    return c.fields[type].grid[y * this.w + x];
  }

  /** Dominanter Naehrstoff der Nahrungsspur einer Zelle (0..2, 255 = keiner). */
  nutrientAt(colonyId, x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 255;
    const c = this.byColony.get(colonyId);
    if (!c) return 255;
    return c.nutrient[y * this.w + x];
  }

  /**
   * Pheromon ablegen. Der Hauptanteil landet auf der Zelle, ein kleinerer
   * auf den vier Nachbarn – das ersetzt eine eigene Diffusionsrechnung.
   * @param {number} nutrient dominanter Naehrstoff (nur fuer FOOD), sonst -1
   */
  deposit(colonyId, type, x, y, amount, nutrient = -1) {
    const c = this.byColony.get(colonyId);
    if (!c) return;
    if (x < 1 || y < 1 || x >= this.w - 1 || y >= this.h - 1) return;
    const f = c.fields[type];
    const i = y * this.w + x;
    this._add(f, i, amount);
    const side = amount * 0.28;
    this._add(f, i - 1, side);
    this._add(f, i + 1, side);
    this._add(f, i - this.w, side);
    this._add(f, i + this.w, side);
    if (nutrient >= 0) c.nutrient[i] = nutrient;
  }

  _add(f, i, amount) {
    const v = f.grid[i];
    if (v === 0) {
      if (f.count >= f.active.length) return;   // Liste voll: nicht mitfuehren
      f.active[f.count++] = i;
    }
    let nv = v + amount;
    if (nv > PHERO.MAX) nv = PHERO.MAX;
    f.grid[i] = nv;
  }

  /**
   * Spur abtasten: liefert den Wert in Blickrichtung, gewichtet mit dem
   * Bedarf der Kolonie an dem Naehrstoff, den die Spur meldet.
   * @param {Float32Array|null} needWeight Gewicht je Naehrstoff (oder null)
   */
  sense(colonyId, type, x, y, needWeight) {
    const c = this.byColony.get(colonyId);
    if (!c) return 0;
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return 0;
    const i = yi * this.w + xi;
    let v = c.fields[type].grid[i];
    if (v > 0 && needWeight && type === PH.FOOD) {
      const n = c.nutrient[i];
      if (n < 3) v *= needWeight[n];
    }
    return v;
  }

  /** Verdunstung (alle PHERO.DECAY_INTERVAL Ticks). */
  update(tick) {
    if (tick % PHERO.DECAY_INTERVAL !== 0) return;
    const decay = [PHERO.DECAY.HOME, PHERO.DECAY.FOOD, PHERO.DECAY.ALARM];
    let active = 0;
    for (const c of this.byColony.values()) {
      for (let t = 0; t < PHERO.COUNT; t++) {
        const f = c.fields[t];
        const d = decay[t];
        const grid = f.grid, list = f.active;
        let write = 0;
        for (let k = 0; k < f.count; k++) {
          const i = list[k];
          const nv = (grid[i] * d) | 0;
          if (nv <= 0) { grid[i] = 0; continue; }
          grid[i] = nv;
          list[write++] = i;
        }
        f.count = write;
        active += write;
      }
    }
    this.stats.active = active;
  }

  /** Alle Felder einer Kolonie loeschen (Werkzeug "Pheromon-Radierer"). */
  clearColony(colonyId) {
    const c = this.byColony.get(colonyId);
    if (!c) return;
    for (const f of c.fields) { f.grid.fill(0); f.count = 0; }
    c.nutrient.fill(0);
  }

  /** Pheromon in einem Umkreis loeschen. */
  erase(colonyId, cx, cy, r) {
    const c = this.byColony.get(colonyId);
    if (!c) return;
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r) continue;
        const i = y * this.w + x;
        for (const f of c.fields) f.grid[i] = 0;
      }
    }
  }
}
