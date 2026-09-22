/**
 * alerts.js – Kampfalarme als Einblendungen oben rechts.
 *
 * Die Simulation meldet ueber world.alerts, wenn eine Kolonie in Bedraengnis
 * geraet. Jede Meldung traegt Ebene und Ort, damit "Zum Kampf" direkt
 * dorthin springen kann – auch in eine andere Ebene.
 */

import { SIM } from '../config.js';
import { THREAT_LABEL } from '../sim/combat.js';

const URGENCY = ['', 'Feinde in der Naehe', 'Kampf am Eingang', 'Koenigin in Gefahr'];

export class AlertView {
  constructor(el, world, game) {
    this.el = el;
    this.world = world;
    this.game = game;
    this.shown = new Set();
    /** Automatisch zur bedrohten Ebene wechseln. */
    this.autoJump = false;
  }

  refresh() {
    for (const a of this.world.alerts) {
      const id = a.tick + ':' + a.colonyId + ':' + a.threat;
      if (this.shown.has(id)) continue;
      this.shown.add(id);
      if (this.world.tick - a.tick > 600) continue;   // alte Meldung beim Laden
      this._toast(a);
      if (this.autoJump && a.threat >= 2) {
        this.game.gotoLevel(a.levelId, a.x >= 0 ? { x: a.x, y: a.y } : null);
      }
    }
    if (this.shown.size > 200) this.shown.clear();
  }

  _toast(a) {
    const box = document.createElement('div');
    box.className = 'toast threat' + a.threat;
    box.style.borderLeftColor = '#' + a.color.toString(16).padStart(6, '0');
    const secs = (a.tick / SIM.TICK_RATE) | 0;
    box.innerHTML = '<div class="toast-head">'
      + '<span class="sw" style="background:#' + a.color.toString(16).padStart(6, '0') + '"></span>'
      + esc(a.name) + ' &middot; ' + esc(URGENCY[a.threat] || THREAT_LABEL[a.threat])
      + '</div><div class="toast-sub">' + fmt(secs) + '</div>';
    const btn = document.createElement('button');
    btn.className = 'btn tiny';
    btn.textContent = 'Zum Kampf';
    btn.addEventListener('click', () => {
      this.game.gotoLevel(a.levelId, a.x >= 0 ? { x: a.x, y: a.y } : null);
      box.remove();
    });
    box.appendChild(btn);
    const close = document.createElement('button');
    close.className = 'btn tiny';
    close.textContent = 'x';
    close.addEventListener('click', () => box.remove());
    box.appendChild(close);
    this.el.appendChild(box);
    setTimeout(() => { box.classList.add('fade'); }, 9000);
    setTimeout(() => { box.remove(); }, 10000);
    while (this.el.children.length > 4) this.el.removeChild(this.el.firstChild);
  }
}

function fmt(s) {
  const m = (s / 60) | 0;
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
