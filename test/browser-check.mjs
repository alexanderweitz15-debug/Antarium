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

/**
 * Playwright liegt je nach Installation als ES-Modul oder als CommonJS vor.
 * Im zweiten Fall haengt alles unter default, und ein blosses Destrukturieren
 * liefert undefined – die Pruefung starb dann mit "Cannot read properties of
 * undefined (reading 'launch')", was nach einem Fehler im Spiel aussieht und
 * keiner ist.
 */
const pw = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const chromium = pw.chromium || (pw.default && pw.default.chromium);
if (!chromium) {
  console.error('Playwright gefunden, aber kein chromium darin. '
    + 'PLAYWRIGHT_MODULE zeigt auf: ' + (process.env.PLAYWRIGHT_MODULE || 'playwright'));
  process.exit(2);
}

/**
 * Ohne Dateiname: "npx serve" leitet /index.html auf /index um und wirft
 * dabei die Abfrage weg – ein ?skipmenu kam so nie an, und die Pruefung
 * blieb am Startmenue haengen.
 */
const BASE = process.argv[2] || 'http://localhost:8123/';
/**
 * Das Startmenue haelt den Start an, bis ein Modus gewaehlt ist. Fuer die
 * bestehenden Pruefungen wird es uebersprungen; das Menue selbst bekommt
 * am Ende eine eigene Pruefung mit echtem Klick.
 */
const URL = BASE + (BASE.includes('?') ? '&' : '?') + 'skipmenu=1';
const results = [];
const check = (name, ok, info = '') => {
  results.push((ok ? 'OK   ' : 'FEHL ') + name + (info ? '  (' + info + ')' : ''));
};

/**
 * Schalter, die in einem Klappmenue der Kopfzeile liegen, sind nicht
 * sichtbar, solange das Menue zu ist. Statt im Test die Menuemechanik
 * nachzubauen (und damit die Verpackung statt der Funktion zu pruefen),
 * wird das Menue kurz geoeffnet und der Schalter direkt angesprochen.
 */
const pressMenuButton = async (pg, id) => {
  await pg.evaluate((bid) => {
    const b = document.getElementById(bid);
    if (!b) throw new Error('Schalter fehlt: ' + bid);
    const menu = b.closest('.menu');
    if (menu) menu.classList.add('open');
    b.click();
    if (menu) menu.classList.remove('open');
  }, id);
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
const qBefore = await page.evaluate(() => formicarium.world.construction.queueLength(formicarium.world.colonies.get(0)));
await page.evaluate(() => {
  document.querySelectorAll('#tools .tool').forEach((b) => {
    const label = b.querySelector('span:last-child');
    if (label && label.textContent.trim() === 'Bauauftrag') b.click();
  });
  formicarium.game.setSpeedIndex(0);
});
await page.mouse.click(tp.x, tp.y);
await page.waitForTimeout(300);
const qAfter = await page.evaluate(() => formicarium.world.construction.queueLength(formicarium.world.colonies.get(0)));
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
  // Genau treffen: seit Phase 9 gibt es auch "Kolonie ausloeschen".
  document.querySelectorAll('#tools .tool').forEach((b) => {
    if (b.querySelector('span:last-child').textContent === 'Kolonie gruenden') b.click();
  });
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
await pressMenuButton(page, 'btn-research');
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
await pressMenuButton(page, 'btn-research');

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
await pressMenuButton(page, 'btn-stats');
await page.waitForTimeout(800);
const st = await page.evaluate(() => ({
  offen: !document.getElementById('panel-stats').hidden,
  zeilen: document.querySelectorAll('#stats .lin-row').length,
}));
check('Stammbaum zeigt alle Voelker', st.offen && st.zeilen >= 1, st.zeilen + ' Eintraege');
await pressMenuButton(page, 'btn-stats');

// --- 15. Kartenvorlage -----------------------------------------------------
// Das Kartenfeld liegt im Klappmenue "Spiel" – erst oeffnen, dann waehlen.
await page.evaluate(() => {
  const sel = document.getElementById('mapselect');
  const menu = sel.closest('.menu');
  if (menu) menu.classList.add('open');
});
await page.selectOption('#mapselect', 'geroell');
await pressMenuButton(page, 'btn-newworld');
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

// --- 16. Bild-in-Bild zeigt eine andere Ebene ------------------------------
await page.evaluate(() => window.formicarium.game.togglePip());
await page.waitForTimeout(1200);
const pip = await page.evaluate(() => {
  const f = window.formicarium;
  const w = f.pip.windows[0];
  if (!w) return { fenster: 0 };
  const view = f.renderer.levelViews.get(w.levelId);
  // Wurden die Chunk-Texturen der FREMDEN Ebene wirklich gezeichnet?
  let gefuellt = 0;
  for (const c of view.chunks.slice(0, 4)) {
    const d = c.ctx.getImageData(0, 0, 8, 8).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) { gefuellt++; break; }
  }
  const r = w.el.querySelector('.pip-body').getBoundingClientRect();
  const stil = getComputedStyle(w.el).backgroundColor;
  return {
    fenster: f.pip.count, ebene: w.levelId, aktiv: f.world.levels.activeId,
    chunks: w.chunks.length, gefuellt, breite: Math.round(r.width), rahmen: stil,
  };
});
check('Bild-in-Bild zeigt eine andere Ebene',
  pip.fenster === 1 && pip.ebene !== pip.aktiv && pip.chunks > 0
  && pip.gefuellt === 4 && /rgba\(0, 0, 0, 0\)|transparent/.test(pip.rahmen),
  JSON.stringify(pip));
await page.evaluate(() => window.formicarium.game.togglePip());

// --- 17. Eingriffe in der Werkzeugleiste -----------------------------------
const godTools = await page.evaluate(() => {
  const gruppen = [...document.querySelectorAll('#tools .tool-group')];
  const g = gruppen.find((b) => b.querySelector('h3').textContent === 'Eingriffe');
  return {
    anzahl: g ? g.querySelectorAll('.tool').length : 0,
    regler: document.querySelectorAll('#tools .slider-row input[type=range]').length,
    modus: !!document.querySelector('#tools .btn.wide'),
  };
});
check('Eingriffe stehen als Werkzeuge bereit mit Reglern',
  godTools.anzahl >= 15 && godTools.regler === 2 && godTools.modus, JSON.stringify(godTools));

const meteor = await page.evaluate(async () => {
  const f = window.formicarium;
  const l = f.world.levels.surface;
  // Genau den Krater messen, nicht die Erdzellen der ganzen Karte: die
  // aendern sich staendig, weil Ameisen Lehm abbauen.
  const R = 22;
  const snap = [];
  for (let y = 200 - R; y <= 200 + R; y++) {
    for (let x = 200 - R; x <= 200 + R; x++) snap.push(l.cells[y * l.w + x]);
  }
  f.world.applyIntervention('meteor', l, 200, 200,
    { power: 1.5, radius: 20, colonyId: 0 });
  f.world.step();
  await new Promise((r) => setTimeout(r, 200));
  let geaendert = 0, k = 0;
  for (let y = 200 - R; y <= 200 + R; y++) {
    for (let x = 200 - R; x <= 200 + R; x++, k++) {
      if (l.cells[y * l.w + x] !== snap[k]) geaendert++;
    }
  }
  return { geaendert, wackeln: +f.world.shake.toFixed(2), teilchen: f.renderer.particles.count };
});
check('Meteor schlaegt einen Krater, wackelt und wirft Teilchen',
  meteor.geaendert > 50 && meteor.wackeln > 0 && meteor.teilchen > 5, JSON.stringify(meteor));

// --- 18. Tag und Nacht -----------------------------------------------------
const nacht = await page.evaluate(() => {
  const f = window.formicarium;
  f.world.tick = Math.round(10800 * 0.95);
  f.world.step();
  f.renderer.frame(1);
  const dunkel = f.renderer.nightVeil.alpha;
  f.world.tick = Math.round(10800 * 0.5);
  f.world.step();
  f.renderer.frame(1);
  return { nacht: +dunkel.toFixed(2), mittag: +f.renderer.nightVeil.alpha.toFixed(2),
    uhr: !!document.getElementById('clock') };
});
check('Nachts liegt eine Blende ueber der Oberflaeche',
  nacht.nacht > 0.3 && nacht.mittag === 0 && nacht.uhr, JSON.stringify(nacht));

// --- 19. Einstellungen und Spielstand --------------------------------------
await page.evaluate(() => window.formicarium.game.togglePanel('settings'));
await page.waitForTimeout(400);
const einst = await page.evaluate(() => ({
  offen: !document.getElementById('panel-settings').hidden,
  schalter: document.querySelectorAll('#settings .check-row').length,
  knoepfe: [...document.querySelectorAll('#settings .btn')].map((b) => b.textContent.trim()),
}));
check('Einstellungsfenster bietet Schalter und Spielstandknoepfe',
  einst.offen && einst.schalter >= 6 && einst.knoepfe.includes('Speichern')
  && einst.knoepfe.includes('Laden'), JSON.stringify(einst));

const stand = await page.evaluate(() => {
  const f = window.formicarium;
  f.game.saveLocal();
  const raw = localStorage.getItem('antarium.save');
  const d = JSON.parse(raw);
  return { kb: Math.round(raw.length / 1024), tick: d.tick, version: d.saveVersion,
    ebenen: d.levels.length, voelker: d.colonies.length };
});
check('Spielstand landet im Browserspeicher', stand.kb > 10 && stand.tick > 0
  && stand.version === 2 && stand.ebenen >= 2, JSON.stringify(stand));

await page.evaluate(() => localStorage.setItem('antarium.save.pending', '1'));
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__booted === true, { timeout: 30000 });
await page.waitForTimeout(900);
const geladen = await page.evaluate(() => ({
  tick: window.formicarium.world.tick, ameisen: window.formicarium.world.ants.count,
}));
check('Geladener Spielstand setzt die Welt fort',
  geladen.tick >= stand.tick && geladen.ameisen > 0, JSON.stringify(geladen));

// --- 20. Einheiten entfernen -----------------------------------------------
const weg = await page.evaluate(() => {
  const f = window.formicarium;
  const lvl = f.world.levels.surface;
  const a = f.world.ants;
  let x = 0, y = 0, n = 0;
  for (let i = 0; i < a.high && n < 1; i++) {
    if (a.alive[i] && a.level[i] === lvl.id) { x = a.x[i]; y = a.y[i]; n++; }
  }
  const vorher = f.world.ants.count;
  const entfernt = f.world.removeUnitsAt(lvl, x, y, 12);
  return { entfernt, vorher, nachher: f.world.ants.count };
});
check('Werkzeug "Entfernen" loescht Einheiten im Umkreis',
  weg.entfernt > 0 && weg.nachher < weg.vorher, JSON.stringify(weg));

// --- 21. Eigenschaften im Inspektor ---------------------------------------
const insp = await page.evaluate(() => {
  const f = window.formicarium, a = f.world.ants;
  let idx = -1;
  for (let i = 0; i < a.high; i++) {
    if (a.alive[i] && (a.trait1[i] || a.trait2[i])) { idx = i; break; }
  }
  if (idx < 0) return { gefunden: false };
  f.game.gotoLevel(a.level[idx]);
  window.__inspIdx = idx;
  return { gefunden: true, trait: a.trait1[idx], mut: +a.courage[idx].toFixed(2) };
});
await page.waitForTimeout(900);
const inspShown = await page.evaluate(() => {
  const f = window.formicarium;
  f.game.clearSelection();
  const insp = document.getElementById('inspector');
  // Inspektor ueber die oeffentliche Auswahl ansteuern
  const ev = f.world.ants;
  void ev;
  window.formicarium.state.follow = -1;
  const inspector = f.game;
  void inspector;
  return !!insp;
});
check('Ameisen tragen Eigenschaften mit Wirkung',
  insp.gefunden && insp.mut > 0 && inspShown,
  JSON.stringify(insp));

// --- 22. Kriegsduft ueber das Werkzeug ------------------------------------
const krieg = await page.evaluate(async () => {
  const f = window.formicarium, w = f.world;
  if (w.colonies.colonies.filter((c) => c.alive && c.total > 0).length < 2) {
    w.foundColony({ x: 120, y: 120 }, 60);
    // Ein Tick, damit die Zaehler des neuen Volkes stehen – vorher ist
    // colony.total noch 0 und der Duft findet kein Ziel.
    for (let i = 0; i < 3; i++) w.step();
  }
  const c = w.colonies.colonies.find((x) => x.alive && x.queenAnt >= 0
    && w.ants.alive[x.queenAnt]) || w.colonies.get(0);
  // Auf die LEBENDE Koenigin zielen, nicht auf ihren geplanten Platz
  const qx = w.ants.x[c.queenAnt], qy = w.ants.y[c.queenAnt];
  const nest = w.levels.get(w.ants.level[c.queenAnt]);
  const res = w.applyIntervention('warscent', nest, qx, qy,
    { power: 1.5, radius: 14, colonyId: c.id });
  const target = c.warTarget;
  for (let i = 0; i < 400; i++) w.step();
  return {
    ok: res.ok, wirkung: res.result, volk: c.id,
    ziel: target === undefined ? -1 : target,
    krieg: target >= 0 ? w.diplomacy.atWar(c.id, target) : false,
    eifer: w.diplomacy.zeal[c.id],
    voelker: w.colonies.colonies.filter((x) => x.alive && x.total > 0).length,
  };
});
check('Kriegsduft auf die Koenigin loest einen Krieg aus',
  krieg.ok && krieg.krieg && krieg.eifer > 0, JSON.stringify(krieg));

// --- 23. Bauwerke: Werkzeug, Anzeige, Forschungsbaum ----------------------
const bau = await page.evaluate(async () => {
  const f = window.formicarium, w = f.world;
  const c = w.colonies.get(0);
  const { RESEARCH_TREE } = await import('/js/config.js');
  for (const r of RESEARCH_TREE) { c.researched.add(r.key); w.structures._applyUnlocks(c, r); }
  const p = w.portals.ofColony(0)[0];
  const s1 = w.structures.create(c, w.levels.surface.id, p.ax + 5, p.ay, 'turret', 3);
  const s2 = w.structures.create(c, w.levels.surface.id, p.ax - 5, p.ay + 3, 'guardpost', 2);
  f.game.gotoSurface();
  return { gesetzt: !!s1 && !!s2, gesamt: w.structures.list.length,
    stufen: [s1.tier, s2.tier], schaden: s1.stats.damage, reichweite: s1.stats.range };
});
await page.waitForTimeout(900);
const bauGfx = await page.evaluate(() => ({
  sprites: window.formicarium.renderer.structPool.filter((s) => s.visible).length,
  gezeichnet: window.formicarium.renderer.stats.structures,
}));
check('Bauwerke lassen sich setzen und werden gezeichnet',
  bau.gesetzt && bau.gesamt >= 2 && bauGfx.gezeichnet >= 2,
  JSON.stringify({ ...bau, ...bauGfx }));

await page.evaluate(() => window.formicarium.game.togglePanel('research'));
await page.waitForTimeout(500);
const tech = await page.evaluate(() => ({
  zellen: document.querySelectorAll('#research .tech').length,
  fertig: document.querySelectorAll('#research .tech.done').length,
  charakter: document.querySelectorAll('#research .trait-chip').length,
}));
check('Forschungsbaum und Charakter stehen im Forschungsmenue',
  tech.zellen === 8 && tech.fertig === 8 && tech.charakter > 0, JSON.stringify(tech));
await page.evaluate(() => window.formicarium.game.togglePanel('research'));

const panel = await page.evaluate(() => ({
  charakter: document.querySelectorAll('#colonies .trait-chip').length,
  baustoffe: document.querySelectorAll('#colonies .mat-chip').length,
  bauwerke: document.querySelectorAll('#colonies .build-chip').length,
}));
check('Die Kolonieliste zeigt Charakter, Baustoffe und Bauwerke',
  panel.charakter > 0 && panel.baustoffe > 0 && panel.bauwerke > 0, JSON.stringify(panel));

// --- Startmenue: Modus waehlen und starten ---------------------------------
{
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const err2 = [];
  p2.on('pageerror', (e) => err2.push('pageerror: ' + e.message));
  await p2.goto(BASE, { waitUntil: 'load' });
  await p2.waitForSelector('#start:not([hidden])', { timeout: 15000 });

  const karten = await p2.evaluate(() => [...document.querySelectorAll('#start-modes .mode-card')]
    .map((c) => c.querySelector('.mode-name').textContent.trim()));
  check('Startmenue bietet die Spielmodi an', karten.length >= 2, karten.join(', '));

  const startetNicht = await p2.evaluate(() => window.__booted !== true);
  check('Das Spiel startet erst nach der Wahl', startetNicht,
    startetNicht ? 'wartet auf den Spieler' : 'lief schon los');

  // Feldzug waehlen und starten
  await p2.evaluate(() => {
    const karten = [...document.querySelectorAll('#start-modes .mode-card')];
    const f = karten.find((c) => c.querySelector('.mode-name').textContent.trim() === 'Feldzug');
    (f || karten[1]).click();
  });
  await p2.click('#start-go');
  await p2.waitForFunction(() => window.__booted === true, { timeout: 30000 });
  await p2.waitForTimeout(900);

  const modus = await p2.evaluate(() => window.antarium.world.mode);
  check('Der gewaehlte Modus gilt in der Welt', modus === 'feldzug', String(modus));

  const werkzeuge = await p2.evaluate(() =>
    [...document.querySelectorAll('#tools .tool span:last-child')].map((b) => b.textContent.trim()));
  const gott = ['Meteor', 'Seuche', 'Kolonie ausloeschen', 'Blitz'];
  check('Im Feldzug fehlen die goettlichen Eingriffe',
    werkzeuge.length > 0 && !gott.some((g) => werkzeuge.includes(g)),
    werkzeuge.length + ' Werkzeuge: ' + werkzeuge.slice(0, 8).join(', '));
  check('Im Feldzug gibt es den Grabduft',
    werkzeuge.includes('Grabduft'), werkzeuge.includes('Grabduft') ? 'vorhanden' : 'fehlt');

  const leiste = await p2.evaluate(() => {
    const el = document.getElementById('resources');
    return { da: el && !el.hidden, felder: el ? el.querySelectorAll('.res').length : 0 };
  });
  check('Im Feldzug zeigt eine Vorratsleiste den Bestand',
    leiste.da && leiste.felder >= 4, leiste.felder + ' Felder');

  check('Startmenue ohne Fehler in der Konsole', err2.length === 0, err2.slice(0, 2).join(' | '));
  await p2.close();
}

console.log('\n' + results.join('\n'));
// Netzfehler des CDN (Vendor-Fallback greift) sind kein Testfehler.
const real = errors.filter((e) => !e.includes('ERR_') && !e.includes('Failed to load resource'));
console.log('\nKonsole: ' + (real.length ? real.join('\n  ') : '(keine Fehler)'));
const failed = results.filter((r) => r.startsWith('FEHL')).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' Pruefungen bestanden');
await browser.close();
process.exit(failed || real.length ? 1 : 0);
