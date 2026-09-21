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
import { NUTRIENT_NAMES, NUTRIENT_COLORS } from '../config.js';

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
      .map((c) => c.id + ':' + c.total + ':' + c.broodTotal + ':' + (c.alive ? 1 : 0)
        + ':' + [...c.populationByLevel.entries()].join(',') + ':' + c.threat
        + ':' + (c.balanceArr ? Array.from(c.balanceArr).map((v) => v.toFixed(1)).join('') : ''))
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
        + '<span class="cname">' + esc(c.name) + (c.alive ? '' : ' (tot)') + '</span>'
        + '<span class="cpop">' + c.total + (c.broodTotal ? ' +' + c.broodTotal : '') + '</span>';
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

      // Naehrstoffbalken: rot Mangel, gruen gedeckt, blau Ueberschuss
      if (c.balanceArr) {
        const nut = document.createElement('div');
        nut.className = 'nut';
        for (let n = 0; n < 3; n++) {
          const b = c.balanceArr[n];
          const label = document.createElement('span');
          label.className = 'nut-label';
          label.textContent = NUTRIENT_NAMES[n];
          const track = document.createElement('span');
          track.className = 'nut-track';
          const fill = document.createElement('span');
          fill.className = 'nut-fill';
          // 0..2 auf 0..100 %; die Marke bei 50 % ist "gedeckt"
          fill.style.width = Math.max(2, Math.min(100, (b / 2) * 100)) + '%';
          fill.style.background = b < 0.85 ? '#d9604a' : (b > 1.35 ? '#4f9ad8' : '#6ec177');
          const mark = document.createElement('span');
          mark.className = 'nut-mark';
          track.appendChild(fill);
          track.appendChild(mark);
          track.title = NUTRIENT_NAMES[n] + ': Bilanz ' + b.toFixed(2)
            + ' (Vorrat ' + Math.round(c.storeArr[n]) + '/' + Math.round(c.capacity[n]) + ')';
          const val = document.createElement('span');
          val.className = 'nut-val';
          val.textContent = Math.round(c.storeArr[n]);
          val.style.color = '#' + NUTRIENT_COLORS[n].toString(16).padStart(6, '0');
          nut.appendChild(label);
          nut.appendChild(track);
          nut.appendChild(val);
        }
        box.appendChild(nut);

        const stress = document.createElement('div');
        stress.className = 'bars stress-bar';
        const sl = document.createElement('span');
        sl.className = 'bar-label';
        sl.textContent = 'Stress';
        const st = document.createElement('span');
        st.className = 'bar-track';
        const sf = document.createElement('span');
        sf.className = 'bar-fill';
        sf.style.width = Math.min(100, (c.stress / 2.5) * 100) + '%';
        sf.style.background = c.stress > 1.2 ? '#d9604a' : '#d9a441';
        st.appendChild(sf);
        st.title = 'Stress ' + c.stress.toFixed(2)
          + ' – treibt die Mutationsstaerke der naechsten Generation';
        stress.appendChild(sl);
        stress.appendChild(st);
        box.appendChild(stress);
      }

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
