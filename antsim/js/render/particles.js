/**
 * particles.js – Teilchen (Phase 10).
 *
 * Bewusst klein gehalten: EIN Graphics-Objekt, das jeden Frame neu gefuellt
 * wird, und ein Ringpuffer fester Groesse ohne jede Allokation im Betrieb.
 * Teilchen sind reine Anzeige – sie stehen NICHT in der Simulation und
 * beeinflussen den Verlauf nicht. Deshalb duerfen sie Math.random()
 * benutzen: der Determinismus der Welt bleibt unberuehrt.
 *
 * Sie leben in Weltkoordinaten der jeweiligen Ebene; beim Ebenenwechsel
 * werden die Teilchen fremder Ebenen einfach nicht gezeichnet.
 */

import { PIXI } from './pixi.js';
import { PARTICLES, WORLD } from '../config.js';

const KIND = ['dust', 'spark', 'splash', 'gore', 'leaf'];
export const PKIND = { DUST: 0, SPARK: 1, SPLASH: 2, GORE: 3, LEAF: 4 };

const COLORS = [
  [0x8a6a44, 0x6d5335, 0xa07f55],   // dust  – Erde
  [0xffe089, 0xffb347, 0xfff4c2],   // spark – Blitz und Feuer
  [0x6fa8d6, 0x9ecbe8, 0x4a83b4],   // splash– Wasser
  [0xb03a2e, 0x8c2f24, 0xd05a4a],   // gore  – Kampf
  [0x6fae4c, 0x8cc45f, 0x4f8a38],   // leaf  – Pflanzenreste
];

export class Particles {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = PARTICLES.ENABLED;
    const n = PARTICLES.MAX;
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.kind = new Uint8Array(n);
    this.color = new Uint32Array(n);
    this.size = new Float32Array(n);
    this.level = new Int16Array(n);
    this.head = 0;
    this.count = 0;
    this.g = new PIXI.Graphics();
  }

  attach(parent) { parent.addChild(this.g); }

  clear() { this.count = 0; this.head = 0; this.g.clear(); }

  /**
   * Ausbruch von Teilchen an einer Zelle.
   * @param {number} levelId
   * @param {number} cx Zellkoordinate
   * @param {number} cy Zellkoordinate
   * @param {number} kind Index aus PKIND
   * @param {number} n Anzahl
   * @param {number} spread Anfangsgeschwindigkeit
   */
  burst(levelId, cx, cy, kind, n, spread = 0.9) {
    if (!this.enabled) return;
    const pal = COLORS[kind] || COLORS[0];
    const base = PARTICLES.LIFE[KIND[kind]] || 24;
    const size = PARTICLES.SIZE[KIND[kind]] || 2;
    for (let k = 0; k < n; k++) {
      const i = this.head;
      this.head = (this.head + 1) % PARTICLES.MAX;
      if (this.count < PARTICLES.MAX) this.count++;
      const a = Math.random() * Math.PI * 2;
      const v = spread * (0.35 + Math.random() * 0.9);
      this.x[i] = (cx + 0.5) * WORLD.CELL_SIZE + (Math.random() - 0.5) * WORLD.CELL_SIZE;
      this.y[i] = (cy + 0.5) * WORLD.CELL_SIZE + (Math.random() - 0.5) * WORLD.CELL_SIZE;
      this.vx[i] = Math.cos(a) * v;
      this.vy[i] = Math.sin(a) * v - (kind === PKIND.SPARK ? 0.5 : 0.25);
      this.maxLife[i] = base * (0.7 + Math.random() * 0.6);
      this.life[i] = this.maxLife[i];
      this.kind[i] = kind;
      this.color[i] = pal[(Math.random() * pal.length) | 0];
      this.size[i] = size * (0.7 + Math.random() * 0.7);
      this.level[i] = levelId;
    }
  }

  /**
   * Bewegen und zeichnen. dtFrames = vergangene Frames bei 60 Hz, damit die
   * Teilchen bei schwankender Bildrate gleich schnell fallen.
   */
  update(activeLevelId, dtFrames) {
    if (!this.enabled) { if (this.count) this.clear(); return; }
    const g = this.g;
    g.clear();
    const dt = Math.min(3, Math.max(0.2, dtFrames));
    const drag = Math.pow(PARTICLES.DRAG, dt);
    let live = 0;
    for (let i = 0; i < PARTICLES.MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      this.vy[i] += PARTICLES.GRAVITY * dt;
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      live++;
      if (this.level[i] !== activeLevelId) continue;
      const t = this.life[i] / this.maxLife[i];
      const s = this.size[i] * (0.4 + t * 0.6);
      g.rect(this.x[i] - s / 2, this.y[i] - s / 2, s, s)
        .fill({ color: this.color[i], alpha: Math.min(1, t * 1.4) });
    }
    this.count = live;
  }
}
