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
import { WORLD, RENDER, PHERO, DAYNIGHT } from '../config.js';
import { LEVEL_KIND } from '../sim/levels.js';
import { paintSurfaceChunk } from './surfaceView.js';
import { paintNestChunk } from './nestView.js';
import { CASTE_DEFS } from '../sim/castes.js';
import { ANT_STATE } from '../sim/ants.js';
import { SPECIES_LIST } from '../sim/creatures.js';
import { Particles } from './particles.js';

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
    /** Bildschirmwackeln zulassen (Einstellung). */
    this.shakeEnabled = true;
    /** Wiederverwendbare Pixelpuffer je Chunkgroesse. */
    this.scratch = new Map();

    this.entityPool = [];
    this.creaturePool = [];
    this.broodPool = [];
    this.markerPool = [];
    this.selectSprite = null;

    /** Pheromon-Overlay: Sichtbarkeit, Kolonie (-1 = alle), Typen. */
    this.pheroView = { enabled: false, colonyId: -1, types: [true, true, true] };
    this._pheroTimer = 0;

    /** Kennzahlen fuers Performance-Overlay. */
    this.stats = {
      chunkUploads: 0, chunkUploadsTotal: 0, visibleAnts: 0, visibleCreatures: 0,
      visibleBrood: 0, drawnMarkers: 0, paintMs: 0, frameMs: 0, drawMs: 0, pheroMs: 0,
    };
    this.showChunkGrid = false;

    this._casteTex = [];
    this._casteScale = new Float32Array(CASTE_DEFS.length);
    this._speciesTex = [];
    this._speciesScale = new Float32Array(SPECIES_LIST.length);
    this._broodTex = [];
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
    this.pheroRoot = new PIXI.Container();
    this.broodRoot = new PIXI.Container();
    this.creatureRoot = new PIXI.Container();
    this.worldRoot.addChild(this.terrainRoot, this.pheroRoot, this.markerRoot,
      this.broodRoot, this.entityRoot, this.creatureRoot, this.debugRoot);
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

    // Pinselvorschau (liegt ueber den Einheiten)
    this.brushG = new PIXI.Graphics();
    this.brushG.visible = false;
    this.worldRoot.addChild(this.brushG);
    this._brush = { x: -1, y: -1, r: -1, color: 0 };

    for (const sp of SPECIES_LIST) {
      const entry = this.sprites.get('creature_' + sp.key);
      this._speciesTex[sp.id] = entry ? entry.textures : null;
      // drawCreature normiert den Koerper auf 66 % der Zellbreite
      this._speciesScale[sp.id] = (RENDER.ANT_CELLS * WORLD.CELL_SIZE) / (this.sprites.cell * 0.66)
        * Math.pow(sp.size, RENDER.SIZE_EXPONENT);
    }
    for (const [k, key] of ['egg', 'larva', 'pupa'].entries()) {
      const e = this.sprites.get('brood_' + key);
      this._broodTex[k] = e ? e.textures[0] : null;
    }

    this.selectSprite = new PIXI.Sprite(this.sprites.get('marker_select').textures[0]);
    this.selectSprite.anchor.set(0.5);
    this.selectSprite.visible = false;
    this.markerRoot.addChild(this.selectSprite);

    // Hervorhebung der Legende: unter den Einheiten, ueber dem Terrain.
    this.highlightG = new PIXI.Graphics();
    this.highlightG.visible = false;
    this.markerRoot.addChild(this.highlightG);
    this._hlCell = -1;
    this._hlMeta = -1;
    this._hlKey = '';

    // Teilchen liegen ueber Terrain und Einheiten, aber unter der Vorschau.
    this.particles = new Particles(this);
    this.particles.attach(this.worldRoot);

    /**
     * Tag-Nacht-Blende: ein bildschirmfuellendes Rechteck im Multiplizier-
     * Modus waere teurer als noetig. Ein halbdurchsichtiges Rechteck ueber
     * der Welt (aber unter der Oberflaeche) reicht voellig und kostet einen
     * einzigen Zeichenaufruf.
     */
    this.nightVeil = new PIXI.Graphics();
    this.nightVeil.alpha = 0;
    this.hudRoot.addChild(this.nightVeil);
    this._veilColor = -1;

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
    this._veilColor = -1;   // erzwingt Neuzeichnen der Nachtblende
  }

  /**
   * Nachtblende ueber die Oberflaeche legen. Nest-Ebenen bleiben unberuehrt:
   * unter der Erde ist es immer dunkel, dort waere ein Tageswechsel falsch.
   */
  _updateNightVeil(level) {
    const w = this.world;
    const isSurface = level.kind === LEVEL_KIND.SURFACE;
    if (!isSurface || !w.dayNightOn || w.light >= 1) {
      this.nightVeil.alpha = 0;
      return;
    }
    // Daemmerung faerbt warm, tiefe Nacht kalt
    const dusk = w.dayPhase === 3 || w.dayPhase === 1;
    const color = dusk ? DAYNIGHT.DUSK_TINT : DAYNIGHT.NIGHT_TINT;
    if (color !== this._veilColor) {
      const sw = this.app.renderer.width, sh = this.app.renderer.height;
      this.nightVeil.clear();
      this.nightVeil.rect(0, 0, sw, sh).fill(color);
      this._veilColor = color;
    }
    const dark = (1 - w.light) / (1 - DAYNIGHT.NIGHT_LIGHT);
    this.nightVeil.alpha = Math.min(0.62, dark * (dusk ? 0.30 : 0.62));
  }

  /** Vergangene Frames seit dem letzten Bild (fuer die Teilchen). */
  setFrameDelta(dtFrames) { this._dtFrames = dtFrames; }

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
  flushDirty(level, max, quiet = false) {
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
    if (quiet) {
      // Nachziehen fuer Bild-in-Bild soll die Messwerte der Hauptansicht
      // nicht ueberschreiben – nur die Gesamtzahl mitzaehlen.
      this.stats.chunkUploadsTotal += done;
    } else if (done > 0) {
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
    /**
     * Bildschirmwackeln: reine Anzeige, deshalb Math.random(). Es verschiebt
     * nur den Wurzelcontainer – Kamera und Simulation bleiben unberuehrt,
     * sonst wuerde ein Erdbeben die Mauszielerfassung verreissen.
     */
    let sx = 0, sy = 0;
    const shake = this.shakeEnabled ? (this.world.shake || 0) : 0;
    if (shake > 0.001) {
      const amp = shake * 7;
      sx = (Math.random() - 0.5) * amp;
      sy = (Math.random() - 0.5) * amp;
    }
    this.worldRoot.position.set(
      -this.camera.x * z + this.app.renderer.width / 2 + sx,
      -this.camera.y * z + this.app.renderer.height / 2 + sy,
    );

    this.flushDirty(level, RENDER.CHUNK_UPLOADS_PER_FRAME);
    this._updatePheroOverlay(level);
    this._drawBrood(level);
    this._drawAnts(level, alpha);
    this._drawCreatures(level, alpha);
    this._drawHighlight(level);
    this.particles.update(level.id, this._dtFrames || 1);
    this._updateNightVeil(level);
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

  _drawCreatures(level, alpha) {
    const cr = this.world.creatures;
    const bucket = cr.buckets.get(level.id);
    const pool = this.creaturePool;
    const cs = WORLD.CELL_SIZE;
    const vis = this._vis;
    let used = 0;
    if (bucket) {
      for (let k = 0; k < bucket.count; k++) {
        const i = bucket.ids[k];
        const ax = cr.px[i] + (cr.x[i] - cr.px[i]) * alpha;
        const ay = cr.py[i] + (cr.y[i] - cr.py[i]) * alpha;
        if (ax < vis.x0 || ax > vis.x1 || ay < vis.y0 || ay > vis.y1) continue;
        const textures = this._speciesTex[cr.species[i]];
        if (!textures) continue;
        let s = pool[used];
        if (!s) {
          s = new PIXI.Sprite();
          s.anchor.set(0.5);
          pool.push(s);
          this.creatureRoot.addChild(s);
        }
        const frame = ((cr.anim[i] | 0) % textures.length + textures.length) % textures.length;
        s.texture = textures[frame];
        s.position.set(ax * cs, ay * cs);
        s.rotation = cr.dir[i];
        // Eigene Gene der Kreatur sind sichtbar: groessere Tiere sind groesser
        s.scale.set(this._speciesScale[cr.species[i]] * (0.7 + cr.gSize[i] * 0.6));
        s.tint = SPECIES_LIST[cr.species[i]].color;
        s.visible = true;
        used++;
      }
    }
    for (let i = used; i < pool.length; i++) {
      if (!pool[i].visible) break;
      pool[i].visible = false;
    }
    this.stats.visibleCreatures = used;
  }

  _drawBrood(level) {
    const br = this.world.brood;
    const pool = this.broodPool;
    const cs = WORLD.CELL_SIZE;
    const vis = this._vis;
    const scale = (0.9 * WORLD.CELL_SIZE) / this.sprites.cell;
    let used = 0;
    if (level.kind === LEVEL_KIND.NEST) {
      for (let i = 0; i < br.high; i++) {
        if (!br.alive[i] || br.level[i] !== level.id) continue;
        const bx = br.x[i], by = br.y[i];
        if (bx < vis.x0 || bx > vis.x1 || by < vis.y0 || by > vis.y1) continue;
        const tex = this._broodTex[br.stage[i]];
        if (!tex) continue;
        let s = pool[used];
        if (!s) {
          s = new PIXI.Sprite();
          s.anchor.set(0.5);
          pool.push(s);
          this.broodRoot.addChild(s);
        }
        s.texture = tex;
        s.position.set(bx * cs, by * cs);
        s.rotation = 0;
        s.scale.set(scale * (br.stage[i] === 0 ? 0.8 : 1));
        const colony = this.world.colonies.get(br.colony[i]);
        s.tint = colony ? lighten(colony.color) : 0xffffff;
        s.visible = true;
        used++;
      }
    }
    for (let i = used; i < pool.length; i++) {
      if (!pool[i].visible) break;
      pool[i].visible = false;
    }
    this.stats.visibleBrood = used;
  }

  /**
   * Pheromon-Overlay: die Felder werden in eine Textur in Zellaufloesung
   * geschrieben (ein Pixel je Zelle) und darueber gelegt. Aktualisiert wird
   * nur alle paar Frames – das Bild aendert sich langsam.
   */
  _updatePheroOverlay(level) {
    const pv = this.pheroView;
    if (!pv.enabled || level.kind !== LEVEL_KIND.SURFACE || !this.world.phero) {
      if (this.pheroSprite) this.pheroSprite.visible = false;
      this.stats.pheroMs = 0;
      return;
    }
    if (!this.pheroSprite) {
      const canvas = document.createElement('canvas');
      canvas.width = level.w;
      canvas.height = level.h;
      this.pheroCanvas = canvas;
      this.pheroCtx = canvas.getContext('2d');
      this.pheroImg = this.pheroCtx.createImageData(level.w, level.h);
      this.pheroBuf = new Uint32Array(this.pheroImg.data.buffer);
      const tex = PIXI.Texture.from(canvas);
      tex.source.scaleMode = 'nearest';
      this.pheroTexture = tex;
      this.pheroSprite = new PIXI.Sprite(tex);
      this.pheroSprite.scale.set(WORLD.CELL_SIZE);
      this.pheroSprite.alpha = 0.75;
      this.pheroRoot.addChild(this.pheroSprite);
    }
    this.pheroSprite.visible = true;
    if (--this._pheroTimer > 0) return;
    this._pheroTimer = 6;

    const t0 = performance.now();
    const buf = this.pheroBuf;
    buf.fill(0);
    const colors = PHERO.TYPE_COLORS;
    for (const [cid, data] of this.world.phero.byColony) {
      if (pv.colonyId >= 0 && cid !== pv.colonyId) continue;
      for (let t = 0; t < PHERO.COUNT; t++) {
        if (!pv.types[t]) continue;
        const f = data.fields[t];
        const col = colors[t];
        const cr = (col >> 16) & 0xff, cg = (col >> 8) & 0xff, cb = col & 0xff;
        for (let k = 0; k < f.count; k++) {
          const idx = f.active[k];
          const v = f.grid[idx];
          if (v === 0) continue;
          const prev = buf[idx];
          const pa = (prev >>> 24) & 0xff;
          const a = Math.min(255, pa + v);
          const pr = prev & 0xff, pg2 = (prev >> 8) & 0xff, pb2 = (prev >> 16) & 0xff;
          const w = v / 255;
          const r = Math.min(255, pr + cr * w) | 0;
          const g = Math.min(255, pg2 + cg * w) | 0;
          const b = Math.min(255, pb2 + cb * w) | 0;
          buf[idx] = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
        }
      }
    }
    this.pheroCtx.putImageData(this.pheroImg, 0, 0);
    this.pheroTexture.source.update();
    this.stats.pheroMs = performance.now() - t0;
  }

  setPheroView(opts) {
    Object.assign(this.pheroView, opts);
    this._pheroTimer = 0;
  }

  /** Auswahlring auf eine Ameise setzen (-1 = aus). */
  /**
   * Alle sichtbaren Zellen eines Typs hervorheben (Legende beim Ueberfahren).
   * cellId < 0 schaltet ab. Gezeichnet wird nur der sichtbare Ausschnitt –
   * bei 160 000 Zellen waere alles andere Verschwendung.
   */
  setHighlight(cellId, meta) {
    this._hlCell = cellId === undefined ? -1 : cellId;
    this._hlMeta = meta === undefined ? -1 : meta;
    this._hlKey = '';
  }

  _drawHighlight(level) {
    const g = this.highlightG;
    if (this._hlCell === undefined || this._hlCell < 0) {
      if (g.visible) { g.visible = false; g.clear(); this._hlKey = ''; }
      return;
    }
    const vis = this.camera.visibleCells(2, this._vis);
    const key = this._hlCell + ':' + this._hlMeta + ':' + level.id + ':'
      + (vis.x0 | 0) + ':' + (vis.y0 | 0) + ':' + (vis.x1 | 0) + ':' + (vis.y1 | 0);
    if (key === this._hlKey) return;
    this._hlKey = key;
    g.visible = true;
    g.clear();
    const cs = WORLD.CELL_SIZE;
    const x0 = Math.max(0, vis.x0 | 0), x1 = Math.min(level.w - 1, Math.ceil(vis.x1));
    const y0 = Math.max(0, vis.y0 | 0), y1 = Math.min(level.h - 1, Math.ceil(vis.y1));
    for (let y = y0; y <= y1; y++) {
      const row = y * level.w;
      for (let x = x0; x <= x1; x++) {
        if (level.cells[row + x] !== this._hlCell) continue;
        if (this._hlMeta >= 0 && level.meta[row + x] !== this._hlMeta) continue;
        g.rect(x * cs, y * cs, cs, cs);
      }
    }
    g.fill({ color: 0xffe08a, alpha: 0.42 });
  }

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

  /**
   * Pinselvorschau setzen (Zellkoordinaten). radius entspricht der
   * Pinselgroesse aus der Werkzeugleiste; -1 blendet sie aus.
   */
  setBrushPreview(cx, cy, radius, color) {
    if (radius < 0) { this.brushG.visible = false; return; }
    this.brushG.visible = true;
    const b = this._brush;
    if (b.x === cx && b.y === cy && b.r === radius && b.color === color) return;
    b.x = cx; b.y = cy; b.r = radius; b.color = color;
    const cs = WORLD.CELL_SIZE;
    const r = (Math.max(0, radius - 1) + 0.7) * cs;
    this.brushG.clear();
    this.brushG.circle((cx + 0.5) * cs, (cy + 0.5) * cs, r)
      .stroke({ width: Math.max(0.5, 1.5 / this.camera.zoom), color, alpha: 0.9 });
  }

  /** Alphawert der Uebergangsblende (0..1). */
  setFade(a) { this.fade.alpha = a; }
}

/** Farbe aufhellen (fuer Brut in Koloniefarbe). */
function lighten(hex) {
  const r = Math.min(255, ((hex >> 16) & 0xff) + 90);
  const g = Math.min(255, ((hex >> 8) & 0xff) + 90);
  const b = Math.min(255, (hex & 0xff) + 90);
  return (r << 16) | (g << 8) | b;
}
