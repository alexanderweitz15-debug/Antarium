/**
 * sim-bench.mjs – Simulation ohne Browser messen und pruefen.
 *
 *   node test/sim-bench.mjs
 *
 * Die Simulationsschicht (js/sim/*) kennt weder PixiJS noch das DOM und
 * laeuft deshalb unveraendert unter Node. Das Skript prueft Determinismus,
 * Nestbau und Tickdauer.
 */

import { World } from '../js/sim/world.js';

const results = [];
const check = (name, ok, info = '') => {
  results.push((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  (' + info + ')' : ''));
  return ok;
};

function bench(label, build, ticks = 1500, warmup = 300) {
  const w = build();
  for (let i = 0; i < warmup; i++) w.step();
  let total = 0, max = 0;
  for (let i = 0; i < ticks; i++) {
    const ms = w.step();
    total += ms;
    if (ms > max) max = ms;
  }
  const avg = total / ticks;
  console.log('  ' + label.padEnd(42) + 'avg ' + avg.toFixed(2) + ' ms   max ' + max.toFixed(2)
    + ' ms   = ' + (avg / (1000 / 30) * 100).toFixed(1) + ' % eines Ticks');
  return { w, avg, max };
}

console.log('\n--- Leistung ---');
const a = bench('1 Kolonie, 5000 Ameisen, 2 Ebenen', () => {
  const w = new World('formica-1').generate();
  let g = 0;
  while (w.ants.count < 5000 && g++ < 40) w.debugSpawn(300);
  return w;
});
const b = bench('8 Kolonien, 5000 Ameisen, 9 Ebenen', () => {
  const w = new World('formica-1').generate();
  for (let i = 1; i < 8; i++) w.foundColony(null, 300);
  let g = 0;
  while (w.ants.count < 5000 && g++ < 40) w.debugSpawn(200, g % 8);
  return w;
});
console.log('  Systeme (8 Kolonien): Buckets ' + b.w.perf.buckets.toFixed(2)
  + '  Bau+Felder ' + b.w.perf.build.toFixed(2)
  + '  Spatial ' + b.w.perf.spatial.toFixed(2)
  + '  Ameisen ' + b.w.perf.ants.toFixed(2) + ' ms');

console.log('\n--- Pruefungen ---');
check('5000 Ameisen bleiben unter 1/3 Tickbudget', a.avg < 11.1, a.avg.toFixed(2) + ' ms von 33.3 ms');
check('8 Kolonien bleiben unter 1/3 Tickbudget', b.avg < 11.1, b.avg.toFixed(2) + ' ms');

// Determinismus inklusive Nestbau
const mk = () => {
  const w = new World('det-1').generate();
  for (let i = 0; i < 1500; i++) w.step();
  return w;
};
const d1 = mk(), d2 = mk();
let same = d1.totalDug === d2.totalDug && d1.totalPassages === d2.totalPassages;
for (const [i, lvl] of d1.levels.levels.entries()) {
  const other = d2.levels.levels[i];
  for (let k = 0; k < lvl.cells.length; k++) if (lvl.cells[k] !== other.cells[k]) { same = false; break; }
}
for (let i = 0; i < d1.ants.high && same; i++) {
  if (d1.ants.x[i] !== d2.ants.x[i] || d1.ants.level[i] !== d2.ants.level[i]) same = false;
}
check('Gleicher Seed -> identischer Verlauf', same, 'nach 1500 Ticks');

// Nestbau
const g = new World('formica-1').generate();
const nest = g.levels.levels[1];
const surface = g.levels.surface;
const air0 = nest.airCount;
const mound0 = surface.cells.reduce((s, v) => s + (v === 8 ? 1 : 0), 0);
for (let i = 0; i < 3000; i++) g.step();           // 100 Sekunden Spielzeit
const mound1 = surface.cells.reduce((s, v) => s + (v === 8 ? 1 : 0), 0);
const colony = g.colonies.get(0);
check('Kolonie erweitert ihr Nest ohne Eingriff', nest.airCount > air0,
  air0 + ' -> ' + nest.airCount + ' Luftzellen, ' + colony.dugTotal + ' Zellen gegraben');
check('Erdhuegel waechst mit dem Nest', mound1 > mound0, mound0 + ' -> ' + mound1 + ' Zellen');
const chambers = new Set();
for (let i = 0; i < nest.cells.length; i++) if (nest.cells[i] === 8 && nest.meta[i]) chambers.add(nest.meta[i]);
check('Neue Kammertypen entstehen', chambers.size >= 3, [...chambers].sort().join(', '));

// Von Hand markierter Auftrag mitten im Fels
const h = new World('formica-1').generate();
const hn = h.levels.levels[1];
const hc = h.colonies.get(0);
const tx = 130, ty = 70;
const added = h.markDigOrders(hc, hn, tx, ty, 3);
for (let i = 0; i < 9000; i++) h.step();
check('Bauauftrag mitten im Erdreich wird erschlossen und abgebaut',
  added > 0 && !hn.isSolid(tx, ty), added + ' Auftraege, Rest ' + hc.digQueue.length);

// Portalverkehr
check('Ameisen wechseln ueber Portale die Ebene', g.totalPassages > 100, g.totalPassages + ' Durchgaenge');

// Keine ungueltigen Werte
let bad = 0;
for (let i = 0; i < b.w.ants.high; i++) {
  if (!b.w.ants.alive[i]) continue;
  if (!Number.isFinite(b.w.ants.x[i]) || !Number.isFinite(b.w.ants.y[i]) || !Number.isFinite(b.w.ants.dir[i])) bad++;
}
check('Keine ungueltigen Positionen', bad === 0, bad + ' Ausreisser');

console.log('\n' + results.join('\n'));
const failed = results.filter((r) => r.startsWith('FEHL')).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' Pruefungen bestanden');
process.exit(failed ? 1 : 0);
