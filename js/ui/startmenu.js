/**
 * startmenu.js – Der erste Bildschirm: Modus, Karte, Seed.
 *
 * Warum vor der Welterzeugung und nicht als Panel im Spiel: der Modus
 * entscheidet, welche Werkzeuge es ueberhaupt gibt und ob der Spieler ein
 * eigenes Volk fuehrt. Das nachtraeglich umzuschalten hiesse, mitten im
 * Spiel die Spielregeln zu wechseln – und eine halbe Kolonie zu erben, die
 * bis dahin von der KI gefuehrt wurde.
 *
 * Das Menue gibt eine Zusage zurueck, die mit der Wahl aufgeloest wird.
 * boot() wartet darauf und erzeugt erst danach die Welt.
 */

import { MODE_LIST, DEFAULT_MODE, MAP_PRESETS, STORAGE, VERSION } from '../config.js';
import { readStored } from './settings.js';

const $ = (id) => document.getElementById(id);

/** Zufaelliger, aussprechbarer Seed. */
function randomSeed() {
  const a = ['flink', 'dunkel', 'rot', 'still', 'wild', 'alt', 'kalt', 'hell'];
  const b = ['tal', 'hang', 'feld', 'moor', 'hain', 'grund', 'bruch', 'wiese'];
  const p = (l) => l[(Math.random() * l.length) | 0];
  return p(a) + '-' + p(b) + '-' + (1 + ((Math.random() * 999) | 0));
}

/** Kurzinfo zum abgelegten Stand, ohne ihn ganz zu laden. */
function savedInfo() {
  try {
    const raw = readStored(STORAGE.SAVE, STORAGE.SAVE_LEGACY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      when: new Date(d.savedAt).toLocaleString('de-DE'),
      preset: d.preset,
      seed: d.seed,
      minutes: Math.round((d.tick || 0) / 1800),
      mode: d.mode || DEFAULT_MODE,
    };
  } catch { return null; }
}

/**
 * Startmenue zeigen.
 * @returns {Promise<{mode:string, mapKey:string, seed:string, resume:boolean}>}
 */
export function showStartMenu() {
  const el = $('start');
  if (!el) {
    return Promise.resolve({ mode: DEFAULT_MODE, mapKey: 'wiese', seed: '', resume: false });
  }

  // Zuletzt gewaehlter Modus, sonst der Vorgabewert.
  let mode = DEFAULT_MODE;
  try {
    const stored = localStorage.getItem(STORAGE.MODE);
    if (stored && MODE_LIST.some((m) => m.key === stored)) mode = stored;
  } catch { /* gesperrter Speicher: Vorgabe */ }

  // --- Moduskarten ---------------------------------------------------------
  const modes = $('start-modes');
  modes.replaceChildren();
  const karten = new Map();
  for (const m of MODE_LIST) {
    const card = document.createElement('button');
    card.className = 'mode-card';
    card.type = 'button';
    card.innerHTML = '<span class="mode-name">' + m.name + '</span>'
      + '<span class="mode-tag">' + m.tagline + '</span>'
      + '<span class="mode-desc">' + m.desc + '</span>';
    card.addEventListener('click', () => {
      mode = m.key;
      for (const [k, c] of karten) c.classList.toggle('on', k === mode);
    });
    modes.appendChild(card);
    karten.set(m.key, card);
  }
  for (const [k, c] of karten) c.classList.toggle('on', k === mode);

  // --- Karte und Seed ------------------------------------------------------
  const map = $('start-map');
  map.replaceChildren();
  for (const p of MAP_PRESETS) {
    const o = document.createElement('option');
    o.value = p.key;
    o.textContent = p.name;
    map.appendChild(o);
  }
  const params = new URLSearchParams(location.search);
  map.value = params.get('map') || MAP_PRESETS[0].key;

  const seed = $('start-seed');
  const presetSeed = () => {
    const p = MAP_PRESETS.find((x) => x.key === map.value);
    return (p && p.seed) || randomSeed();
  };
  seed.value = params.get('seed') || presetSeed();
  map.addEventListener('change', () => { seed.value = presetSeed(); });
  $('start-dice').addEventListener('click', () => { seed.value = randomSeed(); });

  // --- Vorhandener Stand ---------------------------------------------------
  const info = savedInfo();
  const weiter = $('start-continue');
  const note = $('start-note');
  if (info) {
    weiter.hidden = false;
    weiter.title = info.preset + ' / ' + info.seed + ', etwa ' + info.minutes + ' Minuten gespielt';
    note.textContent = 'Gespeicherter Stand vom ' + info.when
      + ' (' + info.preset + ', ' + info.minutes + ' Min.) · Antarium ' + VERSION;
  } else {
    note.textContent = 'Antarium ' + VERSION;
  }

  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('shown'));

  return new Promise((resolve) => {
    const fertig = (resume) => {
      try { localStorage.setItem(STORAGE.MODE, mode); } catch { /* egal */ }
      el.classList.remove('shown');
      setTimeout(() => { el.hidden = true; }, 220);
      resolve({ mode, mapKey: map.value, seed: seed.value.trim(), resume });
    };
    $('start-go').addEventListener('click', () => fertig(false));
    weiter.addEventListener('click', () => fertig(true));
    seed.addEventListener('keydown', (e) => { if (e.key === 'Enter') fertig(false); });
  });
}
