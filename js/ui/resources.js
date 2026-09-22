/**
 * resources.js – Vorratsleiste des gefuehrten Volkes (Feldzug).
 *
 * Die Ernaehrungssimulation laeuft seit Phase 3, war aber nie ablesbar: man
 * sah Ameisen sterben und erfuhr den Grund erst im Ereignisprotokoll. Wer
 * ein Volk fuehren soll, muss sehen, wovon es lebt – und zwar nicht nur den
 * Bestand, sondern die RICHTUNG. Ein Lager von zweihundert Zucker sagt
 * nichts; zweihundert und fallend sagt alles.
 *
 * Im Sandkasten bleibt die Leiste aus. Dort fuehrt der Spieler kein Volk,
 * und acht Vorratsleisten waeren keine Information, sondern Laerm.
 */

import { NUTRIENT, MODES, DEFAULT_MODE, BUILD } from '../config.js';

/** Was angezeigt wird, in dieser Reihenfolge. */
const NAEHR = [
  { i: NUTRIENT.SUGAR, name: 'Zucker' },
  { i: NUTRIENT.PROTEIN, name: 'Protein' },
  { i: NUTRIENT.FAT, name: 'Fett' },
];

export class ResourceBar {
  /**
   * @param {HTMLElement} el
   * @param {import('../sim/world.js').World} world
   */
  constructor(el, world) {
    this.el = el;
    this.world = world;
    this.signature = '';
    /** Bestand beim letzten Vergleich, fuer die Richtungsanzeige. */
    this._last = null;
    this._lastTick = -1;
  }

  get mode() { return MODES[this.world.mode] || MODES[DEFAULT_MODE]; }

  /** Das gefuehrte Volk, oder null. */
  get colony() {
    if (!this.mode.own) return null;
    const c = this.world.colonies.get(this.world.playerColonyId);
    return c && c.alive ? c : null;
  }

  refresh() {
    const c = this.colony;
    if (!c) {
      if (!this.el.hidden) { this.el.hidden = true; this.signature = ''; }
      return;
    }
    this.el.hidden = false;

    /**
     * Die Richtung wird ueber ein festes Zeitfenster gemessen, nicht von
     * Aufruf zu Aufruf: sonst haengt der Pfeil an der Bildrate statt am
     * Spielgeschehen.
     */
    const w = this.world;
    let trend = this._trend;
    if (this._last === null || w.tick - this._lastTick >= 150) {
      const jetzt = Array.from(c.storeArr);
      trend = this._last
        ? jetzt.map((v, i) => v - this._last[i])
        : jetzt.map(() => 0);
      this._last = jetzt;
      this._lastTick = w.tick;
      this._trend = trend;
    }
    trend = trend || [0, 0, 0];

    const werte = NAEHR.map((n) => Math.round(c.storeArr[n.i]));
    const mats = Object.keys(BUILD.YIELD)
      .filter((k) => (c.stores[k] || 0) > 0)
      .map((k) => k + Math.round(c.stores[k]));
    const sig = werte.join(',') + '|' + trend.map((t) => Math.sign(t)).join('')
      + '|' + c.total + '|' + mats.join(',');
    if (sig === this.signature) return;
    this.signature = sig;

    const frag = document.createDocumentFragment();
    frag.appendChild(this._feld('Volk', String(c.total), 0, false));
    for (let k = 0; k < NAEHR.length; k++) {
      const n = NAEHR[k];
      const wert = c.storeArr[n.i];
      const kapa = c.capacity ? c.capacity[n.i] : 0;
      // Unter einem Zehntel des Lagers wird es eng – das soll ins Auge fallen.
      frag.appendChild(this._feld(n.name, String(Math.round(wert)), trend[k],
        kapa > 0 && wert < kapa * 0.1));
    }
    for (const k of Object.keys(BUILD.YIELD)) {
      const v = Math.round(c.stores[k] || 0);
      if (v > 0) frag.appendChild(this._feld(k, String(v), 0, false));
    }
    this.el.replaceChildren(frag);
  }

  _feld(name, wert, richtung, knapp) {
    const d = document.createElement('div');
    d.className = 'res' + (knapp ? ' low' : '');
    const pfeil = richtung > 0.5 ? '▲' : (richtung < -0.5 ? '▼' : '');
    d.innerHTML = '<span class="res-name">' + name + '</span>'
      + '<span class="res-val">' + wert + '</span>'
      + (pfeil ? '<span class="res-trend ' + (richtung > 0 ? 'up' : 'down') + '">'
        + pfeil + '</span>' : '');
    if (knapp) d.title = name + ' wird knapp';
    return d;
  }
}
