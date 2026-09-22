/**
 * structures.js – Bauwerke, Materialien und Forschung (Phase 11).
 *
 * UNTERSCHIED ZU BEFESTIGUNGSZELLEN
 *   Eine verstaerkte Wand ist nur ein Zelltyp. Ein Bauwerk ist ein Eintrag
 *   mit eigenem Zustand: Stufe, Trefferpunkte, Ladezeit, Besitzer. Es steht
 *   auf genau einer Zelle und wirkt von dort in einem Umkreis.
 *
 * WIE ES ENTSTEHT
 *   1. Die Kolonie forscht nebenbei (Punkte aus Nahrung, Bauten, Werkstatt).
 *   2. Eine freigeschaltete Stufe erscheint im Bauplan.
 *   3. `planBuildings` sucht einen Platz und stellt einen Bauauftrag ein.
 *   4. Ameisen tragen Material heran und bauen; ist der Aufwand erbracht,
 *      entsteht das Bauwerk.
 *   Es gibt keinen Knopf "erforschen" – das Volk lernt, weil es arbeitet.
 *
 * LEISTUNG
 *   Bauwerke sind wenige (hoechstens BUILD.MAX_PER_COLONY je Volk). Sie
 *   laufen deshalb als schlichte Objektliste, nicht als Structure of
 *   Arrays; ihre Wirkung wird nur alle BUILD.TICK_INTERVAL Ticks gerechnet.
 */

import { BUILD, STRUCTURES, RESEARCH_TREE, MATERIALS, FORTIFY } from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { NEST_CELL } from './nest.js';
import { SURFACE_CELL } from './surface.js';
import { ANT_STATE } from './ants.js';
import { CASTE } from './castes.js';
import { FX } from './fx.js';
import { bus, CAT } from './events.js';

export const STRUCT_BY_KEY = new Map(STRUCTURES.map((s, i) => [s.key, { ...s, id: i }]));
export const STRUCT_LIST = STRUCTURES.map((s, i) => ({ ...s, id: i }));
export const RESEARCH_BY_KEY = new Map(RESEARCH_TREE.map((r) => [r.key, r]));
export const MATERIAL_KEYS = MATERIALS.map((m) => m.key);
/** Stoffe, die Sammlerinnen gezielt holen koennen (Chitin faellt nur an). */
const FETCHABLE = new Set(['pebble', 'resin', 'clay', 'lime']);

export class Structures {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    /** @type {Array} alle Bauwerke aller Voelker */
    this.list = [];
    /** Nachschlagen nach Ebene und Zelle: levelId + ':' + index. */
    this.byCell = new Map();
    this.built = 0;
  }

  clear() { this.list.length = 0; this.byCell.clear(); this.built = 0; }

  // -------------------------------------------------------------------------
  // Forschung
  // -------------------------------------------------------------------------

  /** Startzustand der Forschung einer Kolonie. */
  initColony(colony) {
    colony.research = 0;
    colony.researched = new Set();
    colony.unlockedTiers = new Map();     // Bauwerksschluessel -> hoechste Stufe
    colony.knownMaterials = new Set(['pebble', 'resin']);
    colony.structureCount = 0;
    colony.storeBonus = 0;
    for (const k of MATERIAL_KEYS) {
      if (colony.stores[k] === undefined) colony.stores[k] = 0;
    }
  }

  /** Was kann diese Kolonie als naechstes erforschen? */
  nextResearch(colony) {
    for (const r of RESEARCH_TREE) {
      if (colony.researched.has(r.key)) continue;
      if (r.needs.some((n) => !colony.researched.has(n))) continue;
      return r;
    }
    return null;
  }

  /**
   * Forschungspunkte sammeln und faellige Entdeckungen abschliessen.
   * Laeuft im selben Takt wie die Kolonie-KI.
   */
  updateResearch(colony, ticks) {
    const ch = colony.character ? colony.character.research : 1;
    const workshop = colony.workshopBonus || 1;
    colony.research += BUILD.POINTS_PER_TICK * ticks * ch * workshop
      * Math.max(0.2, colony.total / 100);

    let guard = 0;
    for (;;) {
      const r = this.nextResearch(colony);
      if (!r || colony.research < r.cost || guard++ > 4) break;
      colony.research -= r.cost;
      colony.researched.add(r.key);
      this._applyUnlocks(colony, r);
      bus.logEvent(CAT.BAU, colony.name + ' erforscht: ' + r.name, {
        tick: this.world.tick, colonyId: colony.id, levelId: colony.nestLevelIds[0],
      });
    }
  }

  _applyUnlocks(colony, r) {
    for (const u of r.unlocks) {
      const [what, val] = u.split(':');
      if (what === 'material') colony.knownMaterials.add(val);
      else {
        const tier = Number(val);
        const have = colony.unlockedTiers.get(what) || 0;
        if (tier > have) colony.unlockedTiers.set(what, tier);
      }
    }
  }

  /** Hoechste gebaute Stufe eines Bauwerks (0 = keine). */
  tierOf(colony, key) { return colony.unlockedTiers ? (colony.unlockedTiers.get(key) || 0) : 0; }

  // -------------------------------------------------------------------------
  // Bauplanung
  // -------------------------------------------------------------------------

  /**
   * Was braucht die Kolonie als naechstes? Die Reihenfolge ist absichtlich
   * eine schlichte Rangliste und kein Optimierer: sie ist nachvollziehbar
   * und laesst sich an einem Nachmittag nachjustieren.
   */
  planBuildings(colony, ctx) {
    if (!colony.unlockedTiers || colony.unlockedTiers.size === 0) return false;
    // Immer nur EIN offener Auftrag je Volk: mehr laesst sich mit den
    // vorhandenen Arbeiterinnen ohnehin nicht sinnvoll bedienen.
    if (colony.pendingBuild && colony.pendingBuild.length) return false;
    if ((colony.structureCount || 0) >= BUILD.MAX_PER_COLONY) return false;
    if (this.world.tick % BUILD.PLAN_INTERVAL !== 0) return false;

    const nest = this.world.levels.get(colony.nestLevelIds[0]);
    if (!nest) return false;
    const threat = colony.threat || 0;
    const ch = colony.character || {};
    const want = [];

    // Verteidigung, sobald es etwas zu verteidigen gibt
    const turret = this.tierOf(colony, 'turret');
    if (turret > 0) want.push({ key: 'turret', tier: turret, prio: 3 + threat * 2 });
    const guard = this.tierOf(colony, 'guardpost');
    if (guard > 0) want.push({ key: 'guardpost', tier: guard, prio: 2 + threat });
    const sling = this.tierOf(colony, 'sling');
    if (sling > 0) want.push({ key: 'sling', tier: sling, prio: 1.5 + threat });

    // Wirtschaft
    const gran = this.tierOf(colony, 'granary');
    if (gran > 0) want.push({ key: 'granary', tier: gran, prio: 2.5 });
    const shop = this.tierOf(colony, 'workshop');
    if (shop > 0) want.push({ key: 'workshop', tier: shop, prio: 2.2 * (ch.research || 1) });
    const inc = this.tierOf(colony, 'incubator');
    if (inc > 0) want.push({ key: 'incubator', tier: inc, prio: 2.0 * (ch.eggRate || 1) });

    want.sort((a, b) => b.prio - a.prio);

    for (const w of want) {
      const def = STRUCT_BY_KEY.get(w.key);
      const tier = def.tiers[w.tier - 1];
      if (this._countOf(colony, w.key) >= this._capFor(colony, w.key)) continue;
      /**
       * Ein Auftrag entsteht, sobald das Material ERREICHBAR ist – nicht
       * erst, wenn es im Lager liegt. Andersherum gab es eine Verklemmung:
       * ohne Auftrag holt niemand Material und niemand haelt etwas zurueck,
       * also blieb der Vorrat bei null und es entstand nie ein Auftrag. Auf
       * der Steppe stand deshalb nach elf Minuten kein einziges Bauwerk.
       * Fehlt das Material dauerhaft, faellt der Auftrag ueber
       * BUILD.MAX_STALLS wieder heraus.
       */
      if (!this._canObtain(colony, tier.cost)) continue;
      const level = def.where === 'surface' ? this.world.levels.surface : nest;
      const spot = this._findSpot(colony, level, def, ctx);
      if (!spot) continue;
      return this._order(colony, level, spot, def, w.tier);
    }
    return false;
  }

  _countOf(colony, key) {
    let n = 0;
    for (const s of this.list) if (s.colonyId === colony.id && s.key === key) n++;
    return n;
  }

  /** Wie viele Bauwerke einer Art sind sinnvoll? Haengt an der Volksgroesse. */
  _capFor(colony, key) {
    const base = { turret: 6, sling: 4, guardpost: 4, granary: 3, workshop: 2, incubator: 3 };
    const scale = Math.max(1, Math.round(colony.total / 120));
    return Math.min(base[key] || 2, Math.max(1, scale + 1));
  }

  /**
   * Naechste Fundstelle eines Materials, vom Nesteingang aus gesehen.
   *
   * Ohne das bleibt Material liegen: Sammlerinnen laufen dorthin, wo
   * Nahrungsspuren sind, und das ist fast nie der Lehmsaum am Wasser. Im
   * Test waren von 316 Ameisen NULL im Lehmguertel. Eine Kolonie, die
   * bauen will, muss also gezielt jemanden losschicken.
   *
   * Das Ergebnis wird gecached; gesucht wird in einer Spirale vom Eingang
   * aus, damit die naechste Quelle gewinnt und die Suche frueh abbricht.
   */
  findMaterialSpot(colony, key) {
    colony.materialCache = colony.materialCache || {};
    const c = colony.materialCache[key];
    if (c && this.world.tick - c.tick < BUILD.SPOT_CACHE_TICKS && this._stillValid(c, key)) {
      return c;
    }
    const level = this.world.levels.surface;
    const portal = this.world.portals.ofColony(colony.id)[0];
    if (!portal) return null;
    const ox = portal.ax, oy = portal.ay;
    let best = null, bestD = Infinity;
    const step = BUILD.SPOT_SCAN_STEP;
    for (let y = step; y < level.h - step; y += step) {
      for (let x = step; x < level.w - step; x += step) {
        const dx = x - ox, dy = y - oy;
        const d = dx * dx + dy * dy;
        if (d >= bestD || d > BUILD.SPOT_MAX_DIST * BUILD.SPOT_MAX_DIST) continue;
        if (!this._isSource(level, x, y, key)) continue;
        bestD = d; best = { x, y };
      }
    }
    if (!best) { colony.materialCache[key] = { x: -1, y: -1, tick: this.world.tick }; return null; }
    best.tick = this.world.tick;
    colony.materialCache[key] = best;
    return best;
  }

  _stillValid(c, key) {
    if (c.x < 0) return true;             // "nichts gefunden" gilt auch eine Weile
    const level = this.world.levels.surface;
    return this._isSource(level, c.x, c.y, key);
  }

  _isSource(level, x, y, key) {
    const cell = level.cells[y * level.w + x];
    // Kiesel und Harz liegen offen und brauchen keine weitere Bedingung
    if (key === 'pebble') return cell === SURFACE_CELL.PEBBLE;
    if (key === 'resin') return cell === SURFACE_CELL.PLANT;
    if (key === 'lime') {
      return cell === SURFACE_CELL.STONE
        || level.get(x - 1, y) === SURFACE_CELL.STONE
        || level.get(x + 1, y) === SURFACE_CELL.STONE;
    }
    if (key !== 'clay') return false;
    if (cell !== SURFACE_CELL.DIRT && cell !== SURFACE_CELL.SAND) return false;
    const R = BUILD.CLAY_RADIUS;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (level.get(x + dx, y + dy) === SURFACE_CELL.WATER) return true;
      }
    }
    return false;
  }

  /**
   * Welches Material fehlt der Kolonie gerade am dringendsten?
   * Setzt colony.wantMaterial und colony.materialSpot fuer die Ameisen.
   */
  updateWants(colony) {
    const job = colony.pendingBuild && colony.pendingBuild[0];
    let want = null;
    if (job) {
      // Was der laufenden Baustelle fehlt, hat Vorrang
      for (const k of Object.keys(job.cost)) {
        if ((colony.stores[k] || 0) < job.cost[k] && FETCHABLE.has(k)) { want = k; break; }
      }
    }
    // Ohne Baustelle: vorsorglich auffuellen, was bekannt und knapp ist
    if (!want) {
      for (const k of ['clay', 'lime', 'pebble', 'resin']) {
        if (!FETCHABLE.has(k)) continue;
        if (k !== 'pebble' && k !== 'resin' && !colony.knownMaterials.has(k)) continue;
        if ((colony.stores[k] || 0) < BUILD.STOCK_TARGET) { want = k; break; }
      }
    }
    colony.wantMaterial = want;
    if (!want) { colony.materialSpot = null; return; }
    const spot = this.findMaterialSpot(colony, want);
    colony.materialSpot = spot && spot.x >= 0 ? spot : null;
  }

  /** Kennt die Kolonie alle noetigen Stoffe? (Vorrat egal) */
  _canObtain(colony, cost) {
    for (const k of Object.keys(cost)) {
      if (k !== 'pebble' && k !== 'resin' && !colony.knownMaterials.has(k)) return false;
    }
    return true;
  }

  _canAfford(colony, cost) {
    for (const k of Object.keys(cost)) {
      if ((colony.stores[k] || 0) < cost[k]) return false;
      if (k !== 'pebble' && k !== 'resin' && !colony.knownMaterials.has(k)) return false;
    }
    return true;
  }

  /**
   * Platz suchen. Geschuetze wollen an den Eingang, Wirtschaftsbauten in
   * die Kammern. Beides mit Mindestabstand, damit nicht alles auf einem
   * Haufen steht.
   */
  _findSpot(colony, level, def, ctx) {
    const rng = ctx.rng;
    const nearGate = def.key === 'turret' || def.key === 'guardpost' || def.key === 'sling';
    const portal = this.world.portals.ofColony(colony.id)[0];
    if (!portal) return null;
    const anchor = level.kind === LEVEL_KIND.SURFACE
      ? { x: portal.ax, y: portal.ay } : { x: portal.bx, y: portal.by };

    for (let t = 0; t < 60; t++) {
      let x, y;
      if (nearGate) {
        const a = rng.angle();
        const r = 3 + rng.float() * 14;
        x = Math.round(anchor.x + Math.cos(a) * r);
        y = Math.round(anchor.y + Math.sin(a) * (level.kind === LEVEL_KIND.NEST
          ? Math.abs(Math.sin(a)) * 10 + 2 : r));
      } else {
        x = Math.round(anchor.x + rng.range(-35, 35));
        y = Math.round(anchor.y + rng.range(6, 60));
      }
      if (!level.inBounds(x, y)) continue;
      if (level.kind === LEVEL_KIND.NEST && y <= 7) continue;
      if (level.isSolid(x, y)) continue;
      if (this.world.portals.at(level.id, x, y)) continue;
      if (this.at(level.id, x, y)) continue;
      if (this._tooClose(level.id, x, y, def.key)) continue;
      return { x, y };
    }
    return null;
  }

  _tooClose(levelId, x, y, key) {
    const r2 = BUILD.MIN_SPACING * BUILD.MIN_SPACING;
    for (const s of this.list) {
      if (s.levelId !== levelId || s.key !== key) continue;
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  /**
   * BAUAUFTRAG DES SPIELERS. Gleiche Warteschlange wie die Selbstplanung,
   * nur mit gewaehltem Ort - das Bauwerk entsteht nicht aus dem Nichts,
   * sondern muss gebaut und bezahlt werden wie jedes andere.
   *
   * @returns {{ok:boolean, grund?:string}}
   */
  order(colony, level, x, y, key) {
    // STRUCTURES ist eine LISTE, kein Nachschlagewerk – der erste Versuch
    // griff mit dem Schluessel hinein und bekam immer undefined.
    const def = STRUCTURES.find((d) => d.key === key);
    if (!def) return { ok: false, grund: 'Unbekanntes Bauwerk' };
    const tier = this.tierOf(colony, key);
    if (tier <= 0) return { ok: false, grund: def.name + ' ist noch nicht erforscht' };
    if ((colony.structureCount || 0) >= BUILD.MAX_PER_COLONY) {
      return { ok: false, grund: 'Hoechstzahl an Bauwerken erreicht' };
    }
    if (colony.pendingBuild && colony.pendingBuild.length >= BUILD.MAX_ORDERS) {
      return { ok: false, grund: 'Es wird schon gebaut' };
    }
    if (!level.inBounds(x, y) || level.isSolid(x, y)) {
      return { ok: false, grund: 'Kein Platz an dieser Stelle' };
    }
    if (this._tooClose(level.id, x, y, key)) {
      return { ok: false, grund: 'Zu nah an einem gleichen Bauwerk' };
    }
    this._order(colony, level, { x, y }, def, tier);
    bus.logEvent(CAT.BAU, colony.name + ': ' + def.name + ' in Auftrag gegeben', {
      tick: this.world.tick, levelId: level.id, x, y, colonyId: colony.id,
    });
    return { ok: true };
  }

  /** Bauauftrag einstellen; gebaut wird von den Ameisen wie alles andere. */
  _order(colony, level, spot, def, tier) {
    const t = def.tiers[tier - 1];
    colony.pendingBuild = colony.pendingBuild || [];
    colony.pendingBuild.push({
      key: def.key, tier, levelId: level.id, x: spot.x, y: spot.y,
      effort: t.effort * (colony.buildDiscount || 1), done: 0, cost: t.cost,
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Bauen und Zustand
  // -------------------------------------------------------------------------

  /**
   * Arbeit an der aktuellen Baustelle. Wird von den Ameisen im Zustand
   * BUILD aufgerufen und liefert true, wenn das Bauwerk fertig wurde.
   */
  contribute(colony, amount) {
    const q = colony.pendingBuild;
    if (!q || !q.length) return 0;
    const job = q[0];
    job.done += amount;
    if (job.done < job.effort) return 0;

    /**
     * Material wird erst beim Abschluss abgebucht, sonst haelt eine
     * halbfertige Baustelle den Vorrat auf unbestimmte Zeit fest.
     *
     * Fehlt es, darf die Baustelle die Warteschlange aber NICHT blockieren:
     * im ersten Anlauf lief sie endlos auf 85 Prozent und band immer mehr
     * Ameisen, bis das Volk verhungerte. Jetzt zaehlt ein Geduldsfaden mit,
     * und danach fliegt der Auftrag raus.
     */
    if (!this._canAfford(colony, job.cost)) {
      job.done = job.effort * 0.9;
      job.stalled = (job.stalled || 0) + 1;
      if (job.stalled > BUILD.MAX_STALLS) {
        q.shift();
        return -1;
      }
      return -1;
    }
    for (const k of Object.keys(job.cost)) colony.stores[k] -= job.cost[k];
    q.shift();
    this.create(colony, job.levelId, job.x, job.y, job.key, job.tier);
    return 1;
  }

  /** Bauwerk setzen (auch fuer Werkzeuge und Eingriffe). */
  create(colony, levelId, x, y, key, tier) {
    const def = STRUCT_BY_KEY.get(key);
    const level = this.world.levels.get(levelId);
    if (!def || !level) return null;
    const t = def.tiers[Math.max(0, Math.min(def.tiers.length - 1, tier - 1))];
    const old = this.at(levelId, x, y);
    if (old) this.remove(old);
    const s = {
      id: this.built++, key, tier, def, stats: t,
      colonyId: colony.id, levelId, x, y,
      hp: t.hp, hpMax: t.hp, cooldown: 0, target: -1, active: true,
    };
    this.list.push(s);
    this.byCell.set(levelId + ':' + (y * level.w + x), s);
    colony.structureCount = (colony.structureCount || 0) + 1;
    this._refreshBonuses(colony);
    bus.logEvent(CAT.BAU, colony.name + ' errichtet ' + def.name + ' (Stufe ' + tier + ')', {
      tick: this.world.tick, colonyId: colony.id, levelId, x, y,
    });
    this.world.emitFx(FX.DUST, levelId, x, y, 6);
    return s;
  }

  at(levelId, x, y) {
    const level = this.world.levels.get(levelId);
    if (!level) return null;
    return this.byCell.get(levelId + ':' + (y * level.w + x)) || null;
  }

  remove(s) {
    const i = this.list.indexOf(s);
    if (i < 0) return;
    this.list.splice(i, 1);
    const level = this.world.levels.get(s.levelId);
    if (level) this.byCell.delete(s.levelId + ':' + (s.y * level.w + s.x));
    const colony = this.world.colonies.get(s.colonyId);
    if (colony) {
      colony.structureCount = Math.max(0, (colony.structureCount || 1) - 1);
      this._refreshBonuses(colony);
    }
    this.world.emitFx(FX.DUST, s.levelId, s.x, s.y, 8);
  }

  /** Dauerwirkungen (Lager, Forschung, Baurabatt) neu zusammenrechnen. */
  _refreshBonuses(colony) {
    let store = 0, research = 1, discount = 1;
    for (const s of this.list) {
      if (s.colonyId !== colony.id || !s.active) continue;
      if (s.stats.store) store += s.stats.store;
      if (s.stats.research) research = Math.max(research, s.stats.research);
      if (s.stats.discount) discount = Math.min(discount, s.stats.discount);
    }
    colony.storeBonus = store;
    colony.workshopBonus = research;
    colony.buildDiscount = discount;
  }

  // -------------------------------------------------------------------------
  // Wirkung im Tick
  // -------------------------------------------------------------------------

  /**
   * Bauwerke wirken. Geschuetze suchen Ziele, Wachposten staerken die
   * Umgebung, Brutstuben beschleunigen die Brut.
   */
  update(ctx) {
    if (this.world.tick % BUILD.TICK_INTERVAL !== 0) return;
    const step = BUILD.TICK_INTERVAL;
    const ants = ctx.ants;
    const creatures = ctx.creatures;

    for (let k = this.list.length - 1; k >= 0; k--) {
      const s = this.list[k];
      if (s.hp <= 0) { this.remove(s); continue; }
      const level = this.world.levels.get(s.levelId);
      if (!level) { this.remove(s); continue; }
      // Verschuettet? Dann ist das Bauwerk hin.
      if (level.isSolid(s.x, s.y)) { this.remove(s); continue; }
      if (s.cooldown > 0) s.cooldown -= step;

      if (s.stats.damage !== undefined) this._shoot(s, level, ants, creatures, ctx);
    }
  }

  /** Ein Geschuetz sucht das naechste feindliche Ziel und feuert. */
  _shoot(s, level, ants, creatures, ctx) {
    if (s.cooldown > 0) return;
    const colony = this.world.colonies.get(s.colonyId);
    if (!colony) return;
    // Schuesse kosten Vorrat – ein leeres Lager schweigt
    const cost = BUILD.SHOT_COST.sugar;
    if (colony.storeArr[0] < cost) return;

    const r = s.stats.range;
    const r2 = r * r;
    let best = -1, bestD = r2, isCreature = false;

    const bucket = ants.buckets.get(level.id);
    if (bucket) {
      for (let k = 0; k < bucket.count; k++) {
        const i = bucket.ids[k];
        if (ants.colony[i] === s.colonyId) continue;
        if (this.world.diplomacy.allied(s.colonyId, ants.colony[i])) continue;
        if (ants.state[i] === ANT_STATE.TRANSIT) continue;
        const dx = ants.x[i] - s.x, dy = ants.y[i] - s.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; isCreature = false; }
      }
    }
    const cb = creatures.buckets.get(level.id);
    if (cb) {
      for (let k = 0; k < cb.count; k++) {
        const i = cb.ids[k];
        if (!creatures.speciesDef(i).prey) continue;      // nur Raeuber beschiessen
        const dx = creatures.x[i] - s.x, dy = creatures.y[i] - s.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; isCreature = true; }
      }
    }
    if (best < 0) return;

    colony.storeArr[0] -= cost;
    s.cooldown = s.stats.reload;
    const dmg = s.stats.damage;
    if (isCreature) {
      creatures.hp[best] -= dmg;
    } else {
      ants.hp[best] -= dmg;
      if (s.stats.slow) ants.speed[best] *= s.stats.slow;
      if (ants.hp[best] <= 0) {
        this.world.emitFx(FX.GORE, level.id, ants.x[best] | 0, ants.y[best] | 0, 4);
        ants.kill(best);
        colony.turretKills = (colony.turretKills || 0) + 1;
      }
    }
    this.world.emitFx(FX.SPARK, level.id, s.x, s.y, 2);
  }

  /** Kampfbonus durch Wachposten an dieser Stelle. */
  guardBonus(levelId, x, y, colonyId) {
    let bonus = 1;
    for (const s of this.list) {
      if (s.levelId !== levelId || s.colonyId !== colonyId || !s.stats.bonus) continue;
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy <= s.stats.range * s.stats.range) {
        bonus = Math.max(bonus, s.stats.bonus);
      }
    }
    return bonus;
  }

  /** Reifebeschleunigung durch Brutstuben an dieser Stelle. */
  broodSpeed(levelId, x, y, colonyId) {
    let f = 1;
    for (const s of this.list) {
      if (s.levelId !== levelId || s.colonyId !== colonyId || !s.stats.speed) continue;
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy <= s.stats.range * s.stats.range) f = Math.max(f, s.stats.speed);
    }
    return f;
  }

  /** Schaden an einem Bauwerk (Einsturz, Eingriff, Feind). */
  damage(s, amount) {
    s.hp -= amount;
    if (s.hp <= 0) this.remove(s);
  }

  /** Alle Bauwerke eines Volkes (fuer Anzeige und Speicherstand). */
  ofColony(colonyId) { return this.list.filter((s) => s.colonyId === colonyId); }

  toJSON() {
    return this.list.map((s) => ({
      key: s.key, tier: s.tier, colonyId: s.colonyId, levelId: s.levelId,
      x: s.x, y: s.y, hp: s.hp, cooldown: s.cooldown,
    }));
  }

  fromJSON(arr) {
    this.clear();
    for (const d of arr || []) {
      const colony = this.world.colonies.get(d.colonyId);
      if (!colony) continue;
      const s = this.create(colony, d.levelId, d.x, d.y, d.key, d.tier);
      if (s) { s.hp = d.hp; s.cooldown = d.cooldown; }
    }
  }
}

/** Zelltyp, aus dem ein Material gewonnen wird. */
export const MATERIAL_SOURCE = {
  clay: { surface: SURFACE_CELL.DIRT, nest: NEST_CELL.SOIL, needsWater: true },
  lime: { surface: SURFACE_CELL.STONE, nest: NEST_CELL.STONE },
  chitin: null,        // faellt bei erlegten Tieren an
};

void FORTIFY; void CASTE;
