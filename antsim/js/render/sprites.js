/**
 * sprites.js – Sprite-System mit Manifest und prozeduralem Fallback.
 *
 * Ablauf:
 *   1. assets/manifest.json laden (fehlt sie, greift ein eingebautes Manifest,
 *      das aus den Kastendefinitionen erzeugt wird).
 *   2. Fuer jeden Eintrag mit "file": "<datei>" wird die Grafik geladen und in
 *      den Atlas kopiert. Bei "file": null – oder wenn die Datei nicht laedt –
 *      zeichnet der prozedurale Generator eine Pixel-Art-Ameise inklusive
 *      Laufanimation.
 *   3. Alles landet in EINEM Atlas (eine Textur) -> die Ameisen der ganzen
 *      Welt gehen in einem einzigen Batch an die GPU.
 *
 * MANIFESTFORMAT (siehe ARCHITECTURE.md):
 *   version   : Formatversion (aktuell 1)
 *   basePath  : Verzeichnis der Grafiken
 *   cell      : Kantenlaenge einer Atlaszelle in Pixeln
 *   sprites   : { "<key>": {
 *                   file: string|null,      // null = prozedural erzeugen
 *                   frameWidth, frameHeight,// Rastermass in der Quelldatei
 *                   frames,                 // Anzahl Einzelbilder
 *                   anchor: [ax, ay],       // Drehpunkt 0..1
 *                   scale,                  // zusaetzlicher Groessenfaktor
 *                   animations: { name: {from, to, fps, loop} }
 *                 } }
 *   Frames in einer Quelldatei liegen zeilenweise: links nach rechts, dann
 *   naechste Zeile. Zeilenlaenge = floor(Bildbreite / frameWidth).
 *
 * Die Grafiken sind absichtlich hell/grau: die Koloniefarbe kommt als Tint
 * dazu. Umrisse bleiben dunkel und damit farbstabil.
 */

import { PIXI } from './pixi.js';
import { RENDER } from '../config.js';
import { CASTE_DEFS } from '../sim/castes.js';

// ---------------------------------------------------------------------------
// Mini-Rasterizer: schreibt direkt in einen Uint32Array (ABGR, little endian).
// Kein Antialiasing -> echte Pixel-Art.
// ---------------------------------------------------------------------------
const rgba = (r, g, b, a = 255) => (((a << 24) | (b << 16) | (g << 8) | r) >>> 0);

const PAL = {
  body: rgba(0xd4, 0xd4, 0xd4),
  dark: rgba(0x9c, 0x9c, 0x9c),
  light: rgba(0xf0, 0xf0, 0xf0),
  leg: rgba(0xb2, 0xb2, 0xb2),
  outline: rgba(0x26, 0x26, 0x26),
  eye: rgba(0x38, 0x38, 0x38),
  plate: rgba(0x86, 0x86, 0x86),
  wing: rgba(0xe6, 0xf2, 0xff, 150),
  nozzle: rgba(0xc8, 0xe8, 0xc0),
};

export class Cell {
  /** Zeichenflaeche innerhalb des Atlas (Ausschnitt ox,oy,w,h). */
  constructor(buf, stride, ox, oy, w, h) {
    this.buf = buf; this.stride = stride;
    this.ox = ox; this.oy = oy; this.w = w; this.h = h;
  }

  plot(x, y, c) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    this.buf[(this.oy + yi) * this.stride + this.ox + xi] = c;
  }

  /** Nur zeichnen, wenn die Zelle noch leer ist (fuer Umrisse). */
  plotEmpty(x, y, c) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (this.oy + yi) * this.stride + this.ox + xi;
    if (this.buf[i] === 0) this.buf[i] = c;
  }

  get(x, y) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return 0;
    return this.buf[(this.oy + yi) * this.stride + this.ox + xi];
  }

  ellipse(cx, cy, rx, ry, c) {
    if (rx < 0.4) rx = 0.4;
    if (ry < 0.4) ry = 0.4;
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.0 - cx) / rx, ny = (y + 0.0 - cy) / ry;
        if (nx * nx + ny * ny <= 1.02) this.plot(x, y, c);
      }
    }
  }

  line(x0, y0, x1, y1, c) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
    for (let i = 0; i <= steps; i++) {
      this.plot(x0 + (dx * i) / steps, y0 + (dy * i) / steps, c);
    }
  }

  /** Umrisspass: leere Pixel neben gefuellten bekommen die Umrissfarbe. */
  outline(c) {
    const marks = [];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y) !== 0) continue;
        if (this.get(x - 1, y) !== 0 || this.get(x + 1, y) !== 0 ||
            this.get(x, y - 1) !== 0 || this.get(x, y + 1) !== 0) marks.push(x, y);
      }
    }
    for (let i = 0; i < marks.length; i += 2) this.plot(marks[i], marks[i + 1], c);
  }
}

/**
 * Zeichnet ein Einzelbild einer Ameise. Koerperachse zeigt nach +X.
 * Alle Kasten werden auf die gleiche Pixel-Laenge normiert – die tatsaechliche
 * Groesse in der Welt macht der Renderer ueber caste.size.
 */
export function drawAnt(cell, art, frame, frames) {
  const cw = cell.w, ch = cell.h;
  const ab = art.ab, th = art.th, hd = art.hd;
  const mand = art.mand || 0;

  // Laengsaufbau: der Koerper belegt nur rund 70 % der Zellbreite, damit die
  // Beine seitlich Platz haben. Sonst wirkt die Ameise wie ein Strich.
  const rawLen = ab[0] * 2 + th[0] * 2 + hd[0] * 2 + mand + 1.4;
  const sx = (cw * 0.70) / rawLen;
  const sy = sx * 1.30;                       // Koerper etwas gedrungener
  const cy = ch / 2;
  let x = cw * 0.15;                           // linker Rand des Koerpers

  const abRX = ab[0] * sx, abRY = ab[1] * sy;
  const thRX = th[0] * sx, thRY = th[1] * sy;
  const hdRX = hd[0] * sx, hdRY = hd[1] * sy;
  const abX = x + abRX; x = abX + abRX;
  const waistX = x + 0.6 * sx; x = waistX + 0.6 * sx;
  const thX = x + thRX; x = thX + thRX;
  const hdX = x + hdRX;
  const mandLen = mand * sx;

  const phase = (frame / frames) * Math.PI * 2;

  // --- Beine: reichen bis fast an den Zellrand, klar nach vorn/hinten
  //     gespreizt und im Dreifuss-Gang animiert. -------------------------
  const legBase = (ch * 0.36) * ((art.leg || 5.6) / 5.6);
  const baseAng = [0.62, 1.40, 2.42];
  const legFactor = [0.88, 1.0, 1.08];
  for (let j = 0; j < 3; j++) {
    const legLen = legBase * legFactor[j];
    const attachX = thX + (1 - j) * (thRX * 0.8 + 1.0);
    for (let sideI = 0; sideI < 2; sideI++) {
      const side = sideI === 0 ? -1 : 1;
      // Dreifuss: Bein 1 der einen Seite schwingt mit 0/2 der anderen.
      const tripod = (j === 1) ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI : 0);
      const swing = Math.sin(phase + tripod) * 0.38;
      const a = baseAng[j] + swing;
      const kneeX = attachX + Math.cos(a) * legLen * 0.55;
      const kneeY = cy + side * Math.sin(a) * legLen * 0.55;
      const footX = attachX + Math.cos(a) * legLen * 1.0;
      const footY = cy + side * Math.sin(a) * legLen * 1.0;
      cell.line(attachX, cy + side * thRY * 0.4, kneeX, kneeY, PAL.leg);
      cell.line(kneeX, kneeY, footX, footY, PAL.leg);
    }
  }

  // --- Fluegel (Gefluegelte) ---------------------------------------------
  if (art.wings) {
    for (let sideI = 0; sideI < 2; sideI++) {
      const side = sideI === 0 ? -1 : 1;
      for (let k = 0; k < 2; k++) {
        const len = (ch * 0.38) - k * 2;
        const a = 2.45 + k * 0.4;
        cell.line(thX, cy + side * 0.6,
          thX + Math.cos(a) * len, cy + side * (1.5 + Math.abs(Math.sin(a)) * len * 0.8), PAL.wing);
      }
    }
  }

  // --- Hinterleib ---------------------------------------------------------
  cell.ellipse(abX, cy, abRX, abRY, PAL.body);
  cell.ellipse(abX - abRX * 0.2, cy - abRY * 0.35, abRX * 0.5, abRY * 0.3, PAL.light);
  if (art.bulge) cell.ellipse(abX - abRX * 0.1, cy, abRX * 0.6, abRY * 0.65, PAL.light);
  for (let k = 0; k < (art.stripe || 0); k++) {
    const stx = abX - abRX * 0.45 + k * Math.max(1, abRX * 0.6);
    cell.line(stx, cy - abRY * 0.8, stx, cy + abRY * 0.8, PAL.dark);
  }
  if (art.nozzle) cell.line(abX - abRX - 1, cy, abX - abRX - 2.4, cy, PAL.nozzle);

  // --- Taille (duenn, damit die Umrisse die Segmente trennen) -------------
  cell.line(waistX - 0.6, cy, waistX + 0.6, cy, PAL.dark);

  // --- Brust --------------------------------------------------------------
  cell.ellipse(thX, cy, thRX, thRY, PAL.body);
  for (let k = 0; k < (art.plate || 0); k++) {
    const plx = thX - thRX * 0.5 + k * Math.max(1, thRX * 0.5);
    cell.line(plx, cy - thRY * 0.9, plx, cy + thRY * 0.9, PAL.plate);
  }

  // --- Kopf, Augen, Kiefer, Fuehler ---------------------------------------
  cell.ellipse(hdX, cy, hdRX, hdRY, PAL.body);
  cell.plot(hdX + hdRX * 0.15, cy - hdRY * 0.55, PAL.eye);
  cell.plot(hdX + hdRX * 0.15, cy + hdRY * 0.55, PAL.eye);
  if (mandLen > 0.5) {
    const bite = Math.sin(phase * 0.5) * 0.3;
    for (let sideI = 0; sideI < 2; sideI++) {
      const side = sideI === 0 ? -1 : 1;
      const bx = hdX + hdRX * 0.7;
      const by = cy + side * hdRY * 0.5;
      cell.line(bx, by, bx + mandLen * 0.75, by + side * (mandLen * 0.45 + bite), PAL.dark);
      cell.line(bx + mandLen * 0.75, by + side * (mandLen * 0.45 + bite), bx + mandLen * 1.1, by, PAL.dark);
    }
  }
  const antLen = (ch * 0.24) * ((art.ant || 3.4) / 3.4);
  for (let sideI = 0; sideI < 2; sideI++) {
    const side = sideI === 0 ? -1 : 1;
    const wave = Math.sin(phase + (side > 0 ? 0 : 1.7)) * 0.9;
    const bx = hdX + hdRX * 0.45, by = cy + side * hdRY * 0.6;
    const mx = bx + antLen * 0.5, my = by + side * (antLen * 0.45) + wave;
    cell.line(bx, by, mx, my, PAL.leg);
    cell.line(mx, my, mx + antLen * 0.45, my + side * antLen * 0.15, PAL.leg);
  }

  cell.outline(PAL.outline);
}

/** Markierungs-Sprite fuer Nesteingaenge (wird mit Koloniefarbe getoent). */
function drawEntranceMarker(cell) {
  const cx = cell.w / 2, cy = cell.h / 2;
  const r = Math.min(cell.w, cell.h) / 2 - 1;
  cell.ellipse(cx, cy, r, r, PAL.body);
  cell.ellipse(cx, cy, r - 1.6, r - 1.6, rgba(0x20, 0x18, 0x12));
  cell.ellipse(cx, cy + 0.3, r - 3.2, r - 3.4, rgba(0x0c, 0x09, 0x07));
  cell.outline(PAL.outline);
}

/** Auswahlring fuer angeklickte Einheiten. */
function drawSelectRing(cell) {
  const cx = cell.w / 2, cy = cell.h / 2;
  const r = cell.w / 2 - 1;
  for (let a = 0; a < Math.PI * 2; a += 0.12) {
    const seg = Math.floor(a / 0.6) % 2;
    if (seg === 0) continue;
    cell.plot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, PAL.light);
  }
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** Eingebautes Manifest – wird aus den Kastendefinitionen aufgebaut. */
export function defaultManifest() {
  const sprites = {};
  for (const c of CASTE_DEFS) {
    sprites['ant_' + c.key] = {
      file: null,
      frameWidth: RENDER.SPRITE_PX,
      frameHeight: RENDER.SPRITE_PX,
      frames: RENDER.WALK_FRAMES,
      anchor: [0.5, 0.5],
      scale: 1.0,
      animations: { walk: { from: 0, to: RENDER.WALK_FRAMES - 1, fps: 14, loop: true } },
    };
  }
  sprites.marker_entrance = {
    file: null, frameWidth: RENDER.SPRITE_PX, frameHeight: RENDER.SPRITE_PX, frames: 1,
    anchor: [0.5, 0.5], scale: 1.0, animations: {},
  };
  sprites.marker_select = {
    file: null, frameWidth: RENDER.SPRITE_PX, frameHeight: RENDER.SPRITE_PX, frames: 1,
    anchor: [0.5, 0.5], scale: 1.0, animations: {},
  };
  return { version: 1, basePath: 'assets/sprites/', cell: RENDER.SPRITE_PX, sprites };
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class SpriteBank {
  constructor() {
    this.manifest = null;
    /** @type {Map<string, {textures:any[], anchor:number[], scale:number, animations:object, procedural:boolean}>} */
    this.entries = new Map();
    this.atlasCanvas = null;
    this.atlasTexture = null;
    this.cell = RENDER.SPRITE_PX;
    this.pitch = RENDER.SPRITE_PX + 2;
    this.stats = { fromFile: 0, procedural: 0 };
    this._dataURLs = new Map();
  }

  /** Manifest laden und Atlas bauen. */
  async load(manifestUrl = 'assets/manifest.json') {
    let manifest = null;
    try {
      const res = await fetch(manifestUrl, { cache: 'no-cache' });
      if (res.ok) manifest = await res.json();
    } catch {
      manifest = null;
    }
    if (!manifest || !manifest.sprites) {
      manifest = defaultManifest();
      console.info('[sprites] Kein Manifest gefunden – eingebaute Definitionen werden benutzt.');
    } else {
      // Fehlende Kasten im Manifest ergaenzen, damit neue Kasten immer
      // dargestellt werden koennen.
      const def = defaultManifest();
      for (const key of Object.keys(def.sprites)) {
        if (!manifest.sprites[key]) manifest.sprites[key] = def.sprites[key];
      }
    }
    this.manifest = manifest;
    this.cell = manifest.cell || RENDER.SPRITE_PX;

    const keys = Object.keys(manifest.sprites);
    const maxFrames = keys.reduce((m, k) => Math.max(m, manifest.sprites[k].frames || 1), 1);

    // 1 Pixel Rand um jede Zelle verhindert Texture-Bleeding beim Skalieren.
    this.pitch = this.cell + 2;
    const canvas = document.createElement('canvas');
    canvas.width = maxFrames * this.pitch;
    canvas.height = keys.length * this.pitch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;

    // Vorhandene Dateien laden (parallel). file:null -> gar kein Netzzugriff.
    const images = await Promise.all(keys.map((k) => {
      const e = manifest.sprites[k];
      if (!e.file) return Promise.resolve(null);
      return loadImage((manifest.basePath || '') + e.file);
    }));

    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const buf = new Uint32Array(imgData.data.buffer);

    for (let r = 0; r < keys.length; r++) {
      const key = keys[r];
      const e = manifest.sprites[key];
      const frames = Math.max(1, e.frames || 1);
      if (images[r]) continue; // Bilddateien werden weiter unten gezeichnet
      for (let f = 0; f < frames; f++) {
        const cell = new Cell(buf, canvas.width, f * this.pitch + 1, r * this.pitch + 1, this.cell, this.cell);
        if (key === 'marker_entrance') drawEntranceMarker(cell);
        else if (key === 'marker_select') drawSelectRing(cell);
        else {
          const casteKey = key.replace(/^ant_/, '');
          const def = CASTE_DEFS.find((c) => c.key === casteKey);
          drawAnt(cell, def ? def.art : CASTE_DEFS[1].art, f, frames);
        }
      }
      this.stats.procedural++;
    }
    ctx.putImageData(imgData, 0, 0);

    // Geladene Grafiken in den Atlas kopieren (nach putImageData, damit sie
    // die prozeduralen Pixel nicht ueberschreiben).
    for (let r = 0; r < keys.length; r++) {
      const img = images[r];
      if (!img) continue;
      const e = manifest.sprites[keys[r]];
      const fw = e.frameWidth || this.cell, fh = e.frameHeight || this.cell;
      const cols = Math.max(1, Math.floor(img.width / fw));
      const frames = Math.max(1, e.frames || 1);
      for (let f = 0; f < frames; f++) {
        const sx = (f % cols) * fw, sy = Math.floor(f / cols) * fh;
        ctx.drawImage(img, sx, sy, fw, fh, f * this.pitch + 1, r * this.pitch + 1, this.cell, this.cell);
      }
      this.stats.fromFile++;
    }

    this.atlasCanvas = canvas;
    this.atlasTexture = PIXI.Texture.from(canvas);
    this.atlasTexture.source.scaleMode = 'nearest';
    this.atlasTexture.source.update();

    for (let r = 0; r < keys.length; r++) {
      const key = keys[r];
      const e = manifest.sprites[key];
      const frames = Math.max(1, e.frames || 1);
      const textures = [];
      for (let f = 0; f < frames; f++) {
        textures.push(new PIXI.Texture({
          source: this.atlasTexture.source,
          frame: new PIXI.Rectangle(f * this.pitch + 1, r * this.pitch + 1, this.cell, this.cell),
        }));
      }
      this.entries.set(key, {
        textures,
        anchor: e.anchor || [0.5, 0.5],
        scale: e.scale || 1,
        animations: e.animations || {},
        procedural: !images[r],
      });
    }
    return this;
  }

  get(key) { return this.entries.get(key) || null; }

  /** Texturen einer Kaste (Laufanimation). */
  caste(casteKey) { return this.entries.get('ant_' + casteKey); }

  /** Einzelbild als data:-URL – fuer Legende und Tooltips im DOM. */
  dataURL(key, frame = 0) {
    const id = key + '#' + frame;
    if (this._dataURLs.has(id)) return this._dataURLs.get(id);
    const keys = Object.keys(this.manifest.sprites);
    const row = keys.indexOf(key);
    if (row < 0 || !this.atlasCanvas) return '';
    const c = document.createElement('canvas');
    c.width = this.cell; c.height = this.cell;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlasCanvas, frame * this.pitch + 1, row * this.pitch + 1, this.cell, this.cell,
      0, 0, this.cell, this.cell);
    const url = c.toDataURL();
    this._dataURLs.set(id, url);
    return url;
  }
}
