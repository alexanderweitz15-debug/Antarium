/**
 * interventions.js – Goettliche Eingriffe (Phase 9).
 *
 * Jeder Eingriff ist ein Eintrag in einer Tabelle: Name, Beschreibung, auf
 * welchen Ebenen er sinnvoll ist, Energiekosten und eine apply()-Funktion.
 * Die Werkzeugleiste baut ihre Knoepfe daraus – ein neuer Eingriff braucht
 * nur einen Tabelleneintrag.
 *
 * Grundsatz: Eingriffe wirken EBENENUEBERGREIFEND, wo das physikalisch
 * Sinn ergibt. Ein Erdbeben an der Oberflaeche erschuettert jedes Nest,
 * dessen Eingang im Radius liegt; eine Flut laeuft ueber die Eingaenge in
 * die Nester hinein.
 */

import { GODMODE, SIM } from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { SURFACE_CELL } from './surface.js';
import { NEST_CELL, CHAMBER } from './nest.js';
import { CASTE } from './castes.js';
import { FX } from './fx.js';
import { PH } from './pheromones.js';
import { broodSpot } from './brood.js';

import { SPECIES_LIST } from './creatures.js';
import { bus, CAT } from './events.js';

/**
 * Tabelle aller Eingriffe.
 *   where : 'surface' | 'nest' | 'both' | 'colony' (wirkt auf eine Kolonie)
 *   cost  : goettliche Energie im Herausforderungsmodus
 */
export const INTERVENTIONS = [
  {
    key: 'reinforce', name: 'Verstaerkung', cost: 20, where: 'colony', icon: 'ant_soldier',
    desc: 'Setzt sofort Soldatinnen der gewaehlten Kolonie an ihrem Eingang ab.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const p = world.portals.ofColony(colony.id)[0];
      const lvl = world.levels.surface;
      const px = p ? p.ax : x, py = p ? p.ay : y;
      const n = world.spawnAntsAt(colony.id, lvl, px, py,
        Math.round(GODMODE.REINFORCE_COUNT * o.power), CASTE.SOLDIER);
      log(world, CAT.KAMPF, n + ' Soldatinnen fuer ' + colony.name + ' herbeigerufen', lvl.id, px, py);
      return n;
    },
  },
  {
    key: 'quake', name: 'Erdbeben', cost: 35, where: 'both', icon: 'glyph:≈',
    fx: FX.DUST, fxCount: 30,
    desc: 'An der Oberflaeche: erschuettert alle Nester mit Eingang im Radius. In einer Nest-Ebene: wirkt nur dort, dafuer gezielt.',
    apply(world, level, x, y, o) {
      let fell = 0;
      if (level.kind === LEVEL_KIND.NEST) {
        fell = world.stability.quake(level, x, y, o.radius, 0.35 * o.power, world.ctx);
      } else {
        // Oberflaeche leicht umgestalten
        for (let i = 0; i < o.radius * 4; i++) {
          const a = world.rngSim.angle();
          const r = world.rngSim.float() * o.radius;
          const cx = Math.round(x + Math.cos(a) * r), cy = Math.round(y + Math.sin(a) * r);
          if (!level.inBounds(cx, cy)) continue;
          const c = level.cells[cy * level.w + cx];
          if (c === SURFACE_CELL.GRASS) level.set(cx, cy, SURFACE_CELL.DIRT);
          else if (c === SURFACE_CELL.DIRT && world.rngSim.chance(0.2)) level.set(cx, cy, SURFACE_CELL.PEBBLE);
        }
        // Jedes Nest mit Eingang im Radius bebt mit
        for (const p of world.portals.portals) {
          if (p.aLevelId !== level.id) continue;
          const dx = p.ax - x, dy = p.ay - y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > o.radius) continue;
          const nest = world.levels.get(p.bLevelId);
          if (!nest) continue;
          const strength = 0.4 * o.power * (1 - d / o.radius);
          fell += world.stability.quake(nest, p.bx, p.by + 20,
            GODMODE.QUAKE_NEST_RADIUS, strength, world.ctx);
        }
      }
      world.shake = Math.min(1.5, (world.shake || 0) + 0.9 * o.power);
      log(world, CAT.KATASTROPHE, 'Erdbeben: ' + fell + ' Zellen eingestuerzt', level.id, x, y);
      return fell;
    },
  },
  {
    key: 'flood', name: 'Flut', cost: 30, where: 'surface', icon: 'cell:water',
    fx: FX.SPLASH, fxCount: 24,
    desc: 'Wasser ueberschwemmt das Gebiet und laeuft ueber die Eingaenge in die Nester.',
    apply(world, level, x, y, o) {
      let cells = 0;
      const r = o.radius;
      for (let cy = y - r; cy <= y + r; cy++) {
        for (let cx = x - r; cx <= x + r; cx++) {
          const dx = cx - x, dy = cy - y;
          if (dx * dx + dy * dy > r * r) continue;
          if (!level.inBounds(cx, cy)) continue;
          const c = level.cells[cy * level.w + cx];
          if (c === SURFACE_CELL.STONE) continue;
          if (world.portals.at(level.id, cx, cy)) continue;
          level.set(cx, cy, SURFACE_CELL.WATER);
          cells++;
        }
      }
      // Ueber die Eingaenge in die Nester
      for (const p of world.portals.portals) {
        if (p.aLevelId !== level.id) continue;
        const dx = p.ax - x, dy = p.ay - y;
        if (dx * dx + dy * dy > r * r) continue;
        const nest = world.levels.get(p.bLevelId);
        if (!nest) continue;
        cells += floodNest(world, nest, p.bx, p.by, Math.round(GODMODE.FLOOD_DEPTH * o.power));
        const colony = world.colonies.get(p.colonyId);
        if (colony) {
          colony.stressEvents = (colony.stressEvents || 0) + 0.25;
          colony.threat = Math.max(colony.threat, 2);
        }
      }
      log(world, CAT.KATASTROPHE, 'Flut: ' + cells + ' Zellen unter Wasser', level.id, x, y);
      return cells;
    },
  },
  {
    key: 'meteor', name: 'Meteor', cost: 60, where: 'surface', icon: 'glyph:☄',
    fx: FX.DUST, fxCount: 40,
    desc: 'Schlaegt einen Krater und laesst die Nester darunter erzittern.',
    apply(world, level, x, y, o) {
      const r = Math.round(o.radius * GODMODE.METEOR_CRATER);
      for (let cy = y - r; cy <= y + r; cy++) {
        for (let cx = x - r; cx <= x + r; cx++) {
          const dx = cx - x, dy = cy - y;
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          if (!level.inBounds(cx, cy)) continue;
          level.set(cx, cy, d2 < r * r * 0.35 ? SURFACE_CELL.DIRT : SURFACE_CELL.SAND);
          level.setMeta(cx, cy, 0);
        }
      }
      // Alles im Krater stirbt
      let killed = 0;
      const ants = world.ants;
      const b = ants.buckets.get(level.id);
      if (b) {
        for (let k = b.count - 1; k >= 0; k--) {
          const i = b.ids[k];
          const dx = ants.x[i] - x, dy = ants.y[i] - y;
          if (dx * dx + dy * dy > r * r) continue;
          ants.kill(i);
          killed++;
        }
      }
      INTERVENTIONS.find((q) => q.key === 'quake').apply(world, level, x, y,
        { ...o, radius: o.radius * 1.6, power: o.power * 1.4 });
      log(world, CAT.KATASTROPHE, 'Meteoreinschlag: ' + killed + ' Einheiten ausgeloescht', level.id, x, y);
      return killed;
    },
  },
  {
    key: 'lightning', name: 'Blitz', cost: 15, where: 'both', icon: 'glyph:⚡',
    fx: FX.SPARK, fxCount: 26,
    desc: 'Schlaegt punktgenau ein und toetet alles im kleinen Umkreis.',
    apply(world, level, x, y, o) {
      const r = Math.max(2, o.radius * 0.25);
      let killed = 0;
      const ants = world.ants;
      const b = ants.buckets.get(level.id);
      if (b) {
        for (let k = b.count - 1; k >= 0; k--) {
          const i = b.ids[k];
          const dx = ants.x[i] - x, dy = ants.y[i] - y;
          if (dx * dx + dy * dy > r * r) continue;
          ants.hp[i] -= GODMODE.LIGHTNING_DAMAGE * o.power;
          if (ants.hp[i] <= 0) { ants.kill(i); killed++; }
        }
      }
      const cb = world.creatures.buckets.get(level.id);
      if (cb) {
        for (let k = cb.count - 1; k >= 0; k--) {
          const i = cb.ids[k];
          const dx = world.creatures.x[i] - x, dy = world.creatures.y[i] - y;
          if (dx * dx + dy * dy > r * r) continue;
          world.creatures.hp[i] -= GODMODE.LIGHTNING_DAMAGE * o.power;
        }
      }
      world.shake = Math.min(1.2, (world.shake || 0) + 0.5);
      log(world, CAT.KATASTROPHE, 'Blitzschlag: ' + killed + ' Einheiten getroffen', level.id, x, y);
      return killed;
    },
  },
  {
    key: 'drought', name: 'Duerre', cost: 25, where: 'surface', icon: 'glyph:☀',
    desc: 'Nahrung waechst eine Weile nicht nach und Pfuetzen trocknen aus.',
    apply(world, level, x, y, o) {
      world.weather.drought = Math.round(GODMODE.DROUGHT_TICKS * o.power);
      log(world, CAT.KATASTROPHE, 'Duerre fuer '
        + Math.round(world.weather.drought / SIM.TICK_RATE) + ' Sekunden', level.id, x, y);
      return 1;
    },
  },
  {
    key: 'rain', name: 'Regen', cost: 15, where: 'surface', icon: 'glyph:☔',
    desc: 'Nahrung waechst doppelt so schnell nach, Pfuetzen fuellen sich.',
    apply(world, level, x, y, o) {
      world.weather.rain = Math.round(GODMODE.RAIN_TICKS * o.power);
      log(world, CAT.SYS, 'Regen faellt', level.id, x, y);
      return 1;
    },
  },
  {
    key: 'foodrain_sugar', name: 'Zuckerregen', cost: 10, where: 'surface', icon: 'cell:sugarcube',
    desc: 'Laesst Zucker vom Himmel fallen.',
    apply(world, level, x, y, o) { return foodRain(world, level, x, y, o, SURFACE_CELL.SUGARCUBE, 'Zucker'); },
  },
  {
    key: 'foodrain_meat', name: 'Fleischregen', cost: 14, where: 'surface', icon: 'cell:meat',
    desc: 'Laesst Fleisch vom Himmel fallen – die Proteinquelle schlechthin.',
    apply(world, level, x, y, o) { return foodRain(world, level, x, y, o, SURFACE_CELL.MEAT, 'Protein'); },
  },
  {
    key: 'foodrain_seeds', name: 'Samenregen', cost: 10, where: 'surface', icon: 'cell:seedpile',
    desc: 'Laesst Samen vom Himmel fallen.',
    apply(world, level, x, y, o) { return foodRain(world, level, x, y, o, SURFACE_CELL.SEEDPILE, 'Fett'); },
  },
  {
    key: 'plague', name: 'Seuche', cost: 40, where: 'colony', icon: 'glyph:☠',
    desc: 'Befaellt eine Kolonie. Kranke Ameisen stecken andere an.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      colony.plague = Math.round(GODMODE.PLAGUE_TICKS * o.power);
      colony.stressEvents = (colony.stressEvents || 0) + 0.4;
      log(world, CAT.KATASTROPHE, 'Seuche bricht in ' + colony.name + ' aus',
        colony.nestLevelIds[0], -1, -1);
      return 1;
    },
  },
  {
    key: 'blessing', name: 'Segen', cost: 20, where: 'colony', icon: 'glyph:✦',
    desc: 'Heilt alle Ameisen der Kolonie und vertreibt die Seuche.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const ants = world.ants;
      let n = 0;
      for (let i = 0; i < ants.high; i++) {
        if (!ants.alive[i] || ants.colony[i] !== colony.id) continue;
        ants.hp[i] = ants.hpMax[i];
        ants.hunger[i] = 0;
        n++;
      }
      colony.plague = 0;
      log(world, CAT.SYS, 'Segen: ' + n + ' Ameisen von ' + colony.name + ' geheilt',
        colony.nestLevelIds[0], -1, -1);
      return n;
    },
  },
  {
    key: 'frenzy', name: 'Raserei', cost: 25, where: 'colony', icon: 'glyph:↯',
    desc: 'Die Kolonie wird fuer eine Weile deutlich schneller.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      colony.frenzy = Math.round(GODMODE.FRENZY_TICKS * o.power);
      log(world, CAT.SYS, colony.name + ' geraet in Raserei', colony.nestLevelIds[0], -1, -1);
      return 1;
    },
  },
  {
    key: 'swarm', name: 'Raeuberschwarm', cost: 30, where: 'surface', icon: 'creature:wolfspider',
    desc: 'Laesst einen Schwarm Jaeger auf das Gebiet los.',
    apply(world, level, x, y, o) {
      let n = 0;
      const kinds = SPECIES_LIST.filter((s) => s.prey);
      for (let i = 0; i < Math.round(GODMODE.SWARM_COUNT * o.power); i++) {
        const sp = kinds[world.rngSim.int(kinds.length)];
        n += world.spawnCreaturesAt(sp.key, level,
          x + world.rngSim.intRange(-o.radius, o.radius),
          y + world.rngSim.intRange(-o.radius, o.radius), 1);
      }
      log(world, CAT.RAEUBER, n + ' Raeuber herbeigerufen', level.id, x, y);
      return n;
    },
  },
  {
    key: 'killqueen', name: 'Koenigin toeten', cost: 50, where: 'colony', icon: 'ant_queen',
    desc: 'Toetet die Koenigin der gewaehlten Kolonie. Ohne sie gibt es keine Brut mehr.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const ants = world.ants;
      for (let i = 0; i < ants.high; i++) {
        if (!ants.alive[i] || ants.colony[i] !== colony.id) continue;
        if (ants.caste[i] !== CASTE.QUEEN) continue;
        const lvl = world.levels.get(ants.level[i]);
        world.queenDied(colony, lvl || world.levels.surface, ants.x[i], ants.y[i]);
        ants.kill(i);
        return 1;
      }
      return 0;
    },
  },
  {
    key: 'wipe', name: 'Kolonie ausloeschen', cost: 80, where: 'colony', icon: 'glyph:✗',
    desc: 'Loescht eine Kolonie vollstaendig aus. Ihr Nest bleibt als verlassener Bau zurueck.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const ants = world.ants;
      let n = 0;
      for (let i = 0; i < ants.high; i++) {
        if (ants.alive[i] && ants.colony[i] === colony.id) { ants.kill(i); n++; }
      }
      for (let i = 0; i < world.brood.high; i++) {
        if (world.brood.alive[i] && world.brood.colony[i] === colony.id) world.brood.kill(i);
      }
      world.extinguish(colony);
      return n;
    },
  },
  {
    key: 'nuptial', name: 'Hochzeitsflug', cost: 30, where: 'colony', icon: 'ant_alate',
    desc: 'Loest sofort einen Hochzeitsflug aus. Die Jungkoeniginnen gruenden neue Voelker.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const ok = world.forceFlight(colony.id);
      if (ok) log(world, CAT.EVOLUTION, 'Hochzeitsflug von ' + colony.name + ' ausgeloest',
        colony.nestLevelIds[0], -1, -1);
      return ok ? 1 : 0;
    },
  },
  {
    key: 'supply', name: 'Vorrat fuellen', cost: 12, where: 'colony', icon: 'cell:sugarcube',
    desc: 'Fuellt Zucker, Protein und Fett direkt ins Lager – ohne Umweg ueber die Karte.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const a = GODMODE.SUPPLY_AMOUNT * o.power;
      world.stockColony(colony.id, [a, a * 0.6, a * 0.35]);
      log(world, CAT.ERNAEHRUNG, 'Vorrat von ' + colony.name + ' aufgefuellt',
        colony.nestLevelIds[0], -1, -1);
      return 1;
    },
  },
  {
    key: 'broodboost', name: 'Brutschub', cost: 24, where: 'colony', icon: 'brood_egg',
    desc: 'Setzt einen Schwung Eier in die Brutkammer. Gefuettert werden muessen sie trotzdem.',
    apply(world, level, x, y, o) {
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      const nest = world.levels.get(colony.nestLevelIds[0]);
      if (!nest) return 0;
      const spot = broodSpot(nest, world.rngSim);
      if (!spot) return 0;
      const n = world.spawnBroodAt(colony.id, nest, spot.x, spot.y,
        Math.round(GODMODE.BROOD_COUNT * o.power), 0);
      log(world, CAT.ERNAEHRUNG, n + ' Eier fuer ' + colony.name + ' gesetzt', nest.id, spot.x, spot.y);
      return n;
    },
  },
  {
    key: 'fire', name: 'Feuer', cost: 28, where: 'surface', icon: 'glyph:\u2668',
    fx: FX.SPARK, fxCount: 34,
    desc: 'Brennt die Vegetation im Umkreis nieder. Was danach uebrig bleibt, ist nackte Erde und Asche (Aas).',
    apply(world, level, x, y, o) {
      let burned = 0;
      const r = o.radius;
      for (let cy = y - r; cy <= y + r; cy++) {
        for (let cx = x - r; cx <= x + r; cx++) {
          const dx = cx - x, dy = cy - y;
          if (dx * dx + dy * dy > r * r) continue;
          if (!level.inBounds(cx, cy)) continue;
          if (world.portals.at(level.id, cx, cy)) continue;
          const c = level.cells[cy * level.w + cx];
          if (c === SURFACE_CELL.STONE || c === SURFACE_CELL.WATER) continue;
          if (c === SURFACE_CELL.PLANT || c === SURFACE_CELL.FLOWER || c === SURFACE_CELL.GRASS
              || c === SURFACE_CELL.APHIDS || c === SURFACE_CELL.FRUIT || c === SURFACE_CELL.SEEDS) {
            level.set(cx, cy, SURFACE_CELL.DIRT);
            level.setMeta(cx, cy, 0);
            burned++;
          }
        }
      }
      // Alles Lebendige im Feuer stirbt und bleibt als Aas liegen
      let killed = 0;
      const ants = world.ants;
      for (let i = 0; i < ants.high; i++) {
        if (!ants.alive[i] || ants.level[i] !== level.id) continue;
        const dx = ants.x[i] - x, dy = ants.y[i] - y;
        if (dx * dx + dy * dy > r * r) continue;
        if (world.food) world.food.dropCarrion(level, ants.x[i] | 0, ants.y[i] | 0, 6);
        ants.kill(i);
        killed++;
      }
      const cr = world.creatures;
      for (let i = 0; i < cr.high; i++) {
        if (!cr.alive[i] || cr.level[i] !== level.id) continue;
        const dx = cr.x[i] - x, dy = cr.y[i] - y;
        if (dx * dx + dy * dy > r * r) continue;
        cr.hp[i] = 0;
      }
      log(world, CAT.KATASTROPHE, 'Feuer: ' + burned + ' Zellen abgebrannt, '
        + killed + ' Tiere verbrannt', level.id, x, y);
      return burned;
    },
  },
  {
    key: 'blast', name: 'Sprengung', cost: 35, where: 'nest', icon: 'glyph:\u2739',
    fx: FX.DUST, fxCount: 30,
    desc: 'Reisst einen Hohlraum ins Gestein. Die Decke darueber wird sofort auf Einsturz geprueft.',
    apply(world, level, x, y, o) {
      let n = 0;
      const r = Math.max(2, Math.round(o.radius * 0.5));
      for (let cy = y - r; cy <= y + r; cy++) {
        for (let cx = x - r; cx <= x + r; cx++) {
          const dx = cx - x, dy = cy - y;
          if (dx * dx + dy * dy > r * r) continue;
          if (!level.inBounds(cx, cy) || cy <= 6) continue;
          if (!level.solidTable[level.cells[cy * level.w + cx]]) continue;
          level.set(cx, cy, NEST_CELL.TUNNEL);
          n++;
        }
      }
      // Alles im Sprengradius nimmt schweren Schaden
      const ants = world.ants;
      for (let i = 0; i < ants.high; i++) {
        if (!ants.alive[i] || ants.level[i] !== level.id) continue;
        const dx = ants.x[i] - x, dy = ants.y[i] - y;
        if (dx * dx + dy * dy > (r + 2) * (r + 2)) continue;
        ants.hp[i] -= GODMODE.BLAST_DAMAGE * o.power;
      }
      if (n) {
        const fs = world.fields.get(level.id);
        if (fs) fs.markAllDirty();
        world.stability.request(level, x, y, r + 4);
      }
      world.shake = Math.min(1.5, (world.shake || 0) + 0.6 * o.power);
      log(world, CAT.KATASTROPHE, 'Sprengung: ' + n + ' Zellen weggerissen', level.id, x, y);
      return n;
    },
  },
  {
    key: 'scent', name: 'Duftspur legen', cost: 8, where: 'surface', icon: 'glyph:\u2234',
    desc: 'Legt eine kuenstliche Nahrungsspur der gewaehlten Kolonie – die Sammlerinnen folgen ihr.',
    apply(world, level, x, y, o) {
      if (!world.phero) return 0;
      const colony = world.colonies.get(o.colonyId);
      if (!colony) return 0;
      let n = 0;
      const r = Math.max(2, Math.round(o.radius * 0.6));
      for (let cy = y - r; cy <= y + r; cy++) {
        for (let cx = x - r; cx <= x + r; cx++) {
          const dx = cx - x, dy = cy - y;
          if (dx * dx + dy * dy > r * r) continue;
          if (!level.inBounds(cx, cy)) continue;
          world.phero.deposit(colony.id, PH.FOOD, cx, cy, GODMODE.SCENT_AMOUNT * o.power, 0);
          n++;
        }
      }
      return n;
    },
  },
  {
    key: 'fortify', name: 'Sofortbau', cost: 18, where: 'nest', icon: 'cell:reinforced',
    desc: 'Errichtet sofort verstaerkte Waende im Pinselbereich.',
    apply(world, level, x, y, o) {
      let n = 0;
      const r = Math.max(1, Math.round(o.radius * 0.4));
      for (let cy = y - r; cy <= y + r; cy++) {
        for (let cx = x - r; cx <= x + r; cx++) {
          const dx = cx - x, dy = cy - y;
          if (dx * dx + dy * dy > r * r) continue;
          if (!level.inBounds(cx, cy)) continue;
          const c = level.cells[cy * level.w + cx];
          if (c === NEST_CELL.STONE || !level.solidTable[c]) continue;
          level.set(cx, cy, NEST_CELL.REINFORCED);
          n++;
        }
      }
      if (n) {
        const fs = world.fields.get(level.id);
        if (fs) fs.markAllDirty();
      }
      log(world, CAT.BAU, n + ' Zellen verstaerkt', level.id, x, y);
      return n;
    },
  },
  {
    key: 'chamber', name: 'Kammer ausheben', cost: 22, where: 'nest', icon: 'cell:chamber',
    desc: 'Hebt sofort eine Kammer aus – Typ ueber die Auswahl in der Werkzeugleiste.',
    apply(world, level, x, y, o) {
      let n = 0;
      const rx = Math.max(2, Math.round(o.radius * 0.5));
      const ry = Math.max(2, Math.round(o.radius * 0.3));
      for (let cy = y - ry; cy <= y + ry; cy++) {
        for (let cx = x - rx; cx <= x + rx; cx++) {
          const nx = (cx - x) / rx, ny = (cy - y) / ry;
          if (nx * nx + ny * ny > 1) continue;
          if (!level.inBounds(cx, cy) || cy <= 6) continue;
          if (level.cells[cy * level.w + cx] === NEST_CELL.STONE) continue;
          level.set(cx, cy, NEST_CELL.CHAMBER);
          level.setMeta(cx, cy, o.chamberType || CHAMBER.NONE);
          n++;
        }
      }
      if (n) {
        const fs = world.fields.get(level.id);
        if (fs) fs.markAllDirty();
        world.stability.request(level, x, y, rx + 3);
      }
      return n;
    },
  },
];

export const INTERVENTION_BY_KEY = new Map(INTERVENTIONS.map((i) => [i.key, i]));

// ---------------------------------------------------------------------------
function log(world, cat, text, levelId, x, y) {
  bus.logEvent(cat, text, { tick: world.tick, levelId, x, y });
}

function foodRain(world, level, x, y, o, cellType, label) {
  const r = o.radius;
  let n = 0;
  for (let i = 0; i < r * r * 0.35; i++) {
    const a = world.rngSim.angle();
    const d = Math.sqrt(world.rngSim.float()) * r;
    const cx = Math.round(x + Math.cos(a) * d), cy = Math.round(y + Math.sin(a) * d);
    if (!level.inBounds(cx, cy)) continue;
    const c = level.cells[cy * level.w + cx];
    if (c === SURFACE_CELL.STONE || c === SURFACE_CELL.WATER) continue;
    if (world.portals.at(level.id, cx, cy)) continue;
    if (world.food.place(level, cx, cy, cellType, GODMODE.FOODRAIN_AMOUNT * o.power)) n++;
  }
  log(world, CAT.ERNAEHRUNG, label + 'regen: ' + n + ' Portionen', level.id, x, y);
  return n;
}

/** Wasser laeuft vom Eingang aus nach unten und fuellt Hohlraeume. */
function floodNest(world, nest, ex, ey, depth) {
  const queue = [ey * nest.w + ex];
  const seen = new Set(queue);
  let filled = 0;
  while (queue.length && filled < depth * 12) {
    const idx = queue.shift();
    const x = idx % nest.w, y = (idx / nest.w) | 0;
    if (y > ey + depth) continue;
    const c = nest.cells[idx];
    if (c !== NEST_CELL.TUNNEL && c !== NEST_CELL.CHAMBER && c !== NEST_CELL.ENTRANCE
        && c !== NEST_CELL.TRAP) continue;
    if (c !== NEST_CELL.ENTRANCE) {
      nest.set(x, y, NEST_CELL.WATER);
      filled++;
    }
    // Wasser laeuft zuerst nach unten, dann zur Seite
    const next = [idx + nest.w, idx - 1, idx + 1];
    for (const n of next) {
      if (n < 0 || n >= nest.cells.length || seen.has(n)) continue;
      seen.add(n);
      queue.push(n);
    }
  }
  return filled;
}

/**
 * Laufende Wirkungen: Wetter, Seuche, Raserei, Austrocknen.
 * Wird jeden Tick von world.step() aufgerufen (sehr guenstig).
 */
export function updateInterventions(world) {
  const w = world.weather;
  if (w.drought > 0) w.drought--;
  if (w.rain > 0) w.rain--;
  if (world.shake > 0) world.shake = Math.max(0, world.shake - 0.02);

  // Wasser trocknet langsam wieder ab
  if (world.tick % GODMODE.WATER_DRY_INTERVAL === 0) {
    for (const level of world.levels.levels) {
      const waterCell = level.kind === LEVEL_KIND.SURFACE ? SURFACE_CELL.WATER : NEST_CELL.WATER;
      const dryTo = level.kind === LEVEL_KIND.SURFACE ? SURFACE_CELL.DIRT : NEST_CELL.TUNNEL;
      if (w.rain > 0 && level.kind === LEVEL_KIND.SURFACE) continue;
      const cells = level.cells;
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] !== waterCell) continue;
        if (!world.rngSim.chance(GODMODE.WATER_DRY_CHANCE)) continue;
        const x = i % level.w, y = (i / level.w) | 0;
        level.set(x, y, dryTo);
      }
    }
  }

  // Seuche und Raserei je Kolonie
  for (const colony of world.colonies.colonies) {
    if (colony.plague > 0) {
      colony.plague--;
      if (colony.plague === 0) {
        bus.logEvent(CAT.SYS, 'Die Seuche in ' + colony.name + ' ist ueberstanden',
          { tick: world.tick, colonyId: colony.id, levelId: colony.nestLevelIds[0] });
      }
    }
    if (colony.frenzy > 0) colony.frenzy--;
  }
}
