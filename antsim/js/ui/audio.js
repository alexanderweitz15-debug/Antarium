/**
 * audio.js – Ton (Phase 10), vollstaendig optional.
 *
 * GRUNDSATZ: Das Spiel bringt KEINE Tondateien mit. Wer welche hat, legt sie
 * unter assets/sfx/ ab; fehlt eine Datei, bleibt es an dieser Stelle still.
 * Es gibt keine Fehlermeldung und keinen Netzwerkfehler in der Konsole, denn
 * geladen wird nur, wenn der Ton eingeschaltet ist, und ein Fehlschlag wird
 * als "diese Datei gibt es nicht" vermerkt.
 *
 * Der WebAudio-Kontext wird erst bei der ersten Benutzereingabe erzeugt –
 * Browser verweigern ihn vorher.
 */

import { AUDIO } from '../config.js';

export class Audio {
  constructor() {
    this.enabled = AUDIO.ENABLED;
    this.volume = AUDIO.VOLUME;
    /** @type {AudioContext|null} */
    this.ctx = null;
    /** @type {Map<string, AudioBuffer|null>} null = Datei fehlt */
    this.buffers = new Map();
    this.pending = new Set();
    this.lastPlayed = new Map();
  }

  /** Muss aus einer Benutzereingabe heraus aufgerufen werden. */
  unlock() {
    if (this.ctx || !this.enabled) return;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) { this.enabled = false; return; }
    try {
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    } catch {
      this.enabled = false;
    }
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  async _load(key) {
    const file = AUDIO.FILES[key];
    if (!file || this.pending.has(key)) return;
    this.pending.add(key);
    try {
      const res = await fetch(AUDIO.DIR + file);
      if (!res.ok) { this.buffers.set(key, null); return; }
      const buf = await res.arrayBuffer();
      this.buffers.set(key, await this.ctx.decodeAudioData(buf));
    } catch {
      // Datei fehlt oder ist unlesbar: still bleiben, nicht noch einmal versuchen
      this.buffers.set(key, null);
    } finally {
      this.pending.delete(key);
    }
  }

  /**
   * Ton abspielen, wenn es ihn gibt.
   * @param {string} key Schluessel aus AUDIO.FILES
   * @param {number} [vol] relative Lautstaerke 0..1
   */
  play(key, vol = 1) {
    if (!this.enabled || !this.ctx) return;
    const now = performance.now();
    const last = this.lastPlayed.get(key) || 0;
    if (now - last < AUDIO.THROTTLE_MS) return;
    this.lastPlayed.set(key, now);

    if (!this.buffers.has(key)) { this._load(key); return; }
    const buf = this.buffers.get(key);
    if (!buf) return;                     // Datei fehlt – bewusst still
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g);
    g.connect(this.gain);
    src.start();
  }
}
