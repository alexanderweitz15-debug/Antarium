/**
 * creatures.js – Raeuber und andere Kreaturen (Phase 7).
 *
 * Gleiches Prinzip wie die Ameisen: Structure of Arrays, Free-List, keine
 * Allokation im Tick. Jede Art hat eine sehr einfache eigene KI:
 *
 *   Fliege          – harmlos, schnell, frisst Pflanzliches, vermehrt sich stark
 *   Radnetzspinne   – baut Netze und wartet darin auf Beute
 *   Wolfsspinne     – jagt aktiv, geht auch durch Nesteingaenge
 *   Ameisenloewe    – graebt einen Trichter in Sand und lauert darin
 *   Laufkaefer      – jagt, frisst Blattlaeuse, graebt eigene Zugaenge ins Nest
 *
 * Kreaturen haben ein kleines eigenes Genom (Groesse, Tempo, Aggression),
 * das sich bei der Fortpflanzung veraendert – Raeuber entwickeln sich also
 * mit, ohne dass es dafuer ein Kolonie-Genom braeuchte.
 *
 * Raeuber-Beute-Zyklen entstehen aus Energie: Jagen bringt Energie, jeder
 * Tick kostet welche. Viel Beute -> Vermehrung -> zu viele Raeuber ->
 * Beutemangel -> Zusammenbruch.
 */

import { CREATURES, LIFE, PHERO } from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { SURFACE_CELL } from './surface.js';
import { ANT_STATE, CARRY } from './ants.js';
import { PH } from './pheromones.js';
import { casteDef } from './castes.js';
import { activityFor } from './daynight.js';
import { bus, CAT } from './events.js';

export const CSTATE = { WANDER: 0, HUNT: 1, FEED: 2, LURK: 3, FLEE: 4 };
export const CSTATE_LABEL = { 0: 'Streift umher', 1: 'Jagt', 2: 'Frisst', 3: 'Lauert', 4: 'Flieht' };

const SPECIES = CREATURES.SPECIES;
export const SPECIES_BY_KEY = new Map(SPECIES.map((s, i) => [s.key, { ...s, id: i }]));
export const SPECIES_LIST = SPECIES.map((s, i) => ({ ...s, id: i }));

/**
 * Nahrungszellen je Art, einmal aus den Schluesseln in CREATURES.SPECIES
 * aufgeloest. Ohne Angabe gilt der alte Standard der Fliege.
 */
const DEFAULT_EATS = [SURFACE_CELL.FLOWER, SURFACE_CELL.FRUIT,
  SURFACE_CELL.CARRION, SURFACE_CELL.APHIDS];
const EATS_BY_SPECIES = SPECIES.map((sp) => {
  if (sp.eats) return sp.eats.map((k) => SURFACE_CELL[k.toUpperCase()]).filter((v) => v !== undefined);
  // Pflanzenfresser ohne Angabe nehmen alles Essbare, Jaeger nichts.
  return sp.diet === 'plants' ? DEFAULT_EATS : [];
});
/** Schnelle Abfrage: frisst Art id diesen Zelltyp? */
const EATS_TABLE = SPECIES.map((sp, i) => {
  const t = new Uint8Array(64);
  for (const c of EATS_BY_SPECIES[i]) t[c] = 1;
  void sp;
  return t;
});

export class Creatures {
  constructor(capacity = CREATURES.MAX) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.species = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.dir = new Float32Array(capacity);
    this.hp = new Float32Array(capacity);
    this.hpMax = new Float32Array(capacity);
    this.energy = new Float32Array(capacity);
    this.age = new Uint32Array(capacity);
    this.maxAge = new Uint32Array(capacity);
    this.state = new Uint8Array(capacity);
    this.timer = new Uint16Array(capacity);
    /** Ticks bis zum naechsten Biss. */
    this.attackCd = new Uint8Array(capacity);
    this.target = new Int32Array(capacity).fill(-1);
    /** Heimatbau (Netz bzw. Trichter) als Zellindex, sonst -1. */
    this.home = new Int32Array(capacity).fill(-1);
    /** Eigene Gene: Groesse, Tempo, Aggression (0..1, Start 0.5). */
    this.gSize = new Float32Array(capacity);
    this.gSpeed = new Float32Array(capacity);
    this.gAggr = new Float32Array(capacity);
    this.anim = new Float32Array(capacity);
    this.generation = new Uint16Array(capacity);

    this.free = new Int32Array(capacity);
    this.freeCount = 0;
    this.high = 0;
    this.count = 0;
    /** @type {Map<number, {ids:Int32Array, count:number}>} */
    this.buckets = new Map();
    this._tmp = [];
  }

  registerLevel(levelId) {
    if (!this.buckets.has(levelId)) {
      this.buckets.set(levelId, { ids: new Int32Array(this.capacity), count: 0 });
    }
  }

  spawn(opts) {
    let i;
    if (this.freeCount > 0) i = this.free[--this.freeCount];
    else if (this.high < this.capacity) i = this.high++;
    else return -1;
    const sp = SPECIES[opts.speciesId];
    this.alive[i] = 1;
    this.species[i] = opts.speciesId;
    this.level[i] = opts.levelId;
    this.x[i] = opts.x;
    this.y[i] = opts.y;
    this.px[i] = opts.x;
    this.py[i] = opts.y;
    this.dir[i] = opts.dir !== undefined ? opts.dir : 0;
    this.gSize[i] = opts.gSize !== undefined ? opts.gSize : 0.5;
    this.gSpeed[i] = opts.gSpeed !== undefined ? opts.gSpeed : 0.5;
    this.gAggr[i] = opts.gAggr !== undefined ? opts.gAggr : 0.5;
    const sizeF = 0.6 + this.gSize[i] * 0.8;
    this.hpMax[i] = sp.hp * sizeF;
    this.hp[i] = this.hpMax[i];
    this.energy[i] = opts.energy !== undefined ? opts.energy : sp.energy * 0.6;
    this.age[i] = 0;
    this.maxAge[i] = sp.maxAge;
    this.state[i] = CSTATE.WANDER;
    this.timer[i] = 0;
    this.attackCd[i] = 0;
    this.target[i] = -1;
    this.home[i] = -1;
    this.anim[i] = 0;
    this.generation[i] = opts.generation || 1;
    this.count++;
    return i;
  }

  kill(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.free[this.freeCount++] = i;
    this.count--;
  }

  clear() {
    this.alive.fill(0);
    this.freeCount = 0;
    this.high = 0;
    this.count = 0;
    for (const b of this.buckets.values()) b.count = 0;
  }

  rebuildBuckets(levelManager) {
    for (const b of this.buckets.values()) b.count = 0;
    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i]) continue;
      const b = this.buckets.get(this.level[i]);
      if (b) b.ids[b.count++] = i;
    }
    for (const lvl of levelManager.levels) {
      const b = this.buckets.get(lvl.id);
      lvl.creatureCount = b ? b.count : 0;
    }
  }

  /** Artdefinition einer Kreatur. */
  speciesDef(i) { return SPECIES_LIST[this.species[i]]; }

  forEachOnLevel(levelId, cb) {
    const b = this.buckets.get(levelId);
    if (!b) return;
    for (let k = 0; k < b.count; k++) cb(b.ids[k]);
  }

  /** Naechste Kreatur zu (x,y) im Radius r auf einer Ebene, sonst -1. */
  pick(levelId, x, y, r) {
    const b = this.buckets.get(levelId);
    if (!b) return -1;
    let best = -1, bestD = r * r;
    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      const dx = this.x[i] - x, dy = this.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  update(level, ctx) {
    const b = this.buckets.get(level.id);
    if (!b) return;
    const rng = ctx.rng;
    const ants = ctx.ants;
    const isSurface = level.kind === LEVEL_KIND.SURFACE;
    const maxX = level.w - 0.25, maxY = level.h - 0.25;

    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      this.age[i]++;
      const sp = SPECIES[this.species[i]];
      if (this.timer[i] > 0) this.timer[i]--;
      if (this.attackCd[i] > 0) this.attackCd[i]--;
      /**
       * Gejagt wird nur bei Hunger. Dadurch regelt der Stoffwechsel die
       * Beutemenge: ein Raeuber toetet ungefaehr so oft, wie er zum Leben
       * braucht – das ist die Bremse, die Raeuber-Beute-Zyklen erst
       * ermoeglicht, statt dass eine Handvoll Spinnen ein ganzes Volk
       * aufreibt.
       */
      const hungry = this.energy[i] < sp.energy * CREATURES.HUNT_HUNGER;
      // Wer zur falschen Tageszeit unterwegs ist, jagt auch weniger
      const awake = level.kind !== LEVEL_KIND.SURFACE ? 1
        : activityFor(sp, ctx.light !== undefined ? ctx.light : 1);

      // --- Stoffwechsel --------------------------------------------------
      this.energy[i] -= sp.drain * (0.7 + this.gSpeed[i] * 0.6);
      if (this.energy[i] <= 0 || this.age[i] > this.maxAge[i] || this.hp[i] <= 0) {
        this._die(i, level, ctx);
        continue;
      }

      // --- Beute und Verteidiger in der Naehe ----------------------------
      let nearest = -1, nearestD = Infinity, swarm = 0;
      const sense = sp.sense * (0.7 + this.gSize[i] * 0.6);
      if (ants && sp.diet === 'ants') {
        const cx = this.x[i], cy = this.y[i];
        level.spatial.query(cx, cy, sense, (id) => {
          if (!ants.alive[id]) return;
          const dx = ants.x[id] - cx, dy = ants.y[id] - cy;
          const d = dx * dx + dy * dy;
          if (d < 9) swarm++;
          if (d < nearestD) { nearestD = d; nearest = id; }
        });
      }

      // --- Von Ameisen umschwaermt: Schaden nehmen und fliehen -----------
      if (swarm > 0) {
        const courage = CREATURES.SWARM_COURAGE;
        if (swarm >= courage) {
          this.hp[i] -= (swarm - courage + 1) * CREATURES.ANT_DAMAGE;
          if (this.hp[i] <= 0) { this._die(i, level, ctx, true); continue; }
          // Ab doppelter Schwelle wird es der Kreatur zu bunt
          if (swarm >= courage * 2 && nearest >= 0) {
            this.state[i] = CSTATE.FLEE;
            this.timer[i] = 120;
            this.dir[i] = Math.atan2(this.y[i] - ants.y[nearest], this.x[i] - ants.x[nearest]);
          }
        }
        // Ameisen in Reichweite zum Angriff aufrufen (Alarmpheromon)
        if (ctx.phero && isSurface && swarm >= 2) {
          const cid = ants.colony[nearest];
          ctx.phero.deposit(cid, PH.ALARM, this.x[i] | 0, this.y[i] | 0, PHERO.DEPOSIT.ALARM * 0.5);
        }
      }

      // --- Angriff --------------------------------------------------------
      if (nearest >= 0 && nearestD < 1.9 * 1.9 && sp.damage > 0 && hungry
          && this.attackCd[i] === 0 && this.state[i] !== CSTATE.FLEE) {
        const dmg = sp.damage * (0.6 + this.gSize[i] * 0.8) * CREATURES.BITE;
        ants.hp[nearest] -= dmg;
        this.attackCd[i] = CREATURES.ATTACK_COOLDOWN;
        this.anim[i] += 0.4;
        if (ants.hp[nearest] <= 0) {
          this.energy[i] = Math.min(sp.energy * 1.6,
            this.energy[i] + CREATURES.MEAL * casteDef(ants.caste[nearest]).size);
          const colony = ctx.colonies.get(ants.colony[nearest]);
          if (colony) {
            colony.stressEvents = (colony.stressEvents || 0) + 0.018;
            colony.lostToPredators = (colony.lostToPredators || 0) + 1;
          }
          if (ctx.food && isSurface) {
            ctx.food.dropCarrion(level, ants.x[nearest] | 0, ants.y[nearest] | 0,
              LIFE.CORPSE_FOOD * casteDef(ants.caste[nearest]).size * 0.4);
          }
          ants.kill(nearest);
          this.state[i] = CSTATE.FEED;
          this.timer[i] = CREATURES.FEED_TICKS;
          nearest = -1;
        }
      }

      // --- Verhalten je Art -----------------------------------------------
      let speedScale = 1;
      switch (this.state[i]) {
        case CSTATE.FLEE:
          speedScale = 1.5;
          if (this.timer[i] === 0) this.state[i] = CSTATE.WANDER;
          break;

        case CSTATE.FEED:
          speedScale = 0;
          if (this.timer[i] === 0) this.state[i] = CSTATE.WANDER;
          break;

        case CSTATE.HUNT:
          if (nearest < 0 || !hungry) {
            this.state[i] = (sp.funnel || sp.web || sp.ambush) ? CSTATE.LURK : CSTATE.WANDER;
            break;
          }
          this.dir[i] = Math.atan2(ants.y[nearest] - this.y[i], ants.x[nearest] - this.x[i]);
          break;

        case CSTATE.LURK:
          speedScale = 0.05;
          if (this.energy[i] < sp.energy * 0.25) {
            // Kein Erfolg an dieser Stelle: Bau aufgeben und weiterziehen
            this.state[i] = CSTATE.WANDER;
            this.home[i] = -1;
            break;
          }
          if (nearest >= 0 && nearestD < 5 * 5 && sp.ambush && hungry) {
            // Aus dem Stand zuschlagen: kurzer, schneller Ausfall
            this.dir[i] = Math.atan2(ants.y[nearest] - this.y[i], ants.x[nearest] - this.x[i]);
            speedScale = 2.2;
          }
          if (nearest >= 0 && nearestD < 6 * 6 && sp.web) {
            // Netzspinne rueckt nur im eigenen Netz vor
            this.dir[i] = Math.atan2(ants.y[nearest] - this.y[i], ants.x[nearest] - this.x[i]);
            speedScale = 0.5;
          }
          if (this.timer[i] === 0 && rng.chance(0.01)) this.state[i] = CSTATE.WANDER;
          break;

        default: {
          // WANDER: gelegentlich Richtung wechseln, Beute aufnehmen
          if (hungry && nearest >= 0 && rng.chance((0.08 + this.gAggr[i] * 0.2) * awake)) {
            this.state[i] = CSTATE.HUNT;
            break;
          }
          this.dir[i] += rng.range(-0.4, 0.4);
          // Hungrig wird gezielt gesucht – sonst verhungern Raeuber auf einer
          // 400x400-Karte, weil sie zufaellig nie an Beute vorbeikommen.
          if (hungry && ((ctx.tick + i) & 31) === 0) this._seek(i, level, ctx, sp);
          if (EATS_BY_SPECIES[this.species[i]].length > 0) {
            /**
             * Auf einer passenden Nahrungszelle wird getankt. Das gilt auch
             * fuer Jaeger mit Nebennahrung (Wespe an Fallobst, Laufkaefer an
             * Blattlaeusen) – ohne das verhungern die teuren Arten zwischen
             * zwei Beutetieren.
             */
            const tbl = EATS_TABLE[this.species[i]];
            const ci = (this.y[i] | 0) * level.w + (this.x[i] | 0);
            const c = level.cells[ci];
            if (c < tbl.length && tbl[c]) {
              this.energy[i] = Math.min(sp.energy * 1.5, this.energy[i] + 0.55);
              speedScale = 0.2;
              /**
               * Weidegaenger fressen die Zelle wirklich auf. Damit wird der
               * Marienkaefer zum echten Nahrungskonkurrenten der Ameisen und
               * die Raupe frisst Pflanzen kahl – sichtbare Folgen statt
               * unsichtbarer Zahlen.
               */
              if (sp.grazes && isSurface && rng.chance(CREATURES.GRAZE_CHANCE)) {
                this._graze(i, level, this.x[i] | 0, this.y[i] | 0, c, ctx);
              }
            }
          }
          // Bauten anlegen
          if (isSurface && sp.web && this.home[i] < 0 && rng.chance(0.004)) this._buildWeb(i, level, rng);
          if (isSurface && sp.funnel && this.home[i] < 0 && rng.chance(0.006)) this._buildFunnel(i, level, rng);
          // Lauerjaeger ohne Bauwerk (Gottesanbeterin): stehen bleiben und warten
          if (sp.ambush && rng.chance(0.02)) { this.state[i] = CSTATE.LURK; this.timer[i] = 900; }
          if (sp.web && this.home[i] >= 0) {
            // zurueck ins Netz
            const hx = this.home[i] % level.w, hy = (this.home[i] / level.w) | 0;
            const dx = hx - this.x[i], dy = hy - this.y[i];
            if (dx * dx + dy * dy > 36) this.dir[i] = Math.atan2(dy, dx);
            else { this.state[i] = CSTATE.LURK; this.timer[i] = 600; }
          }
          break;
        }
      }

      // --- Laufkaefer graebt sich einen eigenen Zugang --------------------
      if (isSurface && sp.digsEntrance && rng.chance(0.00035)) {
        ctx.world.digIntruderEntrance(i, this.x[i] | 0, this.y[i] | 0);
      }

      // --- Fortpflanzung ---------------------------------------------------
      if (this.energy[i] >= sp.breedAt && (ctx.tick % CREATURES.BREED_INTERVAL) === (i % CREATURES.BREED_INTERVAL)) {
        this._breed(i, level, ctx, rng);
      }

      // --- Bewegung ---------------------------------------------------------
      /**
       * Tagesrhythmus: tagaktive Arten werden nachts traege, nachtaktive
       * tagsueber. Das verschiebt das Kraefteverhaeltnis im Lauf eines Tages,
       * ohne dass irgendwo ein Zeitplan steht.
       */
      const activity = isSurface ? activityFor(sp, ctx.light !== undefined ? ctx.light : 1) : 1;
      const speed = sp.speed * (0.65 + this.gSpeed[i] * 0.7) * 0.32 * speedScale * activity;
      if (speed > 0) this._move(level, i, speed, maxX, maxY, rng);

      // --- Portale (nur Arten, die ins Nest duerfen) -----------------------
      if (sp.entersNest && ctx.portals) {
        const p = ctx.portals.at(level.id, this.x[i] | 0, this.y[i] | 0);
        if (p && !p.closed && p.pluggedBy < 0 && rng.chance(0.25)) {
          const other = p.other(level.id);
          const dest = ctx.levels.get(other.levelId);
          if (dest) {
            this.level[i] = dest.id;
            this.x[i] = other.x + 0.5;
            this.y[i] = other.y + 0.5;
            this.px[i] = this.x[i];
            this.py[i] = this.y[i];
            this.dir[i] = dest.kind === LEVEL_KIND.NEST ? Math.PI / 2 : rng.angle();
            if (dest.kind === LEVEL_KIND.NEST) {
              const colony = ctx.colonies.get(dest.colonyId);
              if (colony) {
                colony.stressEvents = (colony.stressEvents || 0) + 0.05;
                bus.logEvent(CAT.RAEUBER, sp.name + ' dringt in ' + colony.nestName + ' ein!', {
                  tick: ctx.tick, levelId: dest.id, x: other.x, y: other.y, colonyId: colony.id,
                });
              }
            }
          }
        }
      }
    }
  }

  _move(level, i, sp, maxX, maxY, rng) {
    const a = this.dir[i];
    const cs = Math.cos(a), sn = Math.sin(a);
    let blocked = false;
    let tx = this.x[i] + cs * sp;
    if (tx < 0.25) { tx = 0.25; blocked = true; } else if (tx > maxX) { tx = maxX; blocked = true; }
    if (!level.isSolid(tx | 0, this.y[i] | 0)) { this.x[i] = tx; } else blocked = true;
    let ty = this.y[i] + sn * sp;
    if (ty < 0.25) { ty = 0.25; blocked = true; } else if (ty > maxY) { ty = maxY; blocked = true; }
    if (!level.isSolid(this.x[i] | 0, ty | 0)) { this.y[i] = ty; } else blocked = true;
    if (blocked) this.dir[i] += rng.chance(0.5) ? 0.9 : -0.9;
    this.anim[i] += sp * 3;
  }

  /**
   * Zielsuche bei Hunger:
   *   Pflanzenfresser steuern die naechste Nahrungszelle an,
   *   Raeuber die naechste Ameisenstrasse bzw. den naechsten Nesteingang.
   */
  _seek(i, level, ctx, sp) {
    const x = this.x[i] | 0, y = this.y[i] | 0;
    if (EATS_BY_SPECIES[this.species[i]].length > 0) {
      const tbl = EATS_TABLE[this.species[i]];
      let bx = -1, by = -1, bestD = 1e9;
      const R = 14;
      for (let dy = -R; dy <= R; dy += 2) {
        for (let dx = -R; dx <= R; dx += 2) {
          const c = level.get(x + dx, y + dy);
          if (c < tbl.length && tbl[c]) {
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; bx = x + dx; by = y + dy; }
          }
        }
      }
      if (bx >= 0) this.dir[i] = Math.atan2(by - this.y[i], bx - this.x[i]);
      return;
    }
    /**
     * Raeuber suchen ihre Beute NICHT gezielt – weder das Nest noch die
     * Ameisenstrassen. Beides wurde ausprobiert und beides bricht das Spiel:
     *
     *   Nest ansteuern    -> alle Jaeger campen am Eingang, das Volk stirbt.
     *   Spur ansteuern    -> alle Jaeger sammeln sich auf der Hauptstrasse.
     *                        Auch als schwache Tendenz (Kurskorrektur 0.22 rad
     *                        alle 32 Ticks) war das Volk im Test nach zehn
     *                        Minuten ausgeloescht, und danach verhungerten
     *                        saemtliche Jaeger mit.
     *
     * Der Grund ist strukturell: eine Ameisenstrasse ist ein DAUERHAFTER
     * Beutestrom. Wer sie findet, muss nie wieder suchen. Deshalb bleibt es
     * beim Umherstreifen – Jaeger finden Beute dort, wo viel Verkehr ist,
     * einfach weil dort mehr Ameisen sind, und das ergibt von selbst eine
     * Verteilung entlang der Routen, ohne Rueckkopplung.
     */
    void ctx;
  }

  /**
   * Eine Nahrungszelle abweiden. Blattlaeuse und Aas werden ueber das
   * Nahrungssystem abgebaut (damit der Restbestand stimmt), Pflanzen und
   * Blueten verschwinden nur unter echten Blattfressern (sp.mows).
   */
  _graze(i, level, x, y, cell, ctx) {
    if (cell === SURFACE_CELL.PLANT || cell === SURFACE_CELL.FLOWER) {
      // Nur echte Blattfresser raeumen Gruen ab. Wer daran nur nascht
      // (Marienkaefer an Pollen, Wespe an Nektar), laesst die Pflanze stehen.
      if (SPECIES[this.species[i]].mows) level.set(x, y, SURFACE_CELL.DIRT);
      return;
    }
    if (ctx.food) ctx.food.take(level, x, y, CREATURES.GRAZE_BITE);
  }

  _buildWeb(i, level, rng) {
    const x = this.x[i] | 0, y = this.y[i] | 0;
    // Netze brauchen Anker: Pflanze oder Stein in der Naehe
    let anchors = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const c = level.get(x + dx, y + dy);
        if (c === SURFACE_CELL.PLANT || c === SURFACE_CELL.STONE) anchors++;
      }
    }
    if (anchors < 2) return;
    let placed = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > 5) continue;
        const c = level.get(x + dx, y + dy);
        if (c === SURFACE_CELL.GRASS || c === SURFACE_CELL.DIRT || c === SURFACE_CELL.SAND) {
          level.set(x + dx, y + dy, SURFACE_CELL.WEB);
          placed++;
        }
      }
    }
    if (placed) {
      this.home[i] = y * level.w + x;
      this.state[i] = CSTATE.LURK;
      this.timer[i] = 900;
    }
    void rng;
  }

  _buildFunnel(i, level, rng) {
    const x = this.x[i] | 0, y = this.y[i] | 0;
    if (level.get(x, y) !== SURFACE_CELL.SAND) return;
    let sand = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (level.get(x + dx, y + dy) === SURFACE_CELL.SAND) sand++;
    }
    if (sand < 7) return;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx * dx + dy * dy <= 2) level.set(x + dx, y + dy, SURFACE_CELL.FUNNEL);
    }
    this.home[i] = y * level.w + x;
    this.state[i] = CSTATE.LURK;
    this.timer[i] = 2000;
    void rng;
  }

  _breed(i, level, ctx, rng) {
    const sp = SPECIES[this.species[i]];
    if (this.count >= this.capacity) return;
    // Dichteregler der UI begrenzt die Population je Art
    const cap = Math.round((CREATURES.START[sp.key] || 10) * CREATURES.POP_CAP * CREATURES.DENSITY_SCALE);
    let have = 0;
    for (let k = 0; k < this.high; k++) if (this.alive[k] && this.species[k] === this.species[i]) have++;
    if (have >= cap) return;

    this.energy[i] -= sp.breedCost;
    const m = CREATURES.MUTATION;
    const id = this.spawn({
      speciesId: this.species[i],
      levelId: this.level[i],
      x: this.x[i] + rng.range(-1.5, 1.5),
      y: this.y[i] + rng.range(-1.5, 1.5),
      dir: rng.angle(),
      energy: sp.breedCost * 0.7,
      gSize: clamp01(this.gSize[i] + rng.gauss(0, m)),
      gSpeed: clamp01(this.gSpeed[i] + rng.gauss(0, m)),
      gAggr: clamp01(this.gAggr[i] + rng.gauss(0, m)),
      generation: this.generation[i] + 1,
    });
    if (id >= 0) ctx.world.creatureBorn(this.species[i]);
    void level;
  }

  _die(i, level, ctx, killedByAnts = false) {
    const sp = SPECIES[this.species[i]];
    // Erlegte Raeuber sind eine grosse Proteinquelle
    if (ctx.food && level.kind === LEVEL_KIND.SURFACE) {
      ctx.food.dropCarrion(level, this.x[i] | 0, this.y[i] | 0, LIFE.CORPSE_FOOD * sp.size * 2.2);
    }
    if (killedByAnts) {
      bus.logEvent(CAT.RAEUBER, sp.name + ' von Ameisen erlegt', {
        tick: ctx.tick, levelId: level.id, x: this.x[i] | 0, y: this.y[i] | 0,
      });
    }
    // Bau aufloesen
    if (this.home[i] >= 0 && level.kind === LEVEL_KIND.SURFACE) {
      const hx = this.home[i] % level.w, hy = (this.home[i] / level.w) | 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const c = level.get(hx + dx, hy + dy);
          if (c === SURFACE_CELL.WEB) level.set(hx + dx, hy + dy, SURFACE_CELL.GRASS);
          if (c === SURFACE_CELL.FUNNEL) level.set(hx + dx, hy + dy, SURFACE_CELL.SAND);
        }
      }
    }
    this.kill(i);
  }

  /** Bestand je Art (fuer Statistik und Dichteregelung). */
  census(out) {
    const counts = out || new Uint16Array(SPECIES.length);
    counts.fill(0);
    for (let i = 0; i < this.high; i++) if (this.alive[i]) counts[this.species[i]]++;
    return counts;
  }
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

export { ANT_STATE, CARRY };
