/**
 * construction.js – Nestbau: Grabauftraege planen und abarbeiten.
 *
 * Vorgezogen aus Phase 3, damit man Ameisen beim Tunnelbau zusehen kann.
 * Absichtlich einfach gehalten:
 *
 *   1. Die Kolonie fuehrt eine Warteschlange aus Grabauftraegen (Zellindizes).
 *   2. Immer nur der ERSTE offene Auftrag ist die aktive Baustelle. Alle
 *      grabenden Ameisen laufen dorthin (ein Distanzfeld reicht) – das sieht
 *      aus wie ein Trupp an der Tunnelbrust und ist genau das, was echte
 *      Ameisen tun.
 *   3. Jede Ameise in Reichweite steuert Grabpunkte bei. Sind genug Punkte
 *      zusammen, wird die Zelle zu Tunnel bzw. Kammerboden, und die Ameise,
 *      die den letzten Punkt beigesteuert hat, nimmt den Aushub mit.
 *   4. Der Aushub wandert durch das Portal an die Oberflaeche und landet dort
 *      als Erdhuegel (siehe ants.js, _arrive).
 *
 * Geplant wird alle DIG.PLAN_INTERVAL Ticks und nur, wenn die Kolonie Platz
 * braucht (Population gegen begehbare Zellen).
 */

import { DIG, WORLD } from '../config.js';
import { NEST_CELL, NEST_CELL_DEFS, CHAMBER } from './nest.js';
import { bus, CAT } from './events.js';

/** Grabaufwand je Zelltyp (Index = Zelltyp-ID, 0 = nicht grabbar). */
const COST = new Float32Array(NEST_CELL_DEFS.length);
for (const d of NEST_CELL_DEFS) {
  COST[d.id] = DIG.COST[d.key] !== undefined ? DIG.COST[d.key] : 0;
}

/** Ist diese Zelle grabbar? (Stein und Luft sind es nicht.) */
export function diggable(level, x, y) {
  if (!level.inBounds(x, y)) return false;
  if (y <= WORLD.NEST_SURFACE_ROW) return false;
  if (y >= level.h - DIG.BOTTOM_MARGIN) return false;
  return COST[level.cells[y * level.w + x]] > 0;
}

export class Construction {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
  }

  /** Zustandsfelder an einer Kolonie anlegen. */
  init(colony) {
    colony.digQueue = [];      // Zellindizes
    colony.digMeta = [];       // Kammertyp je Auftrag (0 = Gang)
    colony.digProgress = 0;    // Punkte auf der aktiven Baustelle
    colony.digActive = -1;     // Zellindex der aktiven Baustelle
    colony.digGoals = [];      // Luftnachbarn der Baustelle (Ziel des Feldes)
    colony.digKey = '';        // Kennung fuer den Feld-Cache
    colony.diggers = 0;        // Ameisen, die gerade graben
    colony.dugTotal = 0;       // Statistik
  }

  /**
   * Auftrag von Hand hinzufuegen (Werkzeug "Bauauftrag").
   * @returns {boolean} true, wenn der Auftrag neu war
   */
  addOrder(colony, level, x, y, chamberType = CHAMBER.NONE) {
    if (!diggable(level, x, y)) return false;
    const idx = y * level.w + x;
    if (colony.digQueue.includes(idx)) return false;
    if (colony.digQueue.length >= DIG.MAX_QUEUE) return false;
    // Von Hand gesetzte Auftraege kommen nach vorn.
    colony.digQueue.unshift(idx);
    colony.digMeta.unshift(chamberType);
    colony.digActive = -1;
    return true;
  }

  /**
   * Sorgt dafuer, dass eine von Hand markierte Stelle ueberhaupt erreichbar
   * ist: liegt sie mitten im Erdreich, wird zuerst ein Zugang von der
   * naechsten Luftzelle dorthin in die Warteschlange gestellt (L-foermig,
   * damit Felsen umgangen werden koennen).
   * @returns {number} Anzahl eingefuegter Zugangszellen
   */
  ensureReachable(colony, level, cx, cy) {
    if (!diggable(level, cx, cy)) return 0;
    if (airNeighbours(level, cy * level.w + cx).length > 0) return 0;

    // Naechstgelegene Luftzelle suchen
    let bx = -1, by = -1, bestD = Infinity;
    const cells = level.cells, solid = level.solidTable, w = level.w;
    for (let y = WORLD.NEST_SURFACE_ROW; y < level.h; y++) {
      for (let x = 0; x < w; x++) {
        if (solid[cells[y * w + x]]) continue;
        const dx = x - cx, dy = y - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bx = x; by = y; }
      }
    }
    if (bx < 0) return 0;

    // Zwei L-Varianten probieren; die erste ohne Fels gewinnt.
    const a = lPath(level, bx, by, cx, cy, true);
    const b = lPath(level, bx, by, cx, cy, false);
    const path = a || b;
    if (!path) {
      bus.logEvent(CAT.BAU, colony.name + ': kein Weg zur markierten Stelle (Fels)', {
        tick: this.world.tick, levelId: level.id, x: cx, y: cy, colonyId: colony.id,
      });
      return 0;
    }
    let added = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      const idx = path[i];
      if (colony.digQueue.includes(idx)) continue;
      colony.digQueue.unshift(idx);
      colony.digMeta.unshift(CHAMBER.NONE);
      added++;
    }
    if (added) colony.digActive = -1;
    return added;
  }

  /** Pro Tick: Baustelle bestimmen und bei Bedarf neue Projekte planen. */
  update(colony, level, rng, tick) {
    if (colony.digQueue === undefined) this.init(colony);

    // Erledigte oder unmoegliche Auftraege vorne abraeumen
    while (colony.digQueue.length > 0) {
      const idx = colony.digQueue[0];
      const x = idx % level.w, y = (idx / level.w) | 0;
      if (diggable(level, x, y)) break;
      colony.digQueue.shift();
      colony.digMeta.shift();
      colony.digProgress = 0;
      colony.digActive = -1;
    }

    const head = colony.digQueue.length ? colony.digQueue[0] : -1;
    if (head !== colony.digActive) {
      colony.digActive = head;
      colony.digProgress = 0;
      colony.digGoals = head >= 0 ? airNeighbours(level, head) : [];
      colony.digKey = 'd' + head;
      // Baustelle ohne Zugang: nach hinten schieben statt blockieren.
      if (head >= 0 && colony.digGoals.length === 0) {
        colony.digQueue.push(colony.digQueue.shift());
        colony.digMeta.push(colony.digMeta.shift());
        colony.digActive = -1;
      }
    }

    // Planung der Kolonien versetzen, sonst scannen alle im selben Tick.
    if ((tick + colony.id * 7) % DIG.PLAN_INTERVAL !== 0) return;
    if (colony.digQueue.length >= DIG.MIN_QUEUE) return;
    if (!this.needsSpace(colony, level)) return;
    this.planProject(colony, level, rng);
  }

  /**
   * Braucht die Kolonie mehr Platz? Massstab ist die GESAMTE Population –
   * Sammlerinnen sind nur voruebergehend draussen und brauchen trotzdem
   * einen Platz im Nest.
   */
  needsSpace(colony, level) {
    // Eine hungernde Kolonie baut nicht aus.
    if (colony.starving) return false;
    const want = Math.max(DIG.MIN_NEST_CELLS, colony.total * DIG.CELLS_PER_ANT);
    return level.airCount < want;
  }

  /**
   * Neues Grabprojekt planen: Schacht, Seitengang oder Kammer, ausgehend von
   * einer vorhandenen Luftzelle mit Erdkontakt.
   */
  planProject(colony, level, rng) {
    const start = this.findGrowthPoint(level, rng);
    if (!start) return false;

    const cells = [];
    let meta = CHAMBER.NONE;
    const roll = rng.float();

    if (roll < DIG.CHAMBER_CHANCE) {
      // Kammer: Typ nach dem, was der Kolonie fehlt.
      meta = this.pickChamberType(colony, level, rng);
      const rx = rng.intRange(DIG.CHAMBER_RX[0], DIG.CHAMBER_RX[1]);
      const ry = rng.intRange(DIG.CHAMBER_RY[0], DIG.CHAMBER_RY[1]);
      const cx = start.x + (rng.chance(0.5) ? -1 : 1) * rng.intRange(0, 2);
      const cy = start.y + ry + 1;
      for (let y = cy - ry; y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const nx = (x - cx) / rx, ny = (y - cy) / ry;
          if (nx * nx + ny * ny > 1) continue;
          if (diggable(level, x, y)) cells.push(y * level.w + x);
        }
      }
      // Zugang von der Startzelle zur Kammer
      for (let y = start.y; y <= cy - ry; y++) if (diggable(level, start.x, y)) cells.unshift(y * level.w + start.x);
    } else if (roll < DIG.CHAMBER_CHANCE + 0.32) {
      // Schacht nach unten
      const len = rng.intRange(DIG.SHAFT_LEN[0], DIG.SHAFT_LEN[1]);
      for (let k = 1; k <= len; k++) {
        const y = start.y + k;
        if (!diggable(level, start.x, y)) break;
        cells.push(y * level.w + start.x);
      }
    } else {
      // Waagerechter Gang, leicht abfallend
      const dir = rng.chance(0.5) ? -1 : 1;
      const len = rng.intRange(DIG.TUNNEL_LEN[0], DIG.TUNNEL_LEN[1]);
      let y = start.y;
      for (let k = 1; k <= len; k++) {
        const x = start.x + dir * k;
        if (rng.chance(0.18)) y++;
        if (!diggable(level, x, y)) break;
        cells.push(y * level.w + x);
      }
    }

    if (cells.length === 0) return false;
    for (let i = 0; i < cells.length; i++) {
      if (colony.digQueue.length >= DIG.MAX_QUEUE) break;
      colony.digQueue.push(cells[i]);
      colony.digMeta.push(meta);
    }
    if (meta !== CHAMBER.NONE) {
      bus.logEvent(CAT.BAU, colony.name + ' beginnt eine neue Kammer', {
        tick: this.world.tick, levelId: level.id,
        x: cells[cells.length - 1] % level.w, y: (cells[cells.length - 1] / level.w) | 0,
        colonyId: colony.id,
      });
    }
    return true;
  }

  /** Welcher Kammertyp fehlt? Reihenfolge nach Dringlichkeit. */
  pickChamberType(colony, level, rng) {
    const have = countChambers(level);
    if (!have[CHAMBER.BROOD]) return CHAMBER.BROOD;
    if (!have[CHAMBER.STORE]) return CHAMBER.STORE;
    if (!have[CHAMBER.GUARD]) return CHAMBER.GUARD;
    if (!have[CHAMBER.ESCAPE]) return CHAMBER.ESCAPE;
    if (!have[CHAMBER.GRAVE]) return CHAMBER.GRAVE;
    if (!have[CHAMBER.INFIRMARY]) return CHAMBER.INFIRMARY;
    return rng.pick([CHAMBER.BROOD, CHAMBER.STORE, CHAMBER.BROOD]);
  }

  /**
   * Luftzelle mit Erdkontakt suchen, moeglichst tief (dort waechst das Nest).
   * Ein voller Scan ueber 30k Zellen kostet Bruchteile einer Millisekunde und
   * laeuft nur alle DIG.PLAN_INTERVAL Ticks.
   */
  findGrowthPoint(level, rng) {
    const w = level.w, h = level.h;
    let best = null, bestScore = -1;
    const cells = level.cells;
    const solid = level.solidTable;
    for (let y = WORLD.NEST_SURFACE_ROW + 2; y < h - DIG.BOTTOM_MARGIN; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (solid[cells[i]]) continue;
        // Erdkontakt?
        if (!diggable(level, x, y + 1) && !diggable(level, x - 1, y)
            && !diggable(level, x + 1, y) && !diggable(level, x, y - 1)) continue;
        // Tiefe bevorzugen, Zufall dazu, damit nicht immer derselbe Punkt gewinnt
        const score = y * 0.6 + rng.float() * 40;
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    return best;
  }

  /**
   * Grabpunkte auf die aktive Baustelle buchen.
   * @returns {number} Zellindex, wenn die Zelle fertig gegraben wurde, sonst -1
   */
  contribute(colony, level, amount) {
    const idx = colony.digActive;
    if (idx < 0) return -1;
    const t = level.cells[idx];
    const cost = COST[t];
    if (cost <= 0) { colony.digActive = -1; return -1; }
    colony.digProgress += amount;
    if (colony.digProgress < cost) return -1;

    // Fertig: Zelle oeffnen
    const x = idx % level.w, y = (idx / level.w) | 0;
    const meta = colony.digMeta[0] !== undefined ? colony.digMeta[0] : CHAMBER.NONE;
    level.set(x, y, meta === CHAMBER.NONE ? NEST_CELL.TUNNEL : NEST_CELL.CHAMBER);
    level.setMeta(x, y, meta);
    colony.digQueue.shift();
    colony.digMeta.shift();
    colony.digProgress = 0;
    colony.digActive = -1;
    colony.dugTotal++;
    return idx;
  }
}

/**
 * L-foermiger Weg von (x0,y0) nach (x1,y1). horizontalFirst entscheidet die
 * Reihenfolge der Schenkel. Liefert null, wenn eine nicht grabbare Zelle
 * (Fels) im Weg liegt, sonst die grabbaren Zellen in Laufrichtung.
 */
function lPath(level, x0, y0, x1, y1, horizontalFirst) {
  const out = [];
  const w = level.w;
  const step = (x, y) => {
    if (!level.inBounds(x, y)) return false;
    if (!level.isSolid(x, y)) return true;           // Luft: nichts zu tun
    if (!diggable(level, x, y)) return false;        // Fels: Weg blockiert
    out.push(y * w + x);
    return true;
  };
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  if (horizontalFirst) {
    for (let x = x0; x !== x1 + sx && sx !== 0; x += sx) if (!step(x, y0)) return null;
    for (let y = y0; y !== y1 + sy && sy !== 0; y += sy) if (!step(x1, y)) return null;
  } else {
    for (let y = y0; y !== y1 + sy && sy !== 0; y += sy) if (!step(x0, y)) return null;
    for (let x = x0; x !== x1 + sx && sx !== 0; x += sx) if (!step(x, y1)) return null;
  }
  if (!step(x1, y1)) return null;
  return out;
}

/** Begehbare Nachbarn einer Zelle (Ziele des Grab-Distanzfeldes). */
function airNeighbours(level, idx) {
  const w = level.w;
  const x = idx % w, y = (idx / w) | 0;
  const out = [];
  const push = (nx, ny) => {
    if (!level.inBounds(nx, ny)) return;
    if (!level.isSolid(nx, ny)) out.push(ny * w + nx);
  };
  push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  push(x - 1, y - 1); push(x + 1, y - 1); push(x - 1, y + 1); push(x + 1, y + 1);
  return out;
}

/** Wie viele Zellen je Kammertyp existieren bereits? */
function countChambers(level) {
  const have = new Uint16Array(16);
  const cells = level.cells, meta = level.meta;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER) have[meta[i] & 15]++;
  }
  return have;
}
