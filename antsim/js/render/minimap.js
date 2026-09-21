/**
 * minimap.js – Uebersichtskarte der aktiven Ebene.
 *
 * Bewusst KEIN PixiJS: die Minikarte ist ein eigenes 2D-Canvas, das alle
 * paar Frames neu gezeichnet wird. Das ist deutlich billiger als eine
 * zweite Szene und reicht fuer eine Uebersicht voellig aus.
 *
 * Inhalt:
 *   Oberflaeche – Terrain, Nester als farbige Symbole mit Bedrohungsstufe,
 *                 Kaempfe als pulsierende Punkte, Raeuber als Warnzeichen
 *   Nest        – Kammern nach Typ eingefaerbt, Feinde rot, Koenigin markiert
 * Klick springt dorthin, der Sichtausschnitt wird als Rahmen gezeigt.
 */

import { WORLD } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { SURFACE_CELL_DEFS } from '../sim/surface.js';
import { NEST_CELL, NEST_CELL_DEFS, CHAMBER_DEFS } from '../sim/nest.js';
import { CASTE } from '../sim/castes.js';
import { ANT_STATE } from '../sim/ants.js';

/** Vorberechnete Grundfarben je Zelltyp als "r,g,b". */
function paletteOf(defs) {
  const p = new Uint8Array(defs.length * 3);
  for (const d of defs) {
    p[d.id * 3] = (d.color >> 16) & 0xff;
    p[d.id * 3 + 1] = (d.color >> 8) & 0xff;
    p[d.id * 3 + 2] = d.color & 0xff;
  }
  return p;
}
const SURFACE_PAL = paletteOf(SURFACE_CELL_DEFS);
const NEST_PAL = paletteOf(NEST_CELL_DEFS);
const CHAMBER_PAL = paletteOf(CHAMBER_DEFS);

export class Minimap {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../sim/world.js').World} world
   * @param {import('./camera.js').Camera} camera
   * @param {object} game
   */
  constructor(canvas, world, camera, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.camera = camera;
    this.game = game;
    this.timer = 0;
    this.levelId = -1;
    this.scale = 1;
    this.offX = 0;
    this.offY = 0;

    canvas.addEventListener('pointerdown', (e) => this._click(e));
    canvas.addEventListener('pointermove', (e) => { if (e.buttons & 1) this._click(e); });
  }

  _click(e) {
    const r = this.canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left - this.offX) / this.scale;
    const cy = (e.clientY - r.top - this.offY) / this.scale;
    const level = this.world.levels.active;
    if (!level) return;
    this.camera.focusCell(
      Math.max(0, Math.min(level.w - 1, cx | 0)),
      Math.max(0, Math.min(level.h - 1, cy | 0)),
    );
    this.camera.followAnt = -1;
  }

  /** Alle paar Frames neu zeichnen. */
  render(dtMs) {
    this.timer -= dtMs;
    if (this.timer > 0) return;
    this.timer = 200;
    const level = this.world.levels.active;
    if (!level) return;

    const W = this.canvas.width, H = this.canvas.height;
    const scale = Math.min(W / level.w, H / level.h);
    this.scale = scale;
    this.offX = (W - level.w * scale) / 2;
    this.offY = (H - level.h * scale) / 2;

    const ctx = this.ctx;
    ctx.fillStyle = '#0b0d0c';
    ctx.fillRect(0, 0, W, H);

    // --- Terrain als ImageData in Zellaufloesung ---------------------------
    if (!this._img || this._img.width !== level.w || this._img.height !== level.h) {
      this._img = ctx.createImageData(level.w, level.h);
      this._buf = new Uint32Array(this._img.data.buffer);
      this._tmp = document.createElement('canvas');
      this._tmp.width = level.w;
      this._tmp.height = level.h;
      this._tmpCtx = this._tmp.getContext('2d');
    }
    const buf = this._buf;
    const isSurface = level.kind === LEVEL_KIND.SURFACE;
    const pal = isSurface ? SURFACE_PAL : NEST_PAL;
    const cells = level.cells, meta = level.meta;
    for (let i = 0; i < cells.length; i++) {
      const t = cells[i];
      let r, g, b;
      if (!isSurface && t === NEST_CELL.CHAMBER) {
        const m = meta[i] * 3;
        r = CHAMBER_PAL[m]; g = CHAMBER_PAL[m + 1]; b = CHAMBER_PAL[m + 2];
      } else {
        const o = t * 3;
        r = pal[o]; g = pal[o + 1]; b = pal[o + 2];
      }
      buf[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
    this._tmpCtx.putImageData(this._img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._tmp, this.offX, this.offY, level.w * scale, level.h * scale);

    // --- Einheiten ---------------------------------------------------------
    const ants = this.world.ants;
    const b2 = ants.buckets.get(level.id);
    if (b2) {
      const dot = Math.max(1, scale * 1.4);
      for (let k = 0; k < b2.count; k++) {
        const i = b2.ids[k];
        if (ants.state[i] === ANT_STATE.TRANSIT) continue;
        const colony = this.world.colonies.get(ants.colony[i]);
        const fighting = ants.state[i] === ANT_STATE.ATTACK || ants.state[i] === ANT_STATE.RAID;
        ctx.fillStyle = fighting ? '#ff4d3d' : (colony ? colony.colorCss : '#fff');
        const px = this.offX + ants.x[i] * scale;
        const py = this.offY + ants.y[i] * scale;
        ctx.fillRect(px, py, ants.caste[i] === CASTE.QUEEN ? dot * 3 : dot, dot);
      }
    }
    // Kreaturen als helle Punkte
    const cb = this.world.creatures.buckets.get(level.id);
    if (cb) {
      ctx.fillStyle = '#e8e2c8';
      for (let k = 0; k < cb.count; k++) {
        const i = cb.ids[k];
        ctx.fillRect(this.offX + this.world.creatures.x[i] * scale,
          this.offY + this.world.creatures.y[i] * scale,
          Math.max(1.5, scale * 2), Math.max(1.5, scale * 2));
      }
    }

    // --- Nesteingaenge mit Bedrohungsstufe ---------------------------------
    for (const p of this.world.portals.portals) {
      const pos = p.on(level.id);
      if (!pos) continue;
      const colony = this.world.colonies.get(p.colonyId);
      const px = this.offX + pos.x * scale;
      const py = this.offY + pos.y * scale;
      ctx.fillStyle = colony ? colony.colorCss : '#888';
      ctx.fillRect(px - 2, py - 2, 5, 5);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 2.5, py - 2.5, 6, 6);
      if (colony && colony.threat > 0) {
        ctx.fillStyle = ['', '#e8c246', '#e08a33', '#ff4d3d'][colony.threat];
        ctx.fillRect(px - 4, py - 6, 2, 2);
      }
    }

    // --- Sichtausschnitt ----------------------------------------------------
    const vis = this.camera.visibleCells(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      this.offX + vis.x0 * scale, this.offY + vis.y0 * scale,
      (vis.x1 - vis.x0) * scale, (vis.y1 - vis.y0) * scale,
    );
    void WORLD;
  }
}
