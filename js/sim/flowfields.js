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
    this.escape = new FlowField(level);
    this._goals = [];
  }

  markAllDirty() {
    this.entrance.valid = false; this.entrance.airVersion = -1;
    this.dig.valid = false; this.dig.airVersion = -1;
    this.store.valid = false; this.store.airVersion = -1;
    this.brood.valid = false; this.brood.airVersion = -1;
    this.escape.valid = false; this.escape.airVersion = -1;
  }

  markEntranceDirty() { this.entrance.valid = false; this.entrance.airVersion = -1; }
  markDigDirty() { this.dig.valid = false; this.dig.airVersion = -1; }

  /**
   * Das Grabfeld fuer den Speicherstand.
   *
   * Nur DIESES Feld wird gespeichert. Die vier anderen haengen allein an
   * level.airVersion und werden vom Budget immer eingeholt, bevor eine
   * Ameise sie liest – gemessen ueber sechs Feldsaetze: null veraltete
   * Eingangs-, Vorrats-, Brut- und Fluchtfelder. Das Grabfeld dagegen
   * wechselt sein ZIEL mit jeder fertigen Zelle und hinkt dem Budget
   * regelmaessig hinterher (drei von sechs mit veralteter Gitterfassung,
   * zwei mit veraltetem Ziel). Wird es beim Laden einfach neu gerechnet,
   * ist es FRISCHER als im laufenden Spiel – und der geladene Stand lief
   * ab dem ersten Tick auseinander.
   *
   * Gespeichert wird duenn besetzt: nur erreichbare Zellen. Eine
   * Nest-Ebene ist fast ganz Fels, es sind ein paar hundert Werte.
   */
  digToJSON(encode) {
    const d = this.dig;
    const n = d.dist.length;
    let count = 0;
    for (let i = 0; i < n; i++) if (d.dist[i] !== UNREACHABLE) count++;
    const idx = new Int32Array(count);
    const val = new Uint16Array(count);
    let k = 0;
    for (let i = 0; i < n; i++) {
      if (d.dist[i] === UNREACHABLE) continue;
      idx[k] = i; val[k] = d.dist[i]; k++;
    }
    return {
      airVersion: d.airVersion, goalKey: d.goalKey, valid: !!d.valid,
      count, idx: encode(idx, count), val: encode(val, count),
    };
  }

  /** Gegenstueck zu digToJSON. */
  digFromJSON(data, decodeInto) {
    if (!data) return;
    const d = this.dig;
    d.dist.fill(UNREACHABLE);
    if (data.count > 0) {
      const idx = new Int32Array(data.count);
      const val = new Uint16Array(data.count);
      decodeInto(data.idx, idx, data.count);
      decodeInto(data.val, val, data.count);
      for (let k = 0; k < data.count; k++) d.dist[idx[k]] = val[k];
    }
    d.airVersion = data.airVersion;
    d.goalKey = data.goalKey;
    d.valid = !!data.valid;
  }

  /**
   * Alle Felder auf Stand bringen.
   * @param {object} colony
   * @param {import('./portals.js').PortalSystem} portals
   * @param {{left:number}} budget gemeinsames Restbudget des Ticks
   * @param {object} [dig] Grabzustand DIESER Ebene (construction.stateFor)
   */
  update(colony, portals, budget, dig) {
    const level = this.level;
    const av = level.airVersion;

    if (budget.left > 0 && (this.entrance.airVersion !== av || !this.entrance.valid)) {
      const g = this._goals;
      g.length = 0;
      for (const p of portals.ofColony(colony.id)) {
        // Nur Portale, die von HIER nach oben fuehren. Der eigene
        // Abstiegsschacht ist kein Ausgang, sonst laufen Sammlerinnen
        // einer mittleren Ebene nach unten statt ans Tageslicht.
        if (p.upLevelId === level.id) continue;
        const pos = p.on(level.id);
        if (pos) g.push(pos.y * level.w + pos.x);
      }
      this.entrance.compute(level, g);
      this.entrance.airVersion = av;
      budget.left--;
    }

    const digKey = dig ? dig.key : '';
    if (budget.left > 0 && (this.dig.airVersion !== av || this.dig.goalKey !== digKey || !this.dig.valid)) {
      this.dig.compute(level, dig ? dig.goals : []);
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

    if (budget.left > 0 && (this.escape.airVersion !== av || !this.escape.valid)) {
      this.escape.compute(level, escapeGoals(level, this._goals));
      this.escape.airVersion = av;
      budget.left--;
    }
  }
}

/**
 * Ziel der Evakuierung: die Fluchtkammer, sonst die tiefste Kammer der
 * Ebene – dorthin bringen Ammen die Brut und die Koenigin zieht sich zurueck.
 */
function escapeGoals(level, out) {
  out.length = 0;
  const cells = level.cells, meta = level.meta;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER && meta[i] === CHAMBER.ESCAPE) out.push(i);
  }
  if (out.length) return out;
  // Keine Fluchtkammer: tiefste vorhandene Kammer nehmen
  let deepest = -1;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER) deepest = i;
  }
  if (deepest >= 0) {
    const dy = (deepest / level.w) | 0;
    for (let x = 0; x < level.w; x++) {
      const i = dy * level.w + x;
      if (cells[i] === NEST_CELL.CHAMBER) out.push(i);
    }
  }
  return out;
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
