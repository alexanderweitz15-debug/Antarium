/**
 * combat.js – Kampf, Bedrohungsstufen und Raubzuege (Phase 5).
 *
 * KAMPF entsteht aus Naehe, nicht aus Befehlen: Trifft eine Ameise auf eine
 * Ameise einer anderen Kolonie, schlagen beide zu. Damit das bei 5000
 * Einheiten bezahlbar bleibt, prueft jede Ameise nur alle
 * COMBAT.CHECK_EVERY Ticks, nach Index versetzt – ein Kampf beginnt dadurch
 * hoechstens einen Sekundenbruchteil spaeter.
 *
 * ENGSTELLEN zaehlen: In einem Gang mit wenigen freien Nachbarzellen wird
 * der Schaden durch die Zahl der Angreifer geteilt. Eine Verteidigerin in
 * einem Ein-Zellen-Tunnel haelt deshalb viele auf – genau das, was
 * Befestigungen wertvoll macht.
 *
 * BEDROHUNGSSTUFEN 0..3 werden aus der Lage der Feinde abgeleitet und
 * steuern das Verhalten der ganzen Kolonie (Sammlerinnen heim, Soldatinnen
 * an den Eingang, Brut evakuieren, Koenigin in die Fluchtkammer).
 *
 * RAUBZUEGE sind kein Skript: ein Trupp bekommt ein Ziel (fremder Eingang),
 * laeuft dorthin, kaempft sich hinein und sucht im fremden Nest nach Brut
 * und Vorraeten. Im fremden Nest gibt es keine Distanzfelder – die
 * Angreifer suchen tatsaechlich.
 */

import { COMBAT, PHERO, NUTRIENT, LIFE } from '../config.js';
import { LEVEL_KIND } from './levels.js';
import { ANT_STATE, CARRY } from './ants.js';
import { CASTE, casteDef } from './castes.js';
import { PH } from './pheromones.js';
import { NEST_CELL, CHAMBER } from './nest.js';
import { bus, CAT } from './events.js';
import { FX } from './fx.js';

export const THREAT_LABEL = ['Frieden', 'Feinde in der Naehe', 'Kampf am Eingang', 'Feinde im Nest'];

export class Combat {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    this.kills = 0;
    this._near = { id: -1, d: 0 };
  }

  // =========================================================================
  // Nahkampf
  // =========================================================================
  /**
   * Kampf auf einer Ebene aufloesen. Wird nach ants.update() aufgerufen,
   * damit die Positionen des aktuellen Ticks gelten.
   */
  update(level, ctx) {
    const ants = ctx.ants;
    const b = ants.buckets.get(level.id);
    if (!b) return;
    const tick = ctx.tick;
    const phero = ctx.phero;

    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      if (ants.state[i] === ANT_STATE.TRANSIT) continue;
      if ((i + tick) % COMBAT.CHECK_EVERY !== 0) continue;

      const st = ants.state[i];
      /**
       * Raubzuegler und Beutetraegerinnen behalten ihren Auftrag. Sonst
       * bleibt ein Trupp im Torkampf haengen und kommt nie ins Nest –
       * genau das ist beim ersten Versuch passiert: 37 Kaempferinnen
       * unterwegs, null im gegnerischen Bau.
       */
      const onMission = st === ANT_STATE.RAID || st === ANT_STATE.LOOT;

      const enemy = this._findEnemy(ants, level, i);
      if (enemy < 0) {
        // Kein Feind mehr in Sicht: zurueck zur Arbeit
        if (st === ANT_STATE.ATTACK || st === ANT_STATE.DEFEND) {
          ants.state[i] = ANT_STATE.EXPLORE;
          ants.timer[i] = 120;
        }
        continue;
      }

      const dx = ants.x[enemy] - ants.x[i];
      const dy = ants.y[enemy] - ants.y[i];
      const d2 = dx * dx + dy * dy;

      // Rueckzug bei schweren Verletzungen (genabhaengig)
      const colony = ctx.colonies.get(ants.colony[i]);
      const retreatGene = colony && colony.genome ? colony.genome.rueckzugsschwelle : 0.5;
      if (!onMission && ants.hp[i] < ants.hpMax[i] * COMBAT.RETREAT_HP * (0.4 + retreatGene)) {
        ants.state[i] = ANT_STATE.FLEE;
        ants.timer[i] = 90;
        ants.dir[i] = Math.atan2(-dy, -dx);
        continue;
      }

      if (d2 > COMBAT.REACH * COMBAT.REACH) {
        // Heran: nur, wenn die Ameise kaempfen will und keinen Auftrag hat
        if (!onMission && this._willFight(ants, colony, i, level)) {
          ants.state[i] = ANT_STATE.ATTACK;
          ants.timer[i] = COMBAT.PURSUE_TICKS;
          ants.dir[i] = Math.atan2(dy, dx);
        }
        continue;
      }

      // Schlagabtausch – im Vorbeigehen, wenn die Ameise einen Auftrag hat
      if (!onMission) {
        ants.state[i] = ANT_STATE.ATTACK;
        ants.dir[i] = Math.atan2(dy, dx);
      }
      ants.anim[i] += 0.5;
      const dmg = this._damage(ants, ctx, i, enemy, level);
      ants.hp[enemy] -= dmg;

      if (phero && level.kind === LEVEL_KIND.SURFACE) {
        phero.deposit(ants.colony[i], PH.ALARM, ants.x[i] | 0, ants.y[i] | 0, PHERO.DEPOSIT.ALARM);
      }
      const defColony = ctx.colonies.get(ants.colony[enemy]);
      if (defColony) defColony.stressEvents = (defColony.stressEvents || 0) + 0.0008;

      if (ants.hp[enemy] <= 0) {
        this.world.emitFx(FX.GORE, level.id, ants.x[enemy] | 0, ants.y[enemy] | 0, 5);
        this._kill(ants, ctx, level, enemy, colony);
      }
    }
  }

  /** Naechste feindliche Ameise in Sichtweite. */
  _findEnemy(ants, level, i) {
    const cid = ants.colony[i];
    const x = ants.x[i], y = ants.y[i];
    let best = -1, bestD = COMBAT.SIGHT * COMBAT.SIGHT;
    level.spatial.query(x, y, COMBAT.SIGHT, (id) => {
      if (id === i || !ants.alive[id]) return;
      if (ants.colony[id] === cid) return;
      if (ants.state[id] === ANT_STATE.TRANSIT) return;
      const dx = ants.x[id] - x, dy = ants.y[id] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  /**
   * Kaempft diese Ameise ueberhaupt? Arbeiterinnen nur in Nestnaehe oder
   * wenn die Kolonie aggressiv ist; Soldatinnen und Raubzuegler immer.
   */
  _willFight(ants, colony, i, level) {
    const caste = ants.caste[i];
    if (caste === CASTE.SOLDIER || caste === CASTE.ARMOR || caste === CASTE.TITAN) return true;
    if (ants.state[i] === ANT_STATE.RAID || ants.state[i] === ANT_STATE.LOOT) return true;
    if (!colony) return false;
    if (level.kind === LEVEL_KIND.NEST) return true;      // im eigenen Nest immer
    const aggr = colony.genome ? colony.genome.aggressivitaet : 0.5;
    return colony.threat >= 2 || aggr > 0.6;
  }

  /** Schaden eines Schlages, mit Panzerung, Hunger und Engstelle. */
  _damage(ants, ctx, attacker, target, level) {
    const aDef = casteDef(ants.caste[attacker]);
    const aColony = ctx.colonies.get(ants.colony[attacker]);
    const dColony = ctx.colonies.get(ants.colony[target]);
    const jaw = aColony && aColony.genome ? 0.6 + aColony.genome.kieferkraft : 1;
    const armorGene = dColony && dColony.genome ? dColony.genome.panzerung : 0.3;
    const armor = 1 - COMBAT.ARMOR_MAX * armorGene;
    // Zuckermangel senkt die Kampfkraft
    const fed = 1 - (1 - COMBAT.HUNGER_PENALTY) * Math.min(1, ants.hunger[attacker] * 2);
    let dmg = aDef.damage * COMBAT.DAMAGE_SCALE * jaw * armor * fed * ants.phenoSize[attacker];

    // Engstelle: in einem schmalen Gang kommt nur die vorderste Reihe zum Zug
    const open = this._openNeighbours(level, ants.x[target] | 0, ants.y[target] | 0);
    if (open <= COMBAT.NARROW_NEIGHBOURS) {
      let attackers = 0;
      const tx = ants.x[target], ty = ants.y[target];
      const tc = ants.colony[target];
      level.spatial.query(tx, ty, COMBAT.REACH + 0.6, (id) => {
        if (ants.alive[id] && ants.colony[id] !== tc) attackers++;
      });
      if (attackers > 1) dmg /= attackers;
    }
    return dmg;
  }

  _openNeighbours(level, x, y) {
    let n = 0;
    if (!level.isSolid(x - 1, y)) n++;
    if (!level.isSolid(x + 1, y)) n++;
    if (!level.isSolid(x, y - 1)) n++;
    if (!level.isSolid(x, y + 1)) n++;
    return n;
  }

  _kill(ants, ctx, level, victim, killerColony) {
    const vColony = ctx.colonies.get(ants.colony[victim]);
    if (vColony) {
      vColony.lostToWar = (vColony.lostToWar || 0) + 1;
      vColony.stressEvents = (vColony.stressEvents || 0) + 0.03;
      if (ants.caste[victim] === CASTE.QUEEN) {
        ctx.world.queenDied(vColony, level, ants.x[victim], ants.y[victim]);
      }
    }
    if (killerColony) killerColony.kills = (killerColony.kills || 0) + 1;
    // Feindliche Tote sind Protein
    if (ctx.food && level.kind === LEVEL_KIND.SURFACE) {
      ctx.food.dropCarrion(level, ants.x[victim] | 0, ants.y[victim] | 0,
        LIFE.CORPSE_FOOD * casteDef(ants.caste[victim]).size);
    } else if (killerColony && level.kind === LEVEL_KIND.NEST) {
      // Im Nest wandert der Tote direkt in den Vorrat der Sieger
      killerColony.storeArr[NUTRIENT.PROTEIN] = Math.min(
        killerColony.capacity[NUTRIENT.PROTEIN],
        killerColony.storeArr[NUTRIENT.PROTEIN] + LIFE.CORPSE_FOOD * 0.3);
    }
    ants.kill(victim);
    this.kills++;
  }

  // =========================================================================
  // Bedrohungsstufen
  // =========================================================================
  /**
   * Stufe 0 Frieden, 1 Feinde in der Naehe, 2 Kampf am Eingang,
   * 3 Feinde in der Nest-Ebene.
   */
  updateThreat(colony, ctx) {
    const world = this.world;
    let threat = 0;
    let focusLevel = -1, focusX = -1, focusY = -1;

    // Feinde in den eigenen Nest-Ebenen?
    for (const lid of colony.nestLevelIds) {
      const lvl = world.levels.get(lid);
      if (!lvl) continue;
      const b = ctx.ants.buckets.get(lid);
      if (b) {
        for (let k = 0; k < b.count; k++) {
          const i = b.ids[k];
          if (ctx.ants.colony[i] !== colony.id) {
            threat = 3;
            focusLevel = lid; focusX = ctx.ants.x[i] | 0; focusY = ctx.ants.y[i] | 0;
            break;
          }
        }
      }
      if (threat < 3) {
        const cb = ctx.creatures.buckets.get(lid);
        if (cb && cb.count > 0) {
          threat = 3;
          focusLevel = lid;
          focusX = ctx.creatures.x[cb.ids[0]] | 0;
          focusY = ctx.creatures.y[cb.ids[0]] | 0;
        }
      }
      if (threat === 3) break;
    }

    // Feinde an der Oberflaeche nahe den Eingaengen?
    if (threat < 3) {
      const surface = world.levels.surface;
      for (const p of world.portals.ofColony(colony.id)) {
        const pos = p.on(surface.id);
        if (!pos) continue;
        let near = 0, atGate = 0;
        surface.spatial.query(pos.x, pos.y, COMBAT.THREAT_NEAR, (id) => {
          if (!ctx.ants.alive[id] || ctx.ants.colony[id] === colony.id) return;
          const dx = ctx.ants.x[id] - pos.x, dy = ctx.ants.y[id] - pos.y;
          const d2 = dx * dx + dy * dy;
          near++;
          if (d2 < COMBAT.THREAT_AT_GATE * COMBAT.THREAT_AT_GATE) atGate++;
        });
        // Raeuber zaehlen mit
        const cb = ctx.creatures.buckets.get(surface.id);
        if (cb) {
          for (let k = 0; k < cb.count; k++) {
            const c = cb.ids[k];
            if (!ctx.creatures.alive[c]) continue;
            const sp = ctx.creatures.speciesDef(c);
            if (!sp.prey) continue;
            const dx = ctx.creatures.x[c] - pos.x, dy = ctx.creatures.y[c] - pos.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < COMBAT.THREAT_AT_GATE * COMBAT.THREAT_AT_GATE) atGate++;
            else if (d2 < COMBAT.THREAT_NEAR * COMBAT.THREAT_NEAR) near++;
          }
        }
        if (atGate > 0 && threat < 2) {
          threat = 2; focusLevel = surface.id; focusX = pos.x; focusY = pos.y;
        } else if (near > 0 && threat < 1) {
          threat = 1; focusLevel = surface.id; focusX = pos.x; focusY = pos.y;
        }
      }
    }

    const before = colony.threat;
    colony.threat = threat;
    colony.threatLevelId = focusLevel;
    colony.threatX = focusX;
    colony.threatY = focusY;

    if (threat > before) {
      bus.logEvent(CAT.KAMPF, colony.name + ': ' + THREAT_LABEL[threat], {
        tick: world.tick, levelId: focusLevel, x: focusX, y: focusY, colonyId: colony.id,
      });
      world.raiseAlarm(colony, threat, focusLevel, focusX, focusY);
    }
    return threat;
  }

  /**
   * Reaktion auf die Bedrohungsstufe. Kein Mikromanagement, nur
   * Prioritaeten: heimkehren, sammeln, evakuieren.
   */
  applyThreat(colony, ctx) {
    if (colony.threat < 2) return;
    const ants = ctx.ants;
    const world = this.world;
    const surface = world.levels.surface;

    // Stufe 2: Sammlerinnen kehren heim, Soldatinnen sammeln sich am Eingang
    const b = ants.buckets.get(surface.id);
    if (b) {
      for (let k = 0; k < b.count; k++) {
        const i = b.ids[k];
        if (ants.colony[i] !== colony.id) continue;
        if (ants.state[i] === ANT_STATE.TRANSIT || ants.state[i] === ANT_STATE.RAID
            || ants.state[i] === ANT_STATE.LOOT || ants.state[i] === ANT_STATE.ATTACK) continue;
        if (ants.state[i] === ANT_STATE.EXPLORE && ctx.rng.chance(0.03)) {
          ants.state[i] = ANT_STATE.RETURN;
          const p = world.portals.nearest(surface.id, colony.id, ants.x[i], ants.y[i]);
          if (p) {
            const pos = p.on(surface.id);
            ants.targetX[i] = pos.x;
            ants.targetY[i] = pos.y;
          }
        }
      }
    }

    // Stufe 3: Brut evakuieren, Koenigin in die Fluchtkammer
    if (colony.threat >= 3) {
      for (const lid of colony.nestLevelIds) {
        const nb = ants.buckets.get(lid);
        if (!nb) continue;
        for (let k = 0; k < nb.count; k++) {
          const i = nb.ids[k];
          if (ants.colony[i] !== colony.id) continue;
          if (ants.caste[i] === CASTE.QUEEN) {
            ants.state[i] = ANT_STATE.EVACUATE;   // Koenigin flieht selbst
            continue;
          }
          if (ants.state[i] === ANT_STATE.EXPLORE && ants.carryType[i] === CARRY.NONE
              && ctx.rng.chance(0.04)) {
            ants.state[i] = ANT_STATE.EVACUATE;
            ants.timer[i] = 900;
          }
        }
      }
    }
  }

  // =========================================================================
  // Raubzuege
  // =========================================================================
  /** Lohnt sich ein Raubzug, und gegen wen? */
  considerRaid(colony, ctx) {
    const world = this.world;
    if (colony.total < COMBAT.RAID_MIN_POP) return false;
    if (world.tick - (colony.lastRaidTick || -1e9) < COMBAT.RAID_INTERVAL) return false;
    const soldiers = colony.population[CASTE.SOLDIER] + colony.population[CASTE.ARMOR]
      + colony.population[CASTE.TITAN];
    if (soldiers < COMBAT.RAID_MIN_SOLDIERS) return false;
    const aggr = colony.genome ? colony.genome.aggressivitaet : 0.5;
    const hungry = colony.balanceArr[NUTRIENT.PROTEIN] < COMBAT.RAID_HUNGER;
    if (!hungry && aggr < 0.55) return false;
    if (colony.threat >= 2) return false;            // erst das eigene Haus

    // Naechstes fremdes Nest suchen
    const surface = world.levels.surface;
    const own = world.portals.ofColony(colony.id)[0];
    if (!own) return false;
    let best = null, bestD = 250 * 250;
    for (const p of world.portals.portals) {
      if (p.colonyId === colony.id) continue;
      const other = world.colonies.get(p.colonyId);
      if (!other || !other.alive) continue;
      // Junge Voelker sind die Reise nicht wert – und wuerden sonst
      // reihenweise ausgeloescht, bevor sie Fuss fassen.
      if (other.total < 40) continue;
      const pos = p.on(surface.id);
      if (!pos) continue;
      const dx = pos.x - own.ax, dy = pos.y - own.ay;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (!best) return false;
    return this.startRaid(colony, best, ctx, hungry);
  }

  /** Trupp zusammenstellen und losschicken. */
  startRaid(colony, targetPortal, ctx, hungry) {
    const world = this.world;
    const ants = ctx.ants;
    const pos = targetPortal.on(world.levels.surface.id);
    if (!pos) return false;
    const want = ctx.rng.intRange(COMBAT.RAID_SQUAD[0], COMBAT.RAID_SQUAD[1]);
    let picked = 0;

    for (let i = 0; i < ants.high && picked < want; i++) {
      if (!ants.alive[i] || ants.colony[i] !== colony.id) continue;
      const caste = ants.caste[i];
      if (caste === CASTE.QUEEN || caste === CASTE.ALATE) continue;
      const isFighter = caste === CASTE.SOLDIER || caste === CASTE.ARMOR
        || caste === CASTE.TITAN || caste === CASTE.ACID || caste === CASTE.BOMB;
      if (!isFighter && !ctx.rng.chance(0.3)) continue;
      ants.state[i] = ANT_STATE.RAID;
      ants.targetX[i] = pos.x;
      ants.targetY[i] = pos.y;
      ants.timer[i] = COMBAT.RAID_TIMEOUT > 65000 ? 65000 : COMBAT.RAID_TIMEOUT;
      ants.raidTarget[i] = targetPortal.colonyId;
      picked++;
    }
    if (picked < 4) return false;
    colony.lastRaidTick = world.tick;
    colony.raids = (colony.raids || 0) + 1;
    const target = world.colonies.get(targetPortal.colonyId);
    bus.logEvent(CAT.KAMPF, colony.name + ' schickt ' + picked + ' Kaempferinnen gegen '
      + (target ? target.name : '?') + (hungry ? ' (Proteinmangel)' : ''), {
      tick: world.tick, levelId: world.levels.surface.id, x: pos.x, y: pos.y, colonyId: colony.id,
    });
    world.raiseAlarm(target, 2, world.levels.surface.id, pos.x, pos.y);
    return true;
  }

  /**
   * Beute im fremden Nest: Brut toeten und mitnehmen, Vorrat pluendern.
   * Wird aus ants.js aufgerufen, wenn eine Raeuberin im fremden Nest steht.
   */
  tryLoot(ants, i, level, ctx) {
    const brood = ctx.brood;
    const x = ants.x[i], y = ants.y[i];
    // 1. Fremde Brut
    for (let k = 0; k < brood.high; k++) {
      if (!brood.alive[k] || brood.level[k] !== level.id) continue;
      if (brood.colony[k] === ants.colony[i]) continue;
      const dx = brood.x[k] - x, dy = brood.y[k] - y;
      if (dx * dx + dy * dy > 2.2) continue;
      const victim = ctx.colonies.get(brood.colony[k]);
      if (victim) {
        victim.broodLost = (victim.broodLost || 0) + 1;
        victim.stressEvents = (victim.stressEvents || 0) + 0.02;
      }
      brood.kill(k);
      ants.carryType[i] = CARRY.BROOD;
      ants.carryAmount[i] = COMBAT.LOOT_BROOD;
      ants.state[i] = ANT_STATE.LOOT;
      return true;
    }
    // 2. Fremde Vorratskammer
    const idx = (y | 0) * level.w + (x | 0);
    if (level.cells[idx] === NEST_CELL.CHAMBER && level.meta[idx] === CHAMBER.STORE) {
      const victim = ctx.colonies.get(level.colonyId);
      if (victim && victim.storeArr[NUTRIENT.PROTEIN] + victim.storeArr[0] > 5) {
        const take = Math.min(COMBAT.LOOT_STORE, victim.storeArr[0] + victim.storeArr[1]);
        const fromSugar = Math.min(victim.storeArr[0], take * 0.5);
        const fromProtein = Math.min(victim.storeArr[1], take - fromSugar);
        victim.storeArr[0] -= fromSugar;
        victim.storeArr[1] -= fromProtein;
        victim.stressEvents = (victim.stressEvents || 0) + 0.03;
        ants.carryType[i] = CARRY.FOOD;
        ants.carrySource[i] = 15;                 // Fleischbrocken-Profil
        ants.carryNutrient[i] = NUTRIENT.PROTEIN;
        ants.carryAmount[i] = fromSugar + fromProtein;
        ants.state[i] = ANT_STATE.LOOT;
        return true;
      }
    }
    return false;
  }
}
