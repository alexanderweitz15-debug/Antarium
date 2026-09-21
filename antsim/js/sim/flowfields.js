/**
 * flowfields.js – Distanzfelder fuer die Navigation in Nest-Ebenen.
 *
 * Pheromone taugen im Nest schlecht: die Gaenge sind eng, die Wege lang und
 * die Ziele fest (Eingang, Baustelle, Kammern). Stattdessen wird pro Ziel ein
 * Distanzfeld per Breitensuche ueber die LUFTZELLEN berechnet. Eine Ameise
 * schaut nur auf ihre vier bzw. acht Nachbarzellen und laeuft auf die mit dem
 * kleinsten Wert – das ist O(1) pro Ameise und Tick und kommt ohne
 * Wegsuche pro Einheit aus.
 *
 * Neu berechnet wird ein Feld nur, wenn sich die Luftzellen der Ebene
 * geaendert haben (level.airVersion) oder das Ziel gewechselt hat. Pro Tick
 * wird hoechstens DIG.FIELD_BUDGET_PER_TICK Felder aktualisiert, damit die
 * Last verteilt bleibt.
 */



import { NEST_CELL, CHAMBER } from './nest.js';

export const UNREACHABLE = 0xffff;

export class FlowField {
  /** @param {import('./levels.js').Level} level */
  constructor(level) {
    this.w = level.w;
    this.h = level.h;
    this.dist = new Uint16Array(level.w * level.h).fill(UNREACHABLE);
    this.queue = new Int32Array(level.w * level.h);
    /** Stand der Luftzellen, fuer den das Feld gilt. */
    this.airVersion = -1;
    /** Kennung des Ziels, fuer das das Feld gilt. */
    this.goalKey = '';
    this.valid = false;
    this.lastMs = 0;
  }

  /**
   * Breitensuche von den Zielzellen aus ueber alle begehbaren Zellen.
   * @param {import('./levels.js').Level} level
   * @param {number[]} goals Zellindizes (muessen begehbar sein)
   */
  compute(level, goals) {
    const t0 = now();
    const dist = this.dist;
    const queue = this.queue;
    const w = this.w;
    dist.fill(UNREACHABLE);
    let head = 0, tail = 0;

    for (let i = 0; i < goals.length; i++) {
      const g = goals[i];
      if (g < 0 || g >= dist.length) continue;
      if (level.solidTable[level.cells[g]]) continue;
      if (dist[g] === 0) continue;
      dist[g] = 0;
      queue[tail++] = g;
    }

    const cells = level.cells;
    const solid = level.solidTable;
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i] + 1;
      if (d >= UNREACHABLE) continue;
      const x = i % w;
      // vier Nachbarn; Diagonalen werden erst beim Laufen zugelassen
      if (x > 0) { const n = i - 1; if (dist[n] > d && !solid[cells[n]]) { dist[n] = d; queue[tail++] = n; } }
      if (x < w - 1) { const n = i + 1; if (dist[n] > d && !solid[cells[n]]) { dist[n] = d; queue[tail++] = n; } }
      const up = i - w;
      if (up >= 0) { if (dist[up] > d && !solid[cells[up]]) { dist[up] = d; queue[tail++] = up; } }
      const dn = i + w;
      if (dn < dist.length) { if (dist[dn] > d && !solid[cells[dn]]) { dist[dn] = d; queue[tail++] = dn; } }
    }
    this.valid = tail > 0;
    this.lastMs = now() - t0;
    return this.valid;
  }

  at(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return UNREACHABLE;
    return this.dist[y * this.w + x];
  }

  /**
   * Richtung zum Ziel: liefert die Nachbarzelle mit dem kleinsten Abstand.
   * Diagonalen nur, wenn beide angrenzenden Achsen frei sind (sonst laufen
   * Ameisen durch Wandecken).
   * @returns {{x:number,y:number}|null} Zielzelle oder null
   */
  next(level, x, y, out) {
    const here = this.at(x, y);
    if (here === UNREACHABLE) return null;
    if (here === 0) return null;
    let bestD = here, bx = -1, by = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        const d = this.at(nx, ny);
        if (d >= bestD) continue;
        if (dx !== 0 && dy !== 0) {
          if (level.isSolid(x + dx, y) || level.isSolid(x, y + dy)) continue;
        }
        bestD = d; bx = nx; by = ny;
      }
    }
    if (bx < 0) return null;
    const o = out || { x: 0, y: 0 };
    o.x = bx; o.y = by;
    return o;
  }
}

/**
 * Haelt alle Distanzfelder einer Nest-Ebene und aktualisiert sie verteilt.
 *
 *   entrance – zu den Portalen dieser Ebene   (Ausrueckweg, Heimweg)
 *   dig      – zur aktiven Baustelle           (Graben)
 *   store    – zu den Vorratskammern           (Nahrung abliefern)
 *   brood    – zu den Brutkammern              (Brutpflege)
 *
 * Felder werden nur neu gerechnet, wenn sich die Luftzellen geaendert haben
 * (level.airVersion) oder das Ziel gewechselt hat. Das Budget teilen sich
 * ALLE Ebenen, damit acht grabende Kolonien nicht acht Breitensuchen pro
 * Tick ausloesen.
 */
export class FieldSet {
  constructor(level) {
    this.level = level;
    this.entrance = new FlowField(level);
    this.dig = new FlowField(level);
    this.store = new FlowField(level);
    this.brood = new FlowField(level);
    this._goals = [];
  }

  markAllDirty() {
    this.entrance.valid = false; this.entrance.airVersion = -1;
    this.dig.valid = false; this.dig.airVersion = -1;
    this.store.valid = false; this.store.airVersion = -1;
    this.brood.valid = false; this.brood.airVersion = -1;
  }

  markEntranceDirty() { this.entrance.valid = false; this.entrance.airVersion = -1; }
  markDigDirty() { this.dig.valid = false; this.dig.airVersion = -1; }

  /**
   * Alle Felder auf Stand bringen.
   * @param {object} colony
   * @param {import('./portals.js').PortalSystem} portals
   * @param {{left:number}} budget gemeinsames Restbudget des Ticks
   */
  update(colony, portals, budget) {
    const level = this.level;
    const av = level.airVersion;

    if (budget.left > 0 && (this.entrance.airVersion !== av || !this.entrance.valid)) {
      const g = this._goals;
      g.length = 0;
      for (const p of portals.ofColony(colony.id)) {
        const pos = p.on(level.id);
        if (pos) g.push(pos.y * level.w + pos.x);
      }
      this.entrance.compute(level, g);
      this.entrance.airVersion = av;
      budget.left--;
    }

    const digKey = colony.digKey || '';
    if (budget.left > 0 && (this.dig.airVersion !== av || this.dig.goalKey !== digKey || !this.dig.valid)) {
      this.dig.compute(level, colony.digGoals || []);
      this.dig.airVersion = av;
      this.dig.goalKey = digKey;
      budget.left--;
    }

    if (budget.left > 0 && (this.store.airVersion !== av || !this.store.valid)) {
      this.store.compute(level, chamberGoals(level, CHAMBER.STORE, this._goals));
      this.store.airVersion = av;
      budget.left--;
    }

    if (budget.left > 0 && (this.brood.airVersion !== av || !this.brood.valid)) {
      this.brood.compute(level, chamberGoals(level, CHAMBER.BROOD, this._goals));
      this.brood.airVersion = av;
      budget.left--;
    }
  }
}

/**
 * Zellindizes aller Kammern eines Typs. Gibt es davon keine, wird auf die
 * Koeniginnenkammer und notfalls auf alle Kammern ausgewichen – eine junge
 * Kolonie hat noch keine Vorrats- oder Brutkammer.
 */
function chamberGoals(level, type, out) {
  out.length = 0;
  const cells = level.cells, meta = level.meta;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER && meta[i] === type) out.push(i);
  }
  if (out.length) return out;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER && meta[i] === CHAMBER.QUEEN) out.push(i);
  }
  if (out.length) return out;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER) out.push(i);
  }
  return out;
}

const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Number(process.hrtime.bigint() / 1000n) / 1000;
