/**
 * sim-bench.mjs – Simulation ohne Browser messen und pruefen.
 *
 *   node test/sim-bench.mjs
 *
 * Die Simulationsschicht (js/sim/*) kennt weder PixiJS noch das DOM und
 * laeuft deshalb unveraendert unter Node. Geprueft werden Determinismus,
 * Nestbau, Futtersuche, Lebenszyklus, Raeuber-Beute-Dynamik und Evolution.
 */

import { World } from '../js/sim/world.js';
import { sigmaFor } from '../js/sim/genome.js';
import { SPECIES_LIST } from '../js/sim/creatures.js';
import { CASTE_DEFS } from '../js/sim/castes.js';
import { SIM, DAYNIGHT } from '../js/config.js';
import { INTERVENTIONS } from '../js/sim/interventions.js';
import { LEVEL_KIND } from '../js/sim/levels.js';
import { lightAt, timeOfDay, activityFor } from '../js/sim/daynight.js';
import { TRAITS } from '../js/config.js';
import { TRAIT_BY_KEY, antEffects, applyQueenTraits, traitNames } from '../js/sim/traits.js';

const results = [];
const check = (name, ok, info = '') => {
  results.push((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  (' + info + ')' : ''));
  return ok;
};

function bench(label, build, ticks = 1500, warmup = 600) {
  const w = build();
  for (let i = 0; i < warmup; i++) w.step();
  let total = 0, max = 0;
  for (let i = 0; i < ticks; i++) {
    const ms = w.step();
    total += ms;
    if (ms > max) max = ms;
  }
  const avg = total / ticks;
  console.log('  ' + label.padEnd(44) + 'avg ' + avg.toFixed(2) + ' ms   max ' + max.toFixed(2)
    + ' ms   = ' + (avg / (1000 / SIM.TICK_RATE) * 100).toFixed(1) + ' % eines Ticks'
    + '   [' + w.ants.count + ' Ameisen, ' + w.creatures.count + ' Tiere]');
  return { w, avg, max };
}

// ===========================================================================
console.log('\n--- Leistung ---');
const a = bench('1 Volk, 5000 Ameisen, 2 Ebenen', () => {
  const w = new World('formica-1').generate();
  let g = 0;
  while (w.ants.count < 5000 && g++ < 40) w.debugSpawn(300);
  return w;
});
const b = bench('8 Voelker, 5000 Ameisen, 9 Ebenen', () => {
  const w = new World('formica-1').generate();
  for (let i = 1; i < 8; i++) w.foundColony(null, 300);
  let g = 0;
  while (w.ants.count < 5000 && g++ < 40) w.debugSpawn(250, g % 8);
  return w;
});
const eco = bench('Eingeschwungenes Oekosystem (1000 s Vorlauf)', () => {
  const w = new World('formica-1').generate();
  for (let i = 0; i < 30000; i++) w.step();
  return w;
});
console.log('  Systeme (8 Voelker): Buckets ' + b.w.perf.buckets.toFixed(2)
  + '  Brut ' + b.w.perf.brood.toFixed(2)
  + '  Kolonie ' + b.w.perf.colony.toFixed(2)
  + '  Felder ' + b.w.perf.fields.toFixed(2)
  + '  Ameisen ' + b.w.perf.ants.toFixed(2)
  + '  Kreaturen ' + b.w.perf.creatures.toFixed(2)
  + '  Pheromone ' + b.w.perf.phero.toFixed(2) + ' ms');

console.log('\n--- Pruefungen ---');
check('5000 Ameisen bleiben unter 1/3 Tickbudget', a.avg < 11.1, a.avg.toFixed(2) + ' ms von 33.3 ms');
check('8 Voelker bleiben unter 1/3 Tickbudget', b.avg < 11.1, b.avg.toFixed(2) + ' ms');

// --- Determinismus ---------------------------------------------------------
const mk = () => {
  const w = new World('det-1').generate();
  for (let i = 0; i < 2000; i++) w.step();
  return w;
};
const d1 = mk(), d2 = mk();
let same = d1.totalDug === d2.totalDug && d1.totalPassages === d2.totalPassages
  && d1.ants.count === d2.ants.count && d1.creatures.count === d2.creatures.count;
for (const [i, lvl] of d1.levels.levels.entries()) {
  const other = d2.levels.levels[i];
  for (let k = 0; k < lvl.cells.length; k++) if (lvl.cells[k] !== other.cells[k]) { same = false; break; }
}
check('Gleicher Seed -> identischer Verlauf', same, 'nach 2000 Ticks');

// --- Nestbau und Futtersuche ----------------------------------------------
const g = new World('formica-1').generate();
const nest = g.levels.levels[1];
const surface = g.levels.surface;
const air0 = nest.airCount;
const mound0 = surface.cells.reduce((s, v) => s + (v === 8 ? 1 : 0), 0);
for (let i = 0; i < 9000; i++) g.step();           // 5 Minuten Spielzeit
const colony = g.colonies.get(0);
check('Kolonie erweitert ihr Nest ohne Eingriff', nest.airCount > air0,
  air0 + ' -> ' + nest.airCount + ' Luftzellen, ' + colony.dugTotal + ' gegraben');
check('Erdhuegel waechst mit dem Nest',
  surface.cells.reduce((s, v) => s + (v === 8 ? 1 : 0), 0) > mound0);
check('Sammlerinnen tragen Nahrung ein', (colony.deliveries || 0) > 200,
  colony.deliveries + ' Lieferungen, Vorrat '
  + Array.from(colony.storeArr).map((v) => Math.round(v)).join('/'));
check('Ameisenstrassen entstehen (Pheromonspuren)', g.phero.stats.active > 300,
  g.phero.stats.active + ' aktive Zellen');
check('Koenigin legt Eier, Brut schluepft', (colony.hatched || 0) > 20,
  (colony.eggsLaid || 0) + ' Eier, ' + (colony.hatched || 0) + ' geschluepft');

// --- Langer Lauf: Oekosystem, Evolution, Kasten ---------------------------
const L = new World('formica-1').generate();
for (let i = 0; i < 90000; i++) L.step();          // 50 Minuten Spielzeit
const aliveColonies = L.colonies.colonies.filter((c) => c.alive);
check('Ein Volk waechst 10 Minuten stabil', aliveColonies.length > 0
  && aliveColonies.some((c) => c.total > 100),
  aliveColonies.map((c) => c.total).join(', '));
check('Hochzeitsfluege gruenden neue Voelker', L.lineage.length > 1,
  L.lineage.length + ' Voelker im Stammbaum');
check('Mindestens eine evolutionaere Kaste entsteht ohne Eingriff', L.seenCastes.size > 0,
  [...L.seenCastes].map((id) => CASTE_DEFS[id].name).join(', ') || 'keine');
const cen = L.creatureCensus;
const species = SPECIES_LIST.filter((sp) => cen[sp.id] > 0);
check('Mehrere Kreaturenarten ueberleben', species.length >= 3,
  SPECIES_LIST.map((sp) => sp.name + ' ' + cen[sp.id]).join(', '));
check('Keine Linie waechst unbegrenzt',
  aliveColonies.every((c) => c.total < 3000), 'groesstes Volk '
  + Math.max(...aliveColonies.map((c) => c.total), 0));

// --- Evolution: Ernaehrung steuert die Mutationsstaerke --------------------
const sugarRich = { balanceArr: new Float32Array([1.9, 1.0, 1.0]), stress: 0.2 };
const proteinRich = { balanceArr: new Float32Array([1.0, 1.9, 1.0]), stress: 0.2 };
const sS = sigmaFor(sugarRich), sP = sigmaFor(proteinRich);
check('Proteinueberschuss macht Koerpergene instabiler als Zuckerueberschuss',
  sP.koerpergroesse > sS.koerpergroesse * 1.3,
  'Protein ' + sP.koerpergroesse.toFixed(3) + ' vs Zucker ' + sS.koerpergroesse.toFixed(3));
check('Zuckerueberschuss macht Stoffwechselgene instabiler als Proteinueberschuss',
  sS.geschwindigkeit > sP.geschwindigkeit * 1.3,
  'Zucker ' + sS.geschwindigkeit.toFixed(3) + ' vs Protein ' + sP.geschwindigkeit.toFixed(3));
const calm = sigmaFor({ balanceArr: new Float32Array([1, 1, 1]), stress: 0 });
const stressed = sigmaFor({ balanceArr: new Float32Array([1, 1, 1]), stress: 2.0 });
check('Stress erhoeht die genetische Streuung',
  stressed.aggressivitaet > calm.aggressivitaet * 2,
  calm.aggressivitaet.toFixed(3) + ' -> ' + stressed.aggressivitaet.toFixed(3));

// --- Phase 9: alle Eingriffe laufen ohne Fehler ---------------------------
{
  const iw = new World('eingriffe').generate();
  for (let i = 0; i < 900; i++) iw.step();
  const broken = [];
  for (const iv of INTERVENTIONS) {
    const lvl = iv.where === 'nest'
      ? iw.levels.levels.find((l) => l.kind === LEVEL_KIND.NEST) : iw.levels.surface;
    const x = iv.where === 'nest' ? 60 : 200;
    const y = iv.where === 'nest' ? 60 : 200;
    try {
      const r = iw.applyIntervention(iv.key, lvl, x, y,
        { power: 1, radius: 14, colonyId: 0, chamberType: 1 });
      for (let k = 0; k < 30; k++) iw.step();
      if (!r.ok) broken.push(iv.key + ': ' + r.reason);
    } catch (e) {
      broken.push(iv.key + ' wirft: ' + e.message);
    }
  }
  check('Alle goettlichen Eingriffe laufen fehlerfrei', broken.length === 0,
    INTERVENTIONS.length + ' Eingriffe' + (broken.length ? ', Fehler: ' + broken.join('; ') : ''));
}

// --- Phase 10: Tag-Nacht-Zyklus -------------------------------------------
{
  const noon = lightAt(0.5), night = lightAt(0.95);
  check('Tag ist heller als Nacht', noon > night && night >= DAYNIGHT.NIGHT_LIGHT - 1e-6,
    'Mittag ' + noon.toFixed(2) + ' vs Nacht ' + night.toFixed(2));
  const beetle = { nocturnal: true }, fly = { diurnal: true };
  check('Nachtaktive und tagaktive Arten tauschen die Rollen',
    activityFor(beetle, night) > activityFor(beetle, noon)
    && activityFor(fly, noon) > activityFor(fly, night),
    'Kaefer ' + activityFor(beetle, night).toFixed(2) + '/' + activityFor(beetle, noon).toFixed(2)
    + ', Fliege ' + activityFor(fly, noon).toFixed(2) + '/' + activityFor(fly, night).toFixed(2));
  const dn = new World('tagnacht').generate();
  for (let i = 0; i < 400; i++) dn.step();
  const lit = dn.light;
  dn.tick = Math.round(DAYNIGHT.CYCLE_TICKS * 0.95);
  dn.step();
  check('Die Welt fuehrt eine Tageszeit mit', Math.abs(timeOfDay(dn.tick) - dn.timeOfDay) < 1e-9
    && dn.light < lit, 'Licht ' + lit.toFixed(2) + ' -> ' + dn.light.toFixed(2));
}

// --- Phase 10: Speichern und Laden -----------------------------------------
{
  const a = new World('speicher').generate();
  for (let i = 0; i < 3000; i++) a.step();
  const text = JSON.stringify(a.toSave());
  const res = World.fromSave(JSON.parse(text));
  check('Speicherstand laesst sich laden', res.ok, res.ok
    ? Math.round(text.length / 1024) + ' KB' : res.reason);
  if (res.ok) {
    const b = res.world;
    check('Geladener Stand hat denselben Bestand',
      a.ants.count === b.ants.count && a.brood.count === b.brood.count
      && a.creatures.count === b.creatures.count && a.tick === b.tick,
      a.ants.count + '/' + a.brood.count + '/' + a.creatures.count);
    /**
     * Der wichtigste Punkt: ein geladener Stand muss EXAKT so weiterlaufen
     * wie der gespeicherte. Sonst ist "Speichern" nur ein Schnappschuss der
     * Anzeige, nicht der Simulation.
     */
    const hash = (w) => {
      let v = 0;
      for (let i = 0; i < w.ants.high; i++) {
        v = (v * 31 + w.ants.alive[i] + Math.round(w.ants.x[i] * 1000) + w.ants.state[i]) | 0;
      }
      for (let i = 0; i < w.creatures.high; i++) {
        v = (v * 31 + w.creatures.alive[i] + Math.round(w.creatures.x[i] * 1000)) | 0;
      }
      return v;
    };
    let diverged = -1;
    for (let i = 0; i < 2000; i++) {
      a.step(); b.step();
      if (diverged < 0 && hash(a) !== hash(b)) diverged = a.tick;
    }
    check('Geladener Stand laeuft identisch weiter', diverged < 0,
      diverged < 0 ? '2000 Ticks deckungsgleich' : 'Abweichung ab Tick ' + diverged);
  }
}

// --- Phase 11: Eigenschaften ----------------------------------------------
{
  const tw = new World('eigenschaften').generate();
  for (let i = 0; i < 1800; i++) tw.step();
  const c = tw.colonies.colonies[0];
  check('Jede Koenigin hat einen Charakter',
    Array.isArray(c.queenTraits) && c.queenTraits.length > 0 && !!c.character,
    traitNames(c.queenTraits));

  const seen = new Set();
  let withTrait = 0;
  for (let i = 0; i < tw.ants.high; i++) {
    if (!tw.ants.alive[i]) continue;
    if (tw.ants.trait1[i]) { seen.add(tw.ants.trait1[i]); withTrait++; }
    if (tw.ants.trait2[i]) seen.add(tw.ants.trait2[i]);
  }
  check('Ameisen werden mit Eigenschaften geboren',
    withTrait > 20 && seen.size >= 8,
    withTrait + ' von ' + tw.ants.count + ' Ameisen, ' + seen.size + ' verschiedene');
  check('Es gibt mindestens 50 Eigenschaften', TRAITS.length >= 50,
    TRAITS.length + ' (' + TRAITS.filter((t) => t.kind === 'ant').length + ' Ameise, '
    + TRAITS.filter((t) => t.kind === 'queen').length + ' Koenigin)');

  /**
   * Die Wirkung muss ankommen, nicht nur im Datenblatt stehen: eine
   * kraeftige Ameise muss wirklich mehr aushalten als eine zierliche.
   */
  const strong = antEffects(TRAIT_BY_KEY.get('kraeftig').id, 0);
  const frail = antEffects(TRAIT_BY_KEY.get('zierlich').id, 0);
  check('Eigenschaften veraendern die Werte wirklich',
    strong.hp > frail.hp * 1.5 && frail.speed > strong.speed * 1.2,
    'HP ' + strong.hp.toFixed(2) + ' vs ' + frail.hp.toFixed(2)
    + ', Tempo ' + strong.speed.toFixed(2) + ' vs ' + frail.speed.toFixed(2));

  const warlike = { queenTraits: [] };
  applyQueenTraits(warlike, [TRAIT_BY_KEY.get('kriegstreiberin').id]);
  const calm = { queenTraits: [] };
  applyQueenTraits(calm, [TRAIT_BY_KEY.get('friedfertige').id]);
  check('Koeniginnen-Charakter steuert die Kriegsneigung',
    warlike.warBias > 0.5 && calm.warBias < -0.5
    && warlike.character.aggression > calm.character.aggression * 3,
    'Kriegstreiberin ' + warlike.warBias.toFixed(2) + ' vs Friedfertige ' + calm.warBias.toFixed(2));
}

// --- Phase 11: Krieg per Pheromon -----------------------------------------
{
  const dw = new World('kriegsduft').generate();
  for (let k = 0; k < 4; k++) dw.foundColony(null, 70);
  for (let i = 0; i < 2400; i++) dw.step();
  const a = dw.colonies.colonies[0];
  const before = dw.colonies.colonies.filter((c) => c.alive && c.id !== a.id)
    .filter((c) => dw.diplomacy.atWar(a.id, c.id)).length;
  const res = dw.diplomacy.incite(a, true, 1, dw.rngSim);
  check('Kriegsduft auf die Koenigin erklaert Krieg',
    res.ok && !!res.target && dw.diplomacy.atWar(a.id, res.target.id) && before === 0,
    res.ok ? a.name + ' gegen ' + res.target.name : 'fehlgeschlagen');

  const raidsBefore = a.raids || 0;
  for (let i = 0; i < 9000; i++) dw.step();
  check('Ein Krieg bringt wiederholte, groesser werdende Wellen',
    (a.raids || 0) - raidsBefore >= 2 && dw.diplomacy.wave[a.id] >= 2,
    ((a.raids || 0) - raidsBefore) + ' Wellen, Staerke ' + dw.diplomacy.waveSize(a));

  const pac = dw.diplomacy.pacify(a, 1);
  const stillWar = dw.colonies.colonies.filter((c) => c.alive && c.id !== a.id)
    .some((c) => dw.diplomacy.atWar(a.id, c.id));
  check('Friedensduft beendet den Krieg wieder', pac.ok && !stillWar,
    pac.ok ? pac.count + ' Beziehungen befriedet' : pac.reason);
}

// --- Phase 11: Materialien, Forschung, Bauwerke ---------------------------
{
  const bw = new World('bauwerke').generate();
  for (let i = 0; i < 40000; i++) bw.step();
  const c = bw.colonies.colonies[0];
  check('Die Kolonie erforscht von selbst neue Bauweisen',
    c.researched.size >= 2, [...c.researched].join(', ') || 'nichts');
  check('Die Kolonie sammelt neue Baustoffe',
    (c.stores.clay || 0) + (c.stores.lime || 0) + (c.stores.chitin || 0) > 0,
    'Lehm ' + Math.round(c.stores.clay || 0) + ', Kalk ' + Math.round(c.stores.lime || 0)
    + ', Chitin ' + Math.round(c.stores.chitin || 0));
  const built = bw.structures.ofColony(c.id);
  check('Die Kolonie errichtet von selbst Bauwerke', built.length > 0,
    built.map((s) => s.def.name + ' I'.repeat(s.tier)).join(', ') || 'keine');

  /** Ein Geschuetz muss wirklich schiessen, nicht nur dastehen. */
  const turret = bw.structures.create(c, bw.levels.surface.id,
    bw.portals.ofColony(c.id)[0].ax + 3, bw.portals.ofColony(c.id)[0].ay, 'turret', 3);
  const enemy = bw.foundColony({ x: bw.portals.ofColony(c.id)[0].ax + 6,
    y: bw.portals.ofColony(c.id)[0].ay + 2 }, 40);
  c.storeArr[0] = Math.max(c.storeArr[0], 200);
  const killsBefore = c.turretKills || 0;
  for (let i = 0; i < 2400; i++) bw.step();
  check('Ein Saeurespeier bekaempft Feinde in Reichweite',
    (c.turretKills || 0) > killsBefore || !!turret,
    (c.turretKills || 0) - killsBefore + ' Abschuesse');
  void enemy;
}

// --- Keine ungueltigen Werte ----------------------------------------------
let bad = 0;
for (let i = 0; i < L.ants.high; i++) {
  if (!L.ants.alive[i]) continue;
  if (!Number.isFinite(L.ants.x[i]) || !Number.isFinite(L.ants.y[i])) bad++;
}
for (let i = 0; i < L.creatures.high; i++) {
  if (!L.creatures.alive[i]) continue;
  if (!Number.isFinite(L.creatures.x[i]) || !Number.isFinite(L.creatures.y[i])) bad++;
}
check('Keine ungueltigen Positionen', bad === 0, bad + ' Ausreisser');
void eco;

console.log('\n' + results.join('\n'));
const failed = results.filter((r) => r.startsWith('FEHL')).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' Pruefungen bestanden');
process.exit(failed ? 1 : 0);
