/**
 * world.js – Weltaufbau und Tick-Orchestrierung.
 *
 * Buendelt alle Simulationsteile und fuehrt genau einen deterministischen
 * Tick aus. Kennt WEDER PixiJS NOCH das DOM – laeuft unveraendert headless
 * unter Node (siehe test/sim-bench.mjs).
 *
 * Reihenfolge eines Ticks:
 *   1. Portalzaehler zuruecksetzen
 *   2. Ameisen- und Kreaturenindizes nach Ebene buckeln, Zaehler auffrischen
 *   3. Brut reifen lassen
 *   4. Je Kolonie (gestaffelt): Ernaehrungsbilanz, Kolonie-KI, Nestbau
 *   5. Distanzfelder auffrischen (gemeinsames Budget)
 *   6. Je Ebene: Spatial Hash, Ameisen, Kreaturen
 *   7. Pheromone verdunsten, Nahrung nachwachsen
 * Die Punkte 4 bis 6 laufen fuer ALLE Ebenen, auch fuer unsichtbare.
 */

import {
  COLONY, TOOLS, DIG, LIMITS, NUTRITION, EVO, CREATURES, LIFE, BROOD as BROOD_CFG,
  WORLD as W, mapPreset, GEN,
} from '../config.js';
import { RNG } from '../rng.js';
import { LevelManager, LEVEL_KIND } from './levels.js';
import { createSurface, findNestSite, buildEntrance, dumpSoil, SURFACE_CELL } from './surface.js';
import { createNest, buildStartNest, randomAirCell, NEST_CELL, CHAMBER } from './nest.js';
import { PortalSystem } from './portals.js';
import { ColonyManager, updateColonyAI } from './colony.js';
import { Ants, ANT_STATE, CARRY } from './ants.js';
import { CASTE, casteDef } from './castes.js';
import { Construction } from './construction.js';
import { FieldSet } from './flowfields.js';
import { FoodSystem } from './food.js';
import { PheromoneSystem } from './pheromones.js';
import { BroodPool, broodSpot, STAGE } from './brood.js';
import { Creatures, SPECIES_LIST, SPECIES_BY_KEY } from './creatures.js';
import { initNutrition, updateNutrition } from './nutrition.js';
import { newGenome, mutateGenome, geneSummary, copyGenome } from './genome.js';
import { bus, CAT } from './events.js';

export class World {
  constructor(seed, presetKey = 'wiese') {
    this.seed = String(seed);
    this.preset = mapPreset(presetKey);
    this.genSurface = { ...GEN.SURFACE, ...(this.preset.surface || {}) };
    this.genNest = { ...GEN.NEST, ...(this.preset.nest || {}) };
    this.tick = 0;

    this.rngRoot = new RNG(this.seed);
    this.rngGen = this.rngRoot.fork('worldgen');
    this.rngSim = this.rngRoot.fork('sim');

    this.levels = new LevelManager();
    this.portals = new PortalSystem();
    this.colonies = new ColonyManager();
    this.ants = new Ants();
    this.brood = new BroodPool();
    this.creatures = new Creatures();
    this.construction = new Construction(this);
    this.food = new FoodSystem(this);
    /** @type {PheromoneSystem|null} – nur fuer die Oberflaeche */
    this.phero = null;
    /** @type {Map<number, FieldSet>} Distanzfelder je Nest-Ebene */
    this.fields = new Map();

    /** Stammbaum: ein Eintrag je Kolonie. */
    this.lineage = [];
    /** Kasten, die in dieser Welt schon aufgetreten sind. */
    this.seenCastes = new Set();
    /** Einstellung "Ernaehrungseinfluss". */
    this.biasMode = EVO.DEFAULT_BIAS;

    this.perf = {
      total: 0, buckets: 0, spatial: 0, ants: 0, build: 0, fields: 0,
      brood: 0, colony: 0, creatures: 0, phero: 0,
      levels: new Map(),
    };

    this.ctx = {
      world: this,
      portals: this.portals, levels: this.levels, colonies: this.colonies,
      construction: this.construction, fields: this.fields,
      food: this.food, brood: this.brood, ants: this.ants, creatures: this.creatures,
      phero: null, rng: this.rngSim, tick: 0,
    };
    this._budget = { left: DIG.FIELD_BUDGET_PER_TICK };
    this._census = new Uint16Array(SPECIES_LIST.length);
  }

  // =========================================================================
  // Aufbau
  // =========================================================================
  generate() {
    const surface = this.levels.add(createSurface(this.rngGen, this.genSurface));
    this.ants.registerLevel(surface.id);
    this.creatures.registerLevel(surface.id);
    this.food.generate(surface, this.rngGen);
    this.phero = new PheromoneSystem(surface);
    this.ctx.phero = this.phero;

    this.foundColony(null, COLONY.START_ANTS);
    this.spawnStartCreatures();

    bus.logEvent(CAT.SYS, 'Welt "' + this.preset.name + '" erzeugt (Seed "' + this.seed + '")',
      { tick: 0, levelId: surface.id });
    return this;
  }

  /**
   * Gruendet eine Kolonie mit eigener Nest-Ebene und Portal.
   * @param {{x:number,y:number}|null} at Wunschort, sonst wird gesucht
   * @param {number} population
   * @param {object} [opts] { genome, parentId, generation, maternal }
   */
  foundColony(at, population = TOOLS.FOUND_ANTS, opts = {}) {
    if (this.colonies.colonies.length >= LIMITS.MAX_COLONIES) return null;
    if (this.levels.nestCount >= LIMITS.MAX_NEST_LEVELS) return null;

    const surface = this.levels.surface;
    const colony = this.colonies.create({
      generation: opts.generation || 1,
      parentId: opts.parentId !== undefined ? opts.parentId : -1,
    });
    colony.foundedTick = this.tick;
    colony.genome = opts.genome || newGenome(this.rngGen);
    initNutrition(colony);
    if (opts.maternal) {
      // Muetterlicher Effekt: die erste Generation erbt den halben Phaenotyp
      colony.pheno.size = 1 + (opts.maternal.size - 1) * EVO.MATERNAL_PHENO;
      colony.pheno.speed = 1 + (opts.maternal.speed - 1) * EVO.MATERNAL_PHENO;
      colony.pheno.life = 1 + (opts.maternal.life - 1) * EVO.MATERNAL_PHENO;
      colony.storeArr[0] += 60;
      colony.storeArr[1] += 40;
    }

    let site = at;
    if (!site) {
      const taken = this.portals.portals
        .filter((p) => p.aLevelId === surface.id).map((p) => ({ x: p.ax, y: p.ay }));
      site = findNestSite(surface, this.rngGen, taken);
    } else {
      site = {
        x: Math.max(6, Math.min(surface.w - 7, site.x | 0)),
        y: Math.max(6, Math.min(surface.h - 7, site.y | 0)),
      };
    }
    buildEntrance(surface, site.x, site.y);

    const nest = this.levels.add(createNest(this.rngGen,
      { colonyId: colony.id, name: 'Nest ' + colony.name }, this.genNest));
    this.ants.registerLevel(nest.id);
    this.creatures.registerLevel(nest.id);
    const layout = buildStartNest(nest, this.rngGen, this.genNest);
    colony.nestLevelIds.push(nest.id);
    colony.layout = layout;
    this.construction.init(colony);
    this.fields.set(nest.id, new FieldSet(nest));
    if (this.phero) this.phero.addColony(colony.id);

    const portal = this.portals.create({
      colonyId: colony.id,
      aLevelId: surface.id, ax: site.x, ay: site.y,
      bLevelId: nest.id, bx: layout.entrance.x, by: layout.entrance.y,
    });
    colony.portalIds.push(portal.id);

    const heaps = Math.round(layout.dugCells / 12);
    for (let i = 0; i < heaps; i++) dumpSoil(surface, site.x, site.y, this.rngGen);

    this.populateColony(colony, population);

    this.lineage.push({
      id: colony.id, name: colony.name, parentId: colony.parentId,
      generation: colony.generation, founded: this.tick, extinct: -1,
      genome: copyGenome(colony.genome), summary: geneSummary(colony.genome),
      motherBalance: opts.motherBalance || null, changes: opts.changes || [],
    });
    bus.logEvent(CAT.SYS, 'Kolonie ' + colony.name + ' gegruendet', {
      tick: this.tick, levelId: surface.id, x: site.x, y: site.y, colonyId: colony.id,
    });
    return colony;
  }

  populateColony(colony, n) {
    const rng = this.rngGen;
    const surface = this.levels.surface;
    const nest = this.levels.get(colony.nestLevelIds[0]);
    const layout = colony.layout;

    if (!colony._queenSpawned) {
      colony._queenSpawned = true;
      const q = this.ants.spawn({
        levelId: nest.id, x: layout.queen.x + 0.5, y: layout.queen.y + 0.5,
        colonyId: colony.id, casteId: CASTE.QUEEN, dir: rng.angle(), state: ANT_STATE.IDLE,
        lifespan: LIFE.QUEEN_LIFESPAN,
      });
      colony.queenAnt = q;
    }

    for (let i = 0; i < n; i++) {
      const caste = rng.chance(0.12) ? CASTE.SOLDIER : CASTE.WORKER;
      const life = Math.round(LIFE.WORKER_LIFESPAN * rng.range(0.6, 1.2));
      if (rng.chance(0.55)) {
        const spot = randomAirCell(nest, rng);
        if (!spot) continue;
        this.ants.spawn({
          levelId: nest.id, x: spot.x + 0.5, y: spot.y + 0.5, colonyId: colony.id,
          casteId: caste, dir: rng.angle(), state: ANT_STATE.EXPLORE,
          timer: rng.intRange(30, 400), lifespan: life,
        });
      } else {
        const p = this.portals.ofColony(colony.id)[0];
        const spot = this.surfaceSpotNear(surface, colony, rng)
          || { x: p ? p.ax : surface.w >> 1, y: p ? p.ay : surface.h >> 1 };
        this.ants.spawn({
          levelId: surface.id, x: spot.x + 0.5, y: spot.y + 0.5, colonyId: colony.id,
          casteId: caste, dir: rng.angle(), state: ANT_STATE.EXPLORE,
          timer: rng.intRange(30, 900), lifespan: life,
        });
      }
    }
  }

  surfaceSpotNear(surface, colony, rng) {
    const p = this.portals.ofColony(colony.id)[0];
    if (!p) return null;
    for (let i = 0; i < 60; i++) {
      const a = rng.angle();
      const r = 1 + rng.float() * 14;
      const x = Math.round(p.ax + Math.cos(a) * r);
      const y = Math.round(p.ay + Math.sin(a) * r);
      if (!surface.inBounds(x, y) || surface.isSolid(x, y)) continue;
      return { x, y };
    }
    return null;
  }

  /** Startbesatz an Kreaturen auf der Oberflaeche verteilen. */
  spawnStartCreatures() {
    const surface = this.levels.surface;
    const rng = this.rngGen;
    for (const sp of SPECIES_LIST) {
      const n = Math.round((CREATURES.START[sp.key] || 0) * CREATURES.DENSITY_SCALE);
      for (let i = 0; i < n; i++) {
        const spot = this.freeSurfaceCell(surface, rng, sp.prey ? CREATURES.START_MIN_DIST : 0);
        if (!spot) continue;
        this.creatures.spawn({
          speciesId: sp.id, levelId: surface.id, x: spot.x + 0.5, y: spot.y + 0.5,
          dir: rng.angle(),
          gSize: clamp01(0.5 + rng.gauss(0, 0.12)),
          gSpeed: clamp01(0.5 + rng.gauss(0, 0.12)),
          gAggr: clamp01(0.5 + rng.gauss(0, 0.12)),
        });
      }
    }
  }

  /**
   * Freie Oberflaechenzelle. minDist haelt Raeuber beim Startbesatz von den
   * Nesteingaengen fern – sonst stehen sie beim Start mitten im Volk.
   */
  freeSurfaceCell(level, rng, minDist = 0) {
    for (let i = 0; i < 300; i++) {
      const x = rng.intRange(3, level.w - 4);
      const y = rng.intRange(3, level.h - 4);
      if (level.isSolid(x, y)) continue;
      if (minDist > 0) {
        let tooClose = false;
        for (const p of this.portals.portals) {
          if (p.aLevelId !== level.id) continue;
          const dx = p.ax - x, dy = p.ay - y;
          if (dx * dx + dy * dy < minDist * minDist) { tooClose = true; break; }
        }
        if (tooClose) continue;
      }
      return { x, y };
    }
    return null;
  }

  // =========================================================================
  // Rueckrufe der Teilsysteme
  // =========================================================================

  /** Koenigin legt ein Ei. */
  layEgg(colony, casteId) {
    if (this.brood.count >= this.brood.capacity) return false;
    const nest = this.levels.get(colony.nestLevelIds[0]);
    if (!nest) return false;
    const spot = broodSpot(nest, this.rngSim, CHAMBER.BROOD);
    if (!spot) return false;
    const id = this.brood.spawn({
      colonyId: colony.id, levelId: nest.id, x: spot.x, y: spot.y, target: casteId,
      pSize: colony.pheno.size, pSpeed: colony.pheno.speed, pLife: colony.pheno.life,
    });
    if (id < 0) return false;
    colony.eggsLaid = (colony.eggsLaid || 0) + 1;
    return true;
  }

  /** Bei extremem Proteinmangel frisst die Kolonie ein eigenes Ei. */
  eatOwnEgg(colony) {
    for (let i = 0; i < this.brood.high; i++) {
      if (!this.brood.alive[i] || this.brood.colony[i] !== colony.id) continue;
      if (this.brood.stage[i] !== STAGE.EGG) continue;
      this.brood.kill(i);
      colony.storeArr[1] += NUTRITION.PROTEIN_PER_EGG * 0.8;
      colony.cannibalized = (colony.cannibalized || 0) + 1;
      return true;
    }
    return false;
  }

  /** Tod der Koenigin: die Kolonie zerfaellt. */
  queenDied(colony, level, x, y) {
    colony.stressEvents = (colony.stressEvents || 0) + EVO.STRESS_QUEENLOSS;
    colony.queenAnt = -1;
    colony._queenSpawned = false;
    bus.logEvent(CAT.KATASTROPHE, colony.name + ': die Koenigin ist tot – keine neue Brut mehr', {
      tick: this.tick, levelId: level.id, x: x | 0, y: y | 0, colonyId: colony.id,
    });
  }

  /** Erste Ameise einer evolutionaeren Kaste in der Welt. */
  firstCaste(def, colony) {
    if (this.seenCastes.has(def.id)) return;
    this.seenCastes.add(def.id);
    bus.logEvent(CAT.EVOLUTION, 'Neue Kaste in der Welt: ' + def.name + ' (' + colony.name + ')', {
      tick: this.tick, levelId: colony.nestLevelIds[0], colonyId: colony.id,
    });
  }

  creatureBorn(speciesId) {
    this.creatureBirths = (this.creatureBirths || 0) + 1;
    void speciesId;
  }

  /**
   * Laufkaefer graebt sich einen eigenen Zugang in ein Nest: ein zusaetzliches
   * Portal, das der Kolonie nicht gehoert und das sie verschliessen muesste.
   */
  digIntruderEntrance(creatureIdx, x, y) {
    const surface = this.levels.surface;
    // Naechstes Nest in der Naehe suchen
    let best = null, bestD = 30 * 30;
    for (const p of this.portals.portals) {
      if (p.aLevelId !== surface.id) continue;
      const dx = p.ax - x, dy = p.ay - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return false;
    const nest = this.levels.get(best.bLevelId);
    if (!nest) return false;
    const colony = this.colonies.get(best.colonyId);
    // Neue Oeffnung seitlich versetzt
    const nx = Math.max(4, Math.min(nest.w - 5, best.bx + this.rngSim.intRange(-30, 30)));
    const ny = W.NEST_SURFACE_ROW;
    if (this.portals.at(nest.id, nx, ny)) return false;
    const sx = Math.max(3, Math.min(surface.w - 4, x));
    const sy = Math.max(3, Math.min(surface.h - 4, y));
    if (this.portals.at(surface.id, sx, sy)) return false;

    surface.set(sx, sy, SURFACE_CELL.ENTRANCE);
    nest.set(nx, ny, NEST_CELL.ENTRANCE);
    // Kurzer Schacht nach unten, damit der Zugang etwas bringt
    for (let d = 1; d <= 6; d++) {
      if (nest.get(nx, ny + d) === NEST_CELL.STONE) break;
      nest.set(nx, ny + d, NEST_CELL.TUNNEL);
      nest.setMeta(nx, ny + d, CHAMBER.NONE);
    }
    const p = this.portals.create({
      colonyId: best.colonyId,
      aLevelId: surface.id, ax: sx, ay: sy,
      bLevelId: nest.id, bx: nx, by: ny,
    });
    p.intruder = true;
    const fs = this.fields.get(nest.id);
    if (fs) fs.markAllDirty();
    if (colony) {
      colony.stressEvents = (colony.stressEvents || 0) + 0.08;
      bus.logEvent(CAT.RAEUBER, 'Ein Laufkaefer hat einen Zugang in ' + colony.nestName + ' gegraben', {
        tick: this.tick, levelId: surface.id, x: sx, y: sy, colonyId: colony.id,
      });
    }
    void creatureIdx;
    return true;
  }

  // =========================================================================
  // Hochzeitsflug und Evolution
  // =========================================================================
  startNuptialFlight(colony) {
    colony.lastFlightTick = this.tick;
    const rng = this.rngSim;
    const surface = this.levels.surface;
    const p = this.portals.ofColony(colony.id)[0];
    if (!p) return;
    // Gut genaehrte Kolonien schicken mehr Gefluegelte los
    const wellFed = Math.min(1.8, (colony.balanceArr[0] + colony.balanceArr[1]) * 0.5);
    const n = Math.round(rng.intRange(EVO.FLIGHT_ALATES[0], EVO.FLIGHT_ALATES[1]) * wellFed);
    // Ernaehrungslage VOR dem Flug einfrieren – sie bestimmt die Mutation
    colony.flightSnapshot = {
      balanceArr: Float32Array.from(colony.balanceArr),
      stress: colony.stress,
      pheno: { ...colony.pheno },
      mutagenSigma: colony.mutagenSigma || 1,
      mutagenJump: colony.mutagenJump || 1,
    };
    for (let i = 0; i < n; i++) {
      const a = rng.angle();
      const r = 1 + rng.float() * 6;
      const x = Math.round(p.ax + Math.cos(a) * r);
      const y = Math.round(p.ay + Math.sin(a) * r);
      if (!surface.inBounds(x, y) || surface.isSolid(x, y)) continue;
      const id = this.ants.spawn({
        levelId: surface.id, x: x + 0.5, y: y + 0.5, colonyId: colony.id,
        casteId: CASTE.ALATE, dir: rng.angle(), state: ANT_STATE.EXPLORE,
        timer: 65000, lifespan: 2400,
      });
      if (id >= 0) this.ants.trip[id] = 0;
    }
    bus.logEvent(CAT.EVOLUTION, colony.name + ': Hochzeitsflug mit ' + n + ' Gefluegelten', {
      tick: this.tick, levelId: surface.id, x: p.ax, y: p.ay, colonyId: colony.id,
    });
  }

  /**
   * Gefluegelte pruefen: Wer lange genug ueberlebt hat und weit genug weg
   * ist, gruendet eine Kolonie – mit mutiertem Genom der Mutterkolonie.
   */
  updateAlates() {
    const a = this.ants;
    const surface = this.levels.surface;
    for (let i = 0; i < a.high; i++) {
      if (!a.alive[i] || a.caste[i] !== CASTE.ALATE) continue;
      if (a.level[i] !== surface.id) continue;
      if (a.age[i] < 900) continue;
      const mother = this.colonies.get(a.colony[i]);
      if (!mother) { a.kill(i); continue; }
      const p = this.portals.ofColony(mother.id)[0];
      const far = !p || ((p.ax - a.x[i]) ** 2 + (p.ay - a.y[i]) ** 2) > 40 * 40;
      if (!far) continue;
      // Die meisten sterben – Raeuber, Wetter, Zufall
      if (!this.rngSim.chance(EVO.FLIGHT_SURVIVAL)) { a.kill(i); continue; }
      const snap = mother.flightSnapshot || {
        balanceArr: mother.balanceArr, stress: mother.stress, pheno: mother.pheno,
      };
      const pseudo = {
        balanceArr: snap.balanceArr, stress: snap.stress,
        mutagenSigma: snap.mutagenSigma || 1, mutagenJump: snap.mutagenJump || 1,
      };
      const bias = EVO.BIAS_MODES[this.biasMode] !== undefined
        ? EVO.BIAS_MODES[this.biasMode] : EVO.BIAS_MODES.standard;
      const res = mutateGenome(mother.genome, pseudo, this.rngSim, bias);
      const child = this.foundColony({ x: a.x[i] | 0, y: a.y[i] | 0 }, 22, {
        genome: res.genome, parentId: mother.id, generation: mother.generation + 1,
        maternal: snap.pheno, changes: res.changes,
        motherBalance: Array.from(snap.balanceArr),
      });
      a.kill(i);
      if (child) {
        bus.logEvent(CAT.EVOLUTION, child.name + ' gegruendet von ' + mother.name
          + (res.changes.length ? ' (' + res.changes[0].key + ' '
            + res.changes[0].from.toFixed(2) + '->' + res.changes[0].to.toFixed(2) + ')' : ''), {
          tick: this.tick, levelId: surface.id, x: a.x[i] | 0, y: a.y[i] | 0, colonyId: child.id,
        });
      }
      break;   // hoechstens eine Gruendung je Tick
    }
  }

  /** Mutagene: eingelagerter Pilz bzw. Giftbeere wirken auf die Mutation. */
  applyMutagen(colony, kind) {
    if (kind === 'fungus') {
      colony.mutagenSigma = EVO.FUNGUS_SIGMA;
      bus.logEvent(CAT.EVOLUTION, colony.name + ' lagert leuchtenden Pilz ein (Mutationsstaerke x2)', {
        tick: this.tick, colonyId: colony.id, levelId: colony.nestLevelIds[0],
      });
    } else {
      colony.mutagenJump = EVO.BERRY_JUMP;
      colony.stressEvents = (colony.stressEvents || 0) + 0.2;
    }
  }

  // =========================================================================
  // Sandbox-Eingriffe
  // =========================================================================
  spawnAntsAt(colonyId, level, cx, cy, n, casteId = CASTE.WORKER) {
    const colony = this.colonies.get(colonyId);
    if (!colony) return 0;
    const rng = this.rngSim;
    let made = 0;
    for (let i = 0; i < n; i++) {
      let px = -1, py = -1;
      for (let t = 0; t < 30; t++) {
        const a = rng.angle();
        const r = rng.float() * 3.5;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        if (!level.inBounds(x, y) || level.isSolid(x, y)) continue;
        px = x; py = y; break;
      }
      if (px < 0) continue;
      const id = this.ants.spawn({
        levelId: level.id, x: px + 0.5, y: py + 0.5, colonyId: colony.id,
        casteId, dir: rng.angle(), state: ANT_STATE.EXPLORE,
        timer: rng.intRange(60, 600),
        lifespan: Math.round(LIFE.WORKER_LIFESPAN * rng.range(0.7, 1.3)),
      });
      if (id >= 0) made++;
    }
    colony.storeArr[0] = Math.min(colony.capacity[0], colony.storeArr[0] + made * 0.6);
    return made;
  }

  /** Werkzeug "Kreatur spawnen". */
  spawnCreaturesAt(speciesKey, level, cx, cy, n) {
    const sp = SPECIES_BY_KEY.get(speciesKey);
    if (!sp) return 0;
    const rng = this.rngSim;
    let made = 0;
    for (let i = 0; i < n; i++) {
      let px = -1, py = -1;
      for (let t = 0; t < 30; t++) {
        const a = rng.angle();
        const r = rng.float() * 3.5;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        if (!level.inBounds(x, y) || level.isSolid(x, y)) continue;
        px = x; py = y; break;
      }
      if (px < 0) continue;
      const id = this.creatures.spawn({
        speciesId: sp.id, levelId: level.id, x: px + 0.5, y: py + 0.5, dir: rng.angle(),
        gSize: clamp01(0.5 + rng.gauss(0, 0.12)),
        gSpeed: clamp01(0.5 + rng.gauss(0, 0.12)),
        gAggr: clamp01(0.5 + rng.gauss(0, 0.12)),
      });
      if (id >= 0) made++;
    }
    return made;
  }

  /** Werkzeug "Nahrung ablegen". */
  placeFood(level, cx, cy, radius, cellType, amount) {
    if (level.kind !== LEVEL_KIND.SURFACE) return 0;
    let n = 0;
    const r = Math.max(0, radius - 1);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r + r) continue;
        if (!level.inBounds(x, y)) continue;
        if (this.portals.at(level.id, x, y)) continue;
        const cur = level.cells[y * level.w + x];
        if (cur === SURFACE_CELL.STONE || cur === SURFACE_CELL.WATER) continue;
        if (this.food.place(level, x, y, cellType, amount)) n++;
      }
    }
    return n;
  }

  paint(level, cx, cy, radius, cellType, chamberType) {
    let changed = 0;
    const r = Math.max(0, radius - 1);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r + r) continue;
        if (!level.inBounds(x, y)) continue;
        if (this.portals.at(level.id, x, y)) continue;
        if (level.kind === LEVEL_KIND.NEST && y <= W.NEST_SURFACE_ROW) continue;
        if (level.cells[y * level.w + x] === cellType
            && (chamberType === undefined || level.meta[y * level.w + x] === chamberType)) continue;
        level.set(x, y, cellType);
        level.setMeta(x, y, chamberType || 0);
        changed++;
      }
    }
    if (changed && level.kind === LEVEL_KIND.NEST) {
      const fs = this.fields.get(level.id);
      if (fs) fs.markAllDirty();
    }
    return changed;
  }

  markDigOrders(colony, level, cx, cy, radius, chamberType = CHAMBER.NONE) {
    let n = 0;
    const r = Math.max(0, radius - 1);
    n += this.construction.ensureReachable(colony, level, cx, cy);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r + r) continue;
        if (this.construction.addOrder(colony, level, x, y, chamberType)) n++;
      }
    }
    return n;
  }

  /** Forschungsmenue: Hochzeitsflug sofort ausloesen. */
  forceFlight(colonyId) {
    const c = this.colonies.get(colonyId);
    if (!c) return false;
    c.lastFlightTick = -1e9;
    this.startNuptialFlight(c);
    return true;
  }

  /** Forschungsmenue: Ticks im Schnelldurchlauf rechnen (ohne Rendering). */
  fastForward(ticks) {
    const t0 = now();
    for (let i = 0; i < ticks; i++) this.step();
    return now() - t0;
  }

  // =========================================================================
  // Tick
  // =========================================================================
  step() {
    const t0 = now();
    this.tick++;
    this.ctx.tick = this.tick;
    this.portals.beginTick();

    const t1 = now();
    this.ants.rebuildBuckets(this.levels, this.colonies);
    this.creatures.rebuildBuckets(this.levels);
    this.brood.recount(this.colonies);
    const t2 = now();

    // --- Brut ---------------------------------------------------------------
    this.brood.update(this.ctx);
    const t3 = now();

    // --- Kolonien: Ernaehrung, KI, Nestbau (gestaffelt) ----------------------
    const iv = NUTRITION.UPDATE_INTERVAL;
    for (const colony of this.colonies.colonies) {
      if (!colony.alive) continue;
      if (colony.total === 0 && colony.broodTotal === 0) { this.extinguish(colony); continue; }
      if ((this.tick + colony.id * 3) % iv === 0) {
        updateNutrition(colony, this, iv);
        updateColonyAI(colony, this, iv);
      }
      for (const lid of colony.nestLevelIds) {
        const nest = this.levels.get(lid);
        if (nest) this.construction.update(colony, nest, this.rngSim, this.tick);
      }
    }
    const t4 = now();

    // --- Distanzfelder ------------------------------------------------------
    this._budget.left = DIG.FIELD_BUDGET_PER_TICK;
    for (const colony of this.colonies.colonies) {
      if (!colony.alive) continue;
      for (const lid of colony.nestLevelIds) {
        const fs = this.fields.get(lid);
        if (fs) fs.update(colony, this.portals, this._budget);
      }
    }
    const t5 = now();

    // --- Einheiten je Ebene -------------------------------------------------
    let spatialMs = 0, antsMs = 0, creatureMs = 0;
    for (const level of this.levels.levels) {
      const l0 = now();
      this.ants.fillSpatial(level);
      const l1 = now();
      this.ants.update(level, this.ctx);
      const l2 = now();
      this.creatures.update(level, this.ctx);
      const l3 = now();
      spatialMs += l1 - l0;
      antsMs += l2 - l1;
      creatureMs += l3 - l2;
      level.simMs = l3 - l0;
      this.perf.levels.set(level.id, level.simMs);
    }
    const t6 = now();

    // --- Umwelt -------------------------------------------------------------
    if (this.phero) this.phero.update(this.tick);
    this.food.update(this.levels.surface, this.tick);
    if (this.tick % 120 === 0) this.updateAlates();
    const t7 = now();

    this.perf.buckets = t2 - t1;
    this.perf.brood = t3 - t2;
    this.perf.colony = t4 - t3;
    this.perf.fields = t5 - t4;
    this.perf.spatial = spatialMs;
    this.perf.ants = antsMs;
    this.perf.creatures = creatureMs;
    this.perf.build = (t4 - t3) + (t5 - t4);
    this.perf.phero = t7 - t6;
    this.perf.total = now() - t0;
    return this.perf.total;
  }

  /** Kolonie ausgestorben: Nest bleibt als verlassenes Nest bestehen. */
  extinguish(colony) {
    colony.alive = false;
    for (const lid of colony.nestLevelIds) {
      const lvl = this.levels.get(lid);
      if (lvl) lvl.abandoned = true;
    }
    const rec = this.lineage.find((l) => l.id === colony.id);
    if (rec) rec.extinct = this.tick;
    bus.logEvent(CAT.KATASTROPHE, 'Kolonie ' + colony.name + ' ist ausgestorben', {
      tick: this.tick, levelId: colony.nestLevelIds[0], colonyId: colony.id,
    });
  }

  /**
   * Debug/Sandbox: Ameisen hinzufuegen. Sie bringen etwas Wegzehrung mit,
   * sonst verhungert ein per Werkzeug verdoppeltes Volk sofort, bevor die
   * Futtersuche nachziehen kann.
   */
  debugSpawn(n, colonyId = 0) {
    const colony = this.colonies.get(colonyId);
    if (!colony) return 0;
    const before = this.ants.count;
    this.populateColony(colony, n);
    const made = this.ants.count - before;
    colony.storeArr[0] = Math.min(colony.capacity[0], colony.storeArr[0] + made * 0.6);
    colony.storeArr[2] = Math.min(colony.capacity[2], colony.storeArr[2] + made * 0.3);
    return made;
  }

  get totalPassages() {
    let s = 0;
    for (const p of this.portals.portals) s += p.totalPassages;
    return s;
  }

  get totalDug() {
    let s = 0;
    for (const c of this.colonies.colonies) s += c.dugTotal || 0;
    return s;
  }

  get creatureCensus() { return this.creatures.census(this._census); }
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Number(process.hrtime.bigint() / 1000n) / 1000;

export { SURFACE_CELL, NEST_CELL, CASTE, casteDef, CARRY, BROOD_CFG, SPECIES_LIST };
