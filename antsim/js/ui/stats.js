/**
 * stats.js – Stammbaum und Statistik.
 *
 * Zeigt, was die Simulation ueber ihre eigene Geschichte weiss:
 * Weltkennzahlen, Bestand je Kreaturenart, alle je gegruendeten Kolonien mit
 * Genom-Kurzprofil, Ernaehrungslage der Mutterkolonie bei der Gruendung und
 * den staerksten Genaenderungen sowie Todesursachen.
 */

import { NUTRIENT_NAMES, SIM } from '../config.js';
import { CASTE_DEFS } from '../sim/castes.js';
import { SPECIES_LIST } from '../sim/creatures.js';
import { geneSummary } from '../sim/genome.js';

export class StatsPanel {
  constructor(el, world, game, sprites) {
    this.el = el;
    this.world = world;
    this.game = game;
    this.sprites = sprites;
    this.timer = 0;
  }

  refresh(dtMs) {
    if (this.el.hidden) return;
    this.timer -= dtMs;
    if (this.timer > 0) return;
    this.timer = 500;

    const w = this.world;
    const parts = [];

    // --- Welt ---------------------------------------------------------------
    const alive = w.colonies.colonies.filter((c) => c.alive);
    const secs = (w.tick / SIM.TICK_RATE) | 0;
    parts.push('<h3>Welt</h3><table class="stat-table">'
      + row('Spielzeit', fmtTime(secs))
      + row('Voelker', alive.length + ' von ' + w.colonies.colonies.length + ' je gegruendet')
      + row('Ameisen', w.ants.count)
      + row('Brut', w.brood.count)
      + row('Kreaturen', w.creatures.count)
      + row('Nahrungsquellen', w.food.stats.sources + ' (' + Math.round(w.food.stats.total) + ' Einheiten)')
      + row('Gegraben', w.totalDug + ' Zellen')
      + row('Portaldurchgaenge', w.totalPassages)
      + '</table>');

    // --- Kreaturen ----------------------------------------------------------
    const cen = w.creatureCensus;
    parts.push('<h3>Kreaturen</h3><table class="stat-table">');
    for (const sp of SPECIES_LIST) {
      parts.push(row(sp.name, cen[sp.id] + ' Tiere'));
    }
    parts.push('</table>');

    // --- Kasten -------------------------------------------------------------
    const seen = new Set();
    for (const c of w.colonies.colonies) for (const k of c.knownCastes) seen.add(k);
    parts.push('<h3>Aufgetretene Kasten</h3><div>');
    for (const def of CASTE_DEFS) {
      if (!seen.has(def.id)) continue;
      parts.push('<span class="caste-chip" title="' + esc(def.role) + '">'
        + '<img src="' + this.sprites.dataURL('ant_' + def.key, 0) + '" alt="">'
        + esc(def.name) + (def.evolutionary ? ' *' : '') + '</span> ');
    }
    parts.push('</div>');

    // --- Stammbaum ----------------------------------------------------------
    parts.push('<h3>Stammbaum</h3>');
    for (const rec of w.lineage) {
      const colony = w.colonies.get(rec.id);
      const dead = !colony || !colony.alive;
      const mother = rec.parentId >= 0 ? ('aus ' + (w.lineage.find((l) => l.id === rec.parentId) || {}).name) : 'Gruenderin';
      const mb = rec.motherBalance
        ? ' &middot; Mutter: ' + NUTRIENT_NAMES.map((n, i) => n[0] + ' ' + rec.motherBalance[i].toFixed(2)).join(' ')
        : '';
      const ch = rec.changes && rec.changes.length
        ? ' &middot; ' + rec.changes.slice(0, 2).map((c) => c.key + ' '
          + c.from.toFixed(2) + '→' + c.to.toFixed(2) + (c.jump ? '!' : '')).join(', ')
        : '';
      const summary = colony && colony.genome ? geneSummary(colony.genome) : rec.summary;
      parts.push('<div class="lin-row' + (dead ? ' dead' : '') + '" data-colony="' + rec.id + '">'
        + '<span class="sw" style="background:' + (colony ? colony.colorCss : '#666') + '"></span>'
        + '<span class="nm">' + esc(rec.name) + '</span>'
        + '<span class="info">Gen. ' + rec.generation + ' &middot; ' + esc(mother)
        + ' &middot; ab ' + fmtTime((rec.founded / SIM.TICK_RATE) | 0)
        + (rec.extinct >= 0 ? ' bis ' + fmtTime((rec.extinct / SIM.TICK_RATE) | 0) : '')
        + (colony && colony.alive ? ' &middot; ' + colony.total + ' Ameisen' : '')
        + '<br>' + esc(summary) + mb + ch + '</span></div>');
    }

    // --- Todesursachen ------------------------------------------------------
    const causes = {};
    let predators = 0;
    for (const c of w.colonies.colonies) {
      for (const [k, v] of Object.entries(c.deathCause || {})) causes[k] = (causes[k] || 0) + v;
      predators += c.lostToPredators || 0;
    }
    causes['Raeuber'] = predators;
    parts.push('<h3>Todesursachen</h3><table class="stat-table">');
    for (const [k, v] of Object.entries(causes)) parts.push(row(k, v));
    parts.push('</table>');

    this.el.innerHTML = parts.join('');
    for (const el of this.el.querySelectorAll('.lin-row')) {
      el.addEventListener('click', () => {
        const c = this.world.colonies.get(Number(el.dataset.colony));
        if (c && c.nestLevelIds.length) this.game.gotoLevel(c.nestLevelIds[0]);
      });
    }
  }
}

function row(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }
function fmtTime(s) {
  const m = (s / 60) | 0;
  return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
