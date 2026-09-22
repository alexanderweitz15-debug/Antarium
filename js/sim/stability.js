/**
 * stability.js – Standfestigkeit der Nest-Ebenen.
 *
 * Modell: Eine solide Zelle mit Luft DARUNTER ist eine Deckenzelle. Laeuft
 * eine solche Decke waagerecht weiter, ohne dass irgendwo etwas darunter
 * steht, wird die Spannweite irgendwann zu gross und die Decke faellt.
 * Was traegt, ist jede solide Zelle in der Reihe darunter – also auch ein
 * Stuetzpfeiler. Verstaerkte Waende tragen viel weiter als lose Erde.
 *
 * Gerechnet wird NUR lokal und nur nach Ereignissen (Graben, Erdbeben,
 * Explosionen). Die Pruefungen laufen ueber eine Warteschlange, damit ein
 * Erdbeben nicht einen einzelnen Tick sprengt.
 *
 * Einsturz: die Deckenzelle wird zu Luft, die Luftzelle darunter zu
 * Truemmern. Wer darunter steht, nimmt Schaden und ist verschuettet – und
 * kann sich freigraben (siehe ants.js).
 */

import { STABILITY, WORLD } from '../config.js';
import { NEST_CELL, NEST_CELL_DEFS } from './nest.js';
import { bus, CAT } from './events.js';
import { FX } from './fx.js';

/** Tragbare Spannweite je Zelltyp-ID. */
const SPAN = new Float32Array(NEST_CELL_DEFS.length);
for (const d of NEST_CELL_DEFS) {
  SPAN[d.id] = STABILITY.MAX_SPAN[d.key] !== undefined ? STABILITY.MAX_SPAN[d.key] : 6;
}

export class Stability {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    /** Warteschlange offener Pruefungen: [levelId, x, y, radius, weakening]. */
    this.queue = [];
    this.collapses = 0;
  }

  /**
   * Bereich zur Pruefung vormerken.
   * @param {number} weaken 0 = normal, >0 = zusaetzliche Schwaechung (Beben)
   */
  request(level, x, y, radius = STABILITY.CHECK_RADIUS, weaken = 0) {
    if (level.kind !== 1) return;     // nur Nest-Ebenen
    this.queue.push(level.id, x, y, radius, weaken);
  }

  /** Pro Tick eine begrenzte Zahl Pruefungen abarbeiten. */
  update(ctx) {
    let done = 0;
    while (this.queue.length >= 5 && done < STABILITY.MAX_CHECKS_PER_TICK) {
      const levelId = this.queue.shift();
      const x = this.queue.shift();
      const y = this.queue.shift();
      const r = this.queue.shift();
      const weaken = this.queue.shift();
      const level = this.world.levels.get(levelId);
      if (level) this.check(level, x, y, r, weaken, ctx);
      done++;
    }
  }

  /**
   * Lokale Pruefung: alle Zeilen im Bereich auf zu weite Decken absuchen.
   * @returns {number} Anzahl eingestuerzter Zellen
   */
  check(level, cx, cy, radius, weaken, ctx) {
    const y0 = Math.max(WORLD.NEST_SURFACE_ROW + 1, cy - radius);
    const y1 = Math.min(level.h - 2, cy + radius);
    const x0 = Math.max(1, cx - radius);
    const x1 = Math.min(level.w - 2, cx + radius);
    const rng = ctx && ctx.rng ? ctx.rng : this.world.rngSim;
    let fell = 0;

    for (let y = y0; y <= y1; y++) {
      let runStart = -1;
      let runSpan = 0;
      for (let x = x0; x <= x1 + 1; x++) {
        const isCeiling = x <= x1 && this._isCeiling(level, x, y);
        if (isCeiling) {
          if (runStart < 0) { runStart = x; runSpan = SPAN[level.cells[y * level.w + x]]; }
          else runSpan = Math.min(runSpan, SPAN[level.cells[y * level.w + x]]);
          continue;
        }
        if (runStart >= 0) {
          const len = x - runStart;
          const allowed = Math.max(2, runSpan * (1 - Math.min(0.85, weaken)));
          if (len > allowed) {
            // Die Mitte der Spannweite faellt zuerst
            const mid = runStart + (len >> 1);
            const spread = Math.max(1, Math.round((len - allowed) / 2));
            for (let k = -spread; k <= spread; k++) {
              const fx = mid + k;
              if (fx < runStart || fx >= runStart + len) continue;
              if (!rng.chance(STABILITY.COLLAPSE_CHANCE + weaken * 0.5)) continue;
              if (this.collapse(level, fx, y, ctx)) fell++;
            }
          }
          runStart = -1;
        }
      }
    }
    if (fell > 0) {
      this.collapses += fell;
      // Nach einem Einsturz die Umgebung erneut pruefen (Kettenreaktion)
      this.request(level, cx, cy, radius, Math.max(0, weaken - 0.2));
    }
    return fell;
  }

  /** Ist (x,y) eine tragende Deckenzelle mit Luft darunter? */
  _isCeiling(level, x, y) {
    const i = y * level.w + x;
    const t = level.cells[i];
    if (!level.solidTable[t]) return false;
    if (t === NEST_CELL.STONE) return false;      // Fels traegt sich selbst
    return !level.solidTable[level.cells[i + level.w]];
  }

  /**
   * Eine Deckenzelle stuerzt ein: sie wird zu Luft, darunter liegen
   * Truemmer. Einheiten darunter werden verschuettet.
   */
  collapse(level, x, y, ctx) {
    if (!level.inBounds(x, y) || !level.inBounds(x, y + 1)) return false;
    const t = level.cells[y * level.w + x];
    if (t === NEST_CELL.STONE) return false;
    level.set(x, y, NEST_CELL.TUNNEL);
    level.setMeta(x, y, 0);
    this.world.emitFx(FX.DUST, level.id, x, y + 1, 10);
    level.set(x, y + 1, NEST_CELL.DEBRIS);
    level.setMeta(x, y + 1, 0);

    // Einheiten in der verschuetteten Zelle
    if (ctx && ctx.ants) {
      const ants = ctx.ants;
      const b = ants.buckets.get(level.id);
      if (b) {
        for (let k = 0; k < b.count; k++) {
          const i = b.ids[k];
          if ((ants.x[i] | 0) !== x) continue;
          const ay = ants.y[i] | 0;
          if (ay !== y + 1 && ay !== y) continue;
          ants.hp[i] -= STABILITY.BURY_DAMAGE;
          ants.stuck[i] = STABILITY.BURY_TICKS;
        }
      }
    }
    return true;
  }

  /**
   * Erdbeben in einer Nest-Ebene: der ganze Radius wird geschwaecht
   * geprueft. Verstaerkte Waende und Pfeiler halten das aus.
   */
  quake(level, cx, cy, radius, strength, ctx) {
    let fell = 0;
    const step = 5;
    for (let y = cy - radius; y <= cy + radius; y += step) {
      for (let x = cx - radius; x <= cx + radius; x += step) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.max(1, radius);
        fell += this.check(level, x, y, step, strength * (1 - dist * 0.6), ctx);
      }
    }
    if (fell > 0) {
      const colony = this.world.colonies.get(level.colonyId);
      bus.logEvent(CAT.KATASTROPHE, (colony ? colony.nestName : level.name)
        + ': ' + fell + ' Zellen eingestuerzt', {
        tick: this.world.tick, levelId: level.id, x: cx, y: cy,
        colonyId: level.colonyId,
      });
      if (colony) colony.stressEvents = (colony.stressEvents || 0) + 0.05 * Math.min(10, fell);
    }
    return fell;
  }

  /**
   * Braucht diese Kammer Stuetzpfeiler? Liefert Positionen, an denen die
   * Kolonie welche setzen sollte.
   */
  pillarSpots(level, cx, cy, out) {
    out.length = 0;
    // Waagerechte Ausdehnung der Luft an dieser Stelle messen
    let left = cx, right = cx;
    while (left > 1 && !level.isSolid(left - 1, cy)) left--;
    while (right < level.w - 2 && !level.isSolid(right + 1, cy)) right++;
    const width = right - left + 1;
    if (width < STABILITY.PILLAR_MIN_WIDTH) return out;
    for (let x = left + STABILITY.PILLAR_SPACING; x < right; x += STABILITY.PILLAR_SPACING) {
      if (level.isSolid(x, cy)) continue;
      out.push(cy * level.w + x);
    }
    return out;
  }
}
