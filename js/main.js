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

import {
  SIM, WORLD, CAMERA, TRANSITION, COLONY, MAP_PRESETS, mapPreset, CINEMA, STORAGE,
  MODES, DEFAULT_MODE,
} from './config.js';
import { World } from './sim/world.js';
import { LEVEL_KIND } from './sim/levels.js';
import { ANT_STATE } from './sim/ants.js';
import { bus, CAT } from './sim/events.js';
import { SpriteBank } from './render/sprites.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Transition } from './render/transition.js';
import { showStartMenu } from './ui/startmenu.js';
import { ResourceBar } from './ui/resources.js';
import { LevelNav } from './ui/levelNav.js';
import { Legend } from './ui/legend.js';
import { PerfOverlay } from './ui/perf.js';
import { EventLogView } from './ui/log.js';
import { Hud } from './ui/hud.js';
import { Inspector } from './ui/inspector.js';
import { ColonyPanel } from './ui/panels.js';
import { Toolbar } from './ui/toolbar.js';
import { ResearchPanel } from './ui/research.js';
import { StatsPanel } from './ui/stats.js';
import { AlertView } from './ui/alerts.js';
import { SettingsPanel, readStored } from './ui/settings.js';
import { Audio } from './ui/audio.js';
import { clockString, PHASE_NAME } from './sim/daynight.js';
import { Minimap } from './render/minimap.js';
import { PipView } from './render/pip.js';

const $ = (id) => document.getElementById(id);

/** Kurzer, gut lesbarer Zufalls-Seed fuer neue Welten. */
function randomSeed() {
  const a = ['moos', 'harz', 'kiesel', 'wurzel', 'tau', 'lehm', 'ginster', 'farn', 'dorn', 'klee'];
  const i = Math.floor(Math.random() * a.length);
  return a[i] + '-' + Math.floor(Math.random() * 9000 + 1000);
}

// ---------------------------------------------------------------------------
// Fehler sichtbar machen – eine leere schwarze Seite hilft niemandem.
// ---------------------------------------------------------------------------
/** Kurze Notiz beim Start (keine Fehlerseite, nur ein Hinweis im Log). */
function bootNote(msg) {
  bus.logEvent(CAT.SYS, msg, { tick: 0 });
}

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

  /**
   * ZUERST DAS STARTMENUE. Der Modus entscheidet, welche Werkzeuge es
   * ueberhaupt gibt und ob der Spieler ein eigenes Volk fuehrt – das laesst
   * sich nicht sinnvoll nachtraeglich umschalten. Ein "pending"-Stand
   * (Laden aus den Einstellungen heraus) ueberspringt das Menue, sonst
   * muesste man nach jedem Laden zweimal bestaetigen.
   */
  let pendingSave = false;
  try { pendingSave = !!localStorage.getItem(STORAGE.SAVE + '.pending'); } catch { /* egal */ }

  let wahl = null;
  if (!pendingSave && !params.has('skipmenu')) {
    wahl = await showStartMenu();
  }

  const mapKey = (wahl && wahl.mapKey) || params.get('map') || 'wiese';
  const preset = mapPreset(mapKey);
  const seed = (wahl && wahl.seed) || params.get('seed') || preset.seed || randomSeed();
  const modeKey = (wahl && wahl.mode) || params.get('mode') || DEFAULT_MODE;
  const mode = MODES[modeKey] || MODES[DEFAULT_MODE];
  if (wahl && wahl.resume) pendingSave = true;

  // --- Welt ----------------------------------------------------------------
  /**
   * Beim Laden eines Standes setzt applySaveData eine Marke und laedt die
   * Seite neu. Hier wird sie eingeloest: die Welt kommt dann aus der Datei
   * statt aus dem Generator.
   */
  let world = null;
  let loadedFromSave = false;
  try {
    if (pendingSave) {
      localStorage.removeItem(STORAGE.SAVE + '.pending');
      const raw = readStored(STORAGE.SAVE, STORAGE.SAVE_LEGACY);
      if (raw) {
        const res = World.fromSave(JSON.parse(raw));
        if (res.ok) { world = res.world; loadedFromSave = true; }
        else bootNote('Spielstand nicht lesbar: ' + res.reason);
      }
    }
  } catch { world = null; }
  if (!world) world = new World(seed, preset.key).generate();
  /**
   * Der Modus haengt an der WELT, nicht an der Oberflaeche: er wandert
   * damit in den Speicherstand und ein geladenes Spiel kommt mit denselben
   * Regeln zurueck, unter denen es gespielt wurde.
   */
  if (!world.mode) world.mode = modeKey;
  /**
   * Im Feldzug fuehrt der Spieler das erste Volk. Es ist das, dessen Nest
   * die Kamera beim Start anfliegt – alles andere waere verwirrend.
   */
  world.playerColonyId = mode.own ? 0 : -1;

  // --- Grafik --------------------------------------------------------------
  const sprites = await new SpriteBank().load();
  const camera = new Camera();
  const renderer = new Renderer(world, sprites, camera);
  await renderer.init($('stage'));
  for (const level of world.levels.levels) renderer.addLevel(level);
  /**
   * WO DER BLICK ANFAENGT, HAENGT AM MODUS.
   *
   * Im Sandkasten schaut man von oben auf die Welt – man beobachtet ein
   * Terrarium. Im Feldzug fuehrt man ein Volk, also faengt der Blick im
   * eigenen Nest an. Das ist nicht nur Geschmack: der Grabduft, das
   * wichtigste Mittel des Modus, gilt nur in Nest-Ebenen. Wer an der
   * Oberflaeche startet, sieht fuenf Werkzeuge und keine Moeglichkeit zu
   * graben – die Browserpruefung hat genau das gemeldet.
   */
  const startNest = mode.own && world.colonies.get(world.playerColonyId)
    ? world.levels.get(world.colonies.get(world.playerColonyId).nestLevelIds[0])
    : null;
  const startLevel = startNest || world.levels.surface;
  camera.attach(startLevel);
  const firstPortal = world.portals.portals[0];
  if (startNest && world.colonies.get(world.playerColonyId).layout) {
    const q = world.colonies.get(world.playerColonyId).layout.queen;
    camera.focusCell(q.x, q.y, CAMERA.DEFAULT_ZOOM);
  } else if (firstPortal) {
    // Start an einem Nesteingang, damit sofort etwas zu sehen ist.
    camera.focusCell(firstPortal.ax, firstPortal.ay, CAMERA.DEFAULT_ZOOM);
  }
  world.levels.setActive(startLevel.id);
  renderer.setActive(startLevel);
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
    research: false,
    stats: false,
    phero: [false, false, false],
    cinema: false,
    autoJump: false,
    follow: -1,
    settings: false,
    front: false,
    shakeOn: true,
    interpolate: true,
    autosave: false,
  };
  let cinemaTimer = 0;
  let cinemaSeen = -1;
  /** Restliche Ticks eines Schnelldurchlaufs (Forschungsmenue). */
  let fastForwardLeft = 0;

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
      if (which === 'research') {
        state.research = !state.research;
        $('panel-research').hidden = !state.research;
        if (state.research) research.refresh(true);
      }
      if (which === 'settings') {
        state.settings = !state.settings;
        $('panel-settings').hidden = !state.settings;
        if (state.settings) { settings.build(); settings.refreshStatus(); }
      }
      if (which === 'stats') {
        state.stats = !state.stats;
        $('panel-stats').hidden = !state.stats;
        if (state.stats) { stats.timer = 0; stats.refresh(0); }
      }
      hud.update(state);
    },
    /** Bild-in-Bild oeffnen bzw. schliessen. */
    togglePip() {
      if (pip.count > 0) { pip.closeAll(); }
      else {
        // Standardmaessig die jeweils andere Ebene zeigen
        const active = world.levels.activeId;
        const other = world.levels.levels.find((l) => l.id !== active);
        if (other) pip.open(other.id, null);
      }
      state.pip = pip.count > 0;
      hud.update(state);
    },
    /** Kinomodus: springt selbstaendig zu Ereignissen. */
    toggleCinema() {
      state.cinema = !state.cinema;
      cinemaTimer = 0;
      hud.update(state);
    },
    toggleAutoJump() {
      state.autoJump = !state.autoJump;
      alerts.autoJump = state.autoJump;
      hud.update(state);
    },
    /** Einheit verfolgen (-1 = aus). */
    follow(antIndex) {
      state.follow = antIndex;
      camera.followAnt = antIndex;
    },
    /** Pheromon-Overlay: Typ ein-/ausschalten. */
    togglePhero(type) {
      state.phero[type] = !state.phero[type];
      renderer.setPheroView({
        enabled: state.phero.some(Boolean),
        types: state.phero,
        colonyId: -1,
      });
      hud.update(state);
    },
    /** Schnelldurchlauf: Ticks ohne Bild rechnen, verteilt ueber Frames. */
    fastForward(ticks) {
      fastForwardLeft = ticks;
      bus.logEvent(CAT.SYS, 'Schnelldurchlauf: ' + Math.round(ticks / SIM.TICK_RATE) + ' s Spielzeit',
        { tick: world.tick });
    },
    clearSelection() { inspector.clear(); },
    /** Legende: alle sichtbaren Zellen eines Typs hervorheben (-1 = aus). */
    highlightCell(cellId, meta) {
      renderer.setHighlight(cellId, meta);
    },
    /**
     * Frontverfolgung: die Kamera bleibt auf dem Schwerpunkt der Kaempfe der
     * aktiven Ebene. Ohne das verliert man bei einem Ueberfall sofort den
     * Ueberblick, weil sich die Front laufend verschiebt.
     */
    toggleFront() {
      state.front = !state.front;
      if (state.front) { state.follow = -1; camera.followAnt = -1; }
      hud.update(state);
    },

    // --- Einstellungen und Spielstaende -----------------------------------
    /** Eine Einstellung auf das jeweilige System anwenden. */
    applySetting(key, value) {
      switch (key) {
        case 'daynight':
          world.dayNightOn = !!value;
          break;
        case 'particles':
          renderer.particles.enabled = !!value;
          if (!value) renderer.particles.clear();
          break;
        case 'shake':
          state.shakeOn = !!value;
          renderer.shakeEnabled = !!value;
          break;
        case 'transition':
          state.transition = !!value;
          transition.setEnabled(!!value);
          break;
        case 'interpolate':
          state.interpolate = !!value;
          break;
        case 'sound':
          audio.setEnabled(!!value);
          break;
        case 'volume':
          audio.setVolume(Number(value));
          break;
        case 'autosave':
          state.autosave = !!value;
          break;
        default:
          break;
      }
      hud.update(state);
    },
    /** Stand im Browser ablegen. */
    saveLocal() {
      try {
        localStorage.setItem(STORAGE.SAVE, JSON.stringify(world.toSave()));
        bus.logEvent(CAT.SYS, 'Spielstand im Browser abgelegt', { tick: world.tick });
      } catch (e) {
        bus.logEvent(CAT.SYS, 'Speichern fehlgeschlagen: ' + e.message, { tick: world.tick });
      }
      settings.refreshStatus();
    },
    /** Zuletzt abgelegten Stand laden. */
    loadLocal() {
      let raw = null;
      raw = readStored(STORAGE.SAVE, STORAGE.SAVE_LEGACY);
      if (!raw) {
        bus.logEvent(CAT.SYS, 'Kein Spielstand im Browser vorhanden', { tick: world.tick });
        return;
      }
      game.applySaveData(JSON.parse(raw));
    },
    clearLocal() {
      try { localStorage.removeItem(STORAGE.SAVE); } catch { /* egal */ }
      bus.logEvent(CAT.SYS, 'Abgelegter Spielstand geloescht', { tick: world.tick });
      settings.refreshStatus();
    },
    /** Stand als Datei herunterladen. */
    saveFile() {
      const text = JSON.stringify(world.toSave());
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'antarium-' + world.seed + '-' + world.tick + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      bus.logEvent(CAT.SYS, 'Spielstand als Datei gespeichert', { tick: world.tick });
    },
    /** Stand aus einer Datei laden. */
    loadFile() {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.addEventListener('change', () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const r = new FileReader();
        r.onload = () => {
          try { game.applySaveData(JSON.parse(String(r.result))); }
          catch (e) { bus.logEvent(CAT.SYS, 'Datei unlesbar: ' + e.message, { tick: world.tick }); }
        };
        r.readAsText(file);
      });
      inp.click();
    },
    /**
     * Speicherstand uebernehmen.
     *
     * Die Welt wird dabei ERSETZT, nicht ueberschrieben: Seed und
     * Kartenvorlage koennen andere sein, und alle Systeme haengen an der
     * Weltinstanz. Deshalb wird die Seite mit dem Stand im Browserspeicher
     * neu geladen – das ist ehrlicher, als hundert Verweise nachzuziehen
     * und dabei einen zu vergessen.
     */
    applySaveData(data) {
      const probe = World.fromSave(data);
      if (!probe.ok) {
        bus.logEvent(CAT.SYS, 'Laden fehlgeschlagen: ' + probe.reason, { tick: world.tick });
        return;
      }
      try {
        localStorage.setItem(STORAGE.SAVE, JSON.stringify(data));
        localStorage.setItem(STORAGE.SAVE + '.pending', '1');
      } catch (e) {
        bus.logEvent(CAT.SYS, 'Laden fehlgeschlagen: ' + e.message, { tick: world.tick });
        return;
      }
      location.reload();
    },
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
    /**
     * Neue Welt mit den Einstellungen aus der Kopfzeile (Neuladen).
     *
     * Der MODUS wandert mit. Wer mitten im Feldzug eine neue Karte will,
     * will einen neuen Feldzug – nicht noch einmal durch das Startmenue.
     */
    newWorld(mapKeyIn, seedIn) {
      const p = new URLSearchParams();
      p.set('map', mapKeyIn);
      if (seedIn) p.set('seed', seedIn);
      p.set('mode', world.mode || DEFAULT_MODE);
      p.set('skipmenu', '1');
      location.search = p.toString();
    },
    /** Wird aufgerufen, wenn per Werkzeug eine Kolonie gegruendet wurde. */
    onColonyFounded(colony) {
      for (const level of world.levels.levels) renderer.addLevel(level);
      levelNav.rebuild(world);
      levelNav.update(world);
      legend.signature = '';
      colonyPanel.signature = '';
      pip.refreshLevels();
      void colony;
    },
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
      } else if (what === 'colonies8') {
        let n = 0;
        while (world.colonies.colonies.length < 8 && world.foundColony(null, 120)) n++;
        if (n) game.onColonyFounded();
        bus.logEvent(CAT.SYS, n + ' Kolonien gegruendet (Debug)', { tick: world.tick });
      }
    },
  };

  // --- UI ------------------------------------------------------------------
  const levelNav = new LevelNav($('levelnav'), $('breadcrumb'), game);
  const legend = new Legend($('legend'), $('legend-visible-only'), sprites, game);
  const perf = new PerfOverlay($('perf'));
  const logView = new EventLogView($('log'), $('log-filters'), game);
  const inspector = new Inspector($('tip'), $('inspector'), $('inspector-body'), world, sprites);
  const colonyPanel = new ColonyPanel($('colonies'), world, sprites, game);
  const toolbar = new Toolbar($('tools'), world, sprites, game);
  const research = new ResearchPanel($('research'), world, game, sprites);
  const stats = new StatsPanel($('stats'), world, game, sprites);
  const alerts = new AlertView($('toasts'), world, game);
  const minimap = new Minimap($('minimap'), world, camera, game);
  const resources = new ResourceBar($('resources'), world);

  /**
   * PANELS EINKLAPPEN. Im Bildschirmabzug nahmen Werkzeugspalte, rechte
   * Spalte und Ereignisfenster zusammen fast die halbe Flaeche; die Karte
   * war ein Streifen in der Mitte. Ein Klick auf die Ueberschrift klappt
   * ein Panel zu einer Titelzeile zusammen. Der Zustand haelt ueber die
   * Sitzung hinaus.
   */
  const PANEL_ZU = 'antarium.panels';
  let zugeklappt = new Set();
  try {
    const raw = localStorage.getItem(PANEL_ZU);
    if (raw) zugeklappt = new Set(JSON.parse(raw));
  } catch { /* gesperrter Speicher: alles offen */ }
  for (const panel of document.querySelectorAll('#panel-tools, #panel-colonies, #panel-legend, #panel-log')) {
    const h = panel.querySelector('h2');
    if (!h) continue;
    h.classList.add('foldable');
    h.title = 'Auf- und zuklappen';
    if (zugeklappt.has(panel.id)) panel.classList.add('folded');
    h.addEventListener('click', (e) => {
      // Schalter IM Titel (Filter, Schliessen) duerfen nicht mitklappen.
      if (e.target.closest('button, input, label, select')) return;
      panel.classList.toggle('folded');
      if (panel.classList.contains('folded')) zugeklappt.add(panel.id);
      else zugeklappt.delete(panel.id);
      try { localStorage.setItem(PANEL_ZU, JSON.stringify([...zugeklappt])); } catch { /* egal */ }
    });
  }

  /**
   * Klappmenues der Kopfzeile. Eines offen, alle anderen zu; ein Klick
   * irgendwo sonst schliesst. Die Schalter darin sind dieselben Elemente
   * mit denselben IDs wie vorher – die Tastenkuerzel merken vom Umbau
   * nichts.
   */
  for (const menu of document.querySelectorAll('.menu')) {
    const btn = menu.querySelector('.menu-btn');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const auf = !menu.classList.contains('open');
      for (const m of document.querySelectorAll('.menu.open')) {
        m.classList.remove('open');
        m.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
      }
      menu.classList.toggle('open', auf);
      btn.setAttribute('aria-expanded', auf ? 'true' : 'false');
    });
    // Klicks im Menue duerfen es nicht schliessen, sonst kann man in der
    // Ansicht nicht zwei Schalter hintereinander umlegen.
    menu.querySelector('.menu-pop').addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', () => {
    for (const m of document.querySelectorAll('.menu.open')) {
      m.classList.remove('open');
      m.querySelector('.menu-btn').setAttribute('aria-expanded', 'false');
    }
  });
  const pip = new PipView(renderer, world, $('pips'), game);
  const audio = new Audio();
  const settings = new SettingsPanel($('settings'), game);
  const hud = new Hud({
    speed: $('speed'), step: $('btn-step'), grid: $('btn-grid'), trans: $('btn-trans'),
    legendBtn: $('btn-legend'), help: $('btn-help'), helpPanel: $('help'),
    seed: $('seedbox'), debug: $('debugmenu'), inspClose: $('insp-close'),
    research: $('btn-research'), stats: $('btn-stats'),
    pip: $('btn-pip'), cinema: $('btn-cinema'), autojump: $('btn-autojump'),
    front: $('btn-front'),
    researchClose: $('research-close'), statsClose: $('stats-close'),
    pheroGroup: $('phero-group'),
    settingsBtn: $('btn-settings'), settingsClose: $('settings-close'),
  }, game);
  levelNav.rebuild(world);
  levelNav.update(world);
  toolbar.refresh();
  settings.applyAll();
  hud.update(state);
  if (loadedFromSave) {
    bus.logEvent(CAT.SYS, 'Spielstand geladen (Tick ' + world.tick + ')', { tick: world.tick });
  }

  // --- Kartenvorlage und Seed in der Kopfzeile -----------------------------
  const mapSel = $('mapselect');
  for (const p of MAP_PRESETS) {
    const o = document.createElement('option');
    o.value = p.key;
    o.textContent = p.name;
    o.title = p.desc;
    if (p.key === preset.key) o.selected = true;
    mapSel.appendChild(o);
  }
  mapSel.title = preset.desc;
  const seedInput = $('seedinput');
  seedInput.value = world.seed;
  mapSel.addEventListener('change', () => {
    const p = mapPreset(mapSel.value);
    mapSel.title = p.desc;
    seedInput.value = p.seed || randomSeed();
  });
  $('btn-dice').addEventListener('click', () => { seedInput.value = randomSeed(); });
  $('btn-newworld').addEventListener('click', () => game.newWorld(mapSel.value, seedInput.value.trim()));
  seedInput.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') game.newWorld(mapSel.value, seedInput.value.trim());
  });

  // --- Eingabe -------------------------------------------------------------
  const canvas = $('stage');
  const keys = new Set();
  const pointer = { down: false, button: 0, dragged: false, moved: false, painting: false, x: 0, y: 0, sx: 0, sy: 0 };
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
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.moved = true;
    canvas.setPointerCapture(e.pointerId);
    // Mit aktivem Werkzeug malt die linke Maustaste, geschoben wird mit der
    // mittleren Taste. Mit dem Zeiger schiebt auch die linke Taste.
    pointer.painting = e.button === 0 && toolbar.isPaintTool;
    if (pointer.painting) {
      camera.screenToCell(e.clientX, e.clientY, cellUnder);
      toolbar.apply(cellUnder, false);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.moved = true;
    if (pointer.down) {
      const dx = e.clientX - pointer.sx, dy = e.clientY - pointer.sy;
      if (!pointer.dragged && Math.hypot(dx, dy) > 4) pointer.dragged = true;
      if (pointer.painting) {
        camera.screenToCell(e.clientX, e.clientY, cellUnder);
        toolbar.apply(cellUnder, true);
      } else if (pointer.dragged) {
        camera.panScreen(e.movementX, e.movementY);
        camera.followAnt = -1;
      }
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (pointer.down && !pointer.dragged && !pointer.painting && e.button === 0) {
      handleClick(e.clientX, e.clientY);
    }
    pointer.down = false;
    pointer.painting = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointerleave', () => { inspector.hideTip(); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey) { toolbar.setBrush(toolbar.brush + (e.deltaY < 0 ? 2 : -2)); return; }
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
    if (ant >= 0) { inspector.select(ant); game.follow(ant); return; }
    const cr = world.creatures.pick(level.id, w.x / WORLD.CELL_SIZE, w.y / WORLD.CELL_SIZE, 3);
    if (cr >= 0) { inspector.selectCreature(cr); return; }
    // 3. sonst Zellinfo
    inspector.selectCell(level, cellUnder);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    keys.add(e.code);
    // Schnell speichern und laden
    if (e.ctrlKey || e.metaKey) {
      if (e.code === 'KeyS') { e.preventDefault(); game.saveLocal(); return; }
      if (e.code === 'KeyL') { e.preventDefault(); game.loadLocal(); return; }
      return;
    }
    audio.unlock();
    switch (e.code) {
      case 'Space': e.preventDefault(); game.togglePause(); break;
      case 'Escape': case 'Backspace':
        // Erst das Werkzeug zuruecknehmen, dann zur Oberflaeche.
        if (toolbar.isPaintTool) { toolbar.setTool('select'); break; }
        game.gotoSurface();
        break;
      case 'KeyV': toolbar.setTool('select'); break;
      case 'KeyR': game.togglePanel('research'); break;
      case 'KeyT': game.togglePanel('stats'); break;
      case 'KeyO': game.togglePanel('settings'); break;
      case 'KeyK': game.toggleFront(); break;
      case 'KeyP': game.togglePhero(1); break;
      case 'KeyB': game.togglePip(); break;
      case 'KeyC': game.toggleCinema(); break;
      case 'KeyF': game.follow(inspector.selected); break;
      case 'BracketLeft': toolbar.setBrush(toolbar.brush - 2); break;
      case 'BracketRight': toolbar.setBrush(toolbar.brush + 2); break;
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

  /** Kopfzeile darf umbrechen; die Panels ruecken entsprechend nach. */
  function syncBarHeight() {
    const h = $('topbar').offsetHeight;
    document.documentElement.style.setProperty('--barh', h + 'px');
  }
  window.addEventListener('resize', () => {
    renderer.resize(window.innerWidth, window.innerHeight);
    syncBarHeight();
  });
  renderer.resize(window.innerWidth, window.innerHeight);
  syncBarHeight();

  // --- Schleife ------------------------------------------------------------
  let accumulator = 0;
  let lastTime = performance.now();
  let uiTimer = 0;
  let lastAutoSave = world.tick;

  function simTick() {
    world.step();
    drainFx();
  }

  /**
   * Schwerpunkt aller kaempfenden Ameisen auf der aktiven Ebene.
   * Kaempft niemand, bleibt die Kamera stehen (null).
   */
  function combatCentroid() {
    const level = world.levels.active;
    const a = world.ants;
    const b = a.buckets.get(level.id);
    if (!b) return null;
    let sx = 0, sy = 0, n = 0;
    for (let k = 0; k < b.count; k++) {
      const i = b.ids[k];
      const st = a.state[i];
      if (st !== ANT_STATE.ATTACK && st !== ANT_STATE.DEFEND && st !== ANT_STATE.RAID) continue;
      sx += a.x[i]; sy += a.y[i]; n++;
    }
    if (n < CINEMA.FRONT_MIN_ANTS) return null;
    return { x: sx / n, y: sy / n };
  }

  /**
   * Anzeige-Effekte des letzten Ticks in den Teilchenpuffer schieben.
   * Der Puffer der Welt wird bei jedem Tick geleert – wird er nicht
   * abgeholt (Schnelldurchlauf), gehen nur Teilchen verloren, nichts sonst.
   */
  function drainFx() {
    const f = world.fx;
    if (!f.count || !renderer.particles.enabled) return;
    for (let i = 0; i < f.count; i++) {
      renderer.particles.burst(f.level[i], f.x[i], f.y[i], f.kind[i], f.n[i]);
    }
  }

  /**
   * Eine Nest-Ebene kann MITTEN IM SPIEL entstehen (World.expandNest gibt
   * einem grossen Volk ein Stockwerk tiefer). Ohne diese Pruefung haette
   * sie keine Chunk-Texturen und keinen Eintrag in der Ebenenleiste – die
   * Ameisen waeren dort, aber unsichtbar.
   */
  let knownLevels = world.levels.levels.length;
  function syncLevels() {
    if (world.levels.levels.length === knownLevels) return;
    knownLevels = world.levels.levels.length;
    for (const level of world.levels.levels) renderer.addLevel(level);
    levelNav.rebuild(world);
    levelNav.update(world);
    pip.refreshLevels();
  }

  function renderFrame(alpha) {
    syncLevels();
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

    // Schnelldurchlauf des Forschungsmenues: moeglichst viele Ticks pro
    // Frame, aber mit Zeitbudget, damit die Seite bedienbar bleibt.
    if (fastForwardLeft > 0) {
      const budgetEnd = performance.now() + 24;
      let done = 0;
      while (fastForwardLeft > 0 && performance.now() < budgetEnd) {
        world.step();
        fastForwardLeft--;
        done++;
      }
      const ffEl = $('ff-overlay');
      if (fastForwardLeft > 0) {
        ffEl.hidden = false;
        ffEl.textContent = 'Schnelldurchlauf … noch '
          + Math.round(fastForwardLeft / SIM.TICK_RATE) + ' s Spielzeit';
      } else {
        ffEl.hidden = true;
      }
      void done;
    }

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

    // --- Einheit verfolgen (auch ueber Ebenen hinweg) ---------------------
    if (camera.followAnt >= 0) {
      const a = world.ants;
      const idx = camera.followAnt;
      if (!a.alive[idx]) {
        camera.followAnt = -1;
        state.follow = -1;
      } else if (!transition.active) {
        if (a.level[idx] !== world.levels.activeId) {
          if (state.followLevels !== false) game.gotoLevel(a.level[idx]);
        } else {
          const al = speed > 0 ? Math.min(1, accumulator / SIM.TICK_MS) : 1;
          camera.x = (a.px[idx] + (a.x[idx] - a.px[idx]) * al) * WORLD.CELL_SIZE;
          camera.y = (a.py[idx] + (a.y[idx] - a.py[idx]) * al) * WORLD.CELL_SIZE;
          camera.clamp();
        }
      }
    }

    // --- Frontverfolgung: Schwerpunkt der Kaempfe ---------------------------
    if (state.front && !transition.active) {
      const c = combatCentroid();
      if (c) camera.glideTo(c.x * WORLD.CELL_SIZE, c.y * WORLD.CELL_SIZE, dt);
    }

    // --- Kinomodus: zum naechsten sehenswerten Ereignis --------------------
    if (state.cinema && !transition.active) {
      cinemaTimer -= dt;
      if (cinemaTimer <= 0) {
        cinemaTimer = CINEMA.INTERVAL_MS;
        const ev = bus.recent(30, (e) => CINEMA.CATEGORIES.includes(e.cat)
          && e.levelId >= 0 && e.x >= 0 && e.seq > cinemaSeen
          && world.tick - e.tick < CINEMA.MAX_AGE)[0];
        if (ev) {
          cinemaSeen = ev.seq;
          game.gotoLevel(ev.levelId, { x: ev.x, y: ev.y });
          camera.followAnt = -1;
        }
      }
    }

    // Pinselvorschau folgt dem Zeiger
    if (toolbar.isPaintTool && pointer.moved && !transition.active) {
      camera.screenToCell(pointer.x, pointer.y, cellUnder);
      renderer.setBrushPreview(cellUnder.x, cellUnder.y, toolbar.previewRadius,
        toolbar.previewColor());
    } else {
      renderer.setBrushPreview(0, 0, -1, 0);
    }

    const alpha = (speed > 0 && state.interpolate) ? Math.min(1, accumulator / SIM.TICK_MS) : 1;
    renderer.setFrameDelta(dt / 16.67);
    renderFrame(alpha);

    // Kamera folgt einer Einheit ueber Ebenen hinweg (Phase 4 baut das aus)
    pip.update();
    minimap.render(dt);
    perf.sample(rawDt, world, ticks);
    perf.render(nowMs, world, renderer, speed);

    // UI nur ~8x pro Sekunde aktualisieren
    uiTimer += dt;
    if (uiTimer > 125) {
      uiTimer = 0;
      levelNav.rebuild(world);
      levelNav.update(world);
      toolbar.refresh();
      toolbar.syncGodMode();
      $('tool-level').textContent = world.levels.active.kind === 0 ? 'Oberflaeche' : 'Nest';
      colonyPanel.refresh();
      resources.refresh();
      legend.refresh(world, camera.visibleCells(0));
      logView.render();
      inspector.refresh();
      research.refresh();
      stats.refresh(125);
      alerts.refresh();
      $('minimap-label').textContent = world.levels.active.name;
      // Uhr in der Kopfzeile
      const clk = $('clock');
      if (clk) {
        clk.textContent = world.dayNightOn
          ? clockString(world.timeOfDay) + ' ' + PHASE_NAME[world.dayPhase]
          : 'Tag (fest)';
      }
      // Automatisch speichern (alle zwei Minuten Spielzeit)
      if (state.autosave && world.tick - lastAutoSave >= SIM.TICK_RATE * 120) {
        lastAutoSave = world.tick;
        game.saveLocal();
      }
      if (!pointer.down && pointer.moved) {
        updateCellUnderPointer();
        const level = world.levels.active;
        const w = camera.screenToWorld(pointer.x, pointer.y);
        const ant = world.ants.pick(level, w.x / WORLD.CELL_SIZE, w.y / WORLD.CELL_SIZE, 2.0);
        const creature = world.creatures.pick(level.id, w.x / WORLD.CELL_SIZE, w.y / WORLD.CELL_SIZE, 3.0);
        inspector.hover(pointer.x, pointer.y, cellUnder, ant, creature);
      }
    }
  }

  window.__booted = true;
  $('boot').classList.add('done');
  setTimeout(() => { const b = $('boot'); if (b) b.remove(); }, 300);
  requestAnimationFrame(loop);

  // Fuer Konsolenexperimente erreichbar machen.
  window.antarium = window.formicarium = { world, renderer, camera, game, sprites, state, pip };
}

boot().catch((err) => {
  console.error(err);
  bootError(err && err.stack ? err.stack : String(err));
});
