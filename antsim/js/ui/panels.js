/**
 * panels.js – Rechte Seitenleiste: Kolonieliste.
 *
 * Zeigt pro Kolonie Farbe, Name, Gesamtpopulation, die Verteilung auf die
 * Ebenen und die vorhandenen Kasten (mit dem echten Sprite als Symbol).
 * Klick auf eine Kolonie wechselt in deren Nest-Ebene.
 *
 * Naehrstoffbalken und Stressanzeige kommen in Phase 3 dazu, sobald es die
 * Daten wirklich gibt.
 */

import { CASTE_DEFS } from '../sim/castes.js';

export class ColonyPanel {
  constructor(el, world, sprites, game) {
    this.el = el;
    this.world = world;
    this.sprites = sprites;
    this.game = game;
    this.signature = '';
  }

  refresh() {
    const sig = this.world.colonies.colonies
      .map((c) => c.id + ':' + c.total + ':' + [...c.populationByLevel.entries()].join(',') + ':' + c.threat)
      .join('|');
    if (sig === this.signature) return;
    this.signature = sig;

    const frag = document.createDocumentFragment();
    for (const c of this.world.colonies.colonies) {
      const box = document.createElement('div');
      box.className = 'colony';

      const head = document.createElement('div');
      head.className = 'colony-head';
      head.title = 'In die Nest-Ebene wechseln';
      head.innerHTML = '<span class="swatch" style="background:' + c.colorCss + '"></span>'
        + '<span class="cname">' + esc(c.name) + '</span>'
        + '<span class="cpop">' + c.total + '</span>';
      head.addEventListener('click', () => {
        if (c.nestLevelIds.length) this.game.gotoLevel(c.nestLevelIds[0]);
      });
      box.appendChild(head);

      // Kasten mit Anzahl
      const castes = document.createElement('div');
      castes.className = 'castes';
      for (const def of CASTE_DEFS) {
        const n = c.population[def.id];
        if (!n) continue;
        const chip = document.createElement('span');
        chip.className = 'caste-chip';
        chip.title = def.name + ' – ' + def.role;
        chip.innerHTML = '<img src="' + this.sprites.dataURL('ant_' + def.key, 0) + '" alt="">' + n;
        castes.appendChild(chip);
      }
      box.appendChild(castes);

      // Verteilung auf die Ebenen
      const bars = document.createElement('div');
      bars.className = 'bars';
      for (const [levelId, n] of [...c.populationByLevel.entries()].sort((a, b) => a[0] - b[0])) {
        const level = this.world.levels.get(levelId);
        const label = document.createElement('span');
        label.className = 'bar-label';
        label.textContent = level ? level.name.slice(0, 8) : '?';
        const track = document.createElement('span');
        track.className = 'bar-track';
        const fill = document.createElement('span');
        fill.className = 'bar-fill';
        fill.style.width = Math.round((n / Math.max(1, c.total)) * 100) + '%';
        fill.style.background = c.colorCss;
        track.appendChild(fill);
        track.title = n + ' Ameisen in ' + (level ? level.name : '?');
        bars.appendChild(label);
        bars.appendChild(track);
      }
      box.appendChild(bars);
      frag.appendChild(box);
    }
    this.el.textContent = '';
    this.el.appendChild(frag);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
