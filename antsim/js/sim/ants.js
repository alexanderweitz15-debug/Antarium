/**
 * ants.js – Ameisen als Structure of Arrays (SoA).
 *
 * Datenlayout: pro Feld ein Typed Array der Laenge LIMITS.MAX_ANTS. Tote
 * Slots landen auf einer Free-List und werden wiederverwendet. Es gibt KEINE
 * Objekte pro Ameise und keine Allokation im Tick.
 *
 * Jede Ameise traegt ein Feld `level` (Uint8). Pro Tick werden die Indizes
 * einmal nach Ebene gebuckelt (O(n)), danach arbeitet jedes System
 * ebenenweise – das liefert nebenbei die Messwerte pro Ebene fuer das
 * Performance-Overlay.
 *
 * PHASE 1: Bewegung, Kollision mit dem Grid und Portalwechsel. Das Verhalten
 * ist bewusst duenn (Erkunden <-> Heimkehren im Wechsel), weil Pheromone
 * (Phase 2) und Aufgabenwahl (Phase 3) es ersetzen werden.
 */

import { ANTS, LIMITS, PORTALS } from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { CASTE, casteDef } from './castes.js';

/** Zustandsmaschine. Phase 1 nutzt IDLE/EXPLORE/RETURN/TRANSIT. */
export const ANT_STATE = {
  IDLE: 0,
  EXPLORE: 1,
  RETURN: 2,
  TRANSIT: 3,      // steckt im Eingangsschacht (unsichtbar)
  DELIVER: 4,
  DIG: 5,
  BUILD: 6,
  REPAIR: 7,
  NURSE: 8,
  MILK: 9,
  GUARD: 10,
  PATROL: 11,
  ATTACK: 12,
  DEFEND: 13,
  FLEE: 14,
  EVACUATE: 15,
  CARRY_WOUNDED: 16,
  PLUG: 17,
};

export const ANT_STATE_LABEL = {
  0: 'Wartet', 1: 'Erkundet', 2: 'Kehrt heim', 3: 'Im Schacht', 4: 'Liefert ab',
  5: 'Graebt', 6: 'Baut', 7: 'Repariert', 8: 'Pflegt Brut', 9: 'Melkt Blattlaeuse',
  10: 'Haelt Wache', 11: 'Patrouilliert', 12: 'Greift an', 13: 'Verteidigt',
  14: 'Flieht', 15: 'Evakuiert Brut', 16: 'Traegt Verwundete', 17: 'Blockiert Eingang',
};

const TWO_PI = Math.PI * 2;

/** Kuerzeste Winkeldifferenz nach [-pi, pi]. */
function angleDelta(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return d;
}

export class Ants {
  constructor(capacity = LIMITS.MAX_ANTS) {
    this.capacity = capacity;

    // --- Identitaet und Ebene --------------------------------------------
    this.alive = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity);
    this.colony = new Uint8Array(capacity);
    this.caste = new Uint8Array(capacity);
    this.state = new Uint8Array(capacity);

    // --- Bewegung ---------------------------------------------------------
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    /** Position des Vortick – ausschliesslich fuer die Renderinterpolation. */
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.dir = new Float32Array(capacity);
    this.speed = new Float32Array(capacity);

    // --- Lebensdaten ------------------------------------------------------
    this.hp = new Float32Array(capacity);
    this.hpMax = new Float32Array(capacity);
    this.hunger = new Float32Array(capacity);
    this.age = new Uint32Array(capacity);

    // --- Tragelast (Typ, Naehrstoff, Menge) – ab Phase 2/3 ----------------
    this.carryType = new Uint8Array(capacity);
    this.carryNutrient = new Uint8Array(capacity);
    this.carryAmount = new Float32Array(capacity);

    // --- Ziel und Zustandstimer -------------------------------------------
    this.targetX = new Int16Array(capacity);
    this.targetY = new Int16Array(capacity);
    this.timer = new Uint16Array(capacity);

    // --- Phaenotyp (Ernaehrung beim Schluepfen) – ab Phase 3 --------------
    this.phenoSize = new Float32Array(capacity);
    this.phenoSpeed = new Float32Array(capacity);
    this.phenoLife = new Float32Array(capacity);

    // --- Portale ----------------------------------------------------------
    /** Restliche Ticks im Schacht. */
    this.transit = new Uint8Array(capacity);
    /** Index des benutzten Portals in PortalSystem.portals, sonst -1. */
    this.portalRef = new Int16Array(capacity);
    /** Sperre gegen sofortigen Wiedereintritt. */
    this.portalCooldown = new Uint8Array(capacity);

    // --- Darstellung ------------------------------------------------------
    /** Animationsphase in Frames (float, wird beim Zeichnen gerundet). */
    this.anim = new Float32Array(capacity);

    // --- Slotverwaltung ---------------------------------------------------
    this.free = new Int32Array(capacity);
    this.freeCount = 0;
    /** Hoechster je benutzter Slot + 1. */
    this.high = 0;
    this.count = 0;

    /** @type {Map<number, {ids:Int32Array, count:number}>} */
    this.buckets = new Map();
  }

  /** Ebene fuer die Bucket-Verwaltung anmelden. */
  registerLevel(levelId) {
    if (!this.buckets.has(levelId)) {
      this.buckets.set(levelId, { ids: new Int32Array(this.capacity), count: 0 });
    }
  }

  /**
   * Neue Ameise erzeugen.
   * @returns {number} Slot-Index oder -1, wenn die Kapazitaet erschoepft ist
   */
  spawn(opts) {
    let i;
    if (this.freeCount > 0) i = this.free[--this.freeCount];
    else if (this.high < this.capacity) i = this.high++;
    else return -1;

    const def = casteDef(opts.casteId !== undefined ? opts.casteId : CASTE.WORKER);
    this.alive[i] = 1;
    this.level[i] = opts.levelId;
    this.colony[i] = opts.colonyId;
    this.caste[i] = def.id;
    this.state[i] = opts.state !== undefined ? opts.state : ANT_STATE.EXPLORE;
    this.x[i] = opts.x;
    this.y[i] = opts.y;
    this.px[i] = opts.x;
    this.py[i] = opts.y;
    this.dir[i] = opts.dir !== undefined ? opts.dir : 0;
    this.speed[i] = ANTS.BASE_SPEED * def.speed;
    this.hp[i] = def.hp;
    this.hpMax[i] = def.hp;
    this.hunger[i] = 0;
    this.age[i] = 0;
    this.carryType[i] = 0;
    this.carryNutrient[i] = 0;
    this.carryAmount[i] = 0;
    this.targetX[i] = -1;
    this.targetY[i] = -1;
    this.timer[i] = opts.timer !== undefined ? opts.timer : 0;
    this.phenoSize[i] = 1;
    this.phenoSpeed[i] = 1;
    this.phenoLife[i] = 1;
    this.transit[i] = 0;
    this.portalRef[i] = -1;
    this.portalCooldown[i] = 0;
    this.anim[i] = 0;
    this.count++;
    return i;
  }

  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free[this.freeCount++] = i;
    this.count--;
  }

  /** Alle Ameisen entfernen (Debug/Reset). */
  clear() {
    this.alive.fill(0);
    this.freeCount = 0;
    this.high = 0;
    this.count = 0;
    for (const b of this.buckets.values()) b.count = 0;
  }

  /**
   * Indizes nach Ebene sortieren und dabei die Kolonie-Zaehler aktualisieren.
   * Ein Durchlauf, keine Allokation.
   */
  rebuildBuckets(levelManager, colonyManager) {
    for (const b of this.buckets.values()) b.count = 0;
    if (colonyManager) for (const c of colonyManager.colonies) c.resetCounts();

    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i]) continue;
      const lv = this.level[i];
      const b = this.buckets.get(lv);
      if (b) b.ids[b.count++] = i;
      if (colonyManager) {
        const c = colonyManager.get(this.colony[i]);
        if (c) c.countAnt(this.caste[i], lv);
      }
    }
    for (const lvl of levelManager.levels) {
      const b = this.buckets.get(lvl.id);
      lvl.antCount = b ? b.count : 0;
    }
  }

  /** Spatial Hash einer Ebene aus deren Bucket neu aufbauen. */
  fillSpatial(level) {
    const b = this.buckets.get(level.id);
    level.spatial.clear();
    if (!b) return;
    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      if (this.state[i] === ANT_STATE.TRANSIT) continue; // steckt im Schacht
      level.spatial.insert(i, this.x[i], this.y[i]);
    }
  }

  /**
   * Simulation einer Ebene.
   * @param {import('./levels.js').Level} level
   * @param {{portals:import('./portals.js').PortalSystem, levels:import('./levels.js').LevelManager, rng:import('../rng.js').RNG, tick:number}} ctx
   */
  update(level, ctx) {
    const b = this.buckets.get(level.id);
    if (!b) return;
    const rng = ctx.rng;
    const maxX = level.w - 0.25;
    const maxY = level.h - 0.25;

    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.age[i]++;
      if (this.portalCooldown[i] > 0) this.portalCooldown[i]--;

      // ---- Im Eingangsschacht ------------------------------------------
      if (this.state[i] === ANT_STATE.TRANSIT) {
        if (--this.transit[i] === 0) this._arrive(i, ctx);
        continue;
      }

      // ---- Koeniginnen bleiben in ihrer Kammer --------------------------
      if (this.caste[i] === CASTE.QUEEN) {
        if (rng.chance(0.02)) this.dir[i] += rng.range(-0.6, 0.6);
        this._move(level, i, 0.25, maxX, maxY, rng);
        continue;
      }

      // ---- Zustandslogik (Phase-1-Platzhalter) --------------------------
      if (this.timer[i] > 0) this.timer[i]--;

      if (this.state[i] === ANT_STATE.EXPLORE) {
        this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        if (this.timer[i] === 0) this._beginReturn(level, i, ctx);
      } else if (this.state[i] === ANT_STATE.RETURN) {
        const tx = this.targetX[i], ty = this.targetY[i];
        if (tx < 0) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(ANTS.EXPLORE_TICKS_MIN, ANTS.EXPLORE_TICKS_MAX);
        } else {
          const want = Math.atan2(ty + 0.5 - this.y[i], tx + 0.5 - this.x[i]);
          this.dir[i] += angleDelta(this.dir[i], want) * ANTS.STEER_GAIN + rng.range(-0.08, 0.08);
        }
      }

      this._move(level, i, 1, maxX, maxY, rng);

      // ---- Portalpruefung ------------------------------------------------
      if (this.portalCooldown[i] === 0) {
        const cx = this.x[i] | 0, cy = this.y[i] | 0;
        const p = ctx.portals.at(level.id, cx, cy);
        if (p !== null) this._tryEnter(level, i, p, ctx);
      }
    }
  }

  /** Bewegung mit achsenweiser Kollision; liefert die gelaufene Distanz. */
  _move(level, i, speedScale, maxX, maxY, rng) {
    const sp = this.speed[i] * this.phenoSpeed[i] * speedScale;
    if (sp <= 0) return 0;
    const a = this.dir[i];
    const cs = Math.cos(a), sn = Math.sin(a);
    let moved = 0;
    let blocked = false;

    let tx = this.x[i] + cs * sp;
    if (tx < 0.25) { tx = 0.25; blocked = true; } else if (tx > maxX) { tx = maxX; blocked = true; }
    if (!level.isSolid(tx | 0, this.y[i] | 0)) { moved += Math.abs(tx - this.x[i]); this.x[i] = tx; }
    else blocked = true;

    let ty = this.y[i] + sn * sp;
    if (ty < 0.25) { ty = 0.25; blocked = true; } else if (ty > maxY) { ty = maxY; blocked = true; }
    if (!level.isSolid(this.x[i] | 0, ty | 0)) { moved += Math.abs(ty - this.y[i]); this.y[i] = ty; }
    else blocked = true;

    if (blocked) {
      // An Waenden entlangtasten: leichte Drehung statt harter Umkehr.
      this.dir[i] += rng.chance(0.5) ? 0.7 : -0.7;
    }
    this.anim[i] += moved * ANTS.ANIM_FRAMES_PER_CELL;
    return moved;
  }

  /** Ziel auf das naechste eigene Portal dieser Ebene setzen. */
  _beginReturn(level, i, ctx) {
    const p = ctx.portals.nearest(level.id, this.colony[i], this.x[i], this.y[i]);
    if (!p) {
      this.timer[i] = ctx.rng.intRange(ANTS.EXPLORE_TICKS_MIN, ANTS.EXPLORE_TICKS_MAX);
      return;
    }
    const pos = p.on(level.id);
    this.targetX[i] = pos.x;
    this.targetY[i] = pos.y;
    this.state[i] = ANT_STATE.RETURN;
  }

  /** Versuch, ein Portal zu betreten. */
  _tryEnter(level, i, portal, ctx) {
    if (this.state[i] !== ANT_STATE.RETURN) return;
    if (!ctx.portals.canEnter(portal, level.id, this.colony[i])) return;
    ctx.portals.consume(portal, level.id);
    this.state[i] = ANT_STATE.TRANSIT;
    this.transit[i] = PORTALS.TRANSIT_TICKS;
    this.portalRef[i] = ctx.portals.portals.indexOf(portal);
  }

  /** Uebertritt abschliessen: Ebene wechseln und auf der Gegenseite auftauchen. */
  _arrive(i, ctx) {
    const portal = ctx.portals.portals[this.portalRef[i]];
    const from = this.level[i];
    const dest = portal.other(from);
    const destLevel = ctx.levels.get(dest.levelId);

    this.level[i] = dest.levelId;
    this.x[i] = dest.x + 0.5;
    this.y[i] = dest.y + 0.5;
    this.px[i] = this.x[i];
    this.py[i] = this.y[i];
    // In ein Nest geht es nach unten, an die Oberflaeche in eine Zufallsrichtung.
    this.dir[i] = destLevel && destLevel.kind === LEVEL_KIND.NEST ? Math.PI / 2 : ctx.rng.angle();
    this.state[i] = ANT_STATE.EXPLORE;
    this.timer[i] = destLevel && destLevel.kind === LEVEL_KIND.NEST
      ? ctx.rng.intRange(ANTS.NEST_STAY_MIN, ANTS.NEST_STAY_MAX)
      : ctx.rng.intRange(ANTS.EXPLORE_TICKS_MIN, ANTS.EXPLORE_TICKS_MAX);
    this.transit[i] = 0;
    this.portalRef[i] = -1;
    this.portalCooldown[i] = PORTALS.REENTRY_COOLDOWN;
    this.targetX[i] = -1;
    this.targetY[i] = -1;
    ctx.portals.completed(portal);
  }

  /** Alle sichtbaren Ameisen einer Ebene besuchen (Rendering, UI). */
  forEachOnLevel(levelId, cb) {
    const b = this.buckets.get(levelId);
    if (!b) return;
    for (let k = 0; k < b.count; k++) cb(b.ids[k]);
  }

  /** Naechste Ameise zu (x,y) im Radius r auf einer Ebene, sonst -1. */
  pick(level, x, y, r) {
    let best = -1, bestD = r * r;
    level.spatial.query(x, y, r, (id) => {
      const dx = this.x[id] - x, dy = this.y[id] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }
}
