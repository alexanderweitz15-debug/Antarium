/**
 * genome.js – Genom, Mutation und Vererbung.
 *
 * Das Genom gehoert der KOLONIE, nicht der einzelnen Ameise, und aendert
 * sich ausschliesslich bei der Gruendung einer neuen Kolonie. Alle Werte
 * liegen zwischen 0 und 1.
 *
 * Die Mutation folgt genau den Formeln aus dem Lastenheft:
 *
 *   sigma_g = sigma_basis
 *           * (1 + k_stress * S)
 *           * PRODUKT_n (1 + k_ueberschuss_n * w[n][g] * ln(1 + max(0, b_n-1)))
 *   sigma_g = min(sigma_g, sigma_max),  zusaetzlich durch Fettueberschuss
 *             leicht stabilisiert
 *   mu_g    = biasStaerke * SUMME_n w[n][g] * tanh(b_n - 1)
 *   gen_neu = clamp(gen_eltern + Normal(mu_g, sigma_g), 0, 1)
 *
 * Dazu Sprungmutationen mit p = p_basis * (1 + S) – sie sind der Hauptweg,
 * auf dem eine Kastenschwelle zum ersten Mal ueberschritten wird.
 */

import { EVO, GENES, GENE_WEIGHTS, CASTE_UNLOCK, NUTRIENT_KEYS } from '../config.js';
import { CASTE_BY_KEY } from './castes.js';

/** Startgenom: leicht gestreut um 0.5, damit Kolonien sich unterscheiden. */
export function newGenome(rng, spread = 0.10) {
  const g = {};
  for (const def of GENES) g[def.key] = clamp01(0.5 + rng.gauss(0, spread));
  return g;
}

export function copyGenome(src) {
  const g = {};
  for (const def of GENES) g[def.key] = src[def.key];
  return g;
}

/** Mittelwert zweier Genome (Kreuzung beim Hochzeitsflug). */
export function crossGenome(a, b) {
  const g = {};
  for (const def of GENES) g[def.key] = (a[def.key] + b[def.key]) * 0.5;
  return g;
}

/**
 * Mutationsstaerke je Gen aus der Ernaehrungslage der Mutterkolonie.
 * Wird auch von der Mutationsprognose im Inspektor benutzt.
 * @returns {Object<string, number>} sigma je Genschluessel
 */
export function sigmaFor(colony) {
  const b = colony.balanceArr || new Float32Array([1, 1, 1]);
  const S = colony.stress || 0;
  const boost = (colony.mutagenSigma || 1) * EVO.MUTATION_SCALE;
  const stressFactor = 1 + EVO.K_STRESS * S;
  // Fettueberschuss stabilisiert alles ein wenig
  const fatSurplus = Math.max(0, b[2] - 1);
  const stabilize = 1 - EVO.FAT_STABILIZE * Math.min(1, fatSurplus);

  const out = {};
  for (const def of GENES) {
    let sigma = EVO.SIGMA_BASE * stressFactor;
    for (let n = 0; n < 3; n++) {
      const w = GENE_WEIGHTS[NUTRIENT_KEYS[n]][def.key] || 0;
      if (w === 0) continue;
      const surplus = Math.max(0, b[n] - 1);
      sigma *= 1 + EVO.K_SURPLUS[n] * w * Math.log(1 + surplus);
    }
    // Verhaltensgene haengen ausschliesslich am Stress
    if (def.group === 'verhalten') sigma = EVO.SIGMA_BASE * (1 + EVO.K_STRESS * S * 1.6);
    sigma *= stabilize * boost;
    out[def.key] = Math.min(EVO.SIGMA_MAX, sigma);
  }
  return out;
}

/** Richtungsneigung je Gen (0, wenn "Realistisch" eingestellt ist). */
export function muFor(colony, biasStrength) {
  const b = colony.balanceArr || new Float32Array([1, 1, 1]);
  const out = {};
  for (const def of GENES) {
    let mu = 0;
    if (biasStrength > 0) {
      for (let n = 0; n < 3; n++) {
        const w = GENE_WEIGHTS[NUTRIENT_KEYS[n]][def.key] || 0;
        if (w === 0) continue;
        mu += w * Math.tanh(b[n] - 1);
      }
      mu *= biasStrength * EVO.SIGMA_BASE;
    }
    out[def.key] = mu;
  }
  return out;
}

/**
 * Genom einer Jungkoenigin aus dem Genom der Mutterkolonie.
 * @param {object} parentGenome
 * @param {object} colony Mutterkolonie (liefert Bilanz, Stress, Mutagene)
 * @param {import('../rng.js').RNG} rng
 * @param {number} biasStrength 0 = "Realistisch"
 */
export function mutateGenome(parentGenome, colony, rng, biasStrength) {
  const sigma = sigmaFor(colony);
  const mu = muFor(colony, biasStrength);
  const S = colony.stress || 0;
  const jumpP = EVO.JUMP_BASE * (1 + S) * (colony.mutagenJump || 1) * EVO.MUTATION_SCALE;

  const child = {};
  const changes = [];
  for (const def of GENES) {
    const k = def.key;
    const before = parentGenome[k];
    let v = before + rng.gauss(mu[k], sigma[k]);
    if (rng.chance(jumpP)) {
      v = before + rng.range(-EVO.JUMP_RANGE, EVO.JUMP_RANGE);
      changes.push({ key: k, jump: true, from: before, to: clamp01(v) });
    }
    child[k] = clamp01(v);
    const d = child[k] - before;
    if (Math.abs(d) > 0.06 && !changes.some((c) => c.key === k)) {
      changes.push({ key: k, jump: false, from: before, to: child[k] });
    }
  }
  changes.sort((a, b2) => Math.abs(b2.to - b2.from) - Math.abs(a.to - a.from));
  return { genome: child, changes: changes.slice(0, 4) };
}

/**
 * Welche evolutionaeren Kasten darf diese Kolonie aufziehen?
 * Eine Kaste bleibt verfuegbar, solange das Gen ueber der Schwelle liegt.
 */
export function unlockedCastes(colony) {
  const out = new Set();
  const g = colony.genome;
  if (!g) return out;
  for (const [key, rule] of Object.entries(CASTE_UNLOCK)) {
    if (g[rule.gene] < rule.at) continue;
    if (rule.gene2 && g[rule.gene2] < rule.at2) continue;
    let ok = true;
    for (const need of rule.needs) {
      const def = CASTE_BY_KEY.get(need);
      if (!def || !colony.knownCastes.has(def.id)) { ok = false; break; }
    }
    if (ok) out.add(key);
  }
  return out;
}

/** Kurzprofil fuer Stammbaum und Inspektor. */
export function geneSummary(genome) {
  const list = GENES.map((d) => ({ key: d.key, name: d.name, v: genome[d.key] }));
  list.sort((a, b) => b.v - a.v);
  return list.slice(0, 3).map((e) => e.name + ' ' + e.v.toFixed(2)).join(', ');
}

/**
 * Mutationsprognose je Gengruppe – wird im Inspektor angezeigt
 * ("Koerpergene +40 % Mutationsstaerke durch Proteinueberschuss").
 */
export function mutationForecast(colony) {
  const sigma = sigmaFor(colony);
  const groups = {};
  for (const def of GENES) {
    if (!groups[def.group]) groups[def.group] = { sum: 0, n: 0 };
    groups[def.group].sum += sigma[def.key];
    groups[def.group].n++;
  }
  const out = [];
  const names = { stoffwechsel: 'Stoffwechselgene', koerper: 'Koerpergene', verhalten: 'Verhaltensgene', kaste: 'Kastengene' };
  for (const [key, v] of Object.entries(groups)) {
    const avg = v.sum / v.n;
    out.push({ group: key, name: names[key] || key, sigma: avg, factor: avg / EVO.SIGMA_BASE });
  }
  out.sort((a, b) => b.factor - a.factor);
  return out;
}

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
