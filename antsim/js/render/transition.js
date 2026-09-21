/**
 * transition.js – Uebergang zwischen zwei Ebenen.
 *
 * Ablauf (Gesamtdauer TRANSITION.DURATION_MS):
 *   1. Haelfte: Kamera zieht auf den angeklickten Eingang und zoomt hinein,
 *      die Blende wird schwarz.
 *   2. Umschalten der aktiven Ebene (Callback).
 *   3. Haelfte: Kamera startet am Gegenstueck leicht hineingezoomt und faehrt
 *      auf den Zielzoom zurueck, die Blende wird wieder klar.
 *
 * Abschaltbar ueber TRANSITION.ENABLED bzw. setEnabled(); dann wird sofort
 * umgeschaltet.
 */

import { TRANSITION, WORLD } from '../config.js';

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class Transition {
  /**
   * @param {import('./camera.js').Camera} camera
   * @param {import('./renderer.js').Renderer} renderer
   */
  constructor(camera, renderer) {
    this.camera = camera;
    this.renderer = renderer;
    this.enabled = TRANSITION.ENABLED;
    this.active = false;
    this.t = 0;
    this.phase = 0; // 0 = hinein, 1 = heraus
    this.onSwap = null;
    this._from = { x: 0, y: 0, zoom: 1 };
    this._to = { x: 0, y: 0, zoom: 1 };
  }

  setEnabled(on) { this.enabled = on; }

  /**
   * Uebergang starten.
   * toCell === null bedeutet: die Kamera behaelt, was onSwap() geladen hat
   * (gemerkte Position der Zielebene) – nur der Zoom wird herangefahren.
   * @param {{fromCell:{x:number,y:number}|null, toCell:{x:number,y:number}|null, toZoom?:number, onSwap:Function}} opts
   */
  start(opts) {
    const toZoom = opts.toZoom !== undefined ? opts.toZoom : TRANSITION.ARRIVE_ZOOM;
    if (!this.enabled) {
      opts.onSwap();
      if (opts.toCell) this.camera.focusCell(opts.toCell.x, opts.toCell.y, toZoom);
      else { this.camera.zoom = toZoom; this.camera.clamp(); }
      this.renderer.setFade(0);
      return;
    }
    this.active = true;
    this.t = 0;
    this.phase = 0;
    this.onSwap = opts.onSwap;
    this.toCell = opts.toCell;
    this.toZoom = toZoom;

    this._from.x = this.camera.x;
    this._from.y = this.camera.y;
    this._from.zoom = this.camera.zoom;
    if (opts.fromCell) {
      this._to.x = (opts.fromCell.x + 0.5) * WORLD.CELL_SIZE;
      this._to.y = (opts.fromCell.y + 0.5) * WORLD.CELL_SIZE;
    } else {
      this._to.x = this.camera.x;
      this._to.y = this.camera.y;
    }
    this._to.zoom = this._from.zoom * TRANSITION.ZOOM_IN_FACTOR;
  }

  /** @param {number} dtMs echte Zeit (unabhaengig von der Simulationsgeschwindigkeit) */
  update(dtMs) {
    if (!this.active) return;
    const half = TRANSITION.DURATION_MS / 2;
    this.t += dtMs;

    if (this.phase === 0) {
      const p = Math.min(1, this.t / half);
      const e = easeInOut(p);
      this.camera.x = this._from.x + (this._to.x - this._from.x) * e;
      this.camera.y = this._from.y + (this._to.y - this._from.y) * e;
      this.camera.zoom = this._from.zoom + (this._to.zoom - this._from.zoom) * e;
      this.renderer.setFade(e);
      if (p >= 1) {
        this.phase = 1;
        this.t = 0;
        this.onSwap();
        // Auf der neuen Ebene leicht hineingezoomt starten und herausfahren.
        if (this.toCell) {
          this.camera.focusCell(this.toCell.x, this.toCell.y, this.toZoom * TRANSITION.ZOOM_IN_FACTOR);
        } else {
          this.camera.zoom = this.toZoom * TRANSITION.ZOOM_IN_FACTOR;
          this.camera.clamp();
        }
        this._from.zoom = this.camera.zoom;
      }
    } else {
      const p = Math.min(1, this.t / half);
      const e = easeInOut(p);
      this.camera.zoom = this._from.zoom + (this.toZoom - this._from.zoom) * e;
      this.camera.clamp();
      this.renderer.setFade(1 - e);
      if (p >= 1) {
        this.active = false;
        this.renderer.setFade(0);
      }
    }
  }
}
