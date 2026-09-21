/**
 * nutrition.js – Bedarf, Bilanz, Phaenotyp und Stress einer Kolonie.
 *
 * Die drei Schichten aus dem Lastenheft sauber getrennt:
 *   1. PHAENOTYP  – wirkt sofort auf die Ameisen, die gerade schluepfen.
 *   2. MUTATION   – nur bei der Gruendung neuer Kolonien (genome.js).
 *   3. SELEKTION  – macht die Umwelt.
 *
 * Bilanz: b_n = Aufnahme_n / Bedarf_n, exponentiell geglaettet ueber
 * NUTRITION.BALANCE_WINDOW Ticks. b = 1 gedeckt, < 1 Mangel, > 1 Ueberschuss.
 *
 * Alles hier laeuft nur alle NUTRITION.UPDATE_INTERVAL Ticks und ist nach
 * Kolonie-ID gestaffelt.
 */

import { NUTRITION, NUTRIENT, EVO, BROOD as BROOD_CFG } from '../config.js';
import { CASTE, casteDef } from './castes.js';
import { NEST_CELL, CHAMBER } from './nest.js';

const N = 3;

export function initNutrition(colony) {
  /** Deckungsgrad des laufenden Bedarfs (1 = voll gedeckt). */
  colony.supply = 1;
  colony.stores = { sugar: 60, protein: 40, fat: 40, pebble: 0, resin: 0 };
  colony.storeArr = new Float32Array([60, 40, 40]);
  colony.capacity = new Float32Array([NUTRITION.STORE_BASE, NUTRITION.STORE_BASE, NUTRITION.STORE_BASE]);
  colony.intakeAcc = new Float32Array(N);
  colony.demandAcc = new Float32Array(N);
  colony.balance = { sugar: 1, protein: 1, fat: 1 };
  colony.balanceArr = new Float32Array([1, 1, 1]);
  colony.needWeight = new Float32Array([1, 1, 1]);
  colony.stress = 0;
  colony.stressEvents = 0;
  /** Phaenotyp-Faktoren fuer neu schluepfende Ameisen. */
  colony.pheno = { size: 1, speed: 1, life: 1 };
  /** Gesamtaufnahme seit Gruendung (Statistik). */
  colony.harvested = new Float32Array(N);
  colony.starving = false;
  colony.lastFlightTick = 0;
}

/** Nahrung einlagern (Ameise liefert ab). */
export function storeFood(colony, nutrientIdx, amount, profile) {
  // Eine Fuhre traegt anteilig alle drei Naehrstoffe des Profils.
  for (let n = 0; n < N; n++) {
    const part = amount * profile[n];
    if (part <= 0) continue;
    const room = colony.capacity[n] - colony.storeArr[n];
    const put = Math.min(part, Math.max(0, room));
    colony.storeArr[n] += put;
    colony.intakeAcc[n] += part;       // Bilanz zaehlt die Aufnahme, nicht den Platz
    colony.harvested[n] += part;
  }
  void nutrientIdx;
}

/** Speicherkapazitaet aus Vorratskammern und Honigtopfameisen. */
export function updateCapacity(colony, world) {
  let cells = 0;
  for (const lid of colony.nestLevelIds) {
    const lvl = world.levels.get(lid);
    if (!lvl) continue;
    const c = lvl.cells, m = lvl.meta;
    for (let i = 0; i < c.length; i++) if (c[i] === NEST_CELL.CHAMBER && m[i] === CHAMBER.STORE) cells++;
  }
  const base = NUTRITION.STORE_BASE + cells * NUTRITION.STORE_PER_CELL;
  const repletes = colony.population[CASTE.REPLETE] || 0;
  colony.capacity[NUTRIENT.SUGAR] = base + repletes * 60;
  colony.capacity[NUTRIENT.PROTEIN] = base;
  colony.capacity[NUTRIENT.FAT] = base + repletes * 40;
  colony.storeCells = cells;
}

/**
 * Bedarf pro Tick. Haengt an Population, Kasten, Brut und Genom –
 * das ist die Kopplung, die spaeter die Selektion traegt.
 */
export function demandPerTick(colony, world, out) {
  let sugar = 0, protein = 0, fat = 0;
  const g = colony.genome;
  const speedGene = g ? g.geschwindigkeit : 0.5;
  const sizeGene = g ? g.koerpergroesse : 0.5;
  const armorGene = g ? g.panzerung : 0.5;
  const lifeGene = g ? g.lebensdauer : 0.5;

  for (let c = 0; c < colony.population.length; c++) {
    const n = colony.population[c];
    if (!n) continue;
    const def = casteDef(c);
    // Zucker: Grundumsatz mal Groesse, zuzueglich Tempoaufschlag
    sugar += n * NUTRITION.SUGAR_PER_ADULT * def.size
      * (1 + NUTRITION.SUGAR_SPEED_FACTOR * (speedGene - 0.5) * 2 * def.speed);
    fat += n * NUTRITION.FAT_PER_ADULT * def.size * (1 + (lifeGene - 0.5));
  }
  // Brut: Protein
  const larvae = colony.broodCount ? colony.broodCount[1] : 0;
  protein += larvae * NUTRITION.PROTEIN_PER_LARVA * (1 + (sizeGene - 0.5) + (armorGene - 0.5) * 0.6);
  // Teure Kasten kosten dauerhaft mehr Protein
  const expensive = (colony.population[CASTE.SOLDIER] || 0) * 0.6
    + (colony.population[CASTE.ARMOR] || 0) * 1.0
    + (colony.population[CASTE.TITAN] || 0) * 2.5;
  protein += expensive * NUTRITION.PROTEIN_PER_LARVA * 0.06;

  out[0] = Math.max(1e-6, sugar);
  out[1] = Math.max(1e-6, protein);
  out[2] = Math.max(1e-6, fat);
  return out;
}

const _demand = new Float32Array(N);

/**
 * Verbrauch abbuchen, Bilanz fortschreiben, Phaenotyp und Stress bestimmen.
 * Wird alle NUTRITION.UPDATE_INTERVAL Ticks je Kolonie aufgerufen.
 */
export function updateNutrition(colony, world, ticks) {
  demandPerTick(colony, world, _demand);

  // --- Verbrauch ---------------------------------------------------------
  /**
   * Der Deckungsgrad ist BEWUSST kein Ja/Nein. Frueher galt jede noch so
   * kleine Luecke als "Hungersnot" und liess das ganze Volk gleichzeitig
   * sterben. Jetzt steigt der Hunger anteilig zur Unterdeckung: ein zu
   * grosses Volk schrumpft auf eine tragfaehige Groesse, statt komplett
   * auszusterben.
   */
  let supply = 1;
  for (let n = 0; n < N; n++) {
    if (n === NUTRIENT.PROTEIN) continue;          // Protein geht ueber die Brutpflege ab
    const need = _demand[n] * ticks;
    colony.demandAcc[n] += need;
    const take = Math.min(colony.storeArr[n], need);
    colony.storeArr[n] -= take;
    if (need > 1e-9) supply = Math.min(supply, take / need);
  }
  colony.demandAcc[NUTRIENT.PROTEIN] += _demand[NUTRIENT.PROTEIN] * ticks;
  colony.supply = clamp(supply, 0, 1);
  colony.starving = colony.supply < 0.999;

  // --- Bilanz (exponentiell geglaettet) ----------------------------------
  const alpha = Math.min(1, ticks / NUTRITION.BALANCE_WINDOW);
  for (let n = 0; n < N; n++) {
    const d = colony.demandAcc[n];
    const b = d > 1e-9 ? colony.intakeAcc[n] / d : 1;
    colony.balanceArr[n] += (clamp(b, 0, 4) - colony.balanceArr[n]) * alpha;
    // Fenster gleitend leeren
    colony.intakeAcc[n] *= 1 - alpha;
    colony.demandAcc[n] *= 1 - alpha;
  }
  colony.balance.sugar = colony.balanceArr[0];
  colony.balance.protein = colony.balanceArr[1];
  colony.balance.fat = colony.balanceArr[2];

  // --- Bedarfsgewichte fuer die Futtersuche ------------------------------
  // Fehlt ein Naehrstoff, werden Spuren dieses Naehrstoffs attraktiver.
  for (let n = 0; n < N; n++) {
    colony.needWeight[n] = clamp(1.6 - colony.balanceArr[n], 0.25, 2.5);
  }

  // --- Phaenotyp (Schicht 1) --------------------------------------------
  const bs = colony.balanceArr[0], bp = colony.balanceArr[1], bf = colony.balanceArr[2];
  colony.pheno.size = lerpClamp(bp, NUTRITION.PHENO_SIZE_RANGE);
  colony.pheno.speed = lerpClamp(bs, NUTRITION.PHENO_SPEED_RANGE);
  // Zuckerueberschuss macht schnell, aber verschleisst; Fett verlaengert
  const lifeFromFat = lerpClamp(bf, NUTRITION.PHENO_LIFE_RANGE);
  colony.pheno.life = lifeFromFat * (bs > 1.2 ? 0.9 : 1);
  // Ungleichgewicht ist schlechter als knapp, aber ausgewogen
  const imbalance = (Math.abs(Math.log(Math.max(0.05, bs / bp)))
    + Math.abs(Math.log(Math.max(0.05, bp / bf)))) * 0.5;
  const penalty = clamp(1 - imbalance * 0.12, 0.8, 1);
  colony.pheno.size *= penalty;
  colony.pheno.life *= penalty;

  // --- Stress (Schicht 2 braucht ihn) ------------------------------------
  let s = 0;
  for (let n = 0; n < N; n++) {
    s += Math.abs(Math.log(Math.max(0.05, colony.balanceArr[n]))) * EVO.STRESS_WEIGHT[n];
  }
  s += colony.stressEvents;
  colony.stressEvents *= Math.pow(EVO.STRESS_DECAY, ticks);
  colony.stress = clamp(s, 0, EVO.STRESS_MAX);

  updateCapacity(colony, world);
}

/** Kann die Kolonie gerade teure Kasten aufziehen? */
export function canAffordExpensive(colony) {
  return colony.balanceArr[NUTRIENT.PROTEIN] >= BROOD_CFG.RICH_PROTEIN
    && colony.storeArr[NUTRIENT.PROTEIN] > 25;
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/** Bilanz 0..2 auf einen Bereich abbilden (1 = Mitte). */
function lerpClamp(b, range) {
  const t = clamp((b - 0.5) / 1.0, 0, 1);      // b 0.5 -> 0, b 1.5 -> 1
  return range[0] + (range[1] - range[0]) * t;
}
