/**
 * perf.js – Performance-Overlay (Taste F3).
 *
 * Zeigt FPS, Tickdauer pro System, Tickdauer und Einheitenzahl PRO EBENE
 * sowie die Renderkennzahlen (sichtbare Sprites, neu hochgeladene Chunks).
 * Die Werte werden geglaettet, damit die Anzeige lesbar bleibt.
 */

import { PERF, SIM } from '../config.js';
import { pixiSource } from '../render/pixi.js';
import { PIXI_VERSION } from '../config.js';

export class PerfOverlay {
  constructor(el) {
    this.el = el;
    this.visible = false;
    this.fps = 60;
    this.frameMs = 0;
    this.tickMs = 0;
    this.lastUpdate = 0;
    this.ticksThisFrame = 0;
    this.sysMs = { buckets: 0, build: 0, spatial: 0, ants: 0 };
    this.levelMs = new Map();
  }

  toggle() {
    this.visible = !this.visible;
    this.el.hidden = !this.visible;
  }

  /** Messwerte eines Frames einspeisen (geglaettet). */
  sample(frameMs, world, ticks) {
    const k = PERF.SMOOTHING;
    this.frameMs = this.frameMs * k + frameMs * (1 - k);
    if (frameMs > 0) this.fps = this.fps * k + (1000 / frameMs) * (1 - k);
    this.ticksThisFrame = this.ticksThisFrame * k + ticks * (1 - k);
    if (ticks > 0) {
      this.tickMs = this.tickMs * k + world.perf.total * (1 - k);
      this.sysMs.buckets = this.sysMs.buckets * k + world.perf.buckets * (1 - k);
      this.sysMs.build = this.sysMs.build * k + world.perf.build * (1 - k);
      this.sysMs.spatial = this.sysMs.spatial * k + world.perf.spatial * (1 - k);
      this.sysMs.ants = this.sysMs.ants * k + world.perf.ants * (1 - k);
      for (const [id, ms] of world.perf.levels) {
        this.levelMs.set(id, (this.levelMs.get(id) || 0) * k + ms * (1 - k));
      }
    }
  }

  /** Text nur alle PERF.UPDATE_MS neu bauen (DOM-Schreiben ist teuer). */
  render(nowMs, world, renderer, speed) {
    if (!this.visible) return;
    if (nowMs - this.lastUpdate < PERF.UPDATE_MS) return;
    this.lastUpdate = nowMs;

    const L = [];
    const fps = this.fps;
    L.push('FPS ' + pad(fps.toFixed(1), 5) + '  Frame ' + pad(this.frameMs.toFixed(2), 6) + ' ms'
      + (fps < 55 ? '   <LANGSAM>' : ''));
    L.push('Tempo ' + (speed === 0 ? 'Pause' : speed + 'x') + '   Tick ' + world.tick
      + '   Ticks/Frame ' + this.ticksThisFrame.toFixed(1));
    L.push('');
    L.push('Simulation (' + SIM.TICK_RATE + ' Ticks/s)');
    L.push('  gesamt      ' + pad(this.tickMs.toFixed(3), 7) + ' ms  = '
      + pad((this.tickMs / SIM.TICK_MS * 100).toFixed(1), 5) + ' % eines Ticks');
    L.push('  Buckets     ' + pad(this.sysMs.buckets.toFixed(3), 7) + ' ms');
    L.push('  Bau+Felder  ' + pad(this.sysMs.build.toFixed(3), 7) + ' ms');
    L.push('  SpatialHash ' + pad(this.sysMs.spatial.toFixed(3), 7) + ' ms');
    L.push('  Ameisen     ' + pad(this.sysMs.ants.toFixed(3), 7) + ' ms');
    L.push('');
    L.push('Ebenen (alle werden simuliert)');
    for (const level of world.levels.levels) {
      const ms = this.levelMs.get(level.id) || 0;
      L.push('  ' + (level.id === world.levels.activeId ? '>' : ' ') + pad(level.name, 14)
        + pad(level.antCount, 6) + ' A  ' + pad(ms.toFixed(3), 7) + ' ms'
        + '  dirty ' + level.dirtyCount
        + (level.kind === 1 ? '  Luft ' + level.airCount : ''));
    }
    L.push('');
    L.push('Rendering');
    L.push('  Sprites     ' + pad(renderer.stats.visibleAnts, 6) + ' sichtbar von ' + world.ants.count);
    L.push('  Chunks      ' + pad(renderer.stats.chunkUploads, 6) + ' /Frame  (gesamt '
      + renderer.stats.chunkUploadsTotal + ')');
    L.push('  Malzeit     ' + pad(renderer.stats.paintMs.toFixed(3), 7) + ' ms');
    L.push('  Vorbereiten ' + pad(renderer.stats.frameMs.toFixed(3), 7) + ' ms');
    L.push('  GPU-Aufruf  ' + pad(renderer.stats.drawMs.toFixed(3), 7) + ' ms');
    L.push('  Portale     ' + world.portals.portals.length + ', im Schacht '
      + world.portals.portals.reduce((s, p) => s + p.inTransit, 0)
      + ', Durchgaenge ' + world.totalPassages);
    L.push('  Gegraben    ' + world.totalDug + ' Zellen, offene Auftraege '
      + world.colonies.colonies.reduce((s, c) => s + (c.digQueue ? c.digQueue.length : 0), 0));
    L.push('');
    L.push('PixiJS ' + PIXI_VERSION + ' (' + pixiSource + ')   Seed "' + world.seed + '"');

    this.el.textContent = L.join('\n');
  }
}

function pad(v, n) {
  const s = String(v);
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}
