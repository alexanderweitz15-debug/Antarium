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
import { ANT_STATE_LABEL } from '../sim/ants.js';

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
  hover(screenX, screenY, cell, antIndex) {
    const level = this.world.levels.active;
    if (!level || (cell.x < 0 || cell.y < 0 || cell.x >= level.w || cell.y >= level.h)) {
      this.tip.hidden = true;
      return;
    }
    const key = level.id + ':' + cell.x + ':' + cell.y + ':' + antIndex;
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
    if (antIndex >= 0) {
      const a = this.world.ants;
      const def = casteDef(a.caste[antIndex]);
      const colony = this.world.colonies.get(a.colony[antIndex]);
      parts.push('<b>' + def.name + '</b> <span class="sub">' + (colony ? colony.name : '?') + '</span>');
      parts.push('<span class="sub">' + (ANT_STATE_LABEL[a.state[antIndex]] || '?')
        + ' · HP ' + a.hp[antIndex].toFixed(1) + '/' + a.hpMax[antIndex].toFixed(1) + '</span>');
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
      ['Phaenotyp', 'Groesse ' + a.phenoSize[i].toFixed(2) + ' · Tempo ' + a.phenoSpeed[i].toFixed(2)],
      ['Slot', '#' + i],
    ];
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
