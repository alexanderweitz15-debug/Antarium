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

import {
  ANTS, LIMITS, PORTALS, DIG, PHERO, FOOD, NUTRITION, LIFE, NUTRIENT,
  FORTIFY, STABILITY, DAYNIGHT, GODMODE, TRAIT_CFG, BUILD, DIGSCENT,
} from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { CASTE, casteDef } from './castes.js';
import { dumpSoil, FOOD_OF_CELL, SURFACE_CELL } from './surface.js';
import { isFoodCell, dominantNutrient } from './food.js';
import { storeFood } from './nutrition.js';
import { PH } from './pheromones.js';
import { antEffects, FLAG } from './traits.js';
import { NEST_CELL } from './nest.js';

/** Wasserzelle je Ebenenart (0 = Oberflaeche, 1 = Nest). */
const WATER_CELL = [SURFACE_CELL.WATER, NEST_CELL.WATER];


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
  RAID: 18,        // unterwegs zu einem fremden Nest
  LOOT: 19,        // mit Beute auf dem Heimweg
  FETCH: 20,       // unterwegs zu einer Materialfundstelle
  AID: 21,         // unterwegs zu einem bedraengten Verbuendeten
};

export const ANT_STATE_LABEL = {
  0: 'Wartet', 1: 'Erkundet', 2: 'Kehrt heim', 3: 'Im Schacht', 4: 'Liefert ab',
  5: 'Graebt', 6: 'Baut', 7: 'Repariert', 8: 'Pflegt Brut', 9: 'Melkt Blattlaeuse',
  10: 'Haelt Wache', 11: 'Patrouilliert', 12: 'Greift an', 13: 'Verteidigt',
  14: 'Flieht', 15: 'Evakuiert Brut', 16: 'Traegt Verwundete', 17: 'Blockiert Eingang',
  18: 'Raubzug', 19: 'Traegt Beute heim',
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
  MATERIAL: 8,  // Lehm, Kalk oder Chitin – welches steht in carrySource
};

export const CARRY_LABEL = {
  0: '-', 1: 'Aushub', 2: 'Nahrung', 3: 'Brut', 4: 'Kiesel', 5: 'Harz',
  6: 'Verwundete', 7: 'Toten', 8: 'Baustoff',
};

/**
 * Material als kleine Zahl, damit es in carrySource passt (Uint8Array).
 * 1 = Lehm, 2 = Kalk, 3 = Chitin.
 */
export const MATERIAL_ID = { clay: 1, lime: 2, chitin: 3 };
export const MATERIAL_NAME = { 1: 'clay', 2: 'lime', 3: 'chitin' };

/**
 * Welches neue Material liegt unter dieser Zelle?
 *
 * Lehm gibt es nur in Wassernaehe – sonst waere er ueberall und damit
 * wertlos. Kalk kommt aus Stein und ist entsprechend selten, weil Stein
 * selten ist. Chitin faellt nur bei erlegten Tieren an und wird deshalb
 * hier nicht gefunden.
 */
function materialUnder(level, x, y, colony, rng) {
  const c = level.cells[y * level.w + x];
  /**
   * Lehm liegt im feuchten Saum um Pfuetzen. Der erste Anlauf verlangte
   * ERDE hoechstens drei Zellen vom Wasser entfernt – auf der Standardkarte
   * gab es davon exakt null Zellen, weil Wasser von einem Sandstreifen
   * umgeben ist. Jetzt zaehlt auch Sand und der Saum ist breiter.
   */
  if ((c === SURFACE_CELL.DIRT || c === SURFACE_CELL.SAND)
      && colony.knownMaterials.has('clay')
      && (colony.stores.clay || 0) < BUILD.MATERIAL_CAP
      && rng.chance(BUILD.CLAY_CHANCE)) {
    const R = BUILD.CLAY_RADIUS;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (level.get(x + dx, y + dy) === SURFACE_CELL.WATER) return 'clay';
      }
    }
    return null;
  }
  /**
   * Kalk wird aus Stein geschlagen. Stein ist unpassierbar, also steht die
   * Ameise DANEBEN und schlaegt hinein – deshalb wird die Nachbarschaft
   * geprueft und nicht die Zelle selbst.
   */
  if (colony.knownMaterials.has('lime')
      && (colony.stores.lime || 0) < BUILD.MATERIAL_CAP
      && rng.chance(BUILD.LIME_CHANCE)) {
    if (level.get(x - 1, y) === SURFACE_CELL.STONE
        || level.get(x + 1, y) === SURFACE_CELL.STONE
        || level.get(x, y - 1) === SURFACE_CELL.STONE
        || level.get(x, y + 1) === SURFACE_CELL.STONE) return 'lime';
  }
  return null;
}

/** Abstand, in dem ein Hilfstrupp vor dem fremden Tor haelt (Zellen). */
const DIPLO_AID_HOLD = 7;

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
    /**
     * Individuelle Hungertoleranz. Ohne sie steigt der Hunger bei allen
     * Ameisen einer Kolonie exakt gleich schnell – und ein Volk, das in
     * Unterdeckung geraet, stirbt nicht allmaehlich, sondern innerhalb
     * weniger Sekunden komplett. Mit Streuung schrumpft es stattdessen.
     */
    this.hungerTol = new Float32Array(capacity);
    /** Bis zu zwei Eigenschaften je Ameise (0 = keine), siehe traits.js. */
    this.trait1 = new Uint8Array(capacity);
    this.trait2 = new Uint8Array(capacity);
    /** Verhaltensschalter der Eigenschaften als Bitmaske. */
    this.traitBits = new Uint32Array(capacity);
    /** Fluchtschwelle als Anteil der Trefferpunkte (aus den Eigenschaften). */
    this.courage = new Float32Array(capacity);
    /** Arbeitsleistung beim Graben und Bauen (aus den Eigenschaften). */
    this.workMul = new Float32Array(capacity);
    /** Tragfaehigkeit je Fuhre (aus den Eigenschaften). */
    this.carryMul = new Float32Array(capacity);
    /** Restticks einer Giftwirkung. */
    this.poison = new Uint16Array(capacity);
    /** Zellindizes bewachter Blattlauskolonien (in rebuildBuckets gefuellt). */
    this.guarded = new Set();
    this.senseMul = new Float32Array(capacity);
    this.trailMul = new Float32Array(capacity);
    this.nurseMul = new Float32Array(capacity);
    this.damageMul = new Float32Array(capacity);
    this.buildMul = new Float32Array(capacity);
    this.loyalty = new Float32Array(capacity);
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
    /** Kolonie, gegen die sich ein Raubzug richtet (-1 = keiner). */
    this.raidTarget = new Int16Array(capacity).fill(-1);
    /** Index der getragenen Brut (-1 = keine). */
    this.carryRef = new Int32Array(capacity).fill(-1);

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
    this.hungerTol[i] = NUTRITION.HUNGER_TOL_MIN
      + (opts.hungerTol !== undefined ? opts.hungerTol : 0.5)
      * (NUTRITION.HUNGER_TOL_MAX - NUTRITION.HUNGER_TOL_MIN);
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
    this.raidTarget[i] = -1;
    this.carryRef[i] = -1;
    this.anim[i] = 0;

    /**
     * Eigenschaften ZULETZT, damit sie auf die fertigen Grundwerte wirken
     * und nicht von der Grundinitialisierung ueberschrieben werden.
     * Zahlenwirkungen werden hier einmalig eingerechnet; Verhalten steckt
     * in der Bitmaske und wird im Tick abgefragt.
     */
    const t1 = opts.trait1 || 0, t2 = opts.trait2 || 0;
    this.trait1[i] = t1;
    this.trait2[i] = t2;
    this.poison[i] = 0;
    if (t1 || t2) {
      const eff = antEffects(t1, t2);
      this.traitBits[i] = eff.bits;
      this.courage[i] = eff.courage;
      this.workMul[i] = eff.dig;
      this.carryMul[i] = eff.carry;
      this.senseMul[i] = eff.sense;
      this.trailMul[i] = eff.trail;
      this.nurseMul[i] = eff.nurse;
      this.loyalty[i] = eff.loyalty;
      this.speed[i] *= eff.speed;
      this.hp[i] *= eff.hp;
      this.hpMax[i] = this.hp[i];
      this.phenoSize[i] *= eff.size;
      this.phenoLife[i] *= eff.life;
      this.hungerTol[i] *= eff.hungerTol;
      this.damageMul[i] = eff.damage;
      this.buildMul[i] = eff.build;
    } else {
      this.traitBits[i] = 0;
      this.courage[i] = TRAIT_CFG.BASE_COURAGE;
      this.workMul[i] = 1;
      this.carryMul[i] = 1;
      this.senseMul[i] = 1;
      this.trailMul[i] = 1;
      this.nurseMul[i] = 1;
      this.loyalty[i] = 0;
      this.damageMul[i] = 1;
      this.buildMul[i] = 1;
    }

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
    this.guarded.clear();
    const surfaceId = levelManager.surface ? levelManager.surface.id : -1;
    const sw = levelManager.surface ? levelManager.surface.w : 1;

    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i]) continue;
      const lv = this.level[i];
      const b = this.buckets.get(lv);
      if (b) b.ids[b.count++] = i;
      if (colonyManager) {
        const c = colonyManager.get(this.colony[i]);
        if (c) c.countAnt(this.caste[i], lv, this.state[i]);
      }
      /**
       * Bewachte Blattlauszellen mitfuehren. Das laeuft hier mit, weil
       * diese Schleife ohnehin jeden Tick ueber alle Ameisen geht – so
       * kostet es nichts extra und der Stand ist nie veraltet. Gespeichert
       * werden muss er nicht: er steckt in den Zustaenden der Ameisen.
       */
      if (lv === surfaceId && this.state[i] === ANT_STATE.GUARD && this.targetX[i] >= 0) {
        this.guarded.add(this.targetY[i] * sw + this.targetX[i]);
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
          const tol = this.hungerTol[i] * this.phenoSize[i];
          if (this.hunger[i] >= tol) { this._die(i, level, ctx, 'Hunger'); continue; }
        } else if (this.hunger[i] > 0) {
          this.hunger[i] = Math.max(0, this.hunger[i] - NUTRITION.HUNGER_RATE * 3);
        }
      }
      // ---- Gift wirkt nach -----------------------------------------------
      if (this.poison[i] > 0) {
        this.poison[i]--;
        this.hp[i] -= TRAIT_CFG.POISON_DAMAGE;
        if (this.hp[i] <= 0) { this._die(i, level, ctx, 'Gift'); continue; }
      }

      let slow = this.hunger[i] > NUTRITION.HUNGER_SLOW ? 0.55 : 1;
      /**
       * Eigener Tagesrhythmus. Nachtaktive Ameisen arbeiten im Dunkeln
       * ohne Einbussen und tagsueber traege, Sonnenkinder umgekehrt. Das
       * gilt UEBERALL, auch im Nest – der Rhythmus steckt im Tier, nicht
       * im Licht, das dort unten ohnehin fehlt.
       */
      const bits = this.traitBits[i];
      if (bits & (FLAG.NACHTAKTIV | FLAG.TAGAKTIV)) {
        const light = ctx.light !== undefined ? ctx.light : 1;
        const day = light > 0.7;
        const matches = (bits & FLAG.NACHTAKTIV) ? !day : day;
        slow *= matches ? TRAIT_CFG.RHYTHM_BONUS : TRAIT_CFG.RHYTHM_MALUS;
      }
      if (colony) {
        // Seuche zehrt und steckt Nachbarinnen an
        if (colony.plague > 0) {
          this.hp[i] -= GODMODE.PLAGUE_DAMAGE;
          if (this.hp[i] <= 0) { this._die(i, level, ctx, 'Seuche'); continue; }
        }
        if (colony.frenzy > 0) slow *= GODMODE.FRENZY_SPEED;
      }
      /**
       * Nachts wird oberirdisch langsamer gesammelt. Unter der Erde aendert
       * sich nichts – dort ist es ohnehin immer dunkel.
       */
      if (!isNest && ctx.light !== undefined && ctx.light < 1) {
        slow *= 1 - (1 - DAYNIGHT.ANT_NIGHT_SPEED) * (1 - ctx.light)
          / (1 - DAYNIGHT.NIGHT_LIGHT);
      }

      // ---- Im Wasser? Ertrinken droht ------------------------------------
      const hereCell = level.cells[(this.y[i] | 0) * level.w + (this.x[i] | 0)];
      if (hereCell === WATER_CELL[level.kind]) {
        this.hp[i] -= GODMODE.FLOOD_DAMAGE;
        if (this.hp[i] <= 0) { this._die(i, level, ctx, 'Ertrunken'); continue; }
        // Verzweifelt auf trockenes Land: eine Zelle in eine freie Richtung
        for (let t = 0; t < 4; t++) {
          const a = rng.angle();
          const nx = (this.x[i] + Math.cos(a) * 1.4) | 0;
          const ny = (this.y[i] + Math.sin(a) * 1.4) | 0;
          if (!level.isSolid(nx, ny)) {
            this.x[i] = nx + 0.5; this.y[i] = ny + 0.5;
            this.px[i] = this.x[i]; this.py[i] = this.y[i];
            break;
          }
        }
        this.anim[i] += 0.3;
        continue;
      }

      // ---- Verschuettet? Dann freigraben ---------------------------------
      // Nach einem Einsturz steckt die Ameise in einer soliden Zelle. Sie
      // kann sich befreien – das dauert, kostet aber kein Leben.
      if (isNest && level.isSolid(this.x[i] | 0, this.y[i] | 0)) {
        if (this.stuck[i] === 0) this.stuck[i] = STABILITY.BURY_TICKS;
        this.stuck[i]--;
        this.anim[i] += 0.3;
        if (this.stuck[i] === 0) {
          const bx = this.x[i] | 0, by = this.y[i] | 0;
          const bc = level.cells[by * level.w + bx];
          if (bc !== NEST_CELL.STONE && bc !== NEST_CELL.WATER) {
            level.set(bx, by, NEST_CELL.TUNNEL);
            level.setMeta(bx, by, 0);
            if (ctx.world.stability) ctx.world.stability.request(level, bx, by, 4);
          }
        }
        continue;
      }

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

      /**
       * Mut entscheidet, wann geflohen wird. Ohne Eigenschaft liegt die
       * Schwelle bei TRAIT_CFG.BASE_COURAGE der Trefferpunkte; tollkuehne
       * Ameisen fliehen nie, feige schon bei halber Kraft.
       */
      if (this.state[i] !== ANT_STATE.FLEE && !(bits & FLAG.KEINE_FLUCHT)
          && this.hp[i] < this.hpMax[i] * (0.55 - this.courage[i])) {
        this.state[i] = ANT_STATE.FLEE;
        this.timer[i] = 120;
      }

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
      /**
       * MATERIAL HOLEN. Die Kolonie nennt eine Fundstelle (structures
       * .updateWants); diese Ameise laeuft gezielt hin. Unterwegs nimmt sie
       * Nahrung trotzdem mit – ein Umweg ist kein Grund, an einem
       * Zuckerwuerfel vorbeizulaufen.
       */
      /**
       * WACHE AN DEN BLATTLAEUSEN. Die Ameise bleibt in Reichweite ihrer
       * Quelle, meldet Feinde und melkt nebenbei. Ist die Quelle erschoepft
       * oder die Zeit um, geht sie wieder sammeln.
       */
      case ANT_STATE.GUARD: {
        const gx = this.targetX[i], gy = this.targetY[i];
        if (this.timer[i] === 0 || gx < 0
            || level.cells[gy * level.w + gx] !== SURFACE_CELL.APHIDS) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(120, 600);
          this.targetX[i] = -1;
          break;
        }
        if (colony) colony.guards++;
        const dx = gx + 0.5 - this.x[i], dy = gy + 0.5 - this.y[i];
        const d2 = dx * dx + dy * dy;
        if (d2 > LIFE.GUARD_RADIUS * LIFE.GUARD_RADIUS) {
          this.dir[i] += angleDelta(this.dir[i], Math.atan2(dy, dx)) * 0.4;
        } else {
          /**
           * Die Wache ERNTET NICHT. Ein erster Anlauf liess sie nebenbei
           * melken – und weil das Abliefern sie heimschickte, war der
           * Posten nach durchschnittlich fuenfzig Ticks wieder verwaist.
           * Sie steht, haelt Weidegaenger fern und ruft ueber die Spur
           * Sammlerinnen herbei; geerntet wird von denen.
           */
          this.dir[i] += rng.range(-0.5, 0.5);
        }
        // Wachen legen eine kraeftige Heimspur, damit Nachschub kommt
        if (phero) phero.deposit(cid, PH.FOOD, cx, cy, PHERO.DEPOSIT.FOOD * 0.8,
          dominantNutrient(SURFACE_CELL.APHIDS));
        break;
      }

      /**
       * BEISTAND. Diese Ameise ist auf dem Weg zu einem bedraengten
       * Verbuendeten. Sie laeuft zu dessen Eingang und geht hinein; drinnen
       * kaempft sie ueber die normale Nahkampfregel mit, weil der Gegner
       * dort weder ihr eigenes Volk noch ein Verbuendeter ist.
       */
      case ANT_STATE.AID: {
        if (this.timer[i] === 0 || this.targetX[i] < 0) {
          this.state[i] = ANT_STATE.RETURN;
          this.timer[i] = 1800;
          this.targetX[i] = -1;
          break;
        }
        const ax = this.targetX[i] + 0.5, ay = this.targetY[i] + 0.5;
        const adx = ax - this.x[i], ady = ay - this.y[i];
        const ad2 = adx * adx + ady * ady;
        if (ad2 > DIPLO_AID_HOLD * DIPLO_AID_HOLD) {
          this.dir[i] += angleDelta(this.dir[i], Math.atan2(ady, adx)) * 0.35
            + rng.range(-0.1, 0.1);
        } else {
          // Angekommen: vor dem Tor patrouillieren und alles abfangen
          this.dir[i] += rng.range(-0.6, 0.6);
          if (phero) phero.deposit(cid, PH.ALARM, cx, cy, PHERO.DEPOSIT.ALARM * 0.4);
        }
        break;
      }

      case ANT_STATE.FETCH: {
        if (this.carryType[i] !== CARRY.NONE || !colony || !colony.materialSpot
            || this.timer[i] === 0) {
          this.state[i] = this.carryType[i] === CARRY.NONE
            ? ANT_STATE.EXPLORE : ANT_STATE.RETURN;
          this.timer[i] = rng.intRange(120, 600);
          break;
        }
        /**
         * Am Ziel: aufnehmen, was dort liegt. Kiesel und Harz laufen ueber
         * die vorhandenen Tragearten, alles Neue ueber CARRY.MATERIAL.
         */
        const under2 = level.cells[cy * level.w + cx];
        if (colony.wantMaterial === 'pebble' && under2 === SURFACE_CELL.PEBBLE) {
          level.set(cx, cy, SURFACE_CELL.DIRT);
          this.carryType[i] = CARRY.PEBBLE;
          this.carryAmount[i] = FORTIFY.PEBBLE_PER_CELL;
          this.trip[i] = 0;
          this._beginReturn(level, i, ctx);
          break;
        }
        if (colony.wantMaterial === 'resin' && under2 === SURFACE_CELL.PLANT
            && rng.chance(0.25)) {
          this.carryType[i] = CARRY.RESIN;
          this.carryAmount[i] = FORTIFY.RESIN_PER_HARVEST;
          this.trip[i] = 0;
          this._beginReturn(level, i, ctx);
          break;
        }
        const mat = materialUnder(level, cx, cy, colony, rng);
        if (mat) {
          this.carryType[i] = CARRY.MATERIAL;
          this.carryAmount[i] = BUILD.YIELD[mat] || 2;
          this.carrySource[i] = MATERIAL_ID[mat];
          if (mat === 'clay') level.set(cx, cy, SURFACE_CELL.SAND);
          this.trip[i] = 0;
          this._beginReturn(level, i, ctx);
          break;
        }
        const sx = colony.materialSpot.x + 0.5, sy = colony.materialSpot.y + 0.5;
        const sdx = sx - this.x[i], sdy = sy - this.y[i];
        if (sdx * sdx + sdy * sdy < 9) {
          // Am Ziel, aber nichts gefunden: im Umkreis suchen
          this.dir[i] += rng.range(-1.2, 1.2);
        } else {
          this.dir[i] += angleDelta(this.dir[i], Math.atan2(sdy, sdx)) * 0.3
            + rng.range(-0.12, 0.12);
        }
        break;
      }

      case ANT_STATE.EXPLORE: {
        // Nahrung unter den Fuessen?
        if (this.carryType[i] === CARRY.NONE && ctx.food) {
          const cell = level.cells[cy * level.w + cx];
          /**
           * BLATTLAEUSE BEWACHEN. Wer eine ergiebige Blattlauskolonie
           * findet, bleibt mit einer gewissen Wahrscheinlichkeit als Wache
           * dort – und zwar STATT zu ernten. Marienkaefer meiden bewachte
           * Blattlaeuse (siehe creatures.js _graze); damit bekommt der
           * Nahrungskonkurrent einen Gegenspieler.
           *
           * Die Pruefung gehoert vor die Aufnahme. Ein erster Anlauf liess
           * die Wache ihre volle Fuhre drei Minuten lang mit sich
           * herumtragen – der Zuckervorrat der Kolonie fiel dabei von 183
           * auf unter 10.
           */
          if (cell === SURFACE_CELL.APHIDS && colony
              && level.meta[cy * level.w + cx] > LIFE.GUARD_MIN_AMOUNT
              && colony.guards < LIFE.GUARD_MAX
              && rng.chance(LIFE.GUARD_CHANCE)) {
            this.state[i] = ANT_STATE.GUARD;
            this.targetX[i] = cx;
            this.targetY[i] = cy;
            this.timer[i] = LIFE.GUARD_TICKS;
            if (phero) {
              phero.deposit(cid, PH.FOOD, cx, cy, PHERO.DEPOSIT.FOOD * 2.2,
                dominantNutrient(cell));
            }
            break;
          }
          if (isFoodCell(cell) && level.meta[cy * level.w + cx] > 0) {
            const got = ctx.food.take(level, cx, cy, FOOD.PICKUP * this.carryMul[i]);
            if (got > 0) {
              this.carryType[i] = CARRY.FOOD;
              this.carrySource[i] = cell;
              this.carryNutrient[i] = dominantNutrient(cell);
              this.carryAmount[i] = got;
              this.trip[i] = 0;                       // neue Spur ab hier
              // Fundstelle kraeftig markieren
              if (phero) {
                phero.deposit(cid, PH.FOOD, cx, cy, PHERO.DEPOSIT.FOOD * 2.2, this.carryNutrient[i]);
              }
              this._beginReturn(level, i, ctx);
              break;
            }
          }
        }
        /**
         * Kiesel aufsammeln, wenn Baumaterial fehlt. Die Grenze lag bei 40
         * – das reichte gerade fuer Befestigungen, und fuer ein Bauwerk
         * blieb nie etwas uebrig: der Vorrat stand dauerhaft bei null.
         */
        if (this.carryType[i] === CARRY.NONE && under === SURFACE_CELL.PEBBLE
            && colony && (colony.stores.pebble || 0) < FORTIFY.PEBBLE_STOCK) {
          level.set(cx, cy, SURFACE_CELL.DIRT);
          this.carryType[i] = CARRY.PEBBLE;
          this.carryAmount[i] = FORTIFY.PEBBLE_PER_CELL;
          this.trip[i] = 0;
          this._beginReturn(level, i, ctx);
          break;
        }

        // Harz an Pflanzen ernten (Baumaterial fuer Harzbarrieren)
        if (this.carryType[i] === CARRY.NONE && under === SURFACE_CELL.PLANT
            && colony && (colony.stores.resin || 0) < 60 && rng.chance(0.10)) {
          this.carryType[i] = CARRY.RESIN;
          this.carryAmount[i] = FORTIFY.RESIN_PER_HARVEST;
          this.trip[i] = 0;
          this._beginReturn(level, i, ctx);
          break;
        }

        /**
         * Neue Materialien (Phase 11). Sie werden nur gesammelt, wenn die
         * Kolonie sie ueberhaupt kennt – erforscht wird ueber den
         * Forschungsbaum. Vorher laeuft eine Ameise an Lehm vorbei, ohne
         * zu wissen, was sie damit soll.
         */
        if (this.carryType[i] === CARRY.NONE && colony && colony.knownMaterials) {
          const mat = materialUnder(level, cx, cy, colony, rng);
          if (mat) {
            this.carryType[i] = CARRY.MATERIAL;
            this.carryAmount[i] = BUILD.YIELD[mat] || 2;
            this.carrySource[i] = MATERIAL_ID[mat];
            // Lehmabbau hinterlaesst Sand; Kalk laesst den Stein stehen
            if (mat === 'clay') level.set(cx, cy, SURFACE_CELL.SAND);
            this.trip[i] = 0;
            this._beginReturn(level, i, ctx);
            break;
          }
        }

        /**
         * Material holen, wenn die Kolonie etwas braucht. Nur ein kleiner
         * Teil der Sammlerinnen – sonst steht die Nahrungsversorgung still.
         */
        if (this.carryType[i] === CARRY.NONE && colony && colony.materialSpot
            && rng.chance(BUILD.FETCH_SHARE * 0.02)) {
          this.state[i] = ANT_STATE.FETCH;
          this.timer[i] = BUILD.JOB_TIMEOUT;
          break;
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

      case ANT_STATE.RAID: {
        // Zum fremden Eingang marschieren
        const tx = this.targetX[i], ty = this.targetY[i];
        if (tx < 0 || this.timer[i] === 0) { this._abortRaid(level, i, ctx); break; }
        const want = Math.atan2(ty + 0.5 - this.y[i], tx + 0.5 - this.x[i]);
        this.dir[i] += angleDelta(this.dir[i], want) * 0.3 + rng.range(-0.1, 0.1);
        break;
      }

      case ANT_STATE.LOOT: {
        // Mit Beute heim: zum eigenen Eingang
        if (this.targetX[i] < 0) {
          const p = ctx.portals.nearest(level.id, cid, this.x[i], this.y[i]);
          if (p) { const pos = p.on(level.id); this.targetX[i] = pos.x; this.targetY[i] = pos.y; }
        }
        const lx = this.targetX[i], ly = this.targetY[i];
        if (lx >= 0) {
          const want = Math.atan2(ly + 0.5 - this.y[i], lx + 0.5 - this.x[i]);
          this.dir[i] += angleDelta(this.dir[i], want) * 0.35 + rng.range(-0.08, 0.08);
        } else {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        break;
      }

      case ANT_STATE.ATTACK:
      case ANT_STATE.DEFEND:
        // Richtung setzt combat.js; hier nur leichtes Zittern
        this.dir[i] += rng.range(-0.06, 0.06);
        break;

      case ANT_STATE.FLEE:
        if (this.timer[i] === 0) { this.state[i] = ANT_STATE.RETURN; this._beginReturn(level, i, ctx); }
        break;

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
    /**
     * Spurentreue und Eigensinn: die Schwelle, ab der eine Spur ueberhaupt
     * wahrgenommen wird, haengt am Charakter. Eine eigensinnige Ameise
     * uebersieht schwache Spuren und sucht lieber selbst.
     */
    const thr = 3 / (this.trailMul[i] || 1);
    if (f < thr && l < thr && r < thr) return false;
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
    /**
     * Im Nest eines VERBUENDETEN gibt es nichts zu arbeiten – nur zu
     * kaempfen. Ist die Luft rein, geht die Helferin wieder heim; ohne
     * diese Regel bliebe sie dort und fehlte dem eigenen Volk.
     */
    if (level.colonyId >= 0 && level.colonyId !== this.colony[i]
        && this.state[i] !== ANT_STATE.TRANSIT) {
      const host = ctx.colonies.get(level.colonyId);
      if (host && ctx.diplomacy.allied(this.colony[i], host.id)) {
        // Gaeste haben im fremden Nest nichts verloren – zurueck zum Tor
        this.state[i] = ANT_STATE.RETURN;
        if (this.timer[i] === 0) this.timer[i] = 2400;
        if (!fields || !this._steerField(level, i, fields.entrance, rng)) {
          this.dir[i] += rng.range(-0.4, 0.4);
        }
        return;
      }
    }

    switch (this.state[i]) {
      case ANT_STATE.DELIVER: {
        const carried = this.carryType[i];
        if (carried !== CARRY.FOOD && carried !== CARRY.PEBBLE
            && carried !== CARRY.RESIN && carried !== CARRY.BROOD
            && carried !== CARRY.MATERIAL) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(30, 120);
          break;
        }
        const f = fields ? fields.store : null;
        const here = f ? f.at(this.x[i] | 0, this.y[i] | 0) : 9999;
        if (here === 0 || this.timer[i] === 0) {
          // Angekommen (oder aufgegeben): einlagern
          if (colony) {
            if (carried === CARRY.FOOD) {
              const key = FOOD_OF_CELL[this.carrySource[i]];
              const prof = key ? FOOD.PROFILES[key].n : [0.34, 0.33, 0.33];
              storeFood(colony, this.carryNutrient[i], this.carryAmount[i], prof);
            } else if (carried === CARRY.BROOD) {
              // Erbeutete Brut ist reines Protein
              colony.storeArr[NUTRIENT.PROTEIN] = Math.min(colony.capacity[NUTRIENT.PROTEIN],
                colony.storeArr[NUTRIENT.PROTEIN] + this.carryAmount[i]);
              colony.intakeAcc[NUTRIENT.PROTEIN] += this.carryAmount[i];
              colony.looted = (colony.looted || 0) + 1;
            } else if (carried === CARRY.PEBBLE) {
              colony.stores.pebble = (colony.stores.pebble || 0) + this.carryAmount[i];
            } else if (carried === CARRY.MATERIAL) {
              const key = MATERIAL_NAME[this.carrySource[i]];
              if (key) {
                colony.stores[key] = Math.min(BUILD.MATERIAL_CAP,
                  (colony.stores[key] || 0) + this.carryAmount[i]);
              }
            } else {
              colony.stores.resin = (colony.stores.resin || 0) + this.carryAmount[i];
            }
            colony.deliveries = (colony.deliveries || 0) + 1;
          }
          this.carryType[i] = CARRY.NONE;
          this.carryAmount[i] = 0;
          this.carryRef[i] = -1;
          this.raidTarget[i] = -1;
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
          const want = 0.5 * this.nurseMul[i];
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

      /**
       * BAUEN AN EINEM BAUWERK. Anders als beim Graben gibt es hier eine
       * feste Stelle mit einem Aufwandszaehler; steht die Ameise nah genug,
       * traegt sie ihre Arbeitsleistung bei.
       */
      case ANT_STATE.BUILD: {
        const q = colony ? colony.pendingBuild : null;
        if (!q || !q.length || this.timer[i] === 0) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(ANTS.NEST_STAY_MIN, ANTS.NEST_STAY_MAX);
          break;
        }
        const job = q[0];
        if (job.levelId !== level.id) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(30, 120);
          break;
        }
        const bx = job.x + 0.5, by = job.y + 0.5;
        const bdx = bx - this.x[i], bdy = by - this.y[i];
        if (bdx * bdx + bdy * bdy <= DIG.REACH * DIG.REACH) {
          this.dir[i] = Math.atan2(bdy, bdx);
          this.anim[i] += 0.3;
          const rate = DIG.RATE_PER_ANT * this.buildMul[i]
            * (colony.genome ? 0.6 + colony.genome.bautrieb : 1);
          const r = ctx.structures.contribute(colony, rate);
          if (r !== 0) {
            // 1 = fertig, -1 = Material fehlt. Beides beendet den Auftrag
            // fuer diese Ameise; sie geht wieder sammeln.
            if (r > 0) {
              colony.builtTotal = (colony.builtTotal || 0) + 1;
              colony.research += BUILD.POINTS_PER_BUILD * 10;
            }
            this.state[i] = ANT_STATE.EXPLORE;
            this.timer[i] = rng.intRange(30, 120);
          }
        } else if (!fields || !this._steerField(level, i, fields.dig, rng)) {
          this.dir[i] += angleDelta(this.dir[i], Math.atan2(bdy, bdx)) * 0.35;
        }
        break;
      }

      case ANT_STATE.DIG: {
        // Jede Nest-Ebene hat ihre eigene Baustelle, siehe construction.js.
        const dig = colony ? ctx.construction.peek(colony, level.id) : undefined;
        if (!dig || this.timer[i] === 0 || (dig.active < 0 && dig.descend < 0)) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(ANTS.NEST_STAY_MIN, ANTS.NEST_STAY_MAX);
          break;
        }
        /**
         * Hier gibt es nichts zu graben, aber ein Stockwerk tiefer schon:
         * zum Schacht laufen. Das Grabfeld zeigt bereits dorthin, den
         * Uebertritt macht _tryEnter beim Betreten der Portalzelle.
         */
        if (dig.active < 0) {
          if (!fields || !this._steerField(level, i, fields.dig, rng)) {
            this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
          }
          break;
        }
        const tx = (dig.active % level.w) + 0.5;
        const ty = ((dig.active / level.w) | 0) + 0.5;
        const dx = tx - this.x[i], dy = ty - this.y[i];
        if (dx * dx + dy * dy <= DIG.REACH * DIG.REACH) {
          this.dir[i] = Math.atan2(dy, dx);
          this.anim[i] += 0.35;
          // Gen der Kolonie mal Charakter der einzelnen Ameise
          const isBuild = dig.target[0];
          const rate = DIG.RATE_PER_ANT
            * (colony.genome ? 0.6 + colony.genome.grabgeschwindigkeit : 1)
            * (isBuild ? this.buildMul[i] : this.workMul[i]);
          const done = ctx.construction.contribute(colony, level, rate);
          if (done >= 0) {
            /**
             * Tiefe Erde ist feucht und gibt Lehm. Ohne diese Quelle
             * haengt der ganze Bauzweig auf trockenen Karten (Steppe) in
             * der Luft: dort gibt es kein Wasser und damit keinen Lehmsaum.
             */
            if (dig.lastDugType === NEST_CELL.SOIL
                && colony.knownMaterials && colony.knownMaterials.has('clay')
                && (colony.stores.clay || 0) < BUILD.MATERIAL_CAP
                && ty > BUILD.CLAY_DEPTH && rng.chance(BUILD.CLAY_DIG_CHANCE)) {
              this.carryType[i] = CARRY.MATERIAL;
              this.carryAmount[i] = BUILD.YIELD.clay;
              this.carrySource[i] = MATERIAL_ID.clay;
              this.state[i] = ANT_STATE.DELIVER;
              this.timer[i] = 1200;
              break;
            }
            if (dig.lastDugType === NEST_CELL.PEBBLE) {
              // Kiesel ist Baumaterial und geht in die Vorratskammer
              this.carryType[i] = CARRY.PEBBLE;
              this.carryAmount[i] = FORTIFY.PEBBLE_PER_CELL;
              this.state[i] = ANT_STATE.DELIVER;
              this.timer[i] = 1200;
            } else {
              this.carryType[i] = CARRY.SOIL;
              this.carryAmount[i] = 1;
              this._beginReturn(level, i, ctx);
            }
          }
          return;   // graben statt laufen
        }
        if (!fields || !this._steerField(level, i, fields.dig, rng)) {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        break;
      }

      case ANT_STATE.RAID: {
        if (this.timer[i] === 0) { this._abortRaid(level, i, ctx); break; }
        /**
         * Ist beim Gegner nichts mehr zu holen, geht es heim. Ohne das
         * standen nach dem Sieg vierzig Raeuberinnen noch zweitausend
         * Sekunden lang im leeren Nest herum, waehrend zu Hause die
         * Sammlerinnen fehlten.
         */
        if (this.raidTarget[i] >= 0) {
          const feind = ctx.colonies.get(this.raidTarget[i]);
          if (!feind || !feind.alive) { this._abortRaid(level, i, ctx); break; }
        }
        // Im EIGENEN Nest zuerst hinaus – sonst sucht die Raeuberin im
        // eigenen Bau nach Beute und der Raubzug kommt nie los.
        if (level.colonyId === this.colony[i]) {
          if (!fields || !this._steerField(level, i, fields.entrance, rng)) {
            this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
          }
          break;
        }
        // Im fremden Nest gibt es keine Distanzfelder – hier wird gesucht.
        if ((i + ctx.tick) % 12 === 0 && ctx.combat
            && ctx.combat.tryLoot(this, i, level, ctx)) {
          this.targetX[i] = -1;
          break;
        }
        // Tiefer ins Nest: nach unten und in die Breite tasten
        this.dir[i] += rng.range(-0.5, 0.5);
        if (rng.chance(0.08)) this.dir[i] = Math.PI / 2 + rng.range(-1.1, 1.1);
        break;
      }

      case ANT_STATE.LOOT: {
        // Mit Beute hinaus: irgendein Portal dieser Ebene
        const p = ctx.portals.nearest(level.id, level.colonyId, this.x[i], this.y[i]);
        if (p) {
          const pos = p.on(level.id);
          this.targetX[i] = pos.x;
          this.targetY[i] = pos.y;
          const want = Math.atan2(pos.y + 0.5 - this.y[i], pos.x + 0.5 - this.x[i]);
          this.dir[i] += angleDelta(this.dir[i], want) * 0.35;
        } else {
          this.dir[i] += rng.range(-0.5, 0.5);
        }
        break;
      }

      case ANT_STATE.EVACUATE: {
        // Brut in die Fluchtkammer tragen; die Koenigin flieht selbst
        if (colony && colony.threat < 3 && this.carryType[i] !== CARRY.BROOD) {
          this.state[i] = ANT_STATE.EXPLORE;
          this.timer[i] = rng.intRange(60, 240);
          break;
        }
        const ef = fields ? fields.escape : null;
        if (this.carryType[i] === CARRY.BROOD) {
          if (ef && ef.at(this.x[i] | 0, this.y[i] | 0) === 0) {
            // Angekommen: ablegen
            const bi = this.carryRef[i];
            if (bi >= 0 && ctx.brood.alive[bi]) ctx.brood.carrier[bi] = -1;
            this.carryType[i] = CARRY.NONE;
            this.carryRef[i] = -1;
            this.state[i] = ANT_STATE.EXPLORE;
            this.timer[i] = 60;
            break;
          }
          if (!ef || !this._steerField(level, i, ef, rng)) {
            this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
          }
          break;
        }
        // Noch nichts im Arm: Brut suchen
        if (ctx.brood && (i + ctx.tick) % 9 === 0) {
          const bi = ctx.brood.findLoose(this.colony[i], level.id, this.x[i], this.y[i], 8);
          if (bi >= 0) {
            ctx.brood.carrier[bi] = i;
            this.carryType[i] = CARRY.BROOD;
            this.carryRef[i] = bi;
            break;
          }
        }
        if (!fields || !this._steerField(level, i, fields.brood, rng)) {
          this.dir[i] += rng.range(-ANTS.WANDER_TURN, ANTS.WANDER_TURN);
        }
        break;
      }

      case ANT_STATE.ATTACK:
      case ANT_STATE.DEFEND:
        this.dir[i] += rng.range(-0.06, 0.06);
        break;

      case ANT_STATE.FLEE:
        if (this.timer[i] === 0) { this.state[i] = ANT_STATE.EXPLORE; this.timer[i] = 120; }
        break;

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
          /**
           * Ein offener Bauwerksauftrag hat Vorrang vor dem Graben: er ist
           * teuer, aber er bringt dem Volk etwas, das es sonst nicht hat
           * (Geschuetz, Speicher, Werkstatt).
           */
          if (colony.pendingBuild && colony.pendingBuild.length && !colony.starving
              && colony.builders < BUILD.MAX_BUILDERS && rng.chance(digChance * 0.5)) {
            this.state[i] = ANT_STATE.BUILD;
            this.timer[i] = BUILD.JOB_TIMEOUT;
            colony.builders++;
            break;
          }
          const digHere = ctx.construction.peek(colony, level.id);
          const digsHere = colony.diggersByLevel.get(level.id) || 0;
          /**
           * Grabduft des Spielers hebt die Obergrenze an: je staerker
           * bemalt, desto mehr Ameisen gehen hin. Das ist der Unterschied
           * zwischen "da soll gegraben werden" und "DA soll gegraben
           * werden".
           */
          const scent = ctx.digScent ? ctx.digScent.total(level.id) : 0;
          const extra = scent > 0
            ? Math.min(DIGSCENT.MAX_EXTRA_DIGGERS, scent * DIGSCENT.DIGGERS_PER_POINT)
            : 0;
          if (digHere !== undefined && (digHere.active >= 0 || digHere.descend >= 0)
              && digsHere < Math.max(3, inNest * DIG.DIGGER_SHARE) + extra
              && rng.chance(digChance)) {
            this.state[i] = ANT_STATE.DIG;
            this.timer[i] = DIG.JOB_TIMEOUT;
            colony.diggers++;
            colony.diggersByLevel.set(level.id, digsHere + 1);
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

  /** Raubzug aufgeben: mit leeren Haenden heim. */
  _abortRaid(level, i, ctx) {
    this.raidTarget[i] = -1;
    this.targetX[i] = -1;
    this.state[i] = this.carryType[i] !== CARRY.NONE ? ANT_STATE.LOOT : ANT_STATE.RETURN;
    if (this.state[i] === ANT_STATE.RETURN) this._beginReturn(level, i, ctx);
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
    const st = this.state[i];
    const raider = st === ANT_STATE.RAID;
    const helper = st === ANT_STATE.AID;
    /**
     * Graeberinnen duerfen durch das EIGENE Tor – so besiedeln sie ein neu
     * geoeffnetes Stockwerk (siehe World.expandNest). Fremde Tore bleiben
     * ihnen verschlossen, sonst spazieren sie in Nachbarnester.
     */
    const digger = st === ANT_STATE.DIG && portal.colonyId === this.colony[i];
    const escapingNow = level.colonyId >= 0 && level.colonyId !== this.colony[i];
    if (st !== ANT_STATE.RETURN && st !== ANT_STATE.LOOT
        && !raider && !helper && !digger && !escapingNow) return;
    /**
     * Verbuendete duerfen durch fremde Tore – aber nur HINAUS, nicht
     * hinein. Zwei Befunde stecken dahinter:
     *
     * 1. Liess man sie nur hinein, sassen im Test dreiundsiebzig
     *    Helferinnen dauerhaft im Nest des Verbuendeten fest.
     * 2. Liess man sie hinein UND hinaus, wurde der Verbuendete dadurch
     *    SCHWAECHER statt staerker: im Gang teilt sich der Schaden auf
     *    alle Angreifer auf (Engstellenregel), und zusaetzliche
     *    befreundete Koerper verduennen die eigenen Treffer. B ueberlebte
     *    mit Hilfe schlechter als ohne (60 gegen 101 Ameisen).
     *
     * Deshalb halten Helferinnen DRAUSSEN vor dem Eingang, wo im offenen
     * Feld jeder Schlag voll zaehlt. Wer drinnen ist, darf heraus.
     */
    /**
     * HERAUS DARF IMMER, WER DRINNEN IST.
     *
     * canEnter fragt nur, ob jemand ein fremdes Tor benutzen darf – nicht,
     * in welche Richtung. Eine Raeuberin kam damit hinein, verlor beim
     * Sieg ihren Raubzug-Zustand und war fortan keine Raeuberin mehr:
     * gemessen sassen nach dem Untergang des Gegners einundfuenfzig Rote
     * dauerhaft in dessen leerem Nest. Wer auf einer fremden Ebene steht,
     * darf sie deshalb ausnahmslos wieder verlassen.
     */
    const escaping = level.colonyId >= 0 && level.colonyId !== this.colony[i];
    const ally = escaping || (st === ANT_STATE.RETURN
      && ctx.diplomacy.allied(this.colony[i], portal.colonyId));
    if (!ctx.portals.canEnter(portal, level.id, this.colony[i], raider, ally)) return;
    // Ein verschlossenes Tor aufzubrechen kostet Kraft.
    if (ctx.portals.isForcing(portal, this.colony[i], ally)) {
      this.hp[i] -= PORTALS.FORCE_DAMAGE;
      if (this.hp[i] <= 0) { this._die(i, level, ctx, 'Tor'); return; }
    }
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
    const wasRaiding = this.state[i] === ANT_STATE.RAID || this.raidTarget[i] >= 0;
    const arrivesInNest = destLevel && destLevel.kind === LEVEL_KIND.NEST;
    const foreignNest = arrivesInNest && destLevel.colonyId !== this.colony[i];
    this.state[i] = ANT_STATE.EXPLORE;
    if (wasRaiding && !arrivesInNest && this.raidTarget[i] >= 0
        && this.carryType[i] === CARRY.NONE) {
      // Aus dem eigenen Nest heraus: weiter zum Ziel des Raubzugs
      const target = ctx.portals.ofColony(this.raidTarget[i])[0];
      if (target) {
        const pos = target.on(destLevel.id);
        if (pos) {
          this.state[i] = ANT_STATE.RAID;
          this.targetX[i] = pos.x;
          this.targetY[i] = pos.y;
          this.timer[i] = 60000;
          this.transit[i] = 0;
          this.portalRef[i] = -1;
          this.portalCooldown[i] = PORTALS.REENTRY_COOLDOWN;
          ctx.portals.completed(portal);
          return;
        }
      }
      this.raidTarget[i] = -1;
    }
    if (wasRaiding && foreignNest) {
      this.state[i] = ANT_STATE.RAID;
      this.transit[i] = 0;
      this.portalRef[i] = -1;
      this.portalCooldown[i] = PORTALS.REENTRY_COOLDOWN;
      this.timer[i] = 60000;
      ctx.portals.completed(portal);
      return;
    }

    const toNest = arrivesInNest;
    this.trip[i] = 0;                       // neuer Spurabschnitt

    if (!toNest && this.carryType[i] === CARRY.SOIL) {
      // Aushub landet als Erdhuegel neben dem Eingang – der Huegel waechst
      // sichtbar mit dem Tunnelsystem.
      dumpSoil(destLevel, portal.ax, portal.ay, ctx.rng);
      this.carryType[i] = CARRY.NONE;
      this.carryAmount[i] = 0;
      this.timer[i] = ctx.rng.intRange(DIG.DUMP_STAY[0], DIG.DUMP_STAY[1]);
    } else if (toNest && (this.carryType[i] === CARRY.FOOD
        || this.carryType[i] === CARRY.PEBBLE || this.carryType[i] === CARRY.RESIN
        || this.carryType[i] === CARRY.BROOD || this.carryType[i] === CARRY.MATERIAL)) {
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
