/**
 * levelNav.js – Ebenen-Navigation (Reiter) und Brotkrumen-Anzeige.
 *
 * Die Leiste wird aus den Daten erzeugt: "Oberflaeche" plus ein Reiter je
 * Kolonie mit Koloniefarbe, Name und (ab Phase 5) Bedrohungssymbol. Neue
 * Kolonien erscheinen automatisch.
 */

import { LEVEL_KIND } from '../sim/levels.js';

const THREAT_ICON = ['', '!', '!!', '!!!'];

export class LevelNav {
  /**
   * @param {HTMLElement} navEl
   * @param {HTMLElement} crumbEl
   * @param {{gotoLevel:(id:number, focus?:object)=>void}} game
   */
  constructor(navEl, crumbEl, game) {
    this.nav = navEl;
    this.crumb = crumbEl;
    this.game = game;
    this.tabs = new Map(); // levelId -> button
    this.signature = '';
  }

  /** Reiter neu aufbauen, wenn sich Ebenen oder Kolonien geaendert haben. */
  rebuild(world) {
    const sig = world.levels.levels.map((l) => l.id + ':' + l.name + ':' + (l.abandoned ? 1 : 0)).join('|');
    if (sig === this.signature) return;
    this.signature = sig;
    this.nav.textContent = '';
    this.tabs.clear();

    for (const level of world.levels.levels) {
      const btn = document.createElement('button');
      btn.className = 'tab';
      btn.dataset.level = String(level.id);

      if (level.kind === LEVEL_KIND.SURFACE) {
        btn.innerHTML = '<span class="key">0</span> Oberflaeche';
        btn.title = 'Zur Oberflaeche (Taste 0)';
      } else {
        const colony = world.colonies.get(level.colonyId);
        const idx = world.levels.levels.filter((l) => l.kind === LEVEL_KIND.NEST).indexOf(level) + 1;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.style.background = colony ? colony.colorCss : '#888';
        btn.appendChild(dot);
        const key = document.createElement('span');
        key.className = 'key';
        key.textContent = String(idx);
        btn.appendChild(key);
        btn.appendChild(document.createTextNode(' ' + (colony ? colony.name : level.name)));
        const threat = document.createElement('span');
        threat.className = 'threat';
        btn.appendChild(threat);
        btn._threat = threat;
        btn.title = level.name + (idx <= 8 ? ' (Taste ' + idx + ')' : '');
      }

      btn.addEventListener('click', () => this.game.gotoLevel(level.id));
      this.nav.appendChild(btn);
      this.tabs.set(level.id, btn);
    }
  }

  /** Aktiven Reiter, Bedrohungssymbole und Brotkrumen aktualisieren. */
  update(world) {
    const active = world.levels.active;
    for (const [id, btn] of this.tabs) {
      btn.classList.toggle('active', id === active.id);
      const level = world.levels.get(id);
      if (btn._threat && level) {
        const colony = world.colonies.get(level.colonyId);
        btn._threat.textContent = colony ? THREAT_ICON[colony.threat] || '' : '';
      }
    }
    if (active.kind === LEVEL_KIND.SURFACE) {
      this.crumb.innerHTML = '<b>Oberflaeche</b>';
    } else {
      this.crumb.innerHTML = 'Oberflaeche &rsaquo; <b>' + escapeHtml(active.name) + '</b>';
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
