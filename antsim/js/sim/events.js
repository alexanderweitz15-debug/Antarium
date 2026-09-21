/**
 * events.js – Ereignis-Bus und Ereignis-Log.
 *
 * Die Simulation kennt die UI nicht. Sie feuert Ereignisse, die UI hoert zu.
 * Das Log ist ein Ringpuffer fester Groesse (keine Allokation im Hot Path
 * ausser dem Eintragsobjekt selbst, das wiederverwendet wird).
 */

import { LIMITS } from '../config.js';

/** Kategorien fuer Filterung im UI. */
export const CAT = {
  SYS: 'sys',
  EBENE: 'ebene',
  BAU: 'bau',
  KAMPF: 'kampf',
  EVOLUTION: 'evolution',
  ERNAEHRUNG: 'ernaehrung',
  KATASTROPHE: 'katastrophe',
  RAEUBER: 'raeuber',
};

export const CAT_LABEL = {
  sys: 'System',
  ebene: 'Ebene',
  bau: 'Bau',
  kampf: 'Kampf',
  evolution: 'Evolution',
  ernaehrung: 'Ernaehrung',
  katastrophe: 'Katastrophe',
  raeuber: 'Raeuber',
};

export class EventBus {
  constructor() {
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
    /** Ringpuffer mit wiederverwendeten Eintragsobjekten. */
    this.log = new Array(LIMITS.EVENT_LOG_SIZE);
    for (let i = 0; i < this.log.length; i++) {
      this.log[i] = { seq: -1, tick: 0, cat: CAT.SYS, text: '', levelId: -1, x: -1, y: -1, colonyId: -1 };
    }
    this.head = 0;
    this.seq = 0;
    this.dirty = true;
  }

  on(type, fn) {
    let arr = this.listeners.get(type);
    if (!arr) { arr = []; this.listeners.set(type, arr); }
    arr.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(type, payload) {
    const arr = this.listeners.get(type);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) arr[i](payload);
  }

  /**
   * Log-Eintrag schreiben.
   * @param {string} cat  Kategorie aus CAT
   * @param {string} text Anzeigetext
   * @param {{tick?:number, levelId?:number, x?:number, y?:number, colonyId?:number}} [where]
   */
  logEvent(cat, text, where) {
    const e = this.log[this.head];
    e.seq = this.seq++;
    e.tick = where && where.tick !== undefined ? where.tick : 0;
    e.cat = cat;
    e.text = text;
    e.levelId = where && where.levelId !== undefined ? where.levelId : -1;
    e.x = where && where.x !== undefined ? where.x : -1;
    e.y = where && where.y !== undefined ? where.y : -1;
    e.colonyId = where && where.colonyId !== undefined ? where.colonyId : -1;
    this.head = (this.head + 1) % this.log.length;
    this.dirty = true;
    this.emit('log', e);
  }

  /** Eintraege neueste zuerst, optional gefiltert. */
  recent(count, filter) {
    const out = [];
    const n = this.log.length;
    for (let i = 1; i <= n && out.length < count; i++) {
      const e = this.log[(this.head - i + n) % n];
      if (e.seq < 0) continue;
      if (filter && !filter(e)) continue;
      out.push(e);
    }
    return out;
  }
}

/** Globaler Bus der Welt (eine Welt pro Seite). */
export const bus = new EventBus();
