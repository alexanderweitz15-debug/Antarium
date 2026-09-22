/**
 * settings.js – Einstellungen und Speicherstaende (Phase 10).
 *
 * Die Einstellungen liegen im localStorage und werden beim Start
 * angewendet. Sie betreffen ausschliesslich Darstellung und Komfort –
 * KEINE Simulationswerte. Wer am Gleichgewicht drehen will, aendert
 * config.js; eine Einstellung, die das Ergebnis verschiebt, waere eine
 * versteckte Schwierigkeitsstufe.
 *
 * Ausnahme mit Ansage: "Tag und Nacht" schaltet einen Simulationsteil ab.
 * Das steht so im Menue, weil manche Versuche ohne Tagesrhythmus besser
 * vergleichbar sind.
 */

import { SETTINGS_DEFAULTS, STORAGE, VERSION } from '../config.js';

export class SettingsPanel {
  /**
   * @param {HTMLElement} el
   * @param {object} game Fassade aus main.js
   */
  constructor(el, game) {
    this.el = el;
    this.game = game;
    this.values = { ...SETTINGS_DEFAULTS, ...load() };
    this.built = false;
  }

  /** Beim Start: alle Werte auf die Systeme anwenden. */
  applyAll() {
    for (const k of Object.keys(this.values)) this.game.applySetting(k, this.values[k]);
  }

  set(key, value) {
    this.values[key] = value;
    save(this.values);
    this.game.applySetting(key, value);
  }

  reset() {
    this.values = { ...SETTINGS_DEFAULTS };
    save(this.values);
    this.applyAll();
    this.built = false;
    this.build();
  }

  build() {
    if (this.built) return;
    this.built = true;
    this.el.textContent = '';

    const group = (title) => {
      const b = document.createElement('div');
      b.className = 'tool-group';
      b.innerHTML = '<h3>' + title + '</h3>';
      this.el.appendChild(b);
      return b;
    };

    const check = (box, key, label, hint) => {
      const row = document.createElement('label');
      row.className = 'check-row';
      row.title = hint || '';
      const i = document.createElement('input');
      i.type = 'checkbox';
      i.checked = !!this.values[key];
      i.addEventListener('change', () => this.set(key, i.checked));
      const t = document.createElement('span');
      t.textContent = label;
      row.appendChild(i); row.appendChild(t);
      box.appendChild(row);
    };

    const darst = group('Darstellung');
    check(darst, 'daynight', 'Tag und Nacht',
      'Schaltet den Tagesrhythmus ab. Achtung: wirkt auch auf die Simulation'
      + ' (Aktivitaet der Tiere, Pflanzenwachstum).');
    check(darst, 'particles', 'Teilchen', 'Staub, Funken, Spritzer');
    check(darst, 'shake', 'Bildschirmwackeln', 'Bei Erdbeben, Meteor und Sprengung');
    check(darst, 'transition', 'Ebenenblende', 'Weicher Uebergang beim Ebenenwechsel');
    check(darst, 'interpolate', 'Zwischenbilder',
      'Bewegung zwischen zwei Ticks glaetten. Aus wirkt ruckartiger, spart aber Rechenzeit.');

    const ton = group('Ton');
    check(ton, 'sound', 'Ton einschalten',
      'Das Spiel bringt keine Tondateien mit. Ohne Dateien unter assets/sfx/'
      + ' bleibt es still – das ist kein Fehler.');
    const vol = document.createElement('div');
    vol.className = 'slider-row';
    vol.innerHTML = '<label>Laut</label>';
    const sl = document.createElement('input');
    sl.type = 'range'; sl.min = '0'; sl.max = '1'; sl.step = '0.05';
    sl.value = String(this.values.volume);
    const out = document.createElement('span');
    out.className = 'slider-val';
    out.textContent = Math.round(this.values.volume * 100) + '%';
    sl.addEventListener('input', () => {
      out.textContent = Math.round(Number(sl.value) * 100) + '%';
      this.set('volume', Number(sl.value));
    });
    vol.appendChild(sl); vol.appendChild(out);
    ton.appendChild(vol);

    const stand = group('Spielstand');
    const row = document.createElement('div');
    row.className = 'tool-row wrap';
    const mk = (label, title, fn) => {
      const b = document.createElement('button');
      b.className = 'btn tiny';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      row.appendChild(b);
      return b;
    };
    mk('Speichern', 'Stand im Browser ablegen (localStorage)', () => this.game.saveLocal());
    mk('Laden', 'Zuletzt abgelegten Stand laden', () => this.game.loadLocal());
    mk('Datei …', 'Stand als Datei herunterladen', () => this.game.saveFile());
    mk('Datei laden', 'Stand aus einer Datei laden', () => this.game.loadFile());
    mk('Loeschen', 'Abgelegten Stand entfernen', () => this.game.clearLocal());
    stand.appendChild(row);

    this.status = document.createElement('div');
    this.status.className = 'tool-hint';
    stand.appendChild(this.status);
    this.refreshStatus();

    check(stand, 'autosave', 'Automatisch speichern',
      'Legt alle zwei Minuten Spielzeit einen Stand im Browser ab.');

    const foot = group('Sonstiges');
    const rb = document.createElement('button');
    rb.className = 'btn tiny';
    rb.textContent = 'Auf Vorgaben zuruecksetzen';
    rb.addEventListener('click', () => this.reset());
    foot.appendChild(rb);
    const v = document.createElement('div');
    v.className = 'tool-hint';
    v.textContent = 'Antarium ' + VERSION;
    foot.appendChild(v);
  }

  /** Zeigt an, ob und von wann ein Stand im Browser liegt. */
  refreshStatus() {
    if (!this.status) return;
    const info = savedInfo();
    this.status.textContent = info
      ? 'Abgelegt: ' + info.when + ' (Tick ' + info.tick + ', ' + info.kb + ' KB)'
      : 'Kein Stand im Browser abgelegt.';
  }
}

// ---------------------------------------------------------------------------
// localStorage – jeder Zugriff gekapselt, damit ein blockierter Speicher
// (privates Fenster, abgeschaltete Cookies) das Spiel nicht anhaelt.
// ---------------------------------------------------------------------------

/**
 * Einen Schluessel lesen und dabei den alten Namen von vor der
 * Umbenennung beruecksichtigen. Wer schon gespielt hat, soll seine
 * Einstellungen und seinen Spielstand nicht verlieren.
 */
export function readStored(key, legacyKey) {
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw;
    const old = localStorage.getItem(legacyKey);
    if (old === null) return null;
    // Einmalig umziehen, danach wird nur noch der neue Schluessel benutzt.
    try { localStorage.setItem(key, old); localStorage.removeItem(legacyKey); } catch { /* egal */ }
    return old;
  } catch { return null; }
}

function load() {
  try {
    const raw = readStored(STORAGE.SETTINGS, STORAGE.SETTINGS_LEGACY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function save(values) {
  try { localStorage.setItem(STORAGE.SETTINGS, JSON.stringify(values)); } catch { /* egal */ }
}

/** Kurzinfo zum abgelegten Stand (oder null). */
export function savedInfo() {
  try {
    const raw = readStored(STORAGE.SAVE, STORAGE.SAVE_LEGACY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return {
      when: new Date(d.savedAt).toLocaleString('de-DE'),
      tick: d.tick,
      kb: Math.round(raw.length / 1024),
    };
  } catch { return null; }
}
