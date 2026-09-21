/**
 * world.js – Weltaufbau und Tick-Orchestrierung.
 *
 * Buendelt alle Simulationsteile (Ebenen, Portale, Kolonien, Ameisen,
 * Nestbau, Distanzfelder) und fuehrt genau einen deterministischen Tick aus.
 * Das Modul kennt WEDER PixiJS NOCH das DOM – es laeuft unveraendert auch
 * headless unter Node, was fuer Tests und Performance-Messungen benutzt wird.
 *
 * Reihenfolge eines Ticks:
 *   1. Portalzaehler zuruecksetzen (Kapazitaet pro Tick)
 *   2. Ameisenindizes nach Ebene buckeln, Kolonie-Zaehler aktualisieren
 *   3. Je Nest-Ebene: Grabauftraege planen, Distanzfelder auffrischen
 *   4. Je Ebene: Spatial Hash fuellen, Einheiten simulieren
 * Die Punkte 3 und 4 laufen fuer ALLE Ebenen, auch fuer unsichtbare.
 */

import { COLONY, GEN, TOOLS, DIG, WORLD as W, LIMITS, mapPreset } from '../config.js';
import { RNG } from '../rng.js';
import { LevelManager, LEVEL_KIND } from './levels.js';
import { createSurface, findNestSite, buildEntrance, dumpSoil, SURFACE_CELL } from './surface.js';
import { createNest, buildStartNest, randomAirCell, NEST_CELL, CHAMBER } from './nest.js';
import { PortalSystem } from './portals.js';
import { ColonyManager } from './colony.js';
import { Ants, ANT_STATE } from './ants.js';
import { CASTE } from './castes.js';
import { Construction } from './construction.js';
import { FieldSet } from './flowfields.js';
import { bus, CAT } from './events.js';

export class World {
  /**
   * @param {string} seed
   * @param {string} [presetKey] Schluessel einer Kartenvorlage aus MAP_PRESETS
   */
  constructor(seed, presetKey = 'wiese') {
    this.seed = String(seed);
    this.preset = mapPreset(presetKey);
    /** Generatorparameter: Grundwerte aus GEN, ueberschrieben von der Vorlage. */
    this.genSurface = { ...GEN.SURFACE, ...(this.preset.surface || {}) };
    this.genNest = { ...GEN.NEST, ...(this.preset.nest || {}) };
    this.tick = 0;

    // Getrennte Zufallsstroeme: Weltgenerierung darf die Simulation nicht
    // verschieben und umgekehrt.
    this.rngRoot = new RNG(this.seed);
    this.rngGen = this.rngRoot.fork('worldgen');
    this.rngSim = this.rngRoot.fork('sim');

    this.levels = new LevelManager();
    this.portals = new PortalSystem();
    this.colonies = new ColonyManager();
    this.ants = new Ants();
    this.construction = new Construction(this);
    /** @type {Map<number, FieldSet>} Distanzfelder je Nest-Ebene */
    this.fields = new Map();

    /** Messwerte des letzten Ticks (ms). */
    this.perf = {
      total: 0, buckets: 0, spatial: 0, ants: 0, build: 0, fields: 0,
      levels: new Map(),
    };

    this.ctx = {
      portals: this.portals, levels: this.levels, colonies: this.colonies,
      construction: this.construction, fields: this.fields,
      rng: this.rngSim, tick: 0,
    };
    this._budget = { left: DIG.FIELD_BUDGET_PER_TICK };
    this._goalBuf = [];
  }

  /** Welt erzeugen: Oberflaeche, erste Kolonie, deren Nest-Ebene, Portal. */
  generate() {
    const surface = this.levels.add(createSurface(this.rngGen, this.genSurface));
    this.ants.registerLevel(surface.id);
    this.foundColony(null, COLONY.START_ANTS);
    bus.logEvent(CAT.SYS, 'Welt "' + this.preset.name + '" erzeugt (Seed "' + this.seed + '")',
      { tick: 0, levelId: surface.id });
    return this;
  }

  /**
   * Gruendet eine Kolonie: sucht (oder bekommt) einen Platz an der
   * Oberflaeche, legt deren Nest-Ebene an und verbindet beide durch ein
   * Portalpaar.
   * @param {{x:number,y:number}|null} at Wunschort, sonst wird gesucht
   * @param {number} population Startpopulation
   */
  foundColony(at, population = TOOLS.FOUND_ANTS) {
    if (this.colonies.colonies.length >= LIMITS.MAX_COLONIES) return null;
    if (this.levels.nestCount >= LIMITS.MAX_NEST_LEVELS) return null;

    const surface = this.levels.surface;
    const colony = this.colonies.create();
    colony.foundedTick = this.tick;

    let site = at;
    if (!site) {
      const taken = this.portals.portals
        .filter((p) => p.aLevelId === surface.id)
        .map((p) => ({ x: p.ax, y: p.ay }));
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
    const layout = buildStartNest(nest, this.rngGen, this.genNest);
    colony.nestLevelIds.push(nest.id);
    colony.layout = layout;
    this.construction.init(colony);
    this.fields.set(nest.id, new FieldSet(nest));

    const portal = this.portals.create({
      colonyId: colony.id,
      aLevelId: surface.id, ax: site.x, ay: site.y,
      bLevelId: nest.id, bx: layout.entrance.x, by: layout.entrance.y,
    });
    colony.portalIds.push(portal.id);

    // Aushub des Startnests liegt als Erdhuegel an der Oberflaeche.
    const heaps = Math.round(layout.dugCells / 12);
    for (let i = 0; i < heaps; i++) dumpSoil(surface, site.x, site.y, this.rngGen);

    this.populateColony(colony, population);
    bus.logEvent(CAT.SYS, 'Kolonie ' + colony.name + ' gegruendet', {
      tick: this.tick, levelId: surface.id, x: site.x, y: site.y, colonyId: colony.id,
    });
    return colony;
  }

  /** Startpopulation verteilen: Koenigin in ihre Kammer, Rest auf beide Ebenen. */
  populateColony(colony, n) {
    const rng = this.rngGen;
    const surface = this.levels.surface;
    const nest = this.levels.get(colony.nestLevelIds[0]);
    const layout = colony.layout;

    if (colony.population[CASTE.QUEEN] === 0 && !colony._queenSpawned) {
      colony._queenSpawned = true;
      this.ants.spawn({
        levelId: nest.id, x: layout.queen.x + 0.5, y: layout.queen.y + 0.5,
        colonyId: colony.id, casteId: CASTE.QUEEN, dir: rng.angle(), state: ANT_STATE.IDLE,
      });
    }

    for (let i = 0; i < n; i++) {
      const caste = rng.chance(0.12) ? CASTE.SOLDIER : CASTE.WORKER;
      if (rng.chance(0.55)) {
        const spot = randomAirCell(nest, rng);
        if (!spot) continue;
        this.ants.spawn({
          levelId: nest.id, x: spot.x + 0.5, y: spot.y + 0.5, colonyId: colony.id,
          casteId: caste, dir: rng.angle(), state: ANT_STATE.EXPLORE, timer: rng.intRange(30, 400),
        });
      } else {
        const p = this.portals.ofColony(colony.id)[0];
        const spot = this.surfaceSpotNear(surface, colony, rng)
          || { x: p ? p.ax : surface.w >> 1, y: p ? p.ay : surface.h >> 1 };
        this.ants.spawn({
          levelId: surface.id, x: spot.x + 0.5, y: spot.y + 0.5, colonyId: colony.id,
          casteId: caste, dir: rng.angle(), state: ANT_STATE.EXPLORE, timer: rng.intRange(30, 900),
        });
      }
    }
  }

  /** Freie Oberflaechenzelle in der Naehe des Eingangs. */
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

  /**
   * Werkzeug "Ameisen spawnen": n Ameisen einer Kolonie an einer Stelle der
   * angegebenen Ebene absetzen.
   * @returns {number} tatsaechlich erzeugte Ameisen
   */
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
      });
      if (id >= 0) made++;
    }
    return made;
  }

  /**
   * Werkzeug "Terrain malen". Schuetzt Portalzellen und die Oberflaechenzeile
   * der Nest-Ebenen.
   * @returns {number} geaenderte Zellen
   */
  paint(level, cx, cy, radius, cellType, chamberType) {
    let changed = 0;
    const r = Math.max(0, radius - 1);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy > r * r + r) continue;
        if (!level.inBounds(x, y)) continue;
        if (this.portals.at(level.id, x, y)) continue;   // Eingaenge bleiben
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
      if (fs) { fs.markEntranceDirty(); fs.markDigDirty(); }
    }
    return changed;
  }

  /** Werkzeug "Bauauftrag": Zellen als Baustelle markieren. */
  markDigOrders(colony, level, cx, cy, radius, chamberType = CHAMBER.NONE) {
    let n = 0;
    const r = Math.max(0, radius - 1);
    // Zuerst einen Zugang sichern, sonst haengt der Auftrag unerreichbar fest.
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

  /** Genau ein Simulationstick. */
  step() {
    const t0 = now();
    this.tick++;
    this.ctx.tick = this.tick;
    this.portals.beginTick();

    const t1 = now();
    this.ants.rebuildBuckets(this.levels, this.colonies);
    const t2 = now();

    // --- Nestbau und Distanzfelder (alle Nest-Ebenen) ---------------------
    this._budget.left = DIG.FIELD_BUDGET_PER_TICK;
    for (const level of this.levels.levels) {
      if (level.kind !== LEVEL_KIND.NEST) continue;
      const colony = this.colonies.get(level.colonyId);
      if (!colony || !colony.alive) continue;
      this.construction.update(colony, level, this.rngSim, this.tick);
      const fs = this.fields.get(level.id);
      if (!fs) continue;
      const goals = this._goalBuf;
      goals.length = 0;
      for (const p of this.portals.ofColony(colony.id)) {
        const pos = p.on(level.id);
        if (pos) goals.push(pos.y * level.w + pos.x);
      }
      fs.update(goals, colony.digGoals, colony.digKey, this._budget);
    }
    const t3 = now();

    // --- Einheiten (alle Ebenen) ------------------------------------------
    let spatialMs = 0, antsMs = 0;
    for (const level of this.levels.levels) {
      const l0 = now();
      this.ants.fillSpatial(level);
      const l1 = now();
      this.ants.update(level, this.ctx);
      const l2 = now();
      spatialMs += l1 - l0;
      antsMs += l2 - l1;
      level.simMs = l2 - l0;
      this.perf.levels.set(level.id, level.simMs);
    }

    this.perf.buckets = t2 - t1;
    this.perf.build = t3 - t2;
    this.perf.spatial = spatialMs;
    this.perf.ants = antsMs;
    this.perf.total = now() - t0;
    return this.perf.total;
  }

  /** Debug: n Ameisen der Kolonie hinzufuegen. */
  debugSpawn(n, colonyId = 0) {
    const colony = this.colonies.get(colonyId);
    if (!colony) return 0;
    const before = this.ants.count;
    this.populateColony(colony, n);
    return this.ants.count - before;
  }

  /** Gesamtzahl Portaldurchgaenge (Kennzahl fuers Overlay). */
  get totalPassages() {
    let s = 0;
    for (const p of this.portals.portals) s += p.totalPassages;
    return s;
  }

  /** Summe aller gegrabenen Zellen (Kennzahl fuers Overlay). */
  get totalDug() {
    let s = 0;
    for (const c of this.colonies.colonies) s += c.dugTotal || 0;
    return s;
  }
}

/** Zeitquelle, die sowohl im Browser als auch unter Node funktioniert. */
const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Number(process.hrtime.bigint() / 1000n) / 1000;

export { SURFACE_CELL, NEST_CELL };
