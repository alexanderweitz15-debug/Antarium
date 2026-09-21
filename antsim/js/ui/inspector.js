/**
 * inspector.js – Tooltip am Mauszeiger und Detailfenster fuer die Auswahl.
 *
 * Alle Texte kommen aus denselben Datentabellen wie die Legende, damit sich
 * neue Zelltypen oder Kasten automatisch erklaeren.
 */

import { WORLD } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { SURFACE_CELL_DEFS } from '../sim/surface.js';
import { NEST_CELL_DEFS, NEST_CELL, CHAMBER_DEFS } from '../sim/nest.js';
import { casteDef } from '../sim/castes.js';
import { ANT_STATE_LABEL, CARRY_LABEL } from '../sim/ants.js';
import { SPECIES_LIST, CSTATE_LABEL } from '../sim/creatures.js';
import { STAGE_NAMES } from '../sim/brood.js';
import { NUTRIENT_NAMES } from '../config.js';
import { geneSummary } from '../sim/genome.js';

export class Inspector {
  constructor(tipEl, panelEl, bodyEl, world, sprites) {
    this.tip = tipEl;
    this.panel = panelEl;
    this.body = bodyEl;
    this.world = world;
    this.sprites = sprites;
    this.selected = -1;
    /** 'ant' | 'cell' | null – was das Detailfenster gerade zeigt. */
    this.mode = null;
    this.lastKey = '';
  }

  /** Tooltip unter dem Mauszeiger aktualisieren. */
  hover(screenX, screenY, cell, antIndex, creatureIndex = -1) {
    this._creatureHover = creatureIndex;
    const level = this.world.levels.active;
    if (!level || (cell.x < 0 || cell.y < 0 || cell.x >= level.w || cell.y >= level.h)) {
      this.tip.hidden = true;
      return;
    }
    const key = level.id + ':' + cell.x + ':' + cell.y + ':' + antIndex + ':' + creatureIndex;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.tip.innerHTML = this._tipHtml(level, cell, antIndex);
    }
    this.tip.hidden = false;
    // Tooltip am Zeiger halten, aber im Fenster lassen.
    const pad = 14;
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    let x = screenX + pad, y = screenY + pad;
    if (x + w > window.innerWidth - 4) x = screenX - w - pad;
    if (y + h > window.innerHeight - 4) y = screenY - h - pad;
    this.tip.style.left = x + 'px';
    this.tip.style.top = y + 'px';
  }

  hideTip() { this.tip.hidden = true; this.lastKey = ''; }

  _tipHtml(level, cell, antIndex) {
    const parts = [];
    const ci = this._creatureHover;
    if (ci !== undefined && ci >= 0) {
      const cr = this.world.creatures;
      const sp = SPECIES_LIST[cr.species[ci]];
      parts.push('<b>' + sp.name + '</b> <span class="sub">Gen. ' + cr.generation[ci] + '</span>');
      parts.push('<span class="sub">' + (CSTATE_LABEL[cr.state[ci]] || '?')
        + ' &middot; HP ' + cr.hp[ci].toFixed(1) + '/' + cr.hpMax[ci].toFixed(1)
        + ' &middot; Energie ' + cr.energy[ci].toFixed(0) + '</span>');
      parts.push('<span class="sub">Groesse ' + cr.gSize[ci].toFixed(2)
        + ' &middot; Tempo ' + cr.gSpeed[ci].toFixed(2)
        + ' &middot; Aggression ' + cr.gAggr[ci].toFixed(2) + '</span>');
    }
    // Brut unter dem Zeiger (nur im Nest)
    if (level.kind === LEVEL_KIND.NEST && this.world.brood) {
      const br = this.world.brood;
      for (let k = 0; k < br.high; k++) {
        if (!br.alive[k] || br.level[k] !== level.id) continue;
        if (Math.abs(br.x[k] - cell.x - 0.5) > 1 || Math.abs(br.y[k] - cell.y - 0.5) > 1) continue;
        const col = this.world.colonies.get(br.colony[k]);
        parts.push('<b>' + STAGE_NAMES[br.stage[k]] + '</b> <span class="sub">'
          + (col ? col.name : '?') + '</span>');
        if (br.stage[k] === 1) {
          parts.push('<span class="sub">gefuettert ' + br.fed[k].toFixed(1) + '/7.5 Protein'
            + ' &middot; wird ' + casteDef(br.target[k]).name + '</span>');
        } else {
          parts.push('<span class="sub">wird ' + casteDef(br.target[k]).name + '</span>');
        }
        break;
      }
    }
    if (antIndex >= 0) {
      const a = this.world.ants;
      const def = casteDef(a.caste[antIndex]);
      const colony = this.world.colonies.get(a.colony[antIndex]);
      parts.push('<b>' + def.name + '</b> <span class="sub">' + (colony ? colony.name : '?') + '</span>');
      parts.push('<span class="sub">' + (ANT_STATE_LABEL[a.state[antIndex]] || '?')
        + ' &middot; HP ' + a.hp[antIndex].toFixed(1) + '/' + a.hpMax[antIndex].toFixed(1)
        + (a.carryType[antIndex] ? ' &middot; traegt ' + CARRY_LABEL[a.carryType[antIndex]] : '')
        + '</span>');
    }
    const portal = this.world.portals.at(level.id, cell.x, cell.y);
    if (portal) {
      const colony = this.world.colonies.get(portal.colonyId);
      parts.push('<b>Nesteingang</b> <span class="sub">' + (colony ? colony.name : '?') + '</span>');
      parts.push('<span class="sub">Klick: Ebene wechseln · Durchgaenge ' + portal.totalPassages + '</span>');
    } else {
      const t = level.cells[cell.y * level.w + cell.x];
      const defs = level.kind === LEVEL_KIND.SURFACE ? SURFACE_CELL_DEFS : NEST_CELL_DEFS;
      const d = defs[t];
      if (d) {
        let name = d.name;
        if (level.kind === LEVEL_KIND.SURFACE && this.world.food) {
          const amt = this.world.food.amountAt(level, cell.x, cell.y);
          if (amt > 0) name += ' (' + amt + ' Einheiten)';
        }
        if (level.kind === LEVEL_KIND.NEST && t === NEST_CELL.CHAMBER) {
          const cd = CHAMBER_DEFS[level.meta[cell.y * level.w + cell.x]];
          if (cd && cd.id !== 0) name = cd.name;
        }
        parts.push('<b>' + name + '</b>');
        parts.push('<span class="sub">' + d.desc + '</span>');
      }
    }
    parts.push('<span class="sub">' + cell.x + ', ' + cell.y + '</span>');
    return parts.join('<br>');
  }

  /** Kreatur auswaehlen und im Detailfenster zeigen. */
  selectCreature(idx) {
    this.selected = -1;
    this.mode = 'creature';
    const cr = this.world.creatures;
    const sp = SPECIES_LIST[cr.species[idx]];
    this.body.innerHTML = '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">'
      + '<img src="' + this.sprites.dataURL('creature_' + sp.key, 0) + '" style="width:32px;height:32px;'
      + 'image-rendering:pixelated;background:#10161a;border:1px solid #2b3439;border-radius:3px">'
      + '<div><b>' + sp.name + '</b><br><span style="color:#8b9a95">' + sp.desc + '</span></div></div>'
      + '<table style="width:100%">'
      + tr('Zustand', CSTATE_LABEL[cr.state[idx]] || '?')
      + tr('HP', cr.hp[idx].toFixed(1) + ' / ' + cr.hpMax[idx].toFixed(1))
      + tr('Energie', cr.energy[idx].toFixed(0) + ' / ' + sp.energy)
      + tr('Generation', String(cr.generation[idx]))
      + tr('Gene', 'Groesse ' + cr.gSize[idx].toFixed(2) + ' \u00b7 Tempo '
        + cr.gSpeed[idx].toFixed(2) + ' \u00b7 Aggression ' + cr.gAggr[idx].toFixed(2))
      + tr('Alter', (cr.age[idx] / 30).toFixed(0) + ' / ' + (cr.maxAge[idx] / 30).toFixed(0) + ' s')
      + '</table>';
    this.panel.hidden = false;
  }

  select(antIndex) {
    this.selected = antIndex;
    this.mode = 'ant';
    this.refresh();
  }

  clear() {
    this.selected = -1;
    this.mode = null;
    this.panel.hidden = true;
  }

  /** Detailfenster der ausgewaehlten Ameise aktualisieren. */
  refresh() {
    if (this.mode !== 'ant') return;   // Zellinfo bleibt stehen
    const i = this.selected;
    const a = this.world.ants;
    if (i < 0 || !a.alive[i]) { this.clear(); return; }
    const def = casteDef(a.caste[i]);
    const colony = this.world.colonies.get(a.colony[i]);
    const level = this.world.levels.get(a.level[i]);
    const rows = [
      ['Kaste', def.name],
      ['Kolonie', colony ? colony.name : '?'],
      ['Ebene', level ? level.name : '?'],
      ['Zustand', ANT_STATE_LABEL[a.state[i]] || '?'],
      ['Position', a.x[i].toFixed(1) + ', ' + a.y[i].toFixed(1)],
      ['Richtung', ((a.dir[i] * 180 / Math.PI) % 360).toFixed(0) + '°'],
      ['HP', a.hp[i].toFixed(1) + ' / ' + a.hpMax[i].toFixed(1)],
      ['Alter', (a.age[i] / 30).toFixed(1) + ' s'],
      ['Tempo', (a.speed[i] * 30).toFixed(1) + ' Zellen/s'],
      ['Phaenotyp', 'Groesse ' + a.phenoSize[i].toFixed(2) + ' \u00b7 Tempo ' + a.phenoSpeed[i].toFixed(2)],
      ['Hunger', (a.hunger[i] * 100).toFixed(0) + ' %'],
      ['Traegt', a.carryType[i] ? CARRY_LABEL[a.carryType[i]]
        + (a.carryType[i] === 2 ? ' (' + NUTRIENT_NAMES[a.carryNutrient[i]] + ', '
          + a.carryAmount[i].toFixed(0) + ')' : '') : '-'],
      ['Lebensdauer', a.lifespan[i] ? (a.age[i] / 30).toFixed(0) + ' / ' + (a.lifespan[i] / 30).toFixed(0) + ' s' : 'unbegrenzt'],
    ];
    if (colony && colony.balanceArr) {
      rows.push(['Bilanz', NUTRIENT_NAMES.map((n, k) => n[0] + ' ' + colony.balanceArr[k].toFixed(2)).join(' ')]);
      rows.push(['Stress', colony.stress.toFixed(2)]);
      if (colony.genome) rows.push(['Genom', geneSummary(colony.genome)]);
    }
    const img = this.sprites.dataURL('ant_' + def.key, 0);
    this.body.innerHTML =
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">'
      + '<img src="' + img + '" style="width:32px;height:32px;image-rendering:pixelated;'
      + 'filter:none;background:#10161a;border:1px solid #2b3439;border-radius:3px">'
      + '<div><b>' + def.name + '</b><br><span style="color:#8b9a95">' + def.role + '</span></div></div>'
      + '<table style="width:100%">'
      + rows.map(([k, v]) => '<tr><td style="color:#8b9a95;padding-right:6px">' + k + '</td><td>' + v + '</td></tr>').join('')
      + '</table>';
    this.panel.hidden = false;
  }

  /** Zellinfo anzeigen, wenn keine Einheit getroffen wurde. */
  selectCell(level, cell) {
    this.selected = -1;
    this.mode = 'cell';
    const t = level.cells[cell.y * level.w + cell.x];
    const defs = level.kind === LEVEL_KIND.SURFACE ? SURFACE_CELL_DEFS : NEST_CELL_DEFS;
    const d = defs[t];
    if (!d) { this.clear(); return; }
    let extra = '';
    if (level.kind === LEVEL_KIND.NEST && t === NEST_CELL.CHAMBER) {
      const cd = CHAMBER_DEFS[level.meta[cell.y * level.w + cell.x]];
      if (cd) extra = '<tr><td style="color:#8b9a95">Kammer</td><td>' + cd.name + '</td></tr>';
    }
    this.body.innerHTML = '<b>' + d.name + '</b><br><span style="color:#8b9a95">' + d.desc + '</span>'
      + '<table style="width:100%;margin-top:4px">'
      + '<tr><td style="color:#8b9a95">Ebene</td><td>' + level.name + '</td></tr>'
      + '<tr><td style="color:#8b9a95">Zelle</td><td>' + cell.x + ', ' + cell.y + '</td></tr>'
      + '<tr><td style="color:#8b9a95">Chunk</td><td>'
      + ((cell.x / WORLD.CHUNK) | 0) + ', ' + ((cell.y / WORLD.CHUNK) | 0) + '</td></tr>'
      + extra + '</table>';
    this.panel.hidden = false;
  }
}

function tr(k, v) {
  return '<tr><td style="color:#8b9a95;padding-right:6px">' + k + '</td><td>' + v + '</td></tr>';
}
