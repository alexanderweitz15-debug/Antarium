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

    if (refs.pip) refs.pip.addEventListener('click', () => game.togglePip());
    if (refs.cinema) refs.cinema.addEventListener('click', () => game.toggleCinema());
    if (refs.autojump) refs.autojump.addEventListener('click', () => game.toggleAutoJump());
    if (refs.front) refs.front.addEventListener('click', () => game.toggleFront());
    if (refs.research) refs.research.addEventListener('click', () => game.togglePanel('research'));
    if (refs.stats) refs.stats.addEventListener('click', () => game.togglePanel('stats'));
    if (refs.researchClose) refs.researchClose.addEventListener('click', () => game.togglePanel('research'));
    if (refs.statsClose) refs.statsClose.addEventListener('click', () => game.togglePanel('stats'));
    if (refs.settingsBtn) refs.settingsBtn.addEventListener('click', () => game.togglePanel('settings'));
    if (refs.settingsClose) refs.settingsClose.addEventListener('click', () => game.togglePanel('settings'));
    if (refs.pheroGroup) {
      this.pheroButtons = [...refs.pheroGroup.querySelectorAll('[data-phero]')];
      this.pheroButtons.forEach((b) => {
        b.addEventListener('click', () => game.togglePhero(Number(b.dataset.phero)));
      });
    }

    refs.debug.querySelectorAll('[data-debug]').forEach((b) => {
      b.addEventListener('click', () => game.debugAction(b.dataset.debug));
    });

    refs.help.title = 'Tastenkuerzel (Taste H)';
    refs.helpPanel.innerHTML = HELP_HTML;
    refs.seed.textContent = 'v' + VERSION + ' (Phase ' + PHASE + ')';
  }

  update(state) {
    this.speedButtons.forEach((b, i) => b.classList.toggle('active', i === state.speedIndex));
    this.refs.step.disabled = state.speedIndex !== 0;
    this.refs.grid.classList.toggle('on', state.chunkGrid);
    this.refs.trans.classList.toggle('on', state.transition);
    this.refs.legendBtn.classList.toggle('on', state.legend);
    this.refs.help.classList.toggle('on', state.help);
    if (this.refs.pip) this.refs.pip.classList.toggle('on', !!state.pip);
    if (this.refs.cinema) this.refs.cinema.classList.toggle('on', state.cinema);
    if (this.refs.autojump) this.refs.autojump.classList.toggle('on', state.autoJump);
    if (this.refs.front) this.refs.front.classList.toggle('on', !!state.front);
    if (this.refs.research) this.refs.research.classList.toggle('on', state.research);
    if (this.refs.stats) this.refs.stats.classList.toggle('on', state.stats);
    if (this.refs.settingsBtn) this.refs.settingsBtn.classList.toggle('on', !!state.settings);
    if (this.pheroButtons) {
      this.pheroButtons.forEach((b, i) => b.classList.toggle('on', state.phero[i]));
    }
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
<tr><td><kbd>Leertaste</kbd></td><td>Pause / weiter</td></tr>
<tr><td><kbd>1</kbd>…<kbd>4</kbd> mit <kbd>Shift</kbd></td><td>Tempo 1x / 2x / 5x / 10x</td></tr>
<tr><td><kbd>.</kbd></td><td>Einzelschritt bei Pause</td></tr>
<tr><td><kbd>V</kbd></td><td>zurueck zum Zeiger-Werkzeug</td></tr>
<tr><td><kbd>[</kbd> <kbd>]</kbd> / Shift+Mausrad</td><td>Pinselgroesse</td></tr>
<tr><td>Linke Maustaste mit Werkzeug</td><td>malen (ziehen moeglich)</td></tr>
<tr><td>Mittlere Maustaste</td><td>Karte ziehen (immer)</td></tr>
<tr><td><kbd>L</kbd></td><td>Legende ein/aus</td></tr>
<tr><td><kbd>G</kbd></td><td>Chunk-Raster ein/aus</td></tr>
<tr><td><kbd>B</kbd></td><td>Bild-in-Bild (andere Ebene beobachten)</td></tr>
<tr><td><kbd>C</kbd></td><td>Kinomodus</td></tr>
<tr><td><kbd>F</kbd></td><td>ausgewaehlter Einheit folgen</td></tr>
<tr><td><kbd>K</kbd></td><td>Kamera folgt dem Schwerpunkt der Kaempfe</td></tr>
<tr><td><kbd>R</kbd></td><td>Forschungsmenue (Evolution im Zeitraffer)</td></tr>
<tr><td><kbd>T</kbd></td><td>Stammbaum und Statistik</td></tr>
<tr><td><kbd>O</kbd></td><td>Einstellungen und Spielstaende</td></tr>
<tr><td><kbd>Strg</kbd>+<kbd>S</kbd> / <kbd>Strg</kbd>+<kbd>L</kbd></td><td>schnell speichern / laden</td></tr>
<tr><td><kbd>P</kbd></td><td>Nahrungsspuren einblenden</td></tr>
<tr><td><kbd>F3</kbd></td><td>Performance-Overlay</td></tr>
<tr><td><kbd>F4</kbd></td><td>Debug-Menue</td></tr>
<tr><td><kbd>H</kbd></td><td>diese Hilfe</td></tr>
</table>
<h3>Voelker aufeinander hetzen</h3>
<table>
<tr><td><b>Kriegsduft</b> auf die <b>Koenigin</b></td><td>ihr Volk erklaert einem Nachbarn den
Krieg und schickt immer groessere Wellen. Auf Arbeiterinnen gesprueht macht er sie nur gereizt.</td></tr>
<tr><td><b>Friedensduft</b></td><td>beendet alle Feindschaften des getroffenen Volkes.
Bei einer blutruenstigen Koenigin wirkungslos.</td></tr>
<tr><td><b>Buendnisduft</b></td><td>verbuendet zwei Voelker. Verbuendete greifen einander nie an.</td></tr>
<tr><td>Die Koenigin sitzt</td><td>in ihrer Kammer tief im Nest – dorthin wechseln und
in die Kammer zielen.</td></tr>
</table>
<h3>Charakter und Eigenschaften</h3>
<table>
<tr><td>Jede <b>Koenigin</b></td><td>hat einen Charakter (bis zu drei Zuege), der ihr ganzes
Volk praegt: Eierrate, Soldatenanteil, Bautrieb, Kriegsneigung.</td></tr>
<tr><td>Jede <b>Ameise</b></td><td>wird mit bis zu zwei Eigenschaften geboren. Anklicken zeigt
sie im Inspektor.</td></tr>
<tr><td>Forschungsmenue</td><td>Charakter ansehen, einzeln umschalten oder neu wuerfeln.</td></tr>
</table>
<h3>Bauen und Forschen</h3>
<table>
<tr><td>Die Kolonie forscht</td><td>von selbst, waehrend sie arbeitet. Es gibt keinen Knopf.</td></tr>
<tr><td>Baustoffe</td><td>Kiesel, Harz, Lehm (am Wasser und tief unter der Erde),
Kalk (aus Stein), Chitin (von erlegten Tieren).</td></tr>
<tr><td>Bauwerke</td><td>Saeurespeier, Harzschleuder, Wachposten, Speicherbau, Brutstube,
Werkstatt – je drei Stufen.</td></tr>
<tr><td>Im Sandkasten</td><td>Bauwerke direkt setzen (Gruppe "Bauwerke") oder den
Forschungsbaum anklicken.</td></tr>
</table>`;
