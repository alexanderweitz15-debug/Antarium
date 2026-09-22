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
import { NUTRIENT_NAMES, NUTRIENT_COLORS, MATERIALS, RESEARCH_TREE } from '../config.js';
import { TRAIT_LIST } from '../sim/traits.js';
import { STANCE, STANCE_LABEL, STANCE_COLOR } from '../sim/diplomacy.js';

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
        + ':' + (c.balanceArr ? Array.from(c.balanceArr).map((v) => v.toFixed(1)).join('') : '')
        + ':' + (c.researched ? c.researched.size : 0) + ':' + (c.structureCount || 0)
        + ':' + Math.round(c.research || 0)
        + ':' + (c.knownMaterials ? [...c.knownMaterials].map((k) => Math.round(c.stores[k] || 0)).join(',') : ''))
      .join('|');
    if (sig === this.signature) return;
    this.signature = sig;

    const frag = document.createDocumentFragment();
    /**
     * AUSGESTORBENE VOELKER GEHOEREN NICHT IN EINE LEBENDLISTE. Sie standen
     * mit "(tot)" und null Ameisen weiter zwischen den anderen und machten
     * die Uebersicht mit jeder Generation unbrauchbarer. Ihre Geschichte
     * bleibt in der Ahnentafel und in den Statistiken; hier steht nur noch
     * ihre Zahl.
     */
    const tot = this.world.colonies.colonies.filter((c) => !c.alive);
    for (const c of this.world.colonies.colonies) {
      if (!c.alive) continue;
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

      /**
       * Charakter der Koenigin. Er erklaert das meiste am Verhalten eines
       * Volkes und gehoert deshalb ganz nach oben, nicht in einen
       * Unterpunkt.
       */
      if (c.queenTraits && c.queenTraits.length) {
        const ch = document.createElement('div');
        ch.className = 'queen-traits';
        for (const id of c.queenTraits) {
          const t = TRAIT_LIST[id];
          if (!t) continue;
          const chip = document.createElement('span');
          chip.className = 'trait-chip trait-' + t.group;
          chip.textContent = t.name;
          chip.title = t.desc;
          ch.appendChild(chip);
        }
        box.appendChild(ch);
      }

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

      /**
       * Forschung, Bauwerke, Baustoffe und Diplomatie (Phase 11). Alles in
       * einem Block, weil es zusammen gelesen wird: was kann das Volk, was
       * hat es gebaut, mit wem liegt es im Streit.
       */
      if (c.researched) {
        const next = this.world.structures.nextResearch(c);
        const res = document.createElement('div');
        res.className = 'bars';
        const rl = document.createElement('span');
        rl.className = 'bar-label';
        rl.textContent = 'Forschung';
        const rt = document.createElement('span');
        rt.className = 'bar-track';
        const rf = document.createElement('span');
        rf.className = 'bar-fill';
        rf.style.background = '#4f9ad8';
        rf.style.width = next
          ? Math.min(100, (c.research / next.cost) * 100) + '%' : '100%';
        rt.appendChild(rf);
        rt.title = next
          ? 'Naechste Stufe: ' + next.name + ' (' + Math.round(c.research)
            + '/' + next.cost + ') – ' + next.desc
          : 'Alles erforscht';
        res.appendChild(rl);
        res.appendChild(rt);
        const rv = document.createElement('span');
        rv.className = 'nut-val';
        rv.textContent = c.researched.size + '/' + RESEARCH_TREE.length;
        res.appendChild(rv);
        box.appendChild(res);

        const mats = document.createElement('div');
        mats.className = 'mat-row';
        for (const m of MATERIALS) {
          const have = Math.round(c.stores[m.key] || 0);
          if (!have && !c.knownMaterials.has(m.key)) continue;
          const chip = document.createElement('span');
          chip.className = 'mat-chip';
          chip.title = m.name + ' – ' + m.desc;
          chip.innerHTML = '<i style="background:#' + m.color.toString(16).padStart(6, '0')
            + '"></i>' + have;
          mats.appendChild(chip);
        }
        if (mats.childElementCount) box.appendChild(mats);

        const builds = this.world.structures.ofColony(c.id);
        if (builds.length) {
          const bl = document.createElement('div');
          bl.className = 'mat-row';
          const byKey = new Map();
          for (const st of builds) {
            const k = st.def.name + ' ' + 'I'.repeat(st.tier);
            byKey.set(k, (byKey.get(k) || 0) + 1);
          }
          for (const [k, n] of byKey) {
            const chip = document.createElement('span');
            chip.className = 'build-chip';
            chip.textContent = k + (n > 1 ? ' x' + n : '');
            bl.appendChild(chip);
          }
          box.appendChild(bl);
        }

        const rel = document.createElement('div');
        rel.className = 'mat-row';
        for (const o of this.world.colonies.colonies) {
          if (o.id === c.id || !o.alive) continue;
          const st = this.world.diplomacy.stance(c.id, o.id);
          if (st === STANCE.HOSTILE) continue;          // Ausgangslage, nicht der Rede wert
          const chip = document.createElement('span');
          chip.className = 'rel-chip';
          chip.style.borderColor = STANCE_COLOR[st];
          chip.style.color = STANCE_COLOR[st];
          chip.textContent = STANCE_LABEL[st] + ': ' + o.name;
          chip.title = 'Beziehung ' + this.world.diplomacy.get(c.id, o.id).toFixed(2);
          rel.appendChild(chip);
        }
        if (rel.childElementCount) box.appendChild(rel);
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
    if (tot.length) {
      const line = document.createElement('div');
      line.className = 'colony extinct-note';
      line.title = tot.map((c) => c.name).join(', ');
      line.textContent = tot.length === 1
        ? '1 Volk ausgestorben'
        : tot.length + ' Voelker ausgestorben';
      frag.appendChild(line);
    }
    this.el.replaceChildren(frag);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
