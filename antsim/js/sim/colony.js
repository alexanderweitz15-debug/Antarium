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
    /** Ameisen, die gerade graben (jeden Tick neu gezaehlt). */
    this.diggers = 0;
  }

  get name() { return this.baseName + ' ' + roman(this.generation); }
  get nestName() { return 'Nest ' + this.name; }
  get colorCss() { return '#' + this.color.toString(16).padStart(6, '0'); }

  resetCounts() {
    this.population.fill(0);
    this.populationByLevel.clear();
    this.total = 0;
    this.diggers = 0;
  }

  countAnt(casteId, levelId, isDigging) {
    this.population[casteId]++;
    this.total++;
    if (isDigging) this.diggers++;
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
