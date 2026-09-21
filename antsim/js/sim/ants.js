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

import { ANTS, LIMITS, PORTALS, DIG, PHERO, FOOD, NUTRITION, LIFE, NUTRIENT } from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { CASTE, casteDef } from './castes.js';
import { dumpSoil, FOOD_OF_CELL, SURFACE_CELL } from './surface.js';
import { isFoodCell, dominantNutrient } from './food.js';
import { storeFood } from './nutrition.js';
import { PH } from './pheromones.js';


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

/** Was eine Ameise tragen kann. */
export const CARRY = {
  NONE: 0,
  SOIL: 1,      // Aushub -> wird an der Oberflaeche zum Erdhuegel
  FOOD: 2,      // ab Phase 2/3
  BROOD: 3,
  PEBBLE: 4,
  RESIN: 5,
  WOUNDED: 6,
  DEAD: 7,
};

export const CARRY_LABEL = {
  0: '-', 1: 'Aushub', 2: 'Nahrung', 3: 'Brut', 4: 'Kiesel', 5: 'Harz',
  6: 'Verwundete', 7: 'Toten',
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

    /** Zelltyp der Nahrungsquelle, von der die Fuhre stammt (Profil). */
    this.carrySource = new Uint8Array(capacity);
    /**
     * Ticks seit dem letzten "Spurstart" (Nestausgang bzw. Fundstelle).
     * Die Ablagemenge faellt damit ab – dadurch zeigt der Heimweg-Gradient
     * zum Nest und der Nahrungs-Gradient zur Fundstelle.
     */
    this.trip = new Uint16Array(capacity);
    /** Lebensdauer in Ticks (0 = unbegrenzt, z. B. per Werkzeug gesetzt). */
    this.lifespan = new Uint32Array(capacity);
    /** Ticks, die die Ameise in einem Netz festhaengt. */
    this.stuck = new Uint8Array(capacity);

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
    /** Wiederverwendetes Hilfsobjekt (keine Allokation im Tick). */
    this._tmp = { x: 0, y: 0 };
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
    this.carrySource[i] = 0;
    this.trip[i] = 0;
    this.lifespan[i] = opts.lifespan !== undefined ? opts.lifespan : 0;
    this.stuck[i] = 0;
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
        if (c) c.countAnt(this.caste[i], lv, this.state[i]);
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
  /**
   * Simulation einer Ebene.
   *
   * Oberflaeche: Futtersuche ueber Pheromone (Phase 2). Ausrueckende Ameisen
   * legen die Heimweg-Spur, heimkehrende mit Beute die Nahrungsspur; beide
   * Ablagen fallen mit der Laufzeit seit dem Spurstart ab. Dadurch zeigt
   * jeder Gradient in die richtige Richtung, ohne dass irgendwo ein Weg
   * geskriptet waere.
   *
   * Nest: Navigation ueber Distanzfelder, Aufgaben Graben, Abliefern und
   * Brutpflege.
   */
  update(level, ctx) {
    const b = this.buckets.get(level.id);
    if (!b) return;
    const rng = ctx.rng;
    const isNest = level.kind === LEVEL_KIND.NEST;
    const fields = isNest && ctx.fields ? ctx.fields.get(level.id) : null;
    const phero = ctx.phero;
    const maxX = level.w - 0.25;
    const maxY = level.h - 0.25;

    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.age[i]++;
      if (this.portalCooldown[i] > 0) this.portalCooldown[i]--;
      if (this.trip[i] < 65000) this.trip[i]++;

      // ---- Im Eingangsschacht ------------------------------------------
      if (this.state[i] === ANT_STATE.TRANSIT) {
        if (--this.transit[i] === 0) this._arrive(i, ctx);
        continue;
      }

      // ---- Altersschwaeche ----------------------------------------------
      if (this.lifespan[i] > 0 && this.age[i] > this.lifespan[i]) {
        this._die(i, level, ctx, 'Alter');
        continue;
      }

      const colony = ctx.colonies ? ctx.colonies.get(this.colony[i]) : null;

      // ---- Hunger --------------------------------------------------------
      if (colony) {
        // Hunger steigt anteilig zur Unterdeckung, nicht als Alles-oder-nichts
        const gap = 1 - (colony.supply !== undefined ? colony.supply : 1);
        if (gap > 0.001) {
          this.hunger[i] += NUTRITION.HUNGER_RATE * gap;
          if (this.hunger[i] >= 1) { this._die(i, level, ctx, 'Hunger'); continue; }
        } else if (this.hunger[i] > 0) {
          this.hunger[i] = Math.max(0, this.hunger[i] - NUTRITION.HUNGER_RATE * 3);
        }
      }
      const slow = this.hunger[i] > NUTRITION.HUNGER_SLOW ? 0.55 : 1;

      // ---- Im Spinnennetz gefangen ---------------------------------------
      if (this.stuck[i] > 0) {
        this.stuck[i]--;
        this.anim[i] += 0.2;
        continue;
      }

      // ---- Koenigin bleibt in ihrer Kammer -------------------------------
      if (this.caste[i] === CASTE.QUEEN) {
        if (rng.chance(0.02)) this.dir[i] += rng.range(-0.6, 0.6);
        this._move(level, i, 0.22, maxX, maxY, rng);
        continue;
      }

      if (this.timer[i] > 0) this.timer[i]--;

      if (isNest) this._nestBehaviour(level, i, ctx, colony, fields, rng);
      else this._surfaceBehaviour(level, i, ctx, colony, phero, rng);

      this._move(level, i, slow, maxX, maxY, rng);

      // ---- Portalpruefung ------------------------------------------------
      if (this.portalCooldown[i] === 0) {
        const cx = this.x[i] | 0, cy = this.y[i] | 0;
        const p = ctx.portals.at(level.id, cx, cy);
        if (p !== null) this._tryEnter(level, i, p, ctx);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Oberflaeche: Futtersuche mit Pheromonen
  // -------------------------------------------------------------------------
  _surfaceBehaviour(level, i, ctx, colony, phero, rng) {
    const cx = this.x[i] | 0, cy = this.y[i] | 0;
    const cid = this.colony[i];

    // --- Fallen der Raeuber ------------------------------------------------
    const under = level.cells[cy * level.w + cx];
    if (under === SURFACE_CELL.WEB) {
      this.stuck[i] = 45;
      if (phero) phero.deposit(cid, PH.ALARM, cx, cy, PHERO.DEPOSIT.ALARM * 0.6);
      return;
    }
    if (under === SURFACE_CELL.FUNNEL) {
      this.hp[i] -= 0.06;
      this.stuck[i] = 12;
      if (this.hp[i] <= 0) { this._die(i, level, ctx, 'Raeuber'); return; }
      if (phero) phero.deposit(cid, PH.ALARM, cx, cy, PHERO.DEPOSIT.ALARM * 0.6);
      return;
    }
    const gene = colony && colony.genome ? colony.genome.pheromonstaerke : 0.5;
    const strength = 0.5 + gene;
    // Ablage faellt mit der Laufzeit seit dem Spurstart ab
    const fall = Math.max(0.12, 1 - this.trip[i] / PHERO.DEPOSIT_FALLOFF);

    if (this.state[i] === ANT_STATE.RETURN && this.carryType[i] === CARRY.FOOD) {
      if (phero) {
        phero.deposit(cid, PH.FOOD, cx, cy, PHERO.DEPOSIT.FOOD * strength * fall, this.carryNutrient[i]);
      }
    } else if (phero) {
      phero.deposit(cid, PH.HOME, cx, cy, PHERO.DEPOSIT.HOME * strength * fall);
    }

    switch (this.state[i]) {
      case ANT_STATE.EXPLORE: {
        // Nahrung unter den Fuessen?
        if (this.carryType[i] === CARRY.NONE && ctx.food) {
          const cell = level.cells[cy * level.w + cx];
          if (isFoodCell(cell) && level.meta[cy * level.w + cx] > 0) {
            const got = ctx.food.take(level, cx, cy, FOOD.PICKUP);
            if (got > 0) {
              this.carryType[i] = CARRY.FOOD;
              this.carrySource[i] = cell;
              this.carryNutrient[i] = dominantNutrient(cell);
              this.carryAmount[i] = got;
              this.trip[i] = 0;                       // neue Spur ab hier
              this._beginReturn(level, i, ctx);
              // Fundstelle kraeftig markieren
              if (phero) {
                phero.deposit(cid, PH.FOOD, cx, cy, PHERO.DEPOSIT.FOOD * 2.2, this.carryNutrient[i]);
              }
              break;
            }
          }
        }
        // Alarm geht vor: Soldatinnen und aggressive Voelker ruecken aus
        const aggr = colony && colony.genome ? colony.genome.aggressivitaet : 0.5;
        const defends = this.caste[i] === CASTE.SOLDIER || aggr > 0.6;
        if (defends && phero && this._followTrail(level, i, phero, cid, PH.ALARM, null, rng)) break;

        // Nahrungsspur verfolgen, sonst suchen
        if (!phero || !this._followTrail(level, i, phero, cid, PH.FOOD,
          colony ? colony.needWeight : null, rng)) {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        if (this.timer[i] === 0) this._beginReturn(level, i, ctx);
        break;
      }

      case ANT_STATE.RETURN: {
        // Heimweg-Spur verfolgen; ohne Spur direkt zum Eingang
        const followed = phero && this._followTrail(level, i, phero, cid, PH.HOME, null, rng);
        if (!followed) {
          const tx = this.targetX[i], ty = this.targetY[i];
          if (tx < 0) { this._beginReturn(level, i, ctx); break; }
          const want = Math.atan2(ty + 0.5 - this.y[i], tx + 0.5 - this.x[i]);
          this.dir[i] += angleDelta(this.dir[i], want) * ANTS.STEER_GAIN + rng.range(-0.08, 0.08);
        } else if (rng.chance(0.08)) {
          // gelegentlicher Blick auf den Eingang, damit niemand im Kreis laeuft
          const tx = this.targetX[i], ty = this.targetY[i];
          if (tx >= 0) {
            const want = Math.atan2(ty + 0.5 - this.y[i], tx + 0.5 - this.x[i]);
            this.dir[i] += angleDelta(this.dir[i], want) * 0.25;
          }
        }
        break;
      }

      default:
        // An der Oberflaeche gibt es keine Nestaufgaben – zurueck auf Suche,
        // damit keine Ameise in einem Zustand haengen bleibt.
        this.state[i] = ANT_STATE.EXPLORE;
        this.timer[i] = rng.intRange(ANTS.EXPLORE_TICKS_MIN, ANTS.EXPLORE_TICKS_MAX);
        this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        break;
    }
  }

  /**
   * Sensoren links/vorne/rechts. Liefert false, wenn keine Spur zu riechen
   * ist – dann uebernimmt das Zufallsverhalten.
   */
  _followTrail(level, i, phero, colonyId, type, needWeight, rng) {
    const a = this.dir[i];
    const d = PHERO.SENSE_DIST;
    const sa = PHERO.SENSE_ANGLE;
    const x = this.x[i], y = this.y[i];
    const fx = x + Math.cos(a) * d, fy = y + Math.sin(a) * d;
    const lx = x + Math.cos(a - sa) * d, ly = y + Math.sin(a - sa) * d;
    const rx = x + Math.cos(a + sa) * d, ry = y + Math.sin(a + sa) * d;
    const f = phero.sense(colonyId, type, fx, fy, needWeight);
    const l = phero.sense(colonyId, type, lx, ly, needWeight);
    const r = phero.sense(colonyId, type, rx, ry, needWeight);
    if (f < 3 && l < 3 && r < 3) return false;
    if (f >= l && f >= r) {
      this.dir[i] += rng.range(-PHERO.NOISE, PHERO.NOISE) * 0.5;
    } else if (l > r) {
      this.dir[i] -= sa * PHERO.STEER;
    } else {
      this.dir[i] += sa * PHERO.STEER;
    }
    this.dir[i] += rng.range(-PHERO.NOISE, PHERO.NOISE) * 0.35;
    return true;
  }

  // -------------------------------------------------------------------------
  // Nest: Abliefern, Graben, Brutpflege
  // -------------------------------------------------------------------------
  _nestBehaviour(level, i, ctx, colony, fields, rng) {
    switch (this.state[i]) {
      case ANT_STATE.DELIVER: {
        if (this.carryType[i] !== CARRY.FOOD) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(30, 120);
          break;
        }
        const f = fields ? fields.store : null;
        const here = f ? f.at(this.x[i] | 0, this.y[i] | 0) : 9999;
        if (here === 0 || this.timer[i] === 0) {
          // Angekommen (oder aufgegeben): einlagern
          if (colony) {
            const key = FOOD_OF_CELL[this.carrySource[i]];
            const prof = key ? FOOD.PROFILES[key].n : [0.34, 0.33, 0.33];
            storeFood(colony, this.carryNutrient[i], this.carryAmount[i], prof);
            colony.deliveries = (colony.deliveries || 0) + 1;
          }
          this.carryType[i] = CARRY.NONE;
          this.carryAmount[i] = 0;
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(30, 150);
          break;
        }
        if (!f || !this._steerField(level, i, f, rng)) {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        break;
      }

      case ANT_STATE.NURSE: {
        if (!colony || !ctx.brood || this.timer[i] === 0) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(60, 240);
          break;
        }
        const larva = ctx.brood.findHungryLarva(colony.id, level.id, this.x[i], this.y[i], 7);
        if (larva >= 0) {
          // Fuettern kostet Protein aus dem Vorrat
          const want = 0.5;
          const have = Math.min(want, colony.storeArr[NUTRIENT.PROTEIN]);
          if (have > 0.01) {
            const used = ctx.brood.feed(larva, have);
            colony.storeArr[NUTRIENT.PROTEIN] -= used;
            colony.fedTotal = (colony.fedTotal || 0) + used;
          }
          const dx = ctx.brood.x[larva] - this.x[i], dy = ctx.brood.y[larva] - this.y[i];
          this.dir[i] = Math.atan2(dy, dx);
          this.anim[i] += 0.25;
          break;
        }
        if (!fields || !this._steerField(level, i, fields.brood, rng)) {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        break;
      }

      case ANT_STATE.DIG: {
        if (!colony || colony.digActive < 0 || this.timer[i] === 0) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(ANTS.NEST_STAY_MIN, ANTS.NEST_STAY_MAX);
          break;
        }
        const tx = (colony.digActive % level.w) + 0.5;
        const ty = ((colony.digActive / level.w) | 0) + 0.5;
        const dx = tx - this.x[i], dy = ty - this.y[i];
        if (dx * dx + dy * dy <= DIG.REACH * DIG.REACH) {
          this.dir[i] = Math.atan2(dy, dx);
          this.anim[i] += 0.35;
          const rate = DIG.RATE_PER_ANT
            * (colony.genome ? 0.6 + colony.genome.grabgeschwindigkeit : 1);
          const done = ctx.construction.contribute(colony, level, rate);
          if (done >= 0) {
            this.carryType[i] = CARRY.SOIL;
            this.carryAmount[i] = 1;
            this._beginReturn(level, i, ctx);
          }
          return;   // graben statt laufen
        }
        if (!fields || !this._steerField(level, i, fields.dig, rng)) {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        break;
      }

      case ANT_STATE.RETURN: {
        if (!fields || !this._steerField(level, i, fields.entrance, rng)) {
          const tx = this.targetX[i], ty = this.targetY[i];
          if (tx < 0) { this._beginReturn(level, i, ctx); break; }
          const want = Math.atan2(ty + 0.5 - this.y[i], tx + 0.5 - this.x[i]);
          this.dir[i] += angleDelta(this.dir[i], want) * ANTS.STEER_GAIN;
        }
        break;
      }

      default: {
        // EXPLORE im Nest: Aufgabe suchen, sonst herumlaufen und ausruecken.
        // Aufgaben gibt es nur im eigenen Nest – sonst arbeitet eine Ameise
        // im Nachbarnest ins Leere und fehlt dem eigenen Volk.
        const ownNest = colony && colony.nestLevelIds.indexOf(level.id) >= 0;
        if (ownNest && this.caste[i] === CASTE.WORKER && this.carryType[i] === CARRY.NONE) {
          const inNest = colony.populationByLevel.get(level.id) || 1;
          // Brutpflege hat Vorrang, solange Larven hungern und Protein da ist
          if (ctx.brood && colony.broodCount && colony.broodCount[1] > 0
              && colony.storeArr[NUTRIENT.PROTEIN] > 1
              && colony.nurses < Math.max(2, inNest * 0.35) && rng.chance(0.08)) {
            this.state[i] = ANT_STATE.NURSE;
            this.timer[i] = rng.intRange(400, 1200);
            colony.nurses++;
            break;
          }
          /**
           * Graben ist nachrangig: bei knapper Versorgung gehen die
           * Arbeiterinnen lieber sammeln. Das ist die Prioritaetensteuerung
           * aus dem Lastenheft ("Naehrstoffmangel -> mehr Sammlerinnen"),
           * umgesetzt als Wahrscheinlichkeit statt als Befehl.
           */
          const digChance = colony.starving ? 0.004 : 0.05;
          if (colony.digActive >= 0
              && colony.diggers < Math.max(3, inNest * DIG.DIGGER_SHARE)
              && rng.chance(digChance)) {
            this.state[i] = ANT_STATE.DIG;
            this.timer[i] = DIG.JOB_TIMEOUT;
            colony.diggers++;
            break;
          }
        }
        this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        if (this.timer[i] === 0) this._beginReturn(level, i, ctx);
        break;
      }
    }
  }

  /**
   * Einer Distanzfeld-Richtung folgen.
   * @returns {boolean} false, wenn das Feld an dieser Stelle nichts weiss
   */
  _steerField(level, i, field, rng) {
    if (!field || !field.valid) return false;
    const n = field.next(level, this.x[i] | 0, this.y[i] | 0, this._tmp);
    if (!n) return false;
    const want = Math.atan2(n.y + 0.5 - this.y[i], n.x + 0.5 - this.x[i]);
    this.dir[i] += angleDelta(this.dir[i], want) * 0.5 + rng.range(-0.05, 0.05);
    return true;
  }

  /** Tod: Aas hinterlassen und Slot freigeben. */
  _die(i, level, ctx, cause) {
    const colony = ctx.colonies ? ctx.colonies.get(this.colony[i]) : null;
    if (colony) {
      colony.deaths = (colony.deaths || 0) + 1;
      colony.deathCause = colony.deathCause || {};
      colony.deathCause[cause] = (colony.deathCause[cause] || 0) + 1;
      if (this.caste[i] === CASTE.QUEEN) ctx.world.queenDied(colony, level, this.x[i], this.y[i]);
    }
    // Tote werden zu Protein – an der Oberflaeche als Aas, im Nest nicht.
    if (ctx.food && level.kind === LEVEL_KIND.SURFACE) {
      ctx.food.dropCarrion(level, this.x[i] | 0, this.y[i] | 0,
        LIFE.CORPSE_FOOD * casteDef(this.caste[i]).size);
    }
    this.kill(i);
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

    const toNest = destLevel && destLevel.kind === LEVEL_KIND.NEST;
    this.trip[i] = 0;                       // neuer Spurabschnitt

    if (!toNest && this.carryType[i] === CARRY.SOIL) {
      // Aushub landet als Erdhuegel neben dem Eingang – der Huegel waechst
      // sichtbar mit dem Tunnelsystem.
      dumpSoil(destLevel, portal.ax, portal.ay, ctx.rng);
      this.carryType[i] = CARRY.NONE;
      this.carryAmount[i] = 0;
      this.timer[i] = ctx.rng.intRange(DIG.DUMP_STAY[0], DIG.DUMP_STAY[1]);
    } else if (toNest && this.carryType[i] === CARRY.FOOD) {
      // Beute in die Vorratskammer bringen
      this.state[i] = ANT_STATE.DELIVER;
      this.timer[i] = 1200;
    } else {
      this.timer[i] = toNest
        ? ctx.rng.intRange(ANTS.NEST_STAY_MIN, ANTS.NEST_STAY_MAX)
        : ctx.rng.intRange(ANTS.EXPLORE_TICKS_MIN, ANTS.EXPLORE_TICKS_MAX);
    }
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
