/**
 * main.js – Einstiegspunkt: Welt, Renderer und UI verdrahten, Spielschleife.
 *
 * SPIELSCHLEIFE
 *   Feste Simulationsrate (SIM.TICK_RATE), entkoppelt vom Rendering. Pro
 *   dargestelltem Frame werden so viele Ticks nachgeholt, wie die gewaehlte
 *   Geschwindigkeit verlangt (maximal SIM.MAX_TICKS_PER_FRAME, danach wird
 *   der Rueckstand verworfen, statt in eine Todesspirale zu laufen).
 *   Gezeichnet wird mit Interpolation zwischen dem vorletzten und dem
 *   letzten Tick (alpha), damit die Bewegung auch bei 1x fluessig aussieht.
 */

import { SIM, WORLD, CAMERA, TRANSITION, COLONY } from './config.js';
import { World } from './sim/world.js';
import { LEVEL_KIND } from './sim/levels.js';
import { bus, CAT } from './sim/events.js';
import { SpriteBank } from './render/sprites.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Transition } from './render/transition.js';
import { LevelNav } from './ui/levelNav.js';
import { Legend } from './ui/legend.js';
import { PerfOverlay } from './ui/perf.js';
import { EventLogView } from './ui/log.js';
import { Hud } from './ui/hud.js';
import { Inspector } from './ui/inspector.js';
import { ColonyPanel } from './ui/panels.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Fehler sichtbar machen – eine leere schwarze Seite hilft niemandem.
// ---------------------------------------------------------------------------
function bootError(msg) {
  const el = $('boot-msg');
  if (!el) return;
  el.classList.add('error');
  el.textContent = 'Start fehlgeschlagen:\n\n' + msg
    + '\n\nHinweis: Die Seite muss ueber einen lokalen Server laufen'
    + ' (z. B. "npx serve" im Projektordner), nicht per file://.';
  $('boot').classList.remove('done');
}
window.addEventListener('error', (e) => { if (!window.__booted) bootError(String(e.message)); });
window.addEventListener('unhandledrejection', (e) => { if (!window.__booted) bootError(String(e.reason)); });

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function boot() {
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed') || 'formica-1';

  // --- Welt ----------------------------------------------------------------
  const world = new World(seed).generate();

  // --- Grafik --------------------------------------------------------------
  const sprites = await new SpriteBank().load();
  const camera = new Camera();
  const renderer = new Renderer(world, sprites, camera);
  await renderer.init($('stage'));
  for (const level of world.levels.levels) renderer.addLevel(level);
  camera.attach(world.levels.surface);
  // Start an einem Nesteingang, damit sofort etwas zu sehen ist.
  const firstPortal = world.portals.portals[0];
  if (firstPortal) camera.focusCell(firstPortal.ax, firstPortal.ay, CAMERA.DEFAULT_ZOOM);
  renderer.setActive(world.levels.surface);
  const transition = new Transition(camera, renderer);

  // --- Zustand der Oberflaeche (UI) ---------------------------------------
  const state = {
    speedIndex: SIM.DEFAULT_SPEED_INDEX,
    lastRunningSpeed: SIM.DEFAULT_SPEED_INDEX,
    chunkGrid: false,
    transition: TRANSITION.ENABLED,
    legend: true,
    help: false,
    debug: false,
  };

  // --- Fassade fuer die UI-Module ------------------------------------------
  const game = {
    world,
    setSpeedIndex(i) {
      state.speedIndex = Math.max(0, Math.min(SIM.SPEEDS.length - 1, i));
      if (state.speedIndex > 0) state.lastRunningSpeed = state.speedIndex;
      hud.update(state);
    },
    togglePause() {
      game.setSpeedIndex(state.speedIndex === 0 ? state.lastRunningSpeed : 0);
    },
    step() {
      if (state.speedIndex !== 0) return;
      simTick();
      renderFrame(1);
    },
    toggleChunkGrid() {
      state.chunkGrid = !state.chunkGrid;
      renderer.setChunkGrid(state.chunkGrid);
      hud.update(state);
    },
    toggleTransition() {
      state.transition = !state.transition;
      transition.setEnabled(state.transition);
      hud.update(state);
    },
    togglePanel(which) {
      if (which === 'legend') { state.legend = !state.legend; $('panel-legend').hidden = !state.legend; }
      if (which === 'help') { state.help = !state.help; $('help').hidden = !state.help; }
      if (which === 'debug') { state.debug = !state.debug; $('debugmenu').hidden = !state.debug; }
      hud.update(state);
    },
    clearSelection() { inspector.clear(); },
    /** Ebenenwechsel mit Uebergang. focus = Zelle, auf die die Kamera zielt. */
    gotoLevel(levelId, focus) {
      const target = world.levels.get(levelId);
      if (!target) return;
      if (target.id === world.levels.activeId) {
        if (focus) camera.focusCell(focus.x, focus.y, Math.max(camera.zoom, CAMERA.DEFAULT_ZOOM));
        return;
      }
      if (transition.active) return;
      const from = world.levels.active;
      camera.save(); // Zustand der Ebene sichern, BEVOR der Uebergang zoomt

      // Portal, das beide Ebenen verbindet: Ankerpunkt fuer das Hineinzoomen
      // und Landeplatz, falls die Zielebene noch nie besucht wurde.
      let fromCell = null;
      let portalCell = null;
      for (const p of world.portals.portals) {
        const a = p.on(from.id), b = p.on(target.id);
        if (a && b) { fromCell = a; portalCell = b; break; }
      }

      // Zielpunkt: 1. ausdrueckliche Vorgabe (Klick auf einen Eingang),
      //            2. die fuer diese Ebene gemerkte Kameraposition,
      //            3. sonst das Portal bzw. die Kartenmitte.
      let toCell, toZoom;
      if (focus) {
        toCell = focus;
        toZoom = TRANSITION.ARRIVE_ZOOM;
      } else if (target.view.init) {
        // Gemerkte Ansicht exakt wiederherstellen: camera.adopt() laedt sie
        // in onSwap(), toCell bleibt bewusst null.
        toCell = null;
        toZoom = target.view.zoom || CAMERA.DEFAULT_ZOOM;
      } else {
        toCell = portalCell || { x: target.w >> 1, y: target.h >> 1 };
        toZoom = TRANSITION.ARRIVE_ZOOM;
      }

      transition.start({
        fromCell,
        toCell,
        toZoom,
        onSwap: () => {
          world.levels.setActive(target.id);
          camera.adopt(target);
          renderer.setActive(target);
          levelNav.update(world);
          legend.signature = '';
        },
      });
      bus.logEvent(CAT.EBENE, 'Ansicht: ' + target.name, {
        tick: world.tick, levelId: target.id,
        x: toCell ? toCell.x : -1, y: toCell ? toCell.y : -1,
      });
    },
    gotoSurface() { game.gotoLevel(world.levels.surface.id); },
    debugAction(what) {
      if (what === 'ants5000') {
        const missing = Math.max(0, 5000 - world.ants.count);
        const n = world.debugSpawn(missing);
        bus.logEvent(CAT.SYS, n + ' Ameisen gespawnt (Debug)', { tick: world.tick });
      } else if (what === 'ants1000') {
        const n = world.debugSpawn(1000);
        bus.logEvent(CAT.SYS, n + ' Ameisen gespawnt (Debug)', { tick: world.tick });
      } else if (what === 'clear') {
        world.ants.clear();
        world.populateColony(world.colonies.get(0), COLONY.START_ANTS);
        bus.logEvent(CAT.SYS, 'Population zurueckgesetzt (Debug)', { tick: world.tick });
      } else if (what === 'dirty') {
        for (const l of world.levels.levels) l.markAllDirty();
        bus.logEvent(CAT.SYS, 'Alle Chunks neu gezeichnet (Debug)', { tick: world.tick });
      }
    },
  };

  // --- UI ------------------------------------------------------------------
  const levelNav = new LevelNav($('levelnav'), $('breadcrumb'), game);
  const legend = new Legend($('legend'), $('legend-visible-only'), sprites);
  const perf = new PerfOverlay($('perf'));
  const logView = new EventLogView($('log'), $('log-filters'), game);
  const inspector = new Inspector($('tip'), $('inspector'), $('inspector-body'), world, sprites);
  const colonyPanel = new ColonyPanel($('colonies'), world, sprites, game);
  const hud = new Hud({
    speed: $('speed'), step: $('btn-step'), grid: $('btn-grid'), trans: $('btn-trans'),
    legendBtn: $('btn-legend'), help: $('btn-help'), helpPanel: $('help'),
    seed: $('seedbox'), debug: $('debugmenu'), inspClose: $('insp-close'),
  }, game);
  levelNav.rebuild(world);
  levelNav.update(world);
  hud.update(state);

  // --- Eingabe -------------------------------------------------------------
  const canvas = $('stage');
  const keys = new Set();
  const pointer = { down: false, button: 0, dragged: false, moved: false, x: 0, y: 0, sx: 0, sy: 0 };
  const cellUnder = { x: 0, y: 0 };

  function updateCellUnderPointer() {
    camera.screenToCell(pointer.x, pointer.y, cellUnder);
  }

  canvas.addEventListener('pointerdown', (e) => {
    pointer.down = true;
    pointer.button = e.button;
    pointer.dragged = false;
    pointer.sx = e.clientX;
    pointer.sy = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.moved = true;
    if (pointer.down) {
      const dx = e.clientX - pointer.sx, dy = e.clientY - pointer.sy;
      if (!pointer.dragged && Math.hypot(dx, dy) > 4) pointer.dragged = true;
      if (pointer.dragged) {
        camera.panScreen(e.movementX, e.movementY);
        camera.followAnt = -1;
      }
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (pointer.down && !pointer.dragged && e.button === 0) handleClick(e.clientX, e.clientY);
    pointer.down = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerleave', () => { inspector.hideTip(); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? CAMERA.ZOOM_STEP : 1 / CAMERA.ZOOM_STEP;
    camera.zoomAt(e.clientX, e.clientY, f);
    if (state.chunkGrid) renderer.setChunkGrid(true);
  }, { passive: false });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function handleClick(sx, sy) {
    const level = world.levels.active;
    camera.screenToCell(sx, sy, cellUnder);
    if (cellUnder.x < 0 || cellUnder.y < 0 || cellUnder.x >= level.w || cellUnder.y >= level.h) return;

    // 1. Nesteingang -> Ebenenwechsel
    const portal = world.portals.at(level.id, cellUnder.x, cellUnder.y);
    if (portal) {
      const other = portal.other(level.id);
      game.gotoLevel(other.levelId, { x: other.x, y: other.y });
      return;
    }
    // 2. Einheit -> Auswahl
    const w = camera.screenToWorld(sx, sy);
    const ant = world.ants.pick(level, w.x / WORLD.CELL_SIZE, w.y / WORLD.CELL_SIZE, 2.5);
    if (ant >= 0) { inspector.select(ant); return; }
    // 3. sonst Zellinfo
    inspector.selectCell(level, cellUnder);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keys.add(e.code);
    switch (e.code) {
      case 'Space': e.preventDefault(); game.togglePause(); break;
      case 'Escape': case 'Backspace': game.gotoSurface(); break;
      case 'Period': game.step(); break;
      case 'KeyL': game.togglePanel('legend'); break;
      case 'KeyH': game.togglePanel('help'); break;
      case 'KeyG': game.toggleChunkGrid(); break;
      case 'F3': e.preventDefault(); perf.toggle(); break;
      case 'F4': e.preventDefault(); game.togglePanel('debug'); break;
      case 'Equal': case 'NumpadAdd': game.setSpeedIndex(state.speedIndex + 1); break;
      case 'Minus': case 'NumpadSubtract': game.setSpeedIndex(state.speedIndex - 1); break;
      default: {
        // 0 = Oberflaeche, 1..8 = n-te Nest-Ebene
        const m = /^(Digit|Numpad)([0-8])$/.exec(e.code);
        if (m) {
          const n = Number(m[2]);
          if (n === 0) game.gotoSurface();
          else {
            const nests = world.levels.levels.filter((l) => l.kind === LEVEL_KIND.NEST);
            if (nests[n - 1]) game.gotoLevel(nests[n - 1].id);
          }
        }
        break;
      }
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
  });
  renderer.resize(window.innerWidth, window.innerHeight);

  // --- Schleife ------------------------------------------------------------
  let accumulator = 0;
  let lastTime = performance.now();
  let uiTimer = 0;

  function simTick() {
    world.step();
  }

  function renderFrame(alpha) {
    renderer.frame(alpha);
    renderer.setSelection(inspector.selected, alpha);
  }

  function loop(nowMs) {
    requestAnimationFrame(loop);
    const rawDt = nowMs - lastTime;
    lastTime = nowMs;
    const dt = Math.min(SIM.MAX_FRAME_MS, rawDt);

    // Kamera und Uebergang laufen in Echtzeit, unabhaengig vom Simulationstempo.
    if (transition.active) transition.update(dt);
    else camera.applyKeys(keys, dt);

    // Feste Ticks nachholen
    const speed = SIM.SPEEDS[state.speedIndex];
    let ticks = 0;
    if (speed > 0) {
      accumulator += dt * speed;
      while (accumulator >= SIM.TICK_MS && ticks < SIM.MAX_TICKS_PER_FRAME) {
        simTick();
        accumulator -= SIM.TICK_MS;
        ticks++;
      }
      if (ticks >= SIM.MAX_TICKS_PER_FRAME) accumulator = 0; // Rueckstand verwerfen
    } else {
      accumulator = 0;
    }

    const alpha = speed > 0 ? Math.min(1, accumulator / SIM.TICK_MS) : 1;
    renderFrame(alpha);

    // Kamera folgt einer Einheit ueber Ebenen hinweg (Phase 4 baut das aus)
    perf.sample(rawDt, world, ticks);
    perf.render(nowMs, world, renderer, speed);

    // UI nur ~8x pro Sekunde aktualisieren
    uiTimer += dt;
    if (uiTimer > 125) {
      uiTimer = 0;
      levelNav.rebuild(world);
      levelNav.update(world);
      colonyPanel.refresh();
      legend.refresh(world, camera.visibleCells(0));
      logView.render();
      inspector.refresh();
      if (!pointer.down && pointer.moved) {
        updateCellUnderPointer();
        const level = world.levels.active;
        const w = camera.screenToWorld(pointer.x, pointer.y);
        const ant = world.ants.pick(level, w.x / WORLD.CELL_SIZE, w.y / WORLD.CELL_SIZE, 2.0);
        inspector.hover(pointer.x, pointer.y, cellUnder, ant);
      }
    }
  }

  window.__booted = true;
  $('boot').classList.add('done');
  setTimeout(() => { const b = $('boot'); if (b) b.remove(); }, 300);
  requestAnimationFrame(loop);

  // Fuer Konsolenexperimente erreichbar machen.
  window.formicarium = { world, renderer, camera, game, sprites, state };
}

boot().catch((err) => {
  console.error(err);
  bootError(err && err.stack ? err.stack : String(err));
});
