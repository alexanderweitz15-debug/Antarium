/**
 * log.js – Ereignis-Log mit Kategoriefiltern.
 *
 * Klick auf eine Zeile wechselt in die zugehoerige Ebene und springt an den
 * Ort des Ereignisses.
 */

import { bus, CAT, CAT_LABEL } from '../sim/events.js';
import { SIM } from '../config.js';

export class EventLogView {
  /**
   * @param {HTMLElement} el
   * @param {HTMLElement} filterEl
   * @param {{gotoLevel:Function}} game
   */
  constructor(el, filterEl, game) {
    this.el = el;
    this.game = game;
    this.enabled = new Set(Object.values(CAT));
    this.lastSeq = -1;

    for (const cat of Object.values(CAT)) {
      const b = document.createElement('button');
      b.className = 'btn tiny on toggle';
      b.textContent = CAT_LABEL[cat];
      b.title = 'Kategorie ein-/ausblenden';
      b.addEventListener('click', () => {
        if (this.enabled.has(cat)) this.enabled.delete(cat); else this.enabled.add(cat);
        b.classList.toggle('on', this.enabled.has(cat));
        this.lastSeq = -1;
        this.render();
      });
      filterEl.appendChild(b);
    }
    bus.on('log', () => { this.dirty = true; });
    this.dirty = true;
  }

  render() {
    if (!this.dirty) return;
    this.dirty = false;
    const items = bus.recent(120, (e) => this.enabled.has(e.cat));
    const frag = document.createDocumentFragment();
    for (const e of items) {
      const row = document.createElement('div');
      row.className = 'log-line' + (e.levelId >= 0 ? ' clickable' : '');
      const secs = (e.tick / SIM.TICK_RATE) | 0;
      row.innerHTML = '<span class="t">' + fmtTime(secs) + '</span>'
        + '<span class="c">' + CAT_LABEL[e.cat] + '</span>'
        + '<span class="m">' + esc(e.text) + '</span>';
      if (e.levelId >= 0) {
        const levelId = e.levelId, x = e.x, y = e.y;
        row.addEventListener('click', () => {
          this.game.gotoLevel(levelId, x >= 0 ? { x, y } : null);
        });
      }
      frag.appendChild(row);
    }
    this.el.textContent = '';
    this.el.appendChild(frag);
  }
}

function fmtTime(s) {
  const m = (s / 60) | 0;
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
