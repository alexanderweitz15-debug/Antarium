/**
 * world.js – Weltaufbau und Tick-Orchestrierung.
 *
 * Buendelt alle Simulationsteile (Ebenen, Portale, Kolonien, Ameisen) und
 * fuehrt genau einen deterministischen Tick aus. Das Modul kennt WEDER PixiJS
 * NOCH das DOM – es laeuft unveraendert auch headless unter Node, was fuer
 * Tests und Performance-Messungen benutzt wird.
 *
 * Reihenfolge eines Ticks:
 *   1. Portalzaehler zuruecksetzen (Kapazitaet pro Tick)
 *   2. Ameisenindizes nach Ebene buckeln, Kolonie-Zaehler aktualisieren
 *   3. Fuer JEDE Ebene: Spatial Hash fuellen, Einheiten simulieren
 * Punkt 3 laeuft fuer alle Ebenen, auch fuer unsichtbare. Das ist Absicht.
 */

import { COLONY } from '../config.js';
import { RNG } from '../rng.js';
import { LevelManager } from './levels.js';
import { createSurface, findNestSite, buildEntrance, dumpSoil } from './surface.js';
import { createNest, buildStartNest, randomAirCell } from './nest.js';
import { PortalSystem } from './portals.js';
import { ColonyManager } from './colony.js';
import { Ants, ANT_STATE } from './ants.js';
import { CASTE } from './castes.js';
import { bus, CAT } from './events.js';

export class World {
  /** @param {string} seed */
  constructor(seed) {
    this.seed = String(seed);
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

    /** Messwerte des letzten Ticks (ms). */
    this.perf = {
      total: 0,
      buckets: 0,
      spatial: 0,
      ants: 0,
      levels: new Map(), // levelId -> ms
    };

    this.ctx = { portals: this.portals, levels: this.levels, rng: this.rngSim, tick: 0 };
  }

  /** Welt erzeugen: Oberflaeche, erste Kolonie, deren Nest-Ebene, Portal. */
  generate() {
    const surface = this.levels.add(createSurface(this.rngGen));
    this.ants.registerLevel(surface.id);
    this.foundColony();
    bus.logEvent(CAT.SYS, 'Welt erzeugt (Seed "' + this.seed + '")', { tick: 0, levelId: surface.id });
    return this;
  }

  /**
   * Gruendet eine Kolonie: sucht einen Platz an der Oberflaeche, legt deren
   * Nest-Ebene an und verbindet beide durch ein Portalpaar.
   */
  foundColony() {
    const surface = this.levels.surface;
    const colony = this.colonies.create();
    const taken = this.portals.portals
      .filter((p) => p.aLevelId === surface.id)
      .map((p) => ({ x: p.ax, y: p.ay }));
    const site = findNestSite(surface, this.rngGen, taken);
    buildEntrance(surface, site.x, site.y);

    const nest = this.levels.add(createNest(this.rngGen, { colonyId: colony.id, name: 'Nest ' + colony.name }));
    this.ants.registerLevel(nest.id);
    const layout = buildStartNest(nest, this.rngGen);
    colony.nestLevelIds.push(nest.id);
    colony.layout = layout;

    const portal = this.portals.create({
      colonyId: colony.id,
      aLevelId: surface.id, ax: site.x, ay: site.y,
      bLevelId: nest.id, bx: layout.entrance.x, by: layout.entrance.y,
    });
    colony.portalIds.push(portal.id);

    // Aushub des Startnests liegt als Erdhuegel an der Oberflaeche.
    const heaps = Math.round(layout.dugCells / 12);
    for (let i = 0; i < heaps; i++) dumpSoil(surface, site.x, site.y, this.rngGen);

    this.populateColony(colony, COLONY.START_ANTS);
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

    this.ants.spawn({
      levelId: nest.id, x: layout.queen.x + 0.5, y: layout.queen.y + 0.5,
      colonyId: colony.id, casteId: CASTE.QUEEN, dir: rng.angle(), state: ANT_STATE.IDLE,
    });

    for (let i = 0; i < n; i++) {
      const soldier = rng.chance(0.12);
      const caste = soldier ? CASTE.SOLDIER : CASTE.WORKER;
      if (rng.chance(0.45)) {
        const spot = randomAirCell(nest, rng);
        if (!spot) continue;
        this.ants.spawn({
          levelId: nest.id, x: spot.x + 0.5, y: spot.y + 0.5, colonyId: colony.id,
          casteId: caste, dir: rng.angle(), state: ANT_STATE.EXPLORE, timer: rng.intRange(30, 400),
        });
      } else {
        const spot = this.surfaceSpotNear(surface, layout.entrance.x, layout.entrance.y, colony, rng);
        const p = this.portals.ofColony(colony.id)[0];
        const sx = p ? p.ax : surface.w >> 1;
        const sy = p ? p.ay : surface.h >> 1;
        const pos = spot || { x: sx, y: sy };
        this.ants.spawn({
          levelId: surface.id, x: pos.x + 0.5, y: pos.y + 0.5, colonyId: colony.id,
          casteId: caste, dir: rng.angle(), state: ANT_STATE.EXPLORE, timer: rng.intRange(30, 900),
        });
      }
    }
  }

  /** Freie Oberflaechenzelle in der Naehe des Eingangs. */
  surfaceSpotNear(surface, _nx, _ny, colony, rng) {
    const p = this.portals.ofColony(colony.id)[0];
    if (!p) return null;
    for (let i = 0; i < 60; i++) {
      const a = rng.angle();
      const r = 1 + rng.float() * 14;
      const x = Math.round(p.ax + Math.cos(a) * r);
      const y = Math.round(p.ay + Math.sin(a) * r);
      if (!surface.inBounds(x, y)) continue;
      if (surface.isSolid(x, y)) continue;
      return { x, y };
    }
    return null;
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
    this.perf.spatial = spatialMs;
    this.perf.ants = antsMs;
    this.perf.total = now() - t0;
    return this.perf.total;
  }

  /** Debug: n Ameisen gleichmaessig ueber alle Ebenen der Kolonie verteilen. */
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
}

/** Zeitquelle, die sowohl im Browser als auch unter Node funktioniert. */
const now = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : () => Number(process.hrtime.bigint() / 1000n) / 1000;
