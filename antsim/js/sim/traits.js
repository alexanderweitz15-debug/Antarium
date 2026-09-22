/**
 * traits.js – Eigenschaften von Ameisen und Koeniginnen (Phase 11).
 *
 * ABGRENZUNG ZU DEN GENEN
 *   Gene (siehe genome.js) gehoeren der KOLONIE, vererben sich und mutieren
 *   ueber Generationen. Eigenschaften gehoeren dem EINZELTIER, werden bei
 *   der Geburt gewuerfelt und aendern sich nie wieder. Ein Volk kann also
 *   genetisch friedlich sein und trotzdem einzelne jaehzornige Ameisen
 *   hervorbringen.
 *
 * WIE DIE WIRKUNG ANKOMMT
 *   Zahlenwerte (Tempo, Trefferpunkte, Grabtempo …) werden EINMAL bei der
 *   Geburt in die vorhandenen Spalten der Ameisentabelle eingerechnet. Im
 *   Tick kostet das dann nichts mehr.
 *
 *   Verhalten (flieht nie, greift von selbst an, nachtaktiv …) braucht eine
 *   Abfrage zur Laufzeit. Dafuer traegt jede Ameise eine Bitmaske
 *   (`ants.traitBits`), und eine Pruefung ist ein einzelnes UND.
 *
 * Eine Ameise hat hoechstens zwei Eigenschaften, eine Koenigin bis zu drei.
 * Mehr waere weder lesbar noch spuerbar.
 */

import { TRAITS, TRAIT_CFG } from '../config.js';

/** Eigenschaft je Schluessel. */
export const TRAIT_BY_KEY = new Map(TRAITS.map((t, i) => [t.key, { ...t, id: i + 1 }]));
/** Index 0 bleibt frei und bedeutet "keine Eigenschaft". */
export const TRAIT_LIST = [null, ...TRAITS.map((t, i) => ({ ...t, id: i + 1 }))];

export const ANT_TRAITS = TRAIT_LIST.filter((t) => t && t.kind === 'ant');
export const QUEEN_TRAITS = TRAIT_LIST.filter((t) => t && t.kind === 'queen');

/**
 * Verhaltensschalter als Bits. Ein Bit je Schalter, der in der Tabelle
 * vorkommt – die Liste wird aus den Daten erzeugt, damit ein neuer Schalter
 * nur einen Tabelleneintrag braucht.
 */
export const FLAG = {};
{
  let bit = 1;
  for (const t of TRAITS) {
    if (t.flag && FLAG[t.flag] === undefined) { FLAG[t.flag] = bit; bit *= 2; }
  }
}

/** Bitmaske einer Eigenschaft (0, wenn sie kein Verhalten aendert). */
function bitOf(t) { return t && t.flag ? FLAG[t.flag] : 0; }

// ---------------------------------------------------------------------------
// Wuerfeln
// ---------------------------------------------------------------------------

/** Gewichtete Auswahl aus einer Liste, optional mit bevorzugtem Schluessel. */
function pickWeighted(list, rng, push) {
  let total = 0;
  for (const t of list) total += t.rarity * (push === t.key ? TRAIT_CFG.PUSH_FACTOR : 1);
  if (total <= 0) return null;
  let r = rng.float() * total;
  for (const t of list) {
    r -= t.rarity * (push === t.key ? TRAIT_CFG.PUSH_FACTOR : 1);
    if (r <= 0) return t;
  }
  return list[list.length - 1];
}

/**
 * Eigenschaften fuer eine neue Ameise wuerfeln.
 * @param {import('../rng.js').RNG} rng
 * @param {object} colony fuer bevorzugte Eigenschaften der Koenigin
 * @returns {number[]} bis zu zwei IDs (0 = keine)
 */
export function rollAntTraits(rng, colony) {
  const out = [0, 0];
  if (!rng.chance(TRAIT_CFG.ANT_CHANCE * (colony && colony.traitChance !== undefined
    ? colony.traitChance : 1))) return out;
  const push = colony ? colony.traitPush : undefined;
  const bonus = colony && colony.antTraitBonus ? colony.antTraitBonus : 0;
  const count = Math.min(TRAIT_CFG.ANT_MAX,
    1 + bonus + (rng.chance(0.3) ? 1 : 0));
  const first = pickWeighted(ANT_TRAITS, rng, push);
  if (!first) return out;
  out[0] = first.id;
  if (count < 2) return out;
  // Zweite Eigenschaft: keine, die der ersten widerspricht
  const rest = ANT_TRAITS.filter((t) => t.id !== first.id
    && !(first.opposes || []).includes(t.key) && !(t.opposes || []).includes(first.key));
  const second = pickWeighted(rest, rng, push);
  if (second) out[1] = second.id;
  return out;
}

/** Charakter einer Koenigin wuerfeln (1 bis 3 Zuege ohne Widerspruch). */
export function rollQueenTraits(rng) {
  const want = rng.intRange(TRAIT_CFG.QUEEN_MIN, TRAIT_CFG.QUEEN_MAX);
  const out = [];
  let pool = QUEEN_TRAITS.slice();
  for (let i = 0; i < want && pool.length; i++) {
    const t = pickWeighted(pool, rng);
    if (!t) break;
    out.push(t.id);
    pool = pool.filter((o) => o.id !== t.id
      && !(t.opposes || []).includes(o.key) && !(o.opposes || []).includes(t.key));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Wirkung
// ---------------------------------------------------------------------------

/** Alle Multiplikatoren einer Ameise, als fertiges Objekt. */
export function antEffects(id1, id2) {
  const e = {
    speed: 1, hp: 1, size: 1, damage: 1, carry: 1, dig: 1, life: 1,
    hungerTol: 1, sense: 1, build: 1, nurse: 1, trail: 1, alarm: 1,
    courage: TRAIT_CFG.BASE_COURAGE, loyalty: 0, bits: 0,
  };
  for (const id of [id1, id2]) {
    const t = id ? TRAIT_LIST[id] : null;
    if (!t) continue;
    if (t.mul) for (const k of Object.keys(t.mul)) e[k] = (e[k] || 1) * t.mul[k];
    if (t.add) {
      if (t.add.courage) e.courage += t.add.courage;
      if (t.add.loyalty) e.loyalty += t.add.loyalty;
    }
    e.bits |= bitOf(t);
  }
  return e;
}

/**
 * Charakter einer Koenigin in Koloniewerte umrechnen. Das Ergebnis haengt
 * am Objekt der Kolonie und wird bei der Gruendung einmal berechnet.
 */
export function applyQueenTraits(colony, traitIds) {
  colony.queenTraits = traitIds.slice();
  const c = {
    eggRate: 1, soldierShare: 1, aggression: 1, expansion: 1, buildDrive: 1,
    raidSize: 1, research: 1, defence: 1, trade: 1,
  };
  let warBias = 0;
  let bits = 0;
  let push;
  let antTraitBonus = 0;
  for (const id of traitIds) {
    const t = TRAIT_LIST[id];
    if (!t) continue;
    if (t.mul) for (const k of Object.keys(t.mul)) c[k] = (c[k] || 1) * t.mul[k];
    if (t.add) {
      if (t.add.warBias) warBias += t.add.warBias;
      if (t.add.traitPush) push = t.add.traitPush;
      if (t.add.antTraitBonus) antTraitBonus += t.add.antTraitBonus;
    }
    bits |= bitOf(t);
  }
  colony.character = c;
  colony.warBias = Math.max(-1, Math.min(1, warBias));
  colony.queenBits = bits;
  colony.traitPush = push;
  colony.antTraitBonus = antTraitBonus;
  colony.traitChance = 1 + antTraitBonus * 0.3;
  return colony;
}

/** Hat die Koenigin diesen Schalter? */
export function queenHas(colony, flagName) {
  return !!(colony && (colony.queenBits & (FLAG[flagName] || 0)));
}

/** Lesbarer Name eines Charakters, z.B. "Kriegstreiberin, Bruetende". */
export function traitNames(ids) {
  if (!ids || !ids.length) return 'ohne Besonderheit';
  return ids.map((id) => (TRAIT_LIST[id] ? TRAIT_LIST[id].name : '?')).join(', ');
}

/** Kurzbeschreibung fuer den Inspektor. */
export function traitInfo(ids) {
  const out = [];
  for (const id of ids || []) {
    const t = TRAIT_LIST[id];
    if (t) out.push({ name: t.name, desc: t.desc, group: t.group });
  }
  return out;
}
