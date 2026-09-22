/**
 * brood.js – Eier, Larven und Puppen als Structure of Arrays.
 *
 * Lebenszyklus: Ei -> Larve -> Puppe -> Ameise.
 *   - Eier reifen von selbst.
 *   - Larven muessen mit PROTEIN gefuettert werden (Ammen holen es aus dem
 *     Vorrat). Ohne Futter kommen sie nicht weiter und sterben irgendwann.
 *   - Puppen reifen von selbst und schluepfen als Ameise der Kaste, die die
 *     Kolonie-KI bei der Fuetterung festgelegt hat.
 *
 * Die Brut liegt immer in einer Kammer der Nest-Ebene und bewegt sich nicht.
 */

import { BROOD, NUTRITION, LIFE } from '../config.js';
import { CASTE, casteDef } from './castes.js';
import { NEST_CELL, CHAMBER } from './nest.js';
import { ANT_STATE } from './ants.js';
import { bus, CAT } from './events.js';
import { rollAntTraits } from './traits.js';

export const STAGE = { EGG: 0, LARVA: 1, PUPA: 2 };
export const STAGE_NAMES = ['Ei', 'Larve', 'Puppe'];

export class BroodPool {
  constructor(capacity = BROOD.MAX) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.colony = new Uint8Array(capacity);
    this.level = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.stage = new Uint8Array(capacity);
    /** Reifefortschritt in Ticks. */
    this.progress = new Float32Array(capacity);
    /** Bereits gefuettertes Protein. */
    this.fed = new Float32Array(capacity);
    /** Ticks ohne Futter. */
    this.hungry = new Uint16Array(capacity);
    /** Kaste, die daraus wird. */
    this.target = new Uint8Array(capacity);
    /** Ameise, die diese Brut gerade traegt (-1 = liegt). */
    this.carrier = new Int32Array(capacity).fill(-1);
    /** Phaenotyp beim Anlegen (muetterlicher Effekt). */
    this.pSize = new Float32Array(capacity);
    this.pSpeed = new Float32Array(capacity);
    this.pLife = new Float32Array(capacity);

    this.free = new Int32Array(capacity);
    this.freeCount = 0;
    this.high = 0;
    this.count = 0;
  }

  spawn(opts) {
    let i;
    if (this.freeCount > 0) i = this.free[--this.freeCount];
    else if (this.high < this.capacity) i = this.high++;
    else return -1;
    this.alive[i] = 1;
    this.colony[i] = opts.colonyId;
    this.level[i] = opts.levelId;
    this.x[i] = opts.x;
    this.y[i] = opts.y;
    this.stage[i] = STAGE.EGG;
    this.progress[i] = 0;
    this.fed[i] = 0;
    this.hungry[i] = 0;
    this.target[i] = opts.target !== undefined ? opts.target : CASTE.WORKER;
    this.carrier[i] = -1;
    this.pSize[i] = opts.pSize || 1;
    this.pSpeed[i] = opts.pSpeed || 1;
    this.pLife[i] = opts.pLife || 1;
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
  }

  /** Larve fuettern; liefert die tatsaechlich verbrauchte Proteinmenge. */
  feed(i, protein) {
    if (!this.alive[i] || this.stage[i] !== STAGE.LARVA) return 0;
    const need = BROOD.LARVA_PROTEIN - this.fed[i];
    if (need <= 0) return 0;
    const put = Math.min(need, protein);
    this.fed[i] += put;
    this.hungry[i] = 0;
    return put;
  }

  /**
   * Reifung aller Brut. Ameisen entstehen ueber ctx.hatch(...).
   * @param {{world:object, rng:object}} ctx
   */
  update(ctx) {
    const world = ctx.world;
    const ants = world.ants;
    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i]) continue;
      // Getragene Brut folgt ihrer Traegerin (Evakuierung)
      const c = this.carrier[i];
      if (c >= 0) {
        if (ants.alive[c] && ants.carryType[c] === 3) {
          this.x[i] = ants.x[c];
          this.y[i] = ants.y[c];
          this.level[i] = ants.level[c];
        } else {
          this.carrier[i] = -1;
        }
      }
      const colony = world.colonies.get(this.colony[i]);
      if (!colony || !colony.alive) { this.kill(i); continue; }

      /**
       * Brutstuben beschleunigen die Reifung im Umkreis. Der Wert wird nur
       * selten geholt, weil die Abfrage ueber alle Bauwerke laeuft – bei
       * hoechstens vierzig je Volk ist das billig genug.
       */
      const warm = (world.tick & 15) === 0 && world.structures
        ? world.structures.broodSpeed(this.level[i], this.x[i], this.y[i], colony.id) : 1;
      const step = warm > 1 ? warm : 1;

      switch (this.stage[i]) {
        case STAGE.EGG:
          this.progress[i] += step;
          if (this.progress[i] >= BROOD.EGG_TICKS) {
            this.stage[i] = STAGE.LARVA;
            this.progress[i] = 0;
          }
          break;

        case STAGE.LARVA: {
          /**
           * KLAUSTRALE GRUENDUNG. Eine junge Kolonie besteht anfangs nur aus
           * der Koenigin; es gibt niemanden, der Larven fuettert. Ohne diesen
           * Sonderfall bleibt so eine Kolonie fuer immer bei einer einzigen
           * Ameise stehen – weder tot noch lebendig. In der Natur zehrt die
           * Jungkoenigin dafuer von ihren Reserven und zieht die erste Brut
           * allein auf. Genau das passiert hier: solange die Kolonie unter
           * BROOD.CLAUSTRAL_WORKERS Ameisen hat, fuettert die Koenigin
           * direkt aus dem Lager.
           */
          if (colony.total <= BROOD.CLAUSTRAL_WORKERS
              && this.fed[i] < BROOD.LARVA_PROTEIN
              && colony.storeArr[1] > 0.02) {
            const put = Math.min(BROOD.CLAUSTRAL_RATE,
              BROOD.LARVA_PROTEIN - this.fed[i], colony.storeArr[1]);
            colony.storeArr[1] -= put;
            this.fed[i] += put;
            this.hungry[i] = 0;
          }
          // Fortschritt nur, soweit die Larve gefuettert wurde
          const ratio = this.fed[i] / BROOD.LARVA_PROTEIN;
          this.progress[i] += ratio > 0.02 ? step : 0;
          this.hungry[i]++;
          if (this.hungry[i] > BROOD.LARVA_STARVE_TICKS) {
            // Verhungerte Larve: die Kolonie frisst sie, Protein kommt zurueck
            colony.storeArr[1] += this.fed[i] * 0.5;
            this.kill(i);
            colony.broodStarved = (colony.broodStarved || 0) + 1;
            break;
          }
          if (this.progress[i] >= BROOD.LARVA_TICKS && ratio >= 0.999) {
            this.stage[i] = STAGE.PUPA;
            this.progress[i] = 0;
          }
          break;
        }

        case STAGE.PUPA:
          this.progress[i] += step;
          if (this.progress[i] >= BROOD.PUPA_TICKS) {
            this._hatch(i, ctx);
          }
          break;
        default:
          break;
      }
    }
  }

  _hatch(i, ctx) {
    const world = ctx.world;
    const colony = world.colonies.get(this.colony[i]);
    const level = world.levels.get(this.level[i]);
    if (!colony || !level) { this.kill(i); return; }

    const def = casteDef(this.target[i]);
    // Phaenotyp: was beim Anlegen galt, gemischt mit der Lage beim Schluepfen
    const size = (this.pSize[i] + colony.pheno.size) * 0.5;
    const speed = (this.pSpeed[i] + colony.pheno.speed) * 0.5;
    const life = (this.pLife[i] + colony.pheno.life) * 0.5;

    const traits = rollAntTraits(ctx.rng, colony);
    const id = world.ants.spawn({
      levelId: level.id, x: this.x[i], y: this.y[i], colonyId: colony.id,
      casteId: def.id, dir: ctx.rng.angle(), state: ANT_STATE.EXPLORE,
      timer: ctx.rng.intRange(60, 300), hungerTol: ctx.rng.float(),
      // Jede geschluepfte Ameise wuerfelt ihren eigenen Charakter
      trait1: traits[0], trait2: traits[1],
    });
    if (id >= 0) {
      const a = world.ants;
      a.phenoSize[id] = size;
      a.phenoSpeed[id] = speed;
      a.phenoLife[id] = life;
      a.hp[id] = def.hp * size;
      a.hpMax[id] = a.hp[id];
      a.lifespan[id] = Math.round(LIFE.WORKER_LIFESPAN * life
        * (1 + (colony.genome ? colony.genome.lebensdauer - 0.5 : 0))
        * ctx.rng.range(1 - LIFE.LIFESPAN_JITTER, 1 + LIFE.LIFESPAN_JITTER));
      if (!colony.knownCastes.has(def.id)) {
        colony.knownCastes.add(def.id);
        if (def.evolutionary) {
          bus.logEvent(CAT.EVOLUTION, colony.name + ': erste ' + def.name + ' geschluepft!', {
            tick: world.tick, levelId: level.id, x: this.x[i] | 0, y: this.y[i] | 0, colonyId: colony.id,
          });
          world.firstCaste(def, colony);
        }
      }
      colony.hatched = (colony.hatched || 0) + 1;
    }
    this.kill(i);
  }

  /** Zaehlung je Kolonie und Stadium (wird jeden Tick neu gerechnet). */
  recount(colonies) {
    for (const c of colonies.colonies) {
      if (!c.broodCount) c.broodCount = new Uint16Array(3);
      c.broodCount.fill(0);
      c.broodTotal = 0;
    }
    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i]) continue;
      const c = colonies.get(this.colony[i]);
      if (!c) continue;
      c.broodCount[this.stage[i]]++;
      c.broodTotal++;
    }
  }

  /** Nicht getragene eigene Brut in der Naehe finden (fuer die Evakuierung). */
  findLoose(colonyId, levelId, x, y, maxDist) {
    let best = -1, bestD = maxDist * maxDist;
    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i] || this.colony[i] !== colonyId || this.level[i] !== levelId) continue;
      if (this.carrier[i] >= 0) continue;
      const dx = this.x[i] - x, dy = this.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /** Eine hungrige Larve der Kolonie finden (fuer die Ammen). */
  findHungryLarva(colonyId, levelId, x, y, maxDist) {
    let best = -1, bestD = maxDist * maxDist;
    for (let i = 0; i < this.high; i++) {
      if (!this.alive[i] || this.colony[i] !== colonyId || this.level[i] !== levelId) continue;
      if (this.stage[i] !== STAGE.LARVA) continue;
      if (this.fed[i] >= BROOD.LARVA_PROTEIN) continue;
      const dx = this.x[i] - x, dy = this.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }
}

/** Freie Kammerzelle fuer neue Brut suchen (Brutkammer bevorzugt). */
export function broodSpot(level, rng, preferMeta = CHAMBER.BROOD) {
  const cells = level.cells, meta = level.meta;
  let fallback = -1;
  for (let tries = 0; tries < 400; tries++) {
    const i = rng.int(cells.length);
    if (cells[i] !== NEST_CELL.CHAMBER) continue;
    if (meta[i] === preferMeta) return { x: (i % level.w) + 0.5, y: ((i / level.w) | 0) + 0.5 };
    if (fallback < 0) fallback = i;
  }
  if (fallback >= 0) return { x: (fallback % level.w) + 0.5, y: ((fallback / level.w) | 0) + 0.5 };
  return null;
}

export { NUTRITION };
