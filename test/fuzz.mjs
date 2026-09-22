/**
 * fuzz.mjs – Massentest: viele Welten parallel, auf der Suche nach Fehlern
 * und nach Balanceproblemen.
 *
 *   node test/fuzz.mjs [Anzahl] [Ticks] [--workers N] [--json datei]
 *   node test/fuzz.mjs 1000 20000
 *
 * WAS GEPRUEFT WIRD (je Lauf)
 *   - keine Ausnahme, kein NaN, keine Position ausserhalb der Karte
 *   - die Welt laeuft die volle Tickzahl durch
 *   - der Speicherstand laesst sich schreiben und wieder lesen
 *   - Kennzahlen: Voelker am Ende, groesstes Volk, Aussterben, Kriege,
 *     Bauwerke, Forschungsstufen, ueberlebende Kreaturenarten
 *
 * WAS "PARALLEL" HIER HEISST
 *   Node laeuft einfaedig. Echte Gleichzeitigkeit gibt es nur ueber
 *   Prozesse bzw. Worker. Das Skript verteilt die Laeufe auf so viele
 *   Worker, wie der Rechner Kerne hat (--workers ueberschreibt das).
 *   Tausend Laeufe sind also tausend Laeufe auf N Kernen, nicht tausend
 *   gleichzeitige – das ginge auf keiner Maschine dieser Groesse.
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// Ein einzelner Lauf
// ---------------------------------------------------------------------------
async function runOne(seed, ticks, preset) {
  const { World } = await import('../js/sim/world.js');
  const { SPECIES_LIST } = await import('../js/sim/creatures.js');

  const out = {
    seed, preset, ticks, ok: true, error: null,
    colonies: 0, biggest: 0, extinct: false, totalAnts: 0, brood: 0,
    creatures: 0, species: 0, wars: 0, allies: 0, structures: 0,
    research: 0, castes: 0, lineage: 0, saveKb: 0, badPos: 0,
    peak: 0, collapses: 0, raids: 0,
  };

  try {
    const w = new World(seed, preset).generate();
    for (let i = 0; i < ticks; i++) {
      w.step();
      if ((i & 1023) === 0) {
        let live = 0;
        for (const c of w.colonies.colonies) if (c.alive) live += c.total;
        if (live > out.peak) out.peak = live;
      }
    }

    // --- Kennzahlen -------------------------------------------------------
    const alive = w.colonies.colonies.filter((c) => c.alive);
    out.colonies = alive.length;
    out.biggest = alive.reduce((m, c) => Math.max(m, c.total), 0);
    out.extinct = alive.length === 0;
    out.totalAnts = w.ants.count;
    out.brood = w.brood.count;
    out.creatures = w.creatures.count;
    out.lineage = w.lineage.length;
    out.castes = w.seenCastes.size;
    out.structures = w.structures.list.length;
    out.collapses = w.stability.collapses;
    out.raids = alive.reduce((s, c) => s + (c.raids || 0), 0);
    out.research = alive.reduce((m, c) => Math.max(m, c.researched ? c.researched.size : 0), 0);

    const cen = w.creatureCensus;
    out.species = SPECIES_LIST.filter((sp) => cen[sp.id] > 0).length;

    for (let a = 0; a < alive.length; a++) {
      for (let b = a + 1; b < alive.length; b++) {
        if (w.diplomacy.atWar(alive[a].id, alive[b].id)) out.wars++;
        if (w.diplomacy.allied(alive[a].id, alive[b].id)) out.allies++;
      }
    }

    // --- Gesundheitspruefungen -------------------------------------------
    const surface = w.levels.surface;
    for (let i = 0; i < w.ants.high; i++) {
      if (!w.ants.alive[i]) continue;
      const x = w.ants.x[i], y = w.ants.y[i];
      const lvl = w.levels.get(w.ants.level[i]);
      if (!Number.isFinite(x) || !Number.isFinite(y)
          || !Number.isFinite(w.ants.hp[i]) || !Number.isFinite(w.ants.speed[i])
          || !lvl || x < 0 || y < 0 || x > lvl.w || y > lvl.h) out.badPos++;
    }
    for (let i = 0; i < w.creatures.high; i++) {
      if (!w.creatures.alive[i]) continue;
      if (!Number.isFinite(w.creatures.x[i]) || !Number.isFinite(w.creatures.y[i])) out.badPos++;
    }
    for (const c of alive) {
      for (let n = 0; n < 3; n++) {
        if (!Number.isFinite(c.storeArr[n]) || c.storeArr[n] < -1e-6) out.badPos++;
      }
    }
    void surface;

    // --- Speicherstand ----------------------------------------------------
    const text = JSON.stringify(w.toSave());
    out.saveKb = Math.round(text.length / 1024);
    const res = World.fromSave(JSON.parse(text));
    if (!res.ok) { out.ok = false; out.error = 'Laden: ' + res.reason; }
    else if (res.world.ants.count !== w.ants.count) {
      out.ok = false;
      out.error = 'Bestand nach dem Laden abweichend';
    }

    if (out.badPos > 0) { out.ok = false; out.error = out.badPos + ' ungueltige Werte'; }
  } catch (e) {
    out.ok = false;
    out.error = (e && e.message ? e.message : String(e)).slice(0, 200);
    out.stack = (e && e.stack ? e.stack.split('\n')[1] || '' : '').trim().slice(0, 160);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------
if (!isMainThread) {
  const { jobs } = workerData;
  const results = [];
  for (const j of jobs) {
    results.push(await runOne(j.seed, j.ticks, j.preset));
    parentPort.postMessage({ progress: 1 });
  }
  parentPort.postMessage({ results });
} else {
  // -------------------------------------------------------------------------
  // Hauptprozess
  // -------------------------------------------------------------------------
  const args = process.argv.slice(2);
  const num = Number(args[0]) || 1000;
  const ticks = Number(args[1]) || 12000;
  const wIdx = args.indexOf('--workers');
  const workers = wIdx >= 0 ? Number(args[wIdx + 1]) : Math.max(1, cpus().length);
  const jIdx = args.indexOf('--json');
  const jsonOut = jIdx >= 0 ? args[jIdx + 1] : null;

  const PRESETS = ['wiese', 'steppe', 'aue', 'geroell', 'garten'];
  const jobs = [];
  for (let i = 0; i < num; i++) {
    jobs.push({ seed: 'fuzz-' + i, ticks, preset: PRESETS[i % PRESETS.length] });
  }

  // Gleichmaessig auf die Worker verteilen
  const chunks = Array.from({ length: workers }, () => []);
  jobs.forEach((j, i) => chunks[i % workers].push(j));

  console.log(num + ' Laeufe à ' + ticks + ' Ticks auf ' + workers + ' Workern'
    + ' (' + Math.round(num * ticks / 30 / 60) + ' Minuten Spielzeit insgesamt)');

  const t0 = Date.now();
  let done = 0;
  const all = [];
  const bar = () => {
    const pct = Math.round(done / num * 100);
    process.stdout.write('\r  ' + done + '/' + num + '  ' + pct + '%   ');
  };

  await Promise.all(chunks.map((jobsFor) => new Promise((resolve, reject) => {
    if (!jobsFor.length) return resolve();
    const w = new Worker(HERE, { workerData: { jobs: jobsFor } });
    w.on('message', (m) => {
      if (m.progress) { done += m.progress; bar(); }
      if (m.results) all.push(...m.results);
    });
    w.on('error', reject);
    w.on('exit', () => resolve());
    return undefined;
  })));

  process.stdout.write('\n');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // -------------------------------------------------------------------------
  // Auswertung
  // -------------------------------------------------------------------------
  const failed = all.filter((r) => !r.ok);
  const okRuns = all.filter((r) => r.ok);
  const num2 = (arr, f) => arr.map(f).sort((a, b) => a - b);
  const med = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : 0);
  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const pct = (n) => (n / Math.max(1, all.length) * 100).toFixed(1) + '%';

  console.log('\n=== Fehler ===');
  if (!failed.length) console.log('  keine');
  else {
    const byMsg = new Map();
    for (const f of failed) {
      const k = f.error + (f.stack ? '  @ ' + f.stack : '');
      byMsg.set(k, (byMsg.get(k) || []).concat(f.seed));
    }
    for (const [msg, seeds] of [...byMsg].sort((a, b) => b[1].length - a[1].length)) {
      console.log('  ' + seeds.length + 'x  ' + msg);
      console.log('       z.B. ' + seeds.slice(0, 4).join(', '));
    }
  }

  const extinct = all.filter((r) => r.extinct);
  const noBuild = okRuns.filter((r) => r.structures === 0);
  const noResearch = okRuns.filter((r) => r.research === 0);
  const runaway = okRuns.filter((r) => r.biggest > 2500);

  console.log('\n=== Balance ===');
  console.log('  Laeufe                ' + all.length + '  (' + secs + ' s, '
    + (all.length / Number(secs)).toFixed(1) + ' Laeufe/s)');
  console.log('  fehlerfrei            ' + okRuns.length + '  ' + pct(okRuns.length));
  console.log('  komplett ausgestorben ' + extinct.length + '  ' + pct(extinct.length));
  console.log('  ohne ein Bauwerk      ' + noBuild.length + '  ' + pct(noBuild.length));
  console.log('  ohne eine Forschung   ' + noResearch.length + '  ' + pct(noResearch.length));
  console.log('  Volk ueber 2500       ' + runaway.length + '  ' + pct(runaway.length));

  const f = (name, sel) => {
    const v = num2(okRuns, sel);
    console.log('  ' + name.padEnd(22)
      + 'Median ' + String(med(v)).padStart(6)
      + '   Mittel ' + avg(v).toFixed(1).padStart(7)
      + '   min ' + String(v[0] ?? 0).padStart(5)
      + '   max ' + String(v[v.length - 1] ?? 0).padStart(6));
  };
  console.log('');
  f('Voelker am Ende', (r) => r.colonies);
  f('groesstes Volk', (r) => r.biggest);
  f('Hoechststand', (r) => r.peak);
  f('Kreaturenarten', (r) => r.species);
  f('Bauwerke', (r) => r.structures);
  f('Forschungsstufen', (r) => r.research);
  f('evolutionaere Kasten', (r) => r.castes);
  f('Kriege am Ende', (r) => r.wars);
  f('Buendnisse', (r) => r.allies);
  f('Raubzuege', (r) => r.raids);
  f('Einstuerze', (r) => r.collapses);
  f('Speicherstand (KB)', (r) => r.saveKb);

  console.log('\n=== Je Kartenvorlage ===');
  for (const p of PRESETS) {
    const sub = okRuns.filter((r) => r.preset === p);
    if (!sub.length) continue;
    console.log('  ' + p.padEnd(9)
      + ' Voelker ' + avg(sub.map((r) => r.colonies)).toFixed(1)
      + '  groesstes ' + Math.round(avg(sub.map((r) => r.biggest)))
      + '  Arten ' + avg(sub.map((r) => r.species)).toFixed(1)
      + '  Bauwerke ' + avg(sub.map((r) => r.structures)).toFixed(1)
      + '  ausgestorben ' + sub.filter((r) => r.extinct).length);
  }

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(all, null, 1));
    console.log('\nRohdaten: ' + jsonOut);
  }
  process.exit(failed.length ? 1 : 0);
}
