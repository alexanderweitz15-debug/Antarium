/**
 * toolbar.js – Spieler-Werkzeuge (Sandbox).
 *
 * Die Leiste ist ebenenabhaengig: an der Oberflaeche erscheinen Terrain- und
 * Koloniewerkzeuge, in einer Nest-Ebene Grab- und Bauwerkzeuge. Die Knoepfe
 * werden aus den Zelltyp-Tabellen erzeugt und tragen das echte Terrainbild
 * als Symbol – neue Zelltypen tauchen dadurch automatisch auf.
 *
 * Die Werkzeuge selbst aendern nichts direkt, sondern rufen Methoden von
 * World auf (paint, markDigOrders, spawnAntsAt, foundColony). Damit bleibt
 * die Simulation die einzige Stelle, die Weltzustand veraendert.
 */

import { TOOLS, CASTE_STATS, FOOD } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { SURFACE_CELL, SURFACE_CELL_DEFS } from '../sim/surface.js';
import { NEST_CELL, NEST_CELL_DEFS, CHAMBER, CHAMBER_DEFS } from '../sim/nest.js';
import { CASTE, CASTE_DEFS } from '../sim/castes.js';
import { cellSwatch } from './swatch.js';
import { bus, CAT } from '../sim/events.js';
import { SPECIES_LIST } from '../sim/creatures.js';

/**
 * Werkzeugtabelle.
 *  where : 'surface' | 'nest' | 'both'
 *  kind  : 'select' | 'paint' | 'order' | 'ants' | 'colony'
 */
export const TOOL_DEFS = [
  { key: 'select', name: 'Zeiger', kind: 'select', where: 'both',
    hint: 'Auswaehlen, Eingang anklicken, Karte ziehen' },

  // --- Oberflaeche: Terrain --------------------------------------------
  { key: 'grass', name: 'Gras', kind: 'paint', where: 'surface', cell: SURFACE_CELL.GRASS },
  { key: 'dirt', name: 'Erde', kind: 'paint', where: 'surface', cell: SURFACE_CELL.DIRT },
  { key: 'sand', name: 'Sand', kind: 'paint', where: 'surface', cell: SURFACE_CELL.SAND },
  { key: 'stone', name: 'Stein', kind: 'paint', where: 'surface', cell: SURFACE_CELL.STONE },
  { key: 'water', name: 'Wasser', kind: 'paint', where: 'surface', cell: SURFACE_CELL.WATER },
  { key: 'plant', name: 'Pflanze', kind: 'paint', where: 'surface', cell: SURFACE_CELL.PLANT },
  { key: 'flower', name: 'Bluete', kind: 'paint', where: 'surface', cell: SURFACE_CELL.FLOWER },
  { key: 'pebble', name: 'Kiesel', kind: 'paint', where: 'surface', cell: SURFACE_CELL.PEBBLE },
  { key: 'mound', name: 'Erdhuegel', kind: 'paint', where: 'surface', cell: SURFACE_CELL.MOUND },

  // --- Nest: graben und zuschuetten ------------------------------------
  { key: 'tunnel', name: 'Tunnel', kind: 'paint', where: 'nest', cell: NEST_CELL.TUNNEL,
    hint: 'Sofort graben (Goettlicher Eingriff)' },
  { key: 'soil', name: 'Erde', kind: 'paint', where: 'nest', cell: NEST_CELL.SOIL,
    hint: 'Zuschuetten' },
  { key: 'hardsoil', name: 'Harte Erde', kind: 'paint', where: 'nest', cell: NEST_CELL.HARD_SOIL },
  { key: 'neststone', name: 'Stein', kind: 'paint', where: 'nest', cell: NEST_CELL.STONE },
  { key: 'nestpebble', name: 'Kiesel', kind: 'paint', where: 'nest', cell: NEST_CELL.PEBBLE },
  { key: 'order', name: 'Bauauftrag', kind: 'order', where: 'nest',
    hint: 'Die Kolonie graebt diese Zellen selbst ab' },

  // --- Nahrung (nur Oberflaeche) ---------------------------------------
  { key: 'f_sugar', name: 'Zuckerwuerfel', kind: 'food', where: 'surface', cell: SURFACE_CELL.SUGARCUBE },
  { key: 'f_meat', name: 'Fleisch', kind: 'food', where: 'surface', cell: SURFACE_CELL.MEAT },
  { key: 'f_seeds', name: 'Samenhaufen', kind: 'food', where: 'surface', cell: SURFACE_CELL.SEEDPILE },
  { key: 'f_aphids', name: 'Blattlaeuse', kind: 'food', where: 'surface', cell: SURFACE_CELL.APHIDS },
  { key: 'f_fruit', name: 'Fallobst', kind: 'food', where: 'surface', cell: SURFACE_CELL.FRUIT },
  { key: 'f_carrion', name: 'Aas', kind: 'food', where: 'surface', cell: SURFACE_CELL.CARRION },

  // --- Mutagene ---------------------------------------------------------
  { key: 'm_fungus', name: 'Leuchtpilz', kind: 'paint', where: 'surface', cell: SURFACE_CELL.FUNGUS,
    hint: 'Mutagen: verdoppelt die Mutationsstaerke der naechsten Generation' },
  { key: 'm_berry', name: 'Giftbeere', kind: 'paint', where: 'surface', cell: SURFACE_CELL.BERRY,
    hint: 'Mutagen: Stress und Sprungmutationen hoch, kostet Trefferpunkte' },

  // --- Einheiten --------------------------------------------------------
  { key: 'ants', name: 'Ameisen', kind: 'ants', where: 'both',
    hint: 'Ameisen der gewaehlten Kolonie absetzen' },
  { key: 'colony', name: 'Kolonie gruenden', kind: 'colony', where: 'surface',
    hint: 'Neues Volk mit eigener Nest-Ebene' },
  { key: 'erase', name: 'Pheromon loeschen', kind: 'erase', where: 'surface',
    hint: 'Loescht alle Spuren der gewaehlten Kolonie im Pinselbereich' },

  // --- Kreaturen (aus der Artentabelle erzeugt) -------------------------
  ...SPECIES_LIST.map((sp) => ({
    key: 'c_' + sp.key, name: sp.name, kind: 'creature', where: 'surface',
    species: sp.key, hint: sp.desc,
  })),
];

/** Zelltyp -> Schluessel des Nahrungsprofils (fuer die Ablagemenge). */
const FOOD_KEY = {
  [SURFACE_CELL.SUGARCUBE]: 'sugarcube',
  [SURFACE_CELL.MEAT]: 'meat',
  [SURFACE_CELL.SEEDPILE]: 'seedpile',
  [SURFACE_CELL.APHIDS]: 'aphids',
  [SURFACE_CELL.FRUIT]: 'fruit',
  [SURFACE_CELL.CARRION]: 'carrion',
};

export class Toolbar {
  /**
   * @param {HTMLElement} el
   * @param {import('../sim/world.js').World} world
   * @param {import('../render/sprites.js').SpriteBank} sprites
   * @param {object} game Fassade aus main.js
   */
  constructor(el, world, sprites, game) {
    this.el = el;
    this.world = world;
    this.sprites = sprites;
    this.game = game;

    this.current = TOOL_DEFS[0];
    this.brush = TOOLS.BRUSH_DEFAULT;
    this.colonyId = 0;
    this.casteId = CASTE.WORKER;
    this.chamberType = CHAMBER.NONE;
    this.signature = '';
    this._buttons = new Map();
  }

  get isPaintTool() { return this.current.kind !== 'select'; }

  setTool(key) {
    const t = TOOL_DEFS.find((d) => d.key === key);
    if (!t) return;
    this.current = t;
    this._markActive();
  }

  setBrush(n) {
    this.brush = Math.max(TOOLS.BRUSH_MIN, Math.min(TOOLS.BRUSH_MAX, n | 0));
    const out = this.el.querySelector('#brush-val');
    if (out) out.textContent = String(this.brush);
  }

  /** Leiste neu aufbauen, wenn sich Ebene oder Kolonien geaendert haben. */
  refresh() {
    const level = this.world.levels.active;
    const where = level.kind === LEVEL_KIND.SURFACE ? 'surface' : 'nest';
    const sig = where + '|' + this.world.colonies.colonies.map((c) => c.id).join(',');
    if (sig === this.signature) { this._markActive(); return; }
    this.signature = sig;

    // Werkzeug passt nicht zur Ebene -> auf Zeiger zurueck
    if (this.current.where !== 'both' && this.current.where !== where) this.current = TOOL_DEFS[0];

    this.el.textContent = '';
    this._buttons.clear();

    const tools = TOOL_DEFS.filter((t) => t.where === 'both' || t.where === where);
    const groups = [
      ['Allgemein', tools.filter((t) => t.kind === 'select' || t.kind === 'erase')],
      [where === 'surface' ? 'Terrain' : 'Graben und Fuellen',
        tools.filter((t) => t.kind === 'paint' && !t.key.startsWith('m_'))],
      ['Nahrung', tools.filter((t) => t.kind === 'food')],
      ['Mutagene', tools.filter((t) => t.key.startsWith('m_'))],
      ['Bauen', tools.filter((t) => t.kind === 'order')],
      ['Einheiten', tools.filter((t) => t.kind === 'ants' || t.kind === 'colony')],
      ['Kreaturen', tools.filter((t) => t.kind === 'creature')],
    ];

    for (const [title, list] of groups) {
      if (!list.length) continue;
      this.el.appendChild(this._group(title, list, level));
    }

    this.el.appendChild(this._brushRow());
    this.el.appendChild(this._colonyRow());
    if (where === 'nest') this.el.appendChild(this._chamberRow());
    this._markActive();
  }

  _group(title, list, level) {
    const box = document.createElement('div');
    box.className = 'tool-group';
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'tool-grid';
    for (const t of list) {
      const b = document.createElement('button');
      b.className = 'tool';
      b.title = (t.hint || t.name) + '';
      if (t.kind === 'paint' || t.kind === 'food') {
        const defs = level.kind === LEVEL_KIND.SURFACE ? SURFACE_CELL_DEFS : NEST_CELL_DEFS;
        const def = defs[t.cell];
        b.innerHTML = '<img src="' + cellSwatch(level.kind, t.cell, 0) + '" alt="">'
          + '<span>' + t.name + '</span>';
        b.title = t.name + ' – ' + (t.hint || (def ? def.desc : ''));
      } else if (t.kind === 'creature') {
        b.innerHTML = '<img src="' + this.sprites.dataURL('creature_' + t.species, 0) + '" alt="">'
          + '<span>' + t.name + '</span>';
        b.title = t.name + ' – ' + t.hint;
      } else if (t.kind === 'erase') {
        b.innerHTML = '<span class="glyph">\u2298</span><span>' + t.name + '</span>';
        b.title = t.hint;
      } else if (t.kind === 'ants') {
        b.innerHTML = '<img src="' + this.sprites.dataURL('ant_worker', 0) + '" alt="">'
          + '<span>' + t.name + '</span>';
      } else if (t.kind === 'colony') {
        b.innerHTML = '<img src="' + this.sprites.dataURL('marker_entrance', 0) + '" alt="">'
          + '<span>' + t.name + '</span>';
      } else {
        b.innerHTML = '<span class="glyph">' + (t.kind === 'order' ? '⚑' : '↖') + '</span>'
          + '<span>' + t.name + '</span>';
      }
      b.addEventListener('click', () => this.setTool(t.key));
      grid.appendChild(b);
      this._buttons.set(t.key, b);
    }
    box.appendChild(grid);
    return box;
  }

  _brushRow() {
    const box = document.createElement('div');
    box.className = 'tool-group';
    box.innerHTML = '<h3>Pinsel</h3>';
    const row = document.createElement('div');
    row.className = 'tool-row';
    const minus = document.createElement('button');
    minus.className = 'btn tiny'; minus.textContent = '-';
    minus.title = 'Kleiner (Taste [ )';
    const val = document.createElement('span');
    val.id = 'brush-val'; val.className = 'brush-val'; val.textContent = String(this.brush);
    const plus = document.createElement('button');
    plus.className = 'btn tiny'; plus.textContent = '+';
    plus.title = 'Groesser (Taste ] oder Shift+Mausrad)';
    minus.addEventListener('click', () => this.setBrush(this.brush - 2));
    plus.addEventListener('click', () => this.setBrush(this.brush + 2));
    row.appendChild(minus); row.appendChild(val); row.appendChild(plus);
    const hint = document.createElement('div');
    hint.className = 'tool-hint';
    hint.textContent = 'Shift + Mausrad';
    box.appendChild(row);
    box.appendChild(hint);
    return box;
  }

  _colonyRow() {
    const box = document.createElement('div');
    box.className = 'tool-group';
    box.innerHTML = '<h3>Kolonie</h3>';
    const row = document.createElement('div');
    row.className = 'tool-row wrap';
    for (const c of this.world.colonies.colonies) {
      const b = document.createElement('button');
      b.className = 'swatch-btn' + (c.id === this.colonyId ? ' on' : '');
      b.style.background = c.colorCss;
      b.title = c.name + ' (' + c.total + ' Ameisen)';
      b.addEventListener('click', () => {
        this.colonyId = c.id;
        this.refreshColonyRow();
      });
      row.appendChild(b);
    }
    box.appendChild(row);

    const casteRow = document.createElement('div');
    casteRow.className = 'tool-row wrap';
    for (const def of CASTE_DEFS) {
      if (def.evolutionary) continue;               // erst ab Phase 8 verfuegbar
      if (def.id === CASTE.ALATE) continue;         // erst beim Hochzeitsflug
      const b = document.createElement('button');
      b.className = 'caste-btn' + (def.id === this.casteId ? ' on' : '');
      b.title = def.name + ' – ' + def.role + ' (Groesse ' + CASTE_STATS[def.key].size + ')';
      b.innerHTML = '<img src="' + this.sprites.dataURL('ant_' + def.key, 0) + '" alt="">';
      b.addEventListener('click', () => { this.casteId = def.id; this.refreshColonyRow(); });
      casteRow.appendChild(b);
    }
    box.appendChild(casteRow);
    this._colonyBox = box;
    return box;
  }

  _chamberRow() {
    const box = document.createElement('div');
    box.className = 'tool-group';
    box.innerHTML = '<h3>Kammertyp fuer Bauauftrag</h3>';
    const sel = document.createElement('select');
    sel.className = 'sel';
    for (const c of CHAMBER_DEFS) {
      const o = document.createElement('option');
      o.value = String(c.id);
      o.textContent = c.id === 0 ? 'Gang (keine Kammer)' : c.name;
      if (c.id === this.chamberType) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { this.chamberType = Number(sel.value); });
    box.appendChild(sel);
    return box;
  }

  refreshColonyRow() {
    this.signature = '';
    this.refresh();
  }

  _markActive() {
    for (const [key, btn] of this._buttons) btn.classList.toggle('on', key === this.current.key);
  }

  /**
   * Werkzeug an einer Zelle anwenden.
   * @param {{x:number,y:number}} cell
   * @param {boolean} dragging true, wenn gezogen wird (unterdrueckt Einmalaktionen)
   */
  apply(cell, dragging) {
    const world = this.world;
    const level = world.levels.active;
    const t = this.current;
    if (!level.inBounds(cell.x, cell.y)) return false;

    switch (t.kind) {
      case 'paint': {
        const n = world.paint(level, cell.x, cell.y, this.brush, t.cell, 0);
        return n > 0;
      }
      case 'food': {
        const key = FOOD_KEY[t.cell];
        const amount = key ? FOOD.PROFILES[key].max : 100;
        const n = world.placeFood(level, cell.x, cell.y, this.brush, t.cell, amount);
        if (n > 0 && !dragging) {
          bus.logEvent(CAT.ERNAEHRUNG, n + 'x ' + t.name + ' abgelegt', {
            tick: world.tick, levelId: level.id, x: cell.x, y: cell.y,
          });
        }
        return n > 0;
      }
      case 'creature': {
        if (dragging) return false;
        const n = world.spawnCreaturesAt(t.species, level, cell.x, cell.y,
          Math.max(1, Math.round(this.brush / 3)));
        bus.logEvent(CAT.RAEUBER, n + 'x ' + t.name + ' gespawnt', {
          tick: world.tick, levelId: level.id, x: cell.x, y: cell.y,
        });
        return n > 0;
      }
      case 'erase': {
        if (!world.phero) return false;
        world.phero.erase(this.colonyId, cell.x, cell.y, this.brush);
        return true;
      }
      case 'order': {
        const colony = world.colonies.get(level.colonyId);
        if (!colony) return false;
        const n = world.markDigOrders(colony, level, cell.x, cell.y, this.brush, this.chamberType);
        if (n > 0 && !dragging) {
          bus.logEvent(CAT.BAU, n + ' Zellen als Baustelle markiert', {
            tick: world.tick, levelId: level.id, x: cell.x, y: cell.y, colonyId: colony.id,
          });
        }
        return n > 0;
      }
      case 'ants': {
        if (dragging) return false;
        const n = world.spawnAntsAt(this.colonyId, level, cell.x, cell.y, TOOLS.SPAWN_ANTS, this.casteId);
        const colony = world.colonies.get(this.colonyId);
        bus.logEvent(CAT.SYS, n + ' ' + CASTE_DEFS[this.casteId].name + ' fuer '
          + (colony ? colony.name : '?') + ' abgesetzt', {
          tick: world.tick, levelId: level.id, x: cell.x, y: cell.y, colonyId: this.colonyId,
        });
        return n > 0;
      }
      case 'colony': {
        if (dragging) return false;
        if (level.kind !== LEVEL_KIND.SURFACE) return false;
        const colony = world.foundColony({ x: cell.x, y: cell.y }, TOOLS.FOUND_ANTS);
        if (!colony) {
          bus.logEvent(CAT.SYS, 'Keine weitere Kolonie moeglich (Obergrenze erreicht)', { tick: world.tick });
          return false;
        }
        this.colonyId = colony.id;
        this.game.onColonyFounded(colony);
        this.signature = '';
        return true;
      }
      default:
        return false;
    }
  }
}
