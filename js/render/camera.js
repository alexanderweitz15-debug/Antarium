/**
 * camera.js – Kamera pro Ebene.
 *
 * Die Kamera haelt Weltposition und Zoom. Beim Ebenenwechsel wird der
 * aktuelle Zustand in level.view gesichert und der gemerkte Zustand der
 * neuen Ebene geladen – so bleibt jede Ansicht dort stehen, wo man sie
 * verlassen hat.
 */

import { CAMERA, WORLD, CINEMA } from '../config.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = CAMERA.DEFAULT_ZOOM;
    this.screenW = 1;
    this.screenH = 1;
    /** @type {import('../sim/levels.js').Level|null} */
    this.level = null;
    /** Einheit, der gefolgt wird (-1 = keine). */
    this.followAnt = -1;
  }

  resize(w, h) { this.screenW = w; this.screenH = h; }

  /** Aktuellen Zustand in die Ebene sichern. */
  save() {
    if (!this.level) return;
    this.level.view.x = this.x;
    this.level.view.y = this.y;
    this.level.view.zoom = this.zoom;
    this.level.view.init = true;
  }

  /** Auf eine Ebene umschalten (merkt sich die alte Position). */
  attach(level) {
    if (this.level === level) return;
    this.save();
    this.level = level;
    if (level.view.init) {
      this.x = level.view.x;
      this.y = level.view.y;
      this.zoom = level.view.zoom;
    } else {
      this.x = level.worldW / 2;
      this.y = level.worldH / 2;
      this.zoom = CAMERA.DEFAULT_ZOOM;
      level.view.init = true;
    }
    this.clamp();
  }

  /**
   * Ebene uebernehmen, OHNE den aktuellen Zustand zu sichern. Wird beim
   * Ebenenwechsel benutzt, wenn vorher schon bewusst gesichert wurde (der
   * Uebergang veraendert die Kamera, dieser Zwischenzustand darf nicht in
   * level.view landen).
   */
  adopt(level) {
    this.level = level;
    if (level.view.init) {
      this.x = level.view.x;
      this.y = level.view.y;
      this.zoom = level.view.zoom;
    } else {
      this.x = level.worldW / 2;
      this.y = level.worldH / 2;
      this.zoom = CAMERA.DEFAULT_ZOOM;
      level.view.init = true;
    }
    this.clamp();
  }

  /** Auf eine Gitterzelle springen. */
  focusCell(cx, cy, zoom) {
    this.x = (cx + 0.5) * WORLD.CELL_SIZE;
    this.y = (cy + 0.5) * WORLD.CELL_SIZE;
    if (zoom !== undefined) this.zoom = zoom;
    this.clamp();
  }

  /**
   * Weich auf einen Weltpunkt nachziehen (Frontverfolgung). Springt nicht,
   * sondern holt je Sekunde einen festen Anteil der Reststrecke auf – so
   * bleibt die Front im Bild, ohne dass die Kamera zuckt.
   * @param {number} dtMs vergangene Zeit in Millisekunden
   */
  glideTo(wx, wy, dtMs) {
    const k = 1 - Math.exp(-CINEMA.FRONT_GLIDE * (dtMs / 1000));
    this.x += (wx - this.x) * k;
    this.y += (wy - this.y) * k;
    this.clamp();
  }

  screenToWorld(sx, sy, out) {
    const o = out || { x: 0, y: 0 };
    o.x = (sx - this.screenW / 2) / this.zoom + this.x;
    o.y = (sy - this.screenH / 2) / this.zoom + this.y;
    return o;
  }

  worldToScreen(wx, wy, out) {
    const o = out || { x: 0, y: 0 };
    o.x = (wx - this.x) * this.zoom + this.screenW / 2;
    o.y = (wy - this.y) * this.zoom + this.screenH / 2;
    return o;
  }

  /** Zellkoordinate unter einem Bildschirmpunkt. */
  screenToCell(sx, sy, out) {
    const w = this.screenToWorld(sx, sy);
    const o = out || { x: 0, y: 0 };
    o.x = Math.floor(w.x / WORLD.CELL_SIZE);
    o.y = Math.floor(w.y / WORLD.CELL_SIZE);
    return o;
  }

  /** Zoomen mit Fixpunkt unter der Maus. */
  zoomAt(sx, sy, factor) {
    const before = this.screenToWorld(sx, sy);
    this.zoom = Math.min(CAMERA.MAX_ZOOM, Math.max(CAMERA.MIN_ZOOM, this.zoom * factor));
    const after = this.screenToWorld(sx, sy);
    this.x += before.x - after.x;
    this.y += before.y - after.y;
    this.clamp();
  }

  /** Verschieben um Bildschirmpixel. */
  panScreen(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this.clamp();
  }

  /** Verschieben um Weltpixel. */
  panWorld(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  clamp() {
    if (!this.level) return;
    const halfW = this.screenW / (2 * this.zoom);
    const halfH = this.screenH / (2 * this.zoom);
    const over = CAMERA.OVERSCROLL;
    const ww = this.level.worldW, wh = this.level.worldH;

    if (ww < halfW * 2) this.x = ww / 2;
    else this.x = Math.min(ww - halfW + halfW * over, Math.max(halfW - halfW * over, this.x));
    if (wh < halfH * 2) this.y = wh / 2;
    else this.y = Math.min(wh - halfH + halfH * over, Math.max(halfH - halfH * over, this.y));
  }

  /** Sichtbarer Bereich in Zellkoordinaten (inkl. Rand). */
  visibleCells(margin, out) {
    const o = out || { x0: 0, y0: 0, x1: 0, y1: 0 };
    const halfW = this.screenW / (2 * this.zoom) / WORLD.CELL_SIZE;
    const halfH = this.screenH / (2 * this.zoom) / WORLD.CELL_SIZE;
    const cx = this.x / WORLD.CELL_SIZE, cy = this.y / WORLD.CELL_SIZE;
    o.x0 = cx - halfW - margin;
    o.x1 = cx + halfW + margin;
    o.y0 = cy - halfH - margin;
    o.y1 = cy + halfH + margin;
    return o;
  }

  /** Tastatursteuerung (WASD / Pfeiltasten). */
  applyKeys(keys, dtMs) {
    let dx = 0, dy = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1;
    if (dx === 0 && dy === 0) return false;
    const len = Math.hypot(dx, dy) || 1;
    const step = (CAMERA.PAN_SPEED * dtMs) / 1000 / this.zoom;
    this.panWorld((dx / len) * step, (dy / len) * step);
    return true;
  }
}
