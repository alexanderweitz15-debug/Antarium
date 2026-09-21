/**
 * hud.js – Obere Leiste: Geschwindigkeit, Schalter, Seed, Debug- und
 * Hilfefenster. Reine Anzeige-/Eingabeschicht, alle Aktionen laufen ueber
 * die Fassade aus main.js.
 */

import { SIM, VERSION, PHASE } from '../config.js';

export class Hud {
  /**
   * @param {object} refs  DOM-Referenzen
   * @param {object} game  Fassade (setSpeed, step, ...)
   */
  constructor(refs, game) {
    this.refs = refs;
    this.game = game;
    this.speedButtons = [];

    // --- Geschwindigkeitsschalter ---------------------------------------
    SIM.SPEEDS.forEach((s, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = s === 0 ? 'Pause' : s + 'x';
      b.title = s === 0 ? 'Pause (Leertaste)' : 'Tempo ' + s + 'x';
      b.addEventListener('click', () => game.setSpeedIndex(i));
      refs.speed.appendChild(b);
      this.speedButtons.push(b);
    });

    refs.step.addEventListener('click', () => game.step());
    refs.grid.addEventListener('click', () => game.toggleChunkGrid());
    refs.trans.addEventListener('click', () => game.toggleTransition());
    refs.legendBtn.addEventListener('click', () => game.togglePanel('legend'));
    refs.help.addEventListener('click', () => game.togglePanel('help'));
    refs.inspClose.addEventListener('click', () => game.clearSelection());

    refs.debug.querySelectorAll('[data-debug]').forEach((b) => {
      b.addEventListener('click', () => game.debugAction(b.dataset.debug));
    });

    refs.help.title = 'Tastenkuerzel (Taste H)';
    refs.helpPanel.innerHTML = HELP_HTML;
    refs.seed.textContent = 'Seed ' + game.world.seed + '  |  v' + VERSION + ' (Phase ' + PHASE + ')';
  }

  update(state) {
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', i === state.speedIndex));
    this.refs.step.disabled = state.speedIndex !== 0;
    this.refs.grid.classList.toggle('on', state.chunkGrid);
    this.refs.trans.classList.toggle('on', state.transition);
    this.refs.legendBtn.classList.toggle('on', state.legend);
    this.refs.help.classList.toggle('on', state.help);
  }
}

const HELP_HTML = `
<table>
<tr><td><kbd>Linksklick</kbd> Nesteingang</td><td>in die Nest-Ebene wechseln</td></tr>
<tr><td><kbd>Linksklick</kbd> Ameise</td><td>auswaehlen und im Inspektor anzeigen</td></tr>
<tr><td><kbd>Esc</kbd> / <kbd>Backspace</kbd></td><td>zurueck zur Oberflaeche</td></tr>
<tr><td><kbd>0</kbd> … <kbd>8</kbd></td><td>Oberflaeche bzw. Nest-Ebene direkt</td></tr>
<tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / Pfeile</td><td>Kamera verschieben</td></tr>
<tr><td>Mausrad</td><td>Zoom auf Mausposition</td></tr>
<tr><td>Mittlere Maustaste / <kbd>Space</kbd>+Ziehen</td><td>Karte ziehen</td></tr>
<tr><td><kbd>Leertaste</kbd></td><td>Pause / weiter</td></tr>
<tr><td><kbd>1</kbd>…<kbd>4</kbd> mit <kbd>Shift</kbd></td><td>Tempo 1x / 2x / 5x / 10x</td></tr>
<tr><td><kbd>.</kbd></td><td>Einzelschritt bei Pause</td></tr>
<tr><td><kbd>L</kbd></td><td>Legende ein/aus</td></tr>
<tr><td><kbd>G</kbd></td><td>Chunk-Raster ein/aus</td></tr>
<tr><td><kbd>F3</kbd></td><td>Performance-Overlay</td></tr>
<tr><td><kbd>F4</kbd></td><td>Debug-Menue</td></tr>
<tr><td><kbd>H</kbd></td><td>diese Hilfe</td></tr>
</table>`;
