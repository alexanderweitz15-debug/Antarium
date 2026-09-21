/**
 * legend.js – Kontextabhaengige, vollstaendig datengetriebene Legende.
 *
 * Die Eintraege werden NICHT im HTML verdrahtet, sondern aus denselben
 * Tabellen erzeugt, die auch Simulation und Renderer benutzen:
 *   - Zelltypen der aktiven Ebene (SURFACE_CELL_DEFS / NEST_CELL_DEFS)
 *   - Kammertypen (CHAMBER_DEFS)
 *   - Kolonien (Farbe + Name)
 *   - Kasten (Sprite + Name + Rolle, nur bereits aufgetretene)
 * Neue Kasten oder Kolonien erscheinen dadurch automatisch.
 *
 * Die Farbfelder werden mit DEM GLEICHEN Maler erzeugt, der auch das Terrain
 * zeichnet – was in der Legende steht, sieht also aus wie im Spiel.
 */

import { LEVEL_KIND } from '../sim/levels.js';
import { SURFACE_CELL_DEFS } from '../sim/surface.js';
import { NEST_CELL_DEFS, NEST_CELL, CHAMBER_DEFS } from '../sim/nest.js';
import { CASTE_DEFS } from '../sim/castes.js';
import { SPECIES_LIST } from '../sim/creatures.js';
import { STAGE_NAMES } from '../sim/brood.js';
import { NUTRIENT_NAMES } from '../config.js';
import { cellSwatch } from './swatch.js';

export class Legend {
  /**
   * @param {HTMLElement} el
   * @param {HTMLInputElement} visibleOnlyEl
   * @param {import('../render/sprites.js').SpriteBank} sprites
   */
  constructor(el, visibleOnlyEl, sprites) {
    this.el = el;
    this.sprites = sprites;
    this.visibleOnly = visibleOnlyEl;
    this.signature = '';
    if (this.visibleOnly) this.visibleOnly.addEventListener('change', () => { this.signature = ''; });
  }

  /**
   * @param {import('../sim/world.js').World} world
   * @param {{x0:number,y0:number,x1:number,y1:number}} visibleRect Zellbereich
   */
  refresh(world, visibleRect) {
    const level = world.levels.active;
    const onlyVisible = this.visibleOnly && this.visibleOnly.checked;
    const present = onlyVisible ? censusCells(level, visibleRect) : null;
    const castes = collectCastes(world);
    const sig = [
      level.id, onlyVisible ? 1 : 0,
      present ? [...present].sort().join(',') : 'all',
      world.colonies.colonies.map((c) => c.id + c.name + c.total).join(','),
      [...castes].sort().join(','),
      [...world.creatureCensus].join(','),
    ].join('|');
    if (sig === this.signature) return;
    this.signature = sig;

    const frag = document.createDocumentFragment();
    const isSurface = level.kind === LEVEL_KIND.SURFACE;
    const defs = isSurface ? SURFACE_CELL_DEFS : NEST_CELL_DEFS;

    // --- Terrain und Strukturen der aktiven Ebene -------------------------
    const byCat = new Map();
    for (const d of defs) {
      if (present && !present.has(d.id)) continue;
      const cat = d.category || 'terrain';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(d);
    }
    const catTitle = {
      terrain: isSurface ? 'Oberflaeche – Terrain' : 'Nest – Terrain',
      struktur: 'Strukturen',
      kammer: 'Kammern',
      nahrung: 'Nahrungsquellen',
      mutagen: 'Mutagene',
      kreatur: 'Bauten der Kreaturen',
    };
    for (const [cat, list] of byCat) {
      frag.appendChild(this._category(catTitle[cat] || cat, list.map((d) => ({
        swatch: this._cellSwatch(level, d.id, 0),
        name: d.name,
        desc: d.desc,
      }))));
    }

    // --- Kammertypen (nur im Nest) ---------------------------------------
    if (!isSurface) {
      const chambers = CHAMBER_DEFS.filter((c) => c.id !== 0)
        .filter((c) => !present || present.has(NEST_CELL.CHAMBER));
      if (chambers.length) {
        frag.appendChild(this._category('Kammertypen', chambers.map((c) => ({
          swatch: this._cellSwatch(level, NEST_CELL.CHAMBER, c.id),
          name: c.name,
          desc: c.desc,
        }))));
      }
    }

    // --- Kolonien ---------------------------------------------------------
    frag.appendChild(this._category('Kolonien', world.colonies.colonies.map((c) => ({
      color: c.colorCss,
      name: c.name,
      desc: c.total + ' Ameisen, ' + c.nestLevelIds.length + ' Nest-Ebene(n)',
    }))));

    // --- Brut (nur im Nest) -----------------------------------------------
    if (!isSurface) {
      frag.appendChild(this._category('Brut', ['egg', 'larva', 'pupa'].map((k, i) => ({
        img: this.sprites.dataURL('brood_' + k, 0),
        name: STAGE_NAMES[i],
        desc: i === 0 ? 'Reift von selbst.'
          : (i === 1 ? 'Muss mit Protein gefuettert werden.' : 'Reift zur Ameise heran.'),
      }))));
    }

    // --- Kreaturen ---------------------------------------------------------
    const cen = world.creatureCensus;
    const creatures = SPECIES_LIST.filter((sp) => cen[sp.id] > 0).map((sp) => ({
      img: this.sprites.dataURL('creature_' + sp.key, 0),
      name: sp.name + ' (' + cen[sp.id] + ')',
      desc: sp.desc,
    }));
    if (creatures.length) frag.appendChild(this._category('Kreaturen', creatures));

    // --- Naehrstoffe --------------------------------------------------------
    frag.appendChild(this._category('Naehrstoffe', NUTRIENT_NAMES.map((n, i) => ({
      color: '#' + [0xe8c246, 0xd1543f, 0xd8c9a3][i].toString(16).padStart(6, '0'),
      name: n,
      desc: [
        'Energie der Erwachsenen. Balken rot = Mangel, gruen = gedeckt, blau = Ueberschuss.',
        'Wachstum der Brut und Eierproduktion.',
        'Reserven, Lebensdauer, Ueberleben in Mangelzeiten.',
      ][i],
    }))));

    // --- Kasten (nur bereits aufgetretene) --------------------------------
    const casteItems = CASTE_DEFS.filter((c) => castes.has(c.id)).map((c) => ({
      img: this.sprites.dataURL('ant_' + c.key, 0),
      name: c.name + (c.evolutionary ? ' *' : ''),
      desc: c.role + (c.evolutionary ? ' (evolutionaere Kaste)' : ''),
      evo: c.evolutionary,
    }));
    if (casteItems.length) frag.appendChild(this._category('Kasten', casteItems));

    this.el.textContent = '';
    this.el.appendChild(frag);
  }

  _category(title, items) {
    const box = document.createElement('div');
    box.className = 'legend-cat';
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'legend-item';
      const sw = document.createElement(it.img || it.swatch ? 'img' : 'div');
      sw.className = 'legend-swatch';
      if (it.img || it.swatch) sw.src = it.img || it.swatch;
      else sw.style.background = it.color;
      row.appendChild(sw);
      const txt = document.createElement('div');
      txt.className = 'legend-text' + (it.evo ? ' legend-evo' : '');
      txt.innerHTML = '<b>' + esc(it.name) + '</b><br><span>' + esc(it.desc) + '</span>';
      row.appendChild(txt);
      box.appendChild(row);
    }
    return box;
  }

  /** Farbfeld eines Zelltyps – gezeichnet vom echten Terrain-Maler. */
  _cellSwatch(level, cellId, meta) {
    return cellSwatch(level.kind, cellId, meta || 0);
  }
}

/** Welche Zelltypen kommen im sichtbaren Ausschnitt vor? */
function censusCells(level, r) {
  const set = new Set();
  const x0 = Math.max(0, Math.floor(r.x0)), x1 = Math.min(level.w - 1, Math.ceil(r.x1));
  const y0 = Math.max(0, Math.floor(r.y0)), y1 = Math.min(level.h - 1, Math.ceil(r.y1));
  for (let y = y0; y <= y1; y++) {
    const row = y * level.w;
    for (let x = x0; x <= x1; x++) set.add(level.cells[row + x]);
  }
  return set;
}

/** Kasten, die in der Welt tatsaechlich vorkommen. */
function collectCastes(world) {
  const set = new Set();
  for (const c of world.colonies.colonies) for (const id of c.knownCastes) set.add(id);
  return set;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
