/**
 * browser-check.mjs – Abnahmekriterien im echten Browser pruefen.
 *
 * Voraussetzung: das Spiel laeuft unter http://localhost:8123
 *   npx serve -l 8123 .
 * Dann:
 *   node test/browser-check.mjs [url]
 *
 * Braucht Playwright (npm i -D playwright). Liegt es nicht im Projekt,
 * kann der Pfad ueber PLAYWRIGHT_MODULE gesetzt werden; ein abweichender
 * Chromium-Pfad ueber CHROME_PATH.
 */

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const URL = process.argv[2] || 'http://localhost:8123/index.html';
const results = [];
const check = (name, ok, info = '') => {
  results.push((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  (' + info + ')' : ''));
};

const launchOpts = { args: ['--no-sandbox'] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 140)); });

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.__booted === true, { timeout: 30000 });
await page.waitForTimeout(1200);

/** Texte der Werkzeugknoepfe (ohne Symbolzeichen). */
const toolNames = () => page.evaluate(
  () => [...document.querySelectorAll('#tools .tool span:last-child')].map((b) => b.textContent.trim()));

// --- 1. Unsichtbare Ebenen werden weiter simuliert -------------------------
const sim = await page.evaluate(async () => {
  const f = window.formicarium, a = f.world.ants;
  const ids = [];
  for (let i = 0; i < a.high; i++) if (a.alive[i] && a.level[i] === 1) ids.push(i);
  const before = ids.slice(0, 50).map((i) => a.x[i] + ',' + a.y[i]);
  await new Promise((r) => setTimeout(r, 1500));
  const after = ids.slice(0, 50).map((i) => a.x[i] + ',' + a.y[i]);
  let moved = 0;
  for (let k = 0; k < before.length; k++) if (before[k] !== after[k]) moved++;
  return { active: f.world.levels.activeId, moved, total: before.length };
});
check('Nest-Ebene wird simuliert, waehrend die Oberflaeche gezeigt wird',
  sim.active === 0 && sim.moved > sim.total * 0.8, sim.moved + '/' + sim.total + ' Ameisen bewegt');

// --- 2. Kameraposition pro Ebene ------------------------------------------
await page.evaluate(() => {
  const f = window.formicarium, p = f.world.portals.portals[0];
  f.camera.focusCell(p.ax, p.ay, 5);
});
await page.waitForTimeout(250);
const surfView = await page.evaluate(() => ({ x: +formicarium.camera.x.toFixed(1), y: +formicarium.camera.y.toFixed(1), z: +formicarium.camera.zoom.toFixed(2) }));
const pt = await page.evaluate(() => {
  const f = window.formicarium, p = f.world.portals.portals[0];
  const s = f.camera.worldToScreen((p.ax + 0.5) * 4, (p.ay + 0.5) * 4);
  return { x: Math.round(s.x), y: Math.round(s.y), bx: p.bx, by: p.by };
});
await page.mouse.click(pt.x, pt.y);
await page.waitForTimeout(900);
const inNest = await page.evaluate(() => ({
  active: formicarium.world.levels.activeId,
  cx: formicarium.camera.x / 4, cy: formicarium.camera.y / 4,
  fade: formicarium.renderer.fade.alpha,
  crumb: document.getElementById('breadcrumb').textContent,
}));
check('Klick auf Nesteingang wechselt in die Nest-Ebene', inNest.active === 1, inNest.crumb);
check('Kamera startet am Gegenstueck des Eingangs',
  Math.abs(inNest.cx - pt.bx) < 2 && Math.abs(inNest.cy - pt.by) < 12);
check('Blende nach dem Uebergang wieder klar', inNest.fade < 0.01);

await page.evaluate(() => { const f = window.formicarium; f.camera.panWorld(0, 120); f.camera.zoom = 8; f.camera.clamp(); });
await page.waitForTimeout(250);
const nestView = await page.evaluate(() => ({ x: +formicarium.camera.x.toFixed(1), y: +formicarium.camera.y.toFixed(1), z: +formicarium.camera.zoom.toFixed(2) }));
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
const back = await page.evaluate(() => ({ active: formicarium.world.levels.activeId, x: +formicarium.camera.x.toFixed(1), y: +formicarium.camera.y.toFixed(1), z: +formicarium.camera.zoom.toFixed(2) }));
await page.keyboard.press('Digit1');
await page.waitForTimeout(900);
const again = await page.evaluate(() => ({ x: +formicarium.camera.x.toFixed(1), y: +formicarium.camera.y.toFixed(1), z: +formicarium.camera.zoom.toFixed(2) }));
check('Oberflaechenansicht bleibt erhalten',
  back.active === 0 && back.x === surfView.x && back.z === surfView.z, JSON.stringify(back));
check('Nestansicht bleibt erhalten',
  again.x === nestView.x && again.z === nestView.z, JSON.stringify(again));

// --- 3. Legende ist ebenenabhaengig ---------------------------------------
const nestCats = await page.evaluate(() => [...document.querySelectorAll('#legend .legend-cat h3')].map((h) => h.textContent));
check('Legende zeigt im Nest Nest-Kategorien',
  nestCats.some((t) => t.includes('Nest')) && nestCats.some((t) => t.includes('Kammer')), nestCats.join(' / '));

// --- 4. Nest-Werkzeuge und Bauauftrag -------------------------------------
const nestTools = await toolNames();
check('Werkzeugleiste zeigt Nest-Werkzeuge',
  nestTools.includes('Bauauftrag') && nestTools.includes('Tunnel') && !nestTools.includes('Gras'),
  nestTools.join(', '));

const target = await page.evaluate(() => {
  const f = window.formicarium, lvl = f.world.levels.get(1);
  let tx = -1, ty = -1;
  for (let y = 20; y < 60 && tx < 0; y++) {
    for (let x = 106; x < 118; x++) {
      if (lvl.isSolid(x, y) && lvl.cells[y * lvl.w + x] !== 4) { tx = x; ty = y; break; }
    }
  }
  f.camera.focusCell(tx, ty, 6);
  return { tx, ty };
});
await page.waitForTimeout(250);
const tp = await page.evaluate((t) => {
  const s = formicarium.camera.worldToScreen((t.tx + 0.5) * 4, (t.ty + 0.5) * 4);
  return { x: Math.round(s.x), y: Math.round(s.y) };
}, target);
const qBefore = await page.evaluate(() => formicarium.world.colonies.get(0).digQueue.length);
await page.evaluate(() => {
  document.querySelectorAll('#tools .tool').forEach((b) => {
    const label = b.querySelector('span:last-child');
    if (label && label.textContent.trim() === 'Bauauftrag') b.click();
  });
  formicarium.game.setSpeedIndex(0);
});
await page.mouse.click(tp.x, tp.y);
await page.waitForTimeout(300);
const qAfter = await page.evaluate(() => formicarium.world.colonies.get(0).digQueue.length);
check('Bauauftrag-Werkzeug fuegt Auftraege hinzu', qAfter > qBefore, qBefore + ' -> ' + qAfter);

const dugBefore = await page.evaluate(() => formicarium.world.colonies.get(0).dugTotal);
await page.evaluate(() => formicarium.game.setSpeedIndex(4));
await page.waitForTimeout(7000);
const dug = await page.evaluate((t) => ({
  solid: formicarium.world.levels.get(1).isSolid(t.tx, t.ty),
  dug: formicarium.world.colonies.get(0).dugTotal,
}), target);
check('Ameisen graben die markierte Stelle ab', !dug.solid && dug.dug > dugBefore,
  (dug.dug - dugBefore) + ' Zellen in 7 s');
await page.evaluate(() => { formicarium.game.setSpeedIndex(1); formicarium.game.gotoSurface(); });
await page.waitForTimeout(900);

// --- 5. Terrain malen ------------------------------------------------------
const surfTools = await toolNames();
check('Werkzeugleiste wechselt auf Oberflaechen-Werkzeuge',
  surfTools.includes('Gras') && surfTools.includes('Kolonie gruenden') && !surfTools.includes('Bauauftrag'),
  surfTools.join(', '));
const sandBefore = await page.evaluate(() => {
  const f = window.formicarium, p = f.world.portals.portals[0];
  f.camera.focusCell(p.ax + 20, p.ay, 4);
  document.querySelectorAll('#tools .tool').forEach((b) => { if (b.textContent.includes('Sand')) b.click(); });
  return f.world.levels.surface.cells.reduce((a, v) => a + (v === 3 ? 1 : 0), 0);
});
await page.waitForTimeout(250);
await page.mouse.move(720, 405);
await page.mouse.down();
await page.mouse.move(840, 465, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(300);
const sandAfter = await page.evaluate(() => formicarium.world.levels.surface.cells.reduce((a, v) => a + (v === 3 ? 1 : 0), 0));
check('Terrain malen aendert Zellen', sandAfter > sandBefore + 30, (sandAfter - sandBefore) + ' Sandzellen dazu');

// --- 6. Kolonie gruenden ---------------------------------------------------
const colBefore = await page.evaluate(() => {
  document.querySelectorAll('#tools .tool').forEach((b) => { if (b.textContent.includes('Kolonie')) b.click(); });
  return { colonies: formicarium.world.colonies.colonies.length, levels: formicarium.world.levels.levels.length };
});
await page.mouse.click(500, 300);
await page.waitForTimeout(700);
const colAfter = await page.evaluate(() => ({
  colonies: formicarium.world.colonies.colonies.length,
  levels: formicarium.world.levels.levels.length,
  tabs: [...document.querySelectorAll('#levelnav .tab')].map((t) => t.textContent.trim()),
}));
check('Kolonie gruenden erzeugt Volk, Nest-Ebene und Reiter',
  colAfter.colonies === colBefore.colonies + 1 && colAfter.levels === colBefore.levels + 1
  && colAfter.tabs.length === colAfter.levels, colAfter.tabs.join(' | '));

// --- 7. Ameisen-Werkzeug ---------------------------------------------------
const antsBefore = await page.evaluate(() => {
  // Genauer Treffer: "Ameisen" – nicht "Ameisenloewe"
  document.querySelectorAll('#tools .tool').forEach((b) => {
    const label = b.querySelector('span:last-child');
    if (label && label.textContent.trim() === 'Ameisen') b.click();
  });
  return formicarium.world.ants.count;
});
await page.mouse.click(520, 320);
await page.waitForTimeout(400);
const antsAfter = await page.evaluate(() => formicarium.world.ants.count);
check('Ameisen-Werkzeug setzt Einheiten ab', antsAfter > antsBefore, (antsAfter - antsBefore) + ' Ameisen');

// --- 8. Geschwindigkeiten --------------------------------------------------
const speed = await page.evaluate(async () => {
  const f = window.formicarium;
  f.game.setSpeedIndex(0);
  await new Promise((r) => setTimeout(r, 400));
  const t0 = f.world.tick;
  await new Promise((r) => setTimeout(r, 400));
  const t1 = f.world.tick;
  f.game.step();
  const t2 = f.world.tick;
  f.game.setSpeedIndex(4);
  await new Promise((r) => setTimeout(r, 1000));
  const t3 = f.world.tick;
  f.game.setSpeedIndex(1);
  return { paused: t1 - t0, step: t2 - t1, fast: t3 - t2 };
});
check('Pause haelt die Simulation an', speed.paused === 0);
check('Einzelschritt rechnet genau einen Tick', speed.step === 1);
check('10x rechnet deutlich mehr Ticks', speed.fast > 120, speed.fast + ' Ticks in 1 s');

// --- 9. Nahrung ablegen ----------------------------------------------------
const foodBefore = await page.evaluate(() => {
  const f = window.formicarium, p = f.world.portals.portals[0];
  f.camera.focusCell(p.ax + 18, p.ay + 10, 4);
  document.querySelectorAll('#tools .tool').forEach((b) => { if (b.textContent.includes('Zuckerw')) b.click(); });
  return f.world.food.stats.sources;
});
await page.waitForTimeout(250);
await page.mouse.click(760, 430);
await page.waitForTimeout(1500);
const foodAfter = await page.evaluate(() => {
  const f = window.formicarium;
  let n = 0;
  const l = f.world.levels.surface;
  for (let i = 0; i < l.cells.length; i++) if (l.cells[i] === 14) n++;
  return n;
});
check('Nahrungs-Werkzeug legt Zuckerwuerfel ab', foodAfter > 0, foodAfter + ' Zellen');
void foodBefore;

// --- 10. Kreaturen spawnen -------------------------------------------------
const crBefore = await page.evaluate(() => {
  document.querySelectorAll('#tools .tool').forEach((b) => { if (b.textContent.includes('Wolfssp')) b.click(); });
  return window.formicarium.world.creatures.count;
});
await page.waitForTimeout(250);
await page.mouse.click(700, 500);
await page.waitForTimeout(500);
const crAfter = await page.evaluate(() => window.formicarium.world.creatures.count);
check('Kreaturen-Werkzeug spawnt Tiere', crAfter > crBefore, (crAfter - crBefore) + ' Wolfsspinnen');

// --- 11. Forschungsmenue ---------------------------------------------------
await page.click('#btn-research');
await page.waitForTimeout(600);
const res = await page.evaluate(() => ({
  offen: !document.getElementById('panel-research').hidden,
  gene: document.querySelectorAll('#research .gene-slider').length,
  kasten: document.querySelectorAll('#research .caste-row').length,
}));
check('Forschungsmenue oeffnet mit Genom-Editor und Kastenliste',
  res.offen && res.gene === 20 && res.kasten === 8, res.gene + ' Gene, ' + res.kasten + ' Kasten');

const geneBefore = await page.evaluate(() => window.formicarium.world.colonies.get(0).genome.koerpergroesse);
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#research .caste-row')];
  const r = rows.find((x) => x.textContent.includes('Titanin'));
  if (r) r.querySelector('button').click();
});
await page.waitForTimeout(400);
const geneAfter = await page.evaluate(() => window.formicarium.world.colonies.get(0).genome.koerpergroesse);
check('Kaste freischalten hebt das Gen ueber die Schwelle', geneAfter > geneBefore && geneAfter >= 0.78,
  geneBefore.toFixed(2) + ' -> ' + geneAfter.toFixed(2));

const alBefore = await page.evaluate(() => {
  let n = 0; const a = window.formicarium.world.ants;
  for (let i = 0; i < a.high; i++) if (a.alive[i] && a.caste[i] === 3) n++;
  return n;
});
await page.evaluate(() => {
  [...document.querySelectorAll('#research .btn')].find((b) => b.textContent === 'Hochzeitsflug jetzt')?.click();
});
await page.waitForTimeout(500);
const alAfter = await page.evaluate(() => {
  let n = 0; const a = window.formicarium.world.ants;
  for (let i = 0; i < a.high; i++) if (a.alive[i] && a.caste[i] === 3) n++;
  return n;
});
check('Hochzeitsflug laesst sich ausloesen', alAfter > alBefore, alBefore + ' -> ' + alAfter + ' Gefluegelte');

const tickBefore = await page.evaluate(() => window.formicarium.world.tick);
await page.evaluate(() => {
  [...document.querySelectorAll('#research .btn')].find((b) => b.textContent === '+1 min')?.click();
});
await page.waitForTimeout(6000);
const tickAfter = await page.evaluate(() => window.formicarium.world.tick);
check('Schnelldurchlauf rechnet Ticks voraus', tickAfter - tickBefore > 1500,
  (tickAfter - tickBefore) + ' Ticks in 6 s');
await page.click('#btn-research');

// --- 12. Pheromon-Overlay --------------------------------------------------
await page.evaluate(() => { window.formicarium.game.togglePhero(1); });
await page.waitForTimeout(800);
const ph = await page.evaluate(() => ({
  sichtbar: window.formicarium.renderer.pheroSprite && window.formicarium.renderer.pheroSprite.visible,
  aktiv: window.formicarium.world.phero.stats.active,
  ms: window.formicarium.renderer.stats.pheroMs,
}));
check('Pheromon-Overlay zeigt Ameisenstrassen', ph.sichtbar && ph.aktiv > 100,
  ph.aktiv + ' aktive Zellen, ' + ph.ms.toFixed(2) + ' ms');
await page.evaluate(() => { window.formicarium.game.togglePhero(1); });

// --- 13. Brut und Lebenszyklus ---------------------------------------------
const brood = await page.evaluate(() => ({
  brut: window.formicarium.world.brood.count,
  geschluepft: window.formicarium.world.colonies.get(0).hatched || 0,
}));
check('Brut existiert und schluepft', brood.brut > 0 || brood.geschluepft > 0,
  brood.brut + ' Brut, ' + brood.geschluepft + ' geschluepft');

// --- 14. Stammbaum ---------------------------------------------------------
await page.click('#btn-stats');
await page.waitForTimeout(800);
const st = await page.evaluate(() => ({
  offen: !document.getElementById('panel-stats').hidden,
  zeilen: document.querySelectorAll('#stats .lin-row').length,
}));
check('Stammbaum zeigt alle Voelker', st.offen && st.zeilen >= 1, st.zeilen + ' Eintraege');
await page.click('#btn-stats');

// --- 15. Kartenvorlage -----------------------------------------------------
await page.selectOption('#mapselect', 'geroell');
await page.click('#btn-newworld');
await page.waitForFunction(() => window.__booted === true, { timeout: 30000 });
await page.waitForTimeout(1200);
const map = await page.evaluate(() => ({
  preset: formicarium.world.preset.key,
  stone: formicarium.world.levels.surface.cells.reduce((a, v) => a + (v === 2 ? 1 : 0), 0),
  nahrung: formicarium.world.food.stats.sources,
  tiere: formicarium.world.creatures.count,
}));
check('Kartenvorlage wird uebernommen', map.preset === 'geroell' && map.stone > 3000,
  map.preset + ', ' + map.stone + ' Steinzellen');
check('Neue Welt hat Nahrung und Kreaturen', map.nahrung > 100 && map.tiere > 10,
  map.nahrung + ' Quellen, ' + map.tiere + ' Tiere');

console.log('\n' + results.join('\n'));
// Netzfehler des CDN (Vendor-Fallback greift) sind kein Testfehler.
const real = errors.filter((e) => !e.includes('ERR_') && !e.includes('Failed to load resource'));
console.log('\nKonsole: ' + (real.length ? real.join('\n  ') : '(keine Fehler)'));
const failed = results.filter((r) => r.startsWith('FEHL')).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' Pruefungen bestanden');
await browser.close();
process.exit(failed || real.length ? 1 : 0);
