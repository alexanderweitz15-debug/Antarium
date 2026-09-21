/**
 * renderer.js – PixiJS-Anbindung.
 *
 * Aufbau des Szenengraphen:
 *   stage
 *     worldRoot            <- traegt die Kameratransformation
 *       terrainRoot        <- ein Container pro Ebene, nur der aktive sichtbar
 *       markerRoot         <- Nesteingaenge der aktiven Ebene
 *       entityRoot         <- Sprite-Pool fuer Einheiten (ein Atlas = ein Batch)
 *       debugRoot          <- Chunk-Raster (F3-Overlay)
 *     hudRoot              <- Bildschirmkoordinaten (Uebergangsblende)
 *
 * Terrain liegt in Chunks von WORLD.CHUNK Zellen Kantenlaenge. Jeder Chunk ist
 * eine eigene Textur; nur als dirty markierte Chunks werden neu gezeichnet und
 * hochgeladen. Unsichtbare Ebenen sammeln ihre dirty Chunks und laden beim
 * Wechsel alles auf einmal hoch.
 */

import { PIXI } from './pixi.js';
import { WORLD, RENDER } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { paintSurfaceChunk } from './surfaceView.js';
import { paintNestChunk } from './nestView.js';
import { CASTE_DEFS } from '../sim/castes.js';
import { ANT_STATE } from '../sim/ants.js';

export class Renderer {
  /**
   * @param {import('../sim/world.js').World} world
   * @param {import('./sprites.js').SpriteBank} sprites
   * @param {import('./camera.js').Camera} camera
   */
  constructor(world, sprites, camera) {
    this.world = world;
    this.sprites = sprites;
    this.camera = camera;
    this.app = null;

    /** @type {Map<number, {container:any, chunks:Array}>} */
    this.levelViews = new Map();
    /** Wiederverwendbare Pixelpuffer je Chunkgroesse. */
    this.scratch = new Map();

    this.entityPool = [];
    this.markerPool = [];
    this.selectSprite = null;

    /** Kennzahlen fuers Performance-Overlay. */
    this.stats = { chunkUploads: 0, chunkUploadsTotal: 0, visibleAnts: 0, drawnMarkers: 0, paintMs: 0, frameMs: 0, drawMs: 0 };
    this.showChunkGrid = false;

    this._casteTex = [];
    this._casteScale = new Float32Array(CASTE_DEFS.length);
    this._colonyColor = new Uint32Array(16).fill(0xffffff);
    this._vis = { x0: 0, y0: 0, x1: 0, y1: 0 };
  }

  async init(canvas) {
    this.app = new PIXI.Application();
    await this.app.init({
      canvas,
      width: canvas.clientWidth || window.innerWidth,
      height: canvas.clientHeight || window.innerHeight,
      background: RENDER.BACKGROUND,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      powerPreference: 'high-performance',
    });
    // Wir treiben den Tick selbst (main.js); Pixi rendert nur.
    this.app.ticker.autoStart = false;
    this.app.ticker.stop();

    const stage = this.app.stage;
    this.worldRoot = new PIXI.Container();
    this.terrainRoot = new PIXI.Container();
    this.markerRoot = new PIXI.Container();
    this.entityRoot = new PIXI.Container();
    this.debugRoot = new PIXI.Container();
    this.hudRoot = new PIXI.Container();
    this.worldRoot.addChild(this.terrainRoot, this.markerRoot, this.entityRoot, this.debugRoot);
    stage.addChild(this.worldRoot, this.hudRoot);

    // Kastenbezogene Texturen und Groessen einmalig aufloesen.
    // drawAnt() normiert den Koerper (ohne Beine) auf 70 % der Zellbreite.
    const bodyPx = this.sprites.cell * 0.70;
    const baseScale = (RENDER.ANT_CELLS * WORLD.CELL_SIZE) / bodyPx;
    for (const c of CASTE_DEFS) {
      const entry = this.sprites.caste(c.key);
      this._casteTex[c.id] = entry ? entry.textures : null;
      // Unterlinear: eine Koenigin (size 4) soll deutlich groesser wirken,
      // aber nicht den halben Tunnel fuellen.
      this._casteScale[c.id] = baseScale * Math.pow(c.size, RENDER.SIZE_EXPONENT);
    }

    this.selectSprite = new PIXI.Sprite(this.sprites.get('marker_select').textures[0]);
    this.selectSprite.anchor.set(0.5);
    this.selectSprite.visible = false;
    this.markerRoot.addChild(this.selectSprite);

    // Blende fuer den Ebenenuebergang (Bildschirmkoordinaten).
    this.fade = new PIXI.Graphics();
    this.fade.alpha = 0;
    this.hudRoot.addChild(this.fade);
    this._drawFade();

    this.resize(this.app.renderer.width, this.app.renderer.height);
    return this;
  }

  _drawFade() {
    const w = this.app.renderer.width, h = this.app.renderer.height;
    this.fade.clear();
    this.fade.rect(0, 0, w, h).fill(0x000000);
  }

  resize(w, h) {
    if (!this.app) return;
    this.app.renderer.resize(w, h);
    this.camera.resize(w, h);
    this.camera.clamp();
    this._drawFade();
  }

  /** Container und Chunk-Sprites fuer eine Ebene anlegen. */
  addLevel(level) {
    if (this.levelViews.has(level.id)) return;
    const container = new PIXI.Container();
    container.visible = false;
    const chunks = [];
    const scale = WORLD.CELL_SIZE / WORLD.CELL_PX;

    for (let cy = 0; cy < level.chunkRows; cy++) {
      for (let cx = 0; cx < level.chunkCols; cx++) {
        const cx0 = cx * level.chunkSize;
        const cy0 = cy * level.chunkSize;
        const cw = Math.min(level.chunkSize, level.w - cx0);
        const ch = Math.min(level.chunkSize, level.h - cy0);
        const canvas = document.createElement('canvas');
        canvas.width = cw * WORLD.CELL_PX;
        canvas.height = ch * WORLD.CELL_PX;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        const texture = PIXI.Texture.from(canvas);
        texture.source.scaleMode = 'nearest';
        const sprite = new PIXI.Sprite(texture);
        sprite.position.set(cx0 * WORLD.CELL_SIZE, cy0 * WORLD.CELL_SIZE);
        sprite.scale.set(scale);
        container.addChild(sprite);
        chunks.push({ cx0, cy0, cw, ch, canvas, ctx, sprite, texture });
      }
    }
    this.terrainRoot.addChild(container);
    this.levelViews.set(level.id, { container, chunks });
  }

  /** Pixelpuffer passender Groesse (wiederverwendet). */
  _scratchFor(ctx, cw, ch) {
    const key = cw + 'x' + ch;
    let s = this.scratch.get(key);
    if (!s) {
      const imageData = ctx.createImageData(cw * WORLD.CELL_PX, ch * WORLD.CELL_PX);
      s = { imageData, buf: new Uint32Array(imageData.data.buffer) };
      this.scratch.set(key, s);
    }
    return s;
  }

  /** Bis zu max dirty Chunks einer Ebene neu zeichnen und hochladen. */
  flushDirty(level, max) {
    const view = this.levelViews.get(level.id);
    if (!view) return 0;
    const t0 = performance.now();
    const paint = level.kind === LEVEL_KIND.SURFACE ? paintSurfaceChunk : paintNestChunk;
    const done = level.consumeDirty(max, (ci) => {
      const c = view.chunks[ci];
      if (!c) return;
      const s = this._scratchFor(c.ctx, c.cw, c.ch);
      paint(level, c.cx0, c.cy0, c.cw, c.ch, s.buf);
      c.ctx.putImageData(s.imageData, 0, 0);
      c.texture.source.update();
    });
    if (done > 0) {
      this.stats.chunkUploads = done;
      this.stats.chunkUploadsTotal += done;
      this.stats.paintMs = performance.now() - t0;
    } else {
      this.stats.chunkUploads = 0;
      this.stats.paintMs = 0;
    }
    return done;
  }

  /** Aktive Ebene umschalten: Sichtbarkeit, Marker, ausstehende Chunks. */
  setActive(level) {
    for (const [id, v] of this.levelViews) v.container.visible = id === level.id;
    // Beim Wechsel alles Ausstehende auf einmal hochladen – der Uebergang
    // verdeckt den kurzen Hitch.
    this.flushDirty(level, level.chunkCount);
    this._rebuildMarkers(level);
    this._rebuildChunkGrid(level);
  }

  _rebuildMarkers(level) {
    const tex = this.sprites.get('marker_entrance').textures[0];
    let used = 0;
    for (const p of this.world.portals.portals) {
      const pos = p.on(level.id);
      if (!pos) continue;
      let s = this.markerPool[used];
      if (!s) {
        s = new PIXI.Sprite(tex);
        s.anchor.set(0.5);
        this.markerPool.push(s);
        this.markerRoot.addChild(s);
      }
      const colony = this.world.colonies.get(p.colonyId);
      s.texture = tex;
      s.tint = colony ? colony.color : 0xffffff;
      s.visible = true;
      s.position.set((pos.x + 0.5) * WORLD.CELL_SIZE, (pos.y + 0.5) * WORLD.CELL_SIZE);
      s.scale.set((3.2 * WORLD.CELL_SIZE) / this.sprites.cell);
      used++;
    }
    for (let i = used; i < this.markerPool.length; i++) this.markerPool[i].visible = false;
    this.stats.drawnMarkers = used;
  }

  _rebuildChunkGrid(level) {
    if (!this.chunkGrid) {
      this.chunkGrid = new PIXI.Graphics();
      this.debugRoot.addChild(this.chunkGrid);
    }
    const g = this.chunkGrid;
    g.clear();
    g.visible = this.showChunkGrid;
    if (!this.showChunkGrid) return;
    const s = WORLD.CELL_SIZE;
    for (let cx = 0; cx <= level.chunkCols; cx++) {
      const x = Math.min(level.w, cx * level.chunkSize) * s;
      g.moveTo(x, 0).lineTo(x, level.worldH);
    }
    for (let cy = 0; cy <= level.chunkRows; cy++) {
      const y = Math.min(level.h, cy * level.chunkSize) * s;
      g.moveTo(0, y).lineTo(level.worldW, y);
    }
    g.stroke({ width: 1 / this.camera.zoom, color: 0x44ff88, alpha: 0.35 });
  }

  setChunkGrid(on) {
    this.showChunkGrid = on;
    if (this.camera.level) this._rebuildChunkGrid(this.camera.level);
  }

  /** Einen Frame zeichnen. alpha = Interpolationsanteil zwischen zwei Ticks. */
  frame(alpha) {
    const level = this.camera.level;
    if (!level) return;
    const t0 = performance.now();

    // Kamera anwenden
    const z = this.camera.zoom;
    this.worldRoot.scale.set(z);
    this.worldRoot.position.set(
      -this.camera.x * z + this.app.renderer.width / 2,
      -this.camera.y * z + this.app.renderer.height / 2,
    );

    this.flushDirty(level, RENDER.CHUNK_UPLOADS_PER_FRAME);
    this._drawAnts(level, alpha);
    if (this.chunkGrid && this.chunkGrid.visible) {
      // Linienstaerke an den Zoom anpassen, damit sie duenn bleibt
      this.chunkGrid.scale.set(1);
    }
    const t1 = performance.now();
    this.app.renderer.render(this.app.stage);
    const t2 = performance.now();
    this.stats.frameMs = t1 - t0;   // Vorbereitung (Sprites, Chunks)
    this.stats.drawMs = t2 - t1;    // reiner GPU-Aufruf
  }

  _drawAnts(level, alpha) {
    const ants = this.world.ants;
    const bucket = ants.buckets.get(level.id);
    const pool = this.entityPool;
    const cs = WORLD.CELL_SIZE;
    const vis = this.camera.visibleCells(RENDER.CULL_MARGIN, this._vis);

    // Koloniefarben auffrischen (wenige Eintraege).
    for (const c of this.world.colonies.colonies) this._colonyColor[c.id] = c.color;

    let used = 0;
    if (bucket) {
      for (let k = 0; k < bucket.count; k++) {
        const i = bucket.ids[k];
        if (ants.state[i] === ANT_STATE.TRANSIT) continue;
        const ax = ants.px[i] + (ants.x[i] - ants.px[i]) * alpha;
        const ay = ants.py[i] + (ants.y[i] - ants.py[i]) * alpha;
        if (ax < vis.x0 || ax > vis.x1 || ay < vis.y0 || ay > vis.y1) continue;
        if (used >= RENDER.MAX_ANT_SPRITES) break;

        let s = pool[used];
        if (!s) {
          s = new PIXI.Sprite();
          s.anchor.set(0.5);
          pool.push(s);
          this.entityRoot.addChild(s);
        }
        const caste = ants.caste[i];
        const textures = this._casteTex[caste];
        if (!textures) continue;
        const frame = ((ants.anim[i] | 0) % textures.length + textures.length) % textures.length;
        s.texture = textures[frame];
        s.position.set(ax * cs, ay * cs);
        s.rotation = ants.dir[i];
        const sc = this._casteScale[caste] * ants.phenoSize[i];
        s.scale.set(sc);
        s.tint = this._colonyColor[ants.colony[i]];
        s.visible = true;
        used++;
      }
    }
    for (let i = used; i < pool.length; i++) {
      if (!pool[i].visible) break; // dahinter ist bereits alles unsichtbar
      pool[i].visible = false;
    }
    this.stats.visibleAnts = used;
  }

  /** Auswahlring auf eine Ameise setzen (-1 = aus). */
  setSelection(antIndex, alpha = 1) {
    const ants = this.world.ants;
    if (antIndex < 0 || !ants.alive[antIndex] || ants.level[antIndex] !== this.camera.level.id
        || ants.state[antIndex] === ANT_STATE.TRANSIT) {
      this.selectSprite.visible = false;
      return;
    }
    const ax = ants.px[antIndex] + (ants.x[antIndex] - ants.px[antIndex]) * alpha;
    const ay = ants.py[antIndex] + (ants.y[antIndex] - ants.py[antIndex]) * alpha;
    this.selectSprite.visible = true;
    this.selectSprite.position.set(ax * WORLD.CELL_SIZE, ay * WORLD.CELL_SIZE);
    const sc = (this._casteScale[ants.caste[antIndex]] * ants.phenoSize[antIndex]) * 1.8;
    this.selectSprite.scale.set(sc);
    this.selectSprite.tint = 0xffffff;
  }

  /** Alphawert der Uebergangsblende (0..1). */
  setFade(a) { this.fade.alpha = a; }
}
