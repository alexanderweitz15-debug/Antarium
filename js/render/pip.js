/**
 * pip.js – Bild-in-Bild: bis zu zwei kleine Fenster, die eine ANDERE Ebene
 * zeigen als die Hauptansicht.
 *
 * Aufbau als Zwitter: Der RAHMEN ist ein DOM-Element (verschiebbar,
 * anklickbar, mit Auswahlfeld fuer die Ebene), der INHALT wird von PixiJS
 * gezeichnet – mit denselben Chunk-Texturen und demselben Sprite-Atlas wie
 * die Hauptansicht. Dadurch sieht das Fenster aus wie das Spiel und nicht
 * wie eine Schemazeichnung, ohne dass eine zweite Szene noetig waere.
 *
 * Die Pixi-Container liegen in hudRoot (Bildschirmkoordinaten) und werden
 * per Maske auf den Fensterausschnitt beschnitten.
 */

import { PIXI } from './pixi.js';
import { WORLD, RENDER } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { ANT_STATE } from '../sim/ants.js';
import { CASTE_DEFS } from '../sim/castes.js';

/** Chunks pro Frame und Fenster, die fuer eine fremde Ebene nachgezeichnet werden. */
const PIP_FLUSH_PER_FRAME = 2;

export class PipView {
  /**
   * @param {import('./renderer.js').Renderer} renderer
   * @param {import('../sim/world.js').World} world
   * @param {HTMLElement} host DOM-Container fuer die Rahmen
   * @param {object} game
   */
  constructor(renderer, world, host, game) {
    this.renderer = renderer;
    this.world = world;
    this.host = host;
    this.game = game;
    /** @type {Array} bis zu zwei Fenster */
    this.windows = [];
    this.frame = 0;
  }

  get count() { return this.windows.length; }

  /** Neues Fenster oeffnen (oder das vorhandene auf eine Ebene setzen). */
  open(levelId, focus) {
    if (this.windows.length >= 2) {
      this.setLevel(0, levelId, focus);
      return this.windows[0];
    }
    const idx = this.windows.length;
    const el = document.createElement('div');
    el.className = 'pip';
    el.style.left = (214 + idx * 20) + 'px';
    el.style.top = (48 + idx * 172) + 'px';
    el.innerHTML = '<header><select class="sel pip-level"></select>'
      + '<button class="btn tiny pip-main" title="Zur Hauptansicht machen">⇱</button>'
      + '<button class="btn tiny pip-close" title="Schliessen">x</button></header>'
      + '<div class="pip-body"></div>';
    this.host.appendChild(el);

    const container = new PIXI.Container();
    const mask = new PIXI.Graphics();
    container.mask = mask;
    const terrain = new PIXI.Container();
    const dots = new PIXI.Graphics();
    container.addChild(terrain, dots);
    this.renderer.hudRoot.addChild(container, mask);

    const win = {
      el, container, mask, terrain, dots,
      levelId, zoom: 1, focus: focus || this._defaultFocus(levelId),
      chunks: [], rect: { x: 0, y: 0, w: 260, h: 160 },
    };
    this.windows.push(win);

    // --- Interaktion -------------------------------------------------------
    const sel = el.querySelector('.pip-level');
    this._fillSelect(sel, levelId);
    sel.addEventListener('change', () => this.setLevel(this.windows.indexOf(win), Number(sel.value)));
    el.querySelector('.pip-close').addEventListener('click', () => this.close(win));
    el.querySelector('.pip-main').addEventListener('click', () => {
      const id = win.levelId;
      const f = win.focus;
      this.close(win);
      this.game.gotoLevel(id, f);
    });
    // Verschieben am Kopf
    const head = el.querySelector('header');
    let dragging = false, ox = 0, oy = 0;
    head.addEventListener('pointerdown', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'SELECT') return;
      dragging = true;
      ox = e.clientX - el.offsetLeft;
      oy = e.clientY - el.offsetTop;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      el.style.left = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - ox)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy)) + 'px';
    });
    head.addEventListener('pointerup', () => { dragging = false; });
    // Zoomen im Fenster
    el.querySelector('.pip-body').addEventListener('wheel', (e) => {
      e.preventDefault();
      win.zoom = Math.max(0.2, Math.min(6, win.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
    }, { passive: false });

    this._buildChunks(win);
    return win;
  }

  /**
   * Sinnvoller Bildausschnitt ohne Vorgabe: der erste Durchgang der Ebene
   * (bei Nestern die Koenigin-Gegend), sonst die Mitte. Die reine Mitte einer
   * Nest-Ebene ist meistens nur Fels und sieht aus wie ein Fehler.
   */
  _defaultFocus(levelId) {
    for (const p of this.world.portals.portals) {
      const s = p.on(levelId);
      if (s) return { x: s.x, y: s.y + (p.bLevelId === levelId ? 14 : 0) };
    }
    const lvl = this.world.levels.get(levelId);
    return lvl ? { x: lvl.w / 2, y: lvl.h / 2 } : null;
  }

  _fillSelect(sel, levelId) {
    sel.textContent = '';
    for (const lvl of this.world.levels.levels) {
      const o = document.createElement('option');
      o.value = String(lvl.id);
      o.textContent = lvl.name;
      if (lvl.id === levelId) o.selected = true;
      sel.appendChild(o);
    }
  }

  setLevel(index, levelId, focus) {
    const win = this.windows[index];
    if (!win) return;
    win.levelId = levelId;
    win.focus = focus || this._defaultFocus(levelId);
    const sel = win.el.querySelector('.pip-level');
    this._fillSelect(sel, levelId);
    this._buildChunks(win);
  }

  close(win) {
    const i = this.windows.indexOf(win);
    if (i < 0) return;
    this.windows.splice(i, 1);
    win.el.remove();
    win.container.destroy({ children: true });
    win.mask.destroy();
  }

  closeAll() { while (this.windows.length) this.close(this.windows[0]); }

  /** Chunk-Sprites anlegen, die dieselben Texturen wie die Hauptansicht nutzen. */
  _buildChunks(win) {
    win.terrain.removeChildren();
    win.chunks.length = 0;
    const view = this.renderer.levelViews.get(win.levelId);
    if (!view) return;
    // Wichtig: Chunk-Texturen fremder Ebenen wurden nie gezeichnet, weil
    // flushDirty sonst nur fuer die aktive Ebene laeuft. Einmal komplett
    // nachziehen, sonst bleibt das Fenster schwarz.
    const level = this.world.levels.get(win.levelId);
    if (level) this.renderer.flushDirty(level, level.chunkCount, true);
    for (const c of view.chunks) {
      const s = new PIXI.Sprite(c.texture);
      s.position.set(c.cx0 * WORLD.CELL_SIZE, c.cy0 * WORLD.CELL_SIZE);
      s.scale.set(WORLD.CELL_SIZE / WORLD.CELL_PX);
      win.terrain.addChild(s);
      win.chunks.push(s);
    }
  }

  /** Jeden Frame: Position, Ausschnitt und Einheiten aktualisieren. */
  update() {
    this.frame++;
    for (const win of this.windows) {
      const body = win.el.querySelector('.pip-body');
      const r = body.getBoundingClientRect();
      win.rect.x = r.left; win.rect.y = r.top; win.rect.w = r.width; win.rect.h = r.height;

      // Maske auf den Fensterausschnitt
      win.mask.clear();
      win.mask.rect(r.left, r.top, r.width, r.height).fill(0xffffff);

      const level = this.world.levels.get(win.levelId);
      if (!level) continue;
      // Laufend nachziehen: das Fenster zeigt eine Ebene, die die
      // Hauptansicht nicht aktualisiert (Graben, Einsturz, Kampf).
      if (level.id !== this.world.levels.activeId) this.renderer.flushDirty(level, PIP_FLUSH_PER_FRAME, true);

      // Zielpunkt: gemerkter Fokus, sonst die Mitte der Ebene
      const fx = win.focus ? win.focus.x : level.w / 2;
      const fy = win.focus ? win.focus.y : level.h / 2;
      const z = win.zoom;
      win.container.scale.set(z);
      win.container.position.set(
        r.left + r.width / 2 - fx * WORLD.CELL_SIZE * z,
        r.top + r.height / 2 - fy * WORLD.CELL_SIZE * z,
      );

      // Einheiten als kleine Punkte – alle drei Frames reicht
      if (this.frame % 3 !== 0) continue;
      const g = win.dots;
      g.clear();
      const ants = this.world.ants;
      const b = ants.buckets.get(level.id);
      const size = Math.max(1.2, RENDER.ANT_CELLS * WORLD.CELL_SIZE * 0.6);
      if (b) {
        for (let k = 0; k < b.count; k++) {
          const i = b.ids[k];
          if (ants.state[i] === ANT_STATE.TRANSIT) continue;
          const colony = this.world.colonies.get(ants.colony[i]);
          const fighting = ants.state[i] === ANT_STATE.ATTACK || ants.state[i] === ANT_STATE.RAID;
          const s = size * (ants.caste[i] === 0 ? 2.2 : 1);
          g.rect(ants.x[i] * WORLD.CELL_SIZE - s / 2, ants.y[i] * WORLD.CELL_SIZE - s / 2, s, s)
            .fill(fighting ? 0xff4d3d : (colony ? colony.color : 0xffffff));
        }
      }
      const cb = this.world.creatures.buckets.get(level.id);
      if (cb) {
        for (let k = 0; k < cb.count; k++) {
          const i = cb.ids[k];
          const s = size * 1.6;
          g.rect(this.world.creatures.x[i] * WORLD.CELL_SIZE - s / 2,
            this.world.creatures.y[i] * WORLD.CELL_SIZE - s / 2, s, s)
            .fill(this.world.creatures.speciesDef(i).color);
        }
      }
      void LEVEL_KIND; void CASTE_DEFS;
    }
  }

  /** Beim Anlegen einer neuen Ebene die Auswahlfelder auffrischen. */
  refreshLevels() {
    for (const win of this.windows) {
      this._fillSelect(win.el.querySelector('.pip-level'), win.levelId);
    }
  }
}
