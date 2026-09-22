/**
 * colony.js – Kolonie-Daten.
 *
 * Phase 1 nutzt davon nur Identitaet (Name, Farbe, Ebenen, Eingaenge) und die
 * Populationszaehler. Vorraete, Ernaehrungsbilanz, Stress und die Kolonie-KI
 * kommen in Phase 3; das Genom in Phase 8. Die Felder stehen bereits hier,
 * damit UI und Legende eine stabile Datenquelle haben.
 */

import { COLONY, LIMITS } from '../config.js';
import { CASTE_DEFS } from './castes.js';
import { ANT_STATE } from './ants.js';

/** Roemische Generationszahl fuer Kolonienamen ("Rot III"). */
export function roman(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  let v = Math.max(1, n | 0);
  for (const [val, sym] of table) while (v >= val) { out += sym; v -= val; }
  return out;
}

export class Colony {
  /**
   * @param {{id:number, generation?:number, parentId?:number}} opts
   */
  constructor(opts) {
    this.id = opts.id;
    this.generation = opts.generation || 1;
    this.parentId = opts.parentId !== undefined ? opts.parentId : -1;
    this.baseName = COLONY.NAMES[this.id % COLONY.NAMES.length];
    this.color = COLONY.COLORS[this.id % COLONY.COLORS.length];
    this.alive = true;
    this.foundedTick = 0;

    /** Nest-Ebenen dieser Kolonie (IDs). */
    this.nestLevelIds = [];
    /** Portale (IDs) dieser Kolonie. */
    this.portalIds = [];

    /** Populationszaehler pro Kaste (Index = Kasten-ID). */
    this.population = new Uint16Array(CASTE_DEFS.length);
    /** Populationszaehler pro Ebene (Map levelId -> Anzahl). */
    this.populationByLevel = new Map();
    this.total = 0;

    /** Vorraete – ab Phase 3 gefuellt. */
    this.stores = { sugar: 0, protein: 0, fat: 0, pebble: 0, resin: 0 };
    /** Ernaehrungsbilanz b_n – ab Phase 3. */
    this.balance = { sugar: 1, protein: 1, fat: 1 };
    /** Stresswert S – ab Phase 8 relevant. */
    this.stress = 0;
    /** Bedrohungsstufe 0..3 – ab Phase 5. */
    this.threat = 0;
    /** Bereits aufgetretene Kasten (Set von Kasten-IDs) fuer die Legende. */
    this.knownCastes = new Set();
    /** Ameisen, die gerade graben bzw. Brut pflegen (jeden Tick gezaehlt). */
    this.diggers = 0;
    this.nurses = 0;
    this.foragers = 0;
    /** Ameisen, die gerade an einem Bauwerk arbeiten. */
    this.builders = 0;
  }

  get name() { return this.baseName + ' ' + roman(this.generation); }
  get nestName() { return 'Nest ' + this.name; }
  get colorCss() { return '#' + this.color.toString(16).padStart(6, '0'); }

  resetCounts() {
    this.population.fill(0);
    this.populationByLevel.clear();
    this.total = 0;
    this.diggers = 0;
    this.nurses = 0;
    this.foragers = 0;
    this.builders = 0;
  }

  countAnt(casteId, levelId, state) {
    this.population[casteId]++;
    this.total++;
    if (state === ANT_STATE.DIG) this.diggers++;
    else if (state === ANT_STATE.NURSE) this.nurses++;
    else if (state === ANT_STATE.EXPLORE || state === ANT_STATE.RETURN) this.foragers++;
    this.knownCastes.add(casteId);
    this.populationByLevel.set(levelId, (this.populationByLevel.get(levelId) || 0) + 1);
  }
}

export class ColonyManager {
  constructor() {
    /** @type {Colony[]} */
    this.colonies = [];
    this.byId = new Map();
  }

  create(opts = {}) {
    if (this.colonies.length >= LIMITS.MAX_COLONIES) {
      throw new Error('Maximale Anzahl Kolonien erreicht (' + LIMITS.MAX_COLONIES + ')');
    }
    const c = new Colony({ id: this.colonies.length, ...opts });
    this.colonies.push(c);
    this.byId.set(c.id, c);
    return c;
  }

  get(id) { return this.byId.get(id) || null; }

  get living() { return this.colonies.filter((c) => c.alive); }
}

// ===========================================================================
// KOLONIE-KI
// ---------------------------------------------------------------------------
// Steuert NICHT einzelne Ameisen, sondern nur Prioritaeten und Anteile:
//   - wie oft die Koenigin Eier legt (Protein und Gen "eierrate")
//   - welche Kaste aus einer Larve werden soll (Bedarf, Bedrohung, Gene)
//   - wann ein Hochzeitsflug startet
// Laeuft alle NUTRITION.UPDATE_INTERVAL Ticks, nach Kolonie-ID gestaffelt.
// ===========================================================================

import { BROOD as BROOD_CFG, NUTRITION, EVO, NUTRIENT } from '../config.js';
import { CASTE } from './castes.js';
import { unlockedCastes } from './genome.js';
import { CASTE_BY_KEY } from './castes.js';

/** Wie viele Eier stehen der Koenigin gerade zu? */
export function eggInterval(colony) {
  const gene = colony.genome ? colony.genome.eierrate : 0.5;
  const protein = colony.balanceArr ? colony.balanceArr[NUTRIENT.PROTEIN] : 1;
  const rate = (0.4 + gene * 1.6) * Math.min(1.6, Math.max(0.15, protein));
  return Math.max(18, BROOD_CFG.EGG_INTERVAL / rate);
}

/**
 * Kaste, die aus der naechsten Larve werden soll.
 * Reihenfolge: evolutionaere Sonderkasten (selten, teuer) -> Soldatinnen
 * nach Gen und Bedrohung -> Arbeiterinnen.
 */
export function chooseCaste(colony, rng) {
  const g = colony.genome;
  const rich = colony.balanceArr && colony.balanceArr[NUTRIENT.PROTEIN] >= BROOD_CFG.RICH_PROTEIN
    && colony.storeArr[NUTRIENT.PROTEIN] > 25;

  if (rich && g) {
    const unlocked = colony.unlocked || unlockedCastes(colony);
    if (unlocked.size > 0 && rng.chance(0.18)) {
      const keys = [...unlocked];
      const key = keys[rng.int(keys.length)];
      const def = CASTE_BY_KEY.get(key);
      if (def) {
        // Teure Kasten gibt es nur in kleiner Zahl
        const have = colony.population[def.id] || 0;
        const cap = Math.max(2, colony.total * (def.id === CASTE.TITAN ? 0.01 : 0.06));
        if (have < cap) return def.id;
      }
    }
  }

  const soldierGene = g ? g.soldatenanteil : 0.5;
  const threatBonus = colony.threat * 0.10;
  let share = soldierGene * 0.22 + threatBonus;
  if (!rich) share *= 0.35;                       // ohne Protein keine Soldatinnen
  if (rng.chance(share)) return CASTE.SOLDIER;
  return CASTE.WORKER;
}

/**
 * Kolonie-KI: Eier legen, Kasten waehlen, Hochzeitsflug ausloesen.
 * @param {object} colony
 * @param {import('./world.js').World} world
 * @param {number} ticks vergangene Ticks seit dem letzten Aufruf
 */
export function updateColonyAI(colony, world, ticks) {
  if (!colony.alive) return;
  const rng = world.rngSim;

  colony.unlocked = unlockedCastes(colony);

  // --- Eier legen --------------------------------------------------------
  const queens = colony.population[CASTE.QUEEN] || 0;
  if (queens > 0 && colony.broodTotal < BROOD_CFG.MAX_PER_COLONY) {
    colony.eggTimer = (colony.eggTimer || 0) + ticks;
    const interval = eggInterval(colony);
    while (colony.eggTimer >= interval && colony.broodTotal < BROOD_CFG.MAX_PER_COLONY) {
      colony.eggTimer -= interval;
      if (colony.storeArr[NUTRIENT.PROTEIN] < NUTRITION.PROTEIN_PER_EGG) break;
      if (!world.layEgg(colony, chooseCaste(colony, rng))) break;
      colony.storeArr[NUTRIENT.PROTEIN] -= NUTRITION.PROTEIN_PER_EGG;
    }
  }

  // --- Bei extremem Proteinmangel frisst die Kolonie eigene Eier ---------
  if (colony.balanceArr[NUTRIENT.PROTEIN] < BROOD_CFG.CANNIBAL_BALANCE
      && colony.broodCount && colony.broodCount[0] > 4 && rng.chance(0.25)) {
    world.eatOwnEgg(colony);
  }

  // --- Hochzeitsflug -----------------------------------------------------
  const interval = EVO.FLIGHT_INTERVAL / Math.max(0.1, EVO.FLIGHT_SCALE);
  if (colony.total >= EVO.FLIGHT_MIN_POP
      && colony.balanceArr[NUTRIENT.SUGAR] > EVO.FLIGHT_MIN_BALANCE
      && colony.balanceArr[NUTRIENT.PROTEIN] > EVO.FLIGHT_MIN_BALANCE
      && world.tick - colony.lastFlightTick > interval) {
    world.startNuptialFlight(colony);
  }
}
