/**
 * research.js – Forschungsmenue (Sandbox).
 *
 * Hier laesst sich die Evolution im Zeitraffer betreiben, ohne die Regeln zu
 * umgehen: alle Regler veraendern nur Parameter, die die Simulation ohnehin
 * benutzt (Mutationsstaerke, Flughaeufigkeit, Ernaehrungseinfluss,
 * Nahrungsnachwuchs, Raeuberdichte). Dazu kommen ein Genom-Editor und ein
 * Schnelldurchlauf, der Ticks ohne Rendering rechnet.
 *
 * Bewusst getrennt von den Werkzeugen: Werkzeuge veraendern die WELT,
 * das Forschungsmenue veraendert die REGELN.
 */

import { EVO, FOOD, CREATURES, RESEARCH, GENES, CASTE_UNLOCK, NUTRIENT_NAMES } from '../config.js';
import { CASTE_BY_KEY, CASTE_DEFS } from '../sim/castes.js';
import { mutationForecast, unlockedCastes } from '../sim/genome.js';
import { bus, CAT } from '../sim/events.js';

export class ResearchPanel {
  /**
   * @param {HTMLElement} el
   * @param {import('../sim/world.js').World} world
   * @param {object} game Fassade aus main.js
   */
  constructor(el, world, game, sprites) {
    this.el = el;
    this.world = world;
    this.game = game;
    this.sprites = sprites;
    this.colonyId = 0;
    this.built = false;
    this.signature = '';
  }

  /** Aufbau beim ersten Oeffnen; danach nur noch Werte auffrischen. */
  build() {
    if (this.built) return;
    this.built = true;
    this.el.textContent = '';

    // --- Evolution ---------------------------------------------------------
    const evo = section('Evolution');
    evo.appendChild(this._steps('Mutationsstaerke', RESEARCH.MUTATION_STEPS, EVO.MUTATION_SCALE,
      (v) => { EVO.MUTATION_SCALE = v; this._log('Mutationsstaerke auf x' + v + ' gesetzt'); }));
    evo.appendChild(this._steps('Hochzeitsfluege', RESEARCH.FLIGHT_STEPS, EVO.FLIGHT_SCALE,
      (v) => { EVO.FLIGHT_SCALE = v; this._log('Hochzeitsflug-Haeufigkeit auf x' + v + ' gesetzt'); }));
    evo.appendChild(this._choice('Ernaehrungseinfluss',
      [['realistisch', 'Realistisch'], ['standard', 'Standard'], ['stark', 'Stark']],
      this.world.biasMode,
      (v) => { this.world.biasMode = v; this._log('Ernaehrungseinfluss: ' + v); }));
    this.el.appendChild(evo);

    // --- Umwelt ------------------------------------------------------------
    const env = section('Umwelt');
    env.appendChild(this._steps('Nahrungsnachwuchs', RESEARCH.FOOD_STEPS, FOOD.REGROW_SCALE,
      (v) => { FOOD.REGROW_SCALE = v; this._log('Nahrungsnachwuchs auf x' + v); }));
    env.appendChild(this._steps('Raeuberdichte', RESEARCH.PREDATOR_STEPS, CREATURES.DENSITY_SCALE,
      (v) => { CREATURES.DENSITY_SCALE = v; this._log('Raeuberdichte auf x' + v); }));
    this.el.appendChild(env);

    // --- Zeitraffer --------------------------------------------------------
    const ff = section('Zeitraffer');
    const row = document.createElement('div');
    row.className = 'tool-row wrap';
    for (const mins of [1, 5, 15]) {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = '+' + mins + ' min';
      b.title = mins + ' Minuten Spielzeit ohne Bild berechnen';
      b.addEventListener('click', () => this.game.fastForward(mins * 60 * 30));
      row.appendChild(b);
    }
    ff.appendChild(row);
    const flightRow = document.createElement('div');
    flightRow.className = 'tool-row wrap';
    const flightBtn = document.createElement('button');
    flightBtn.className = 'btn';
    flightBtn.textContent = 'Hochzeitsflug jetzt';
    flightBtn.title = 'Loest fuer die gewaehlte Kolonie sofort einen Schwarmflug aus';
    flightBtn.addEventListener('click', () => {
      if (this.world.forceFlight(this.colonyId)) this._log('Hochzeitsflug ausgeloest');
    });
    flightRow.appendChild(flightBtn);
    ff.appendChild(flightRow);
    this.el.appendChild(ff);

    // --- Kolonieauswahl ----------------------------------------------------
    const pick = section('Kolonie');
    this.colonyRow = document.createElement('div');
    this.colonyRow.className = 'tool-row wrap';
    pick.appendChild(this.colonyRow);
    this.el.appendChild(pick);

    // --- Genom-Editor ------------------------------------------------------
    const gen = section('Genom-Editor');
    this.geneBox = document.createElement('div');
    this.geneBox.className = 'gene-grid';
    gen.appendChild(this.geneBox);
    const randRow = document.createElement('div');
    randRow.className = 'tool-row wrap';
    const randBtn = document.createElement('button');
    randBtn.className = 'btn';
    randBtn.textContent = 'Zufallsgenom';
    randBtn.addEventListener('click', () => {
      const c = this.world.colonies.get(this.colonyId);
      if (!c) return;
      for (const d of GENES) c.genome[d.key] = this.world.rngSim.float();
      this._log(c.name + ': Genom zufaellig gesetzt');
      this.refresh(true);
    });
    randRow.appendChild(randBtn);
    gen.appendChild(randRow);
    this.el.appendChild(gen);

    // --- Kasten freischalten ----------------------------------------------
    const cast = section('Evolutionaere Kasten');
    this.casteBox = document.createElement('div');
    cast.appendChild(this.casteBox);
    this.el.appendChild(cast);

    // --- Prognose ----------------------------------------------------------
    const fc = section('Mutationsprognose');
    this.forecastBox = document.createElement('div');
    this.forecastBox.className = 'forecast';
    fc.appendChild(this.forecastBox);
    this.el.appendChild(fc);
  }

  /** Werte auffrischen (guenstig, laeuft nur bei offenem Panel). */
  refresh(force = false) {
    if (this.el.hidden) return;
    this.build();
    const colonies = this.world.colonies.colonies;
    if (!colonies.some((c) => c.id === this.colonyId && c.alive)) {
      const first = colonies.find((c) => c.alive);
      if (first) this.colonyId = first.id;
    }
    const colony = this.world.colonies.get(this.colonyId);
    const sig = colonies.map((c) => c.id + (c.alive ? '1' : '0')).join(',') + '|' + this.colonyId;
    if (sig !== this.signature || force) {
      this.signature = sig;
      this._buildColonyRow(colonies);
      this._buildGenes(colony);
      this._buildCastes(colony);
    }
    this._updateGenes(colony);
    this._updateForecast(colony);
  }

  _buildColonyRow(colonies) {
    this.colonyRow.textContent = '';
    for (const c of colonies) {
      const b = document.createElement('button');
      b.className = 'swatch-btn' + (c.id === this.colonyId ? ' on' : '');
      b.style.background = c.colorCss;
      b.style.opacity = c.alive ? '1' : '0.35';
      b.title = c.name + (c.alive ? ' – ' + c.total + ' Ameisen' : ' (ausgestorben)');
      b.addEventListener('click', () => { this.colonyId = c.id; this.refresh(true); });
      this.colonyRow.appendChild(b);
    }
  }

  _buildGenes(colony) {
    this.geneBox.textContent = '';
    this._sliders = [];
    if (!colony || !colony.genome) return;
    for (const d of GENES) {
      const label = document.createElement('label');
      label.className = 'gene-name';
      label.textContent = d.name;
      label.title = 'Gruppe: ' + d.group;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0'; input.max = '1'; input.step = '0.01';
      input.value = String(colony.genome[d.key]);
      input.className = 'gene-slider';
      const out = document.createElement('span');
      out.className = 'gene-val';
      out.textContent = colony.genome[d.key].toFixed(2);
      input.addEventListener('input', () => {
        const c = this.world.colonies.get(this.colonyId);
        if (!c) return;
        c.genome[d.key] = Number(input.value);
        out.textContent = c.genome[d.key].toFixed(2);
        c.unlocked = unlockedCastes(c);
      });
      this.geneBox.appendChild(label);
      this.geneBox.appendChild(input);
      this.geneBox.appendChild(out);
      this._sliders.push({ key: d.key, input, out });
    }
  }

  _updateGenes(colony) {
    if (!this._sliders || !colony || !colony.genome) return;
    for (const s of this._sliders) {
      const v = colony.genome[s.key];
      if (document.activeElement === s.input) continue;
      if (Math.abs(Number(s.input.value) - v) > 0.005) {
        s.input.value = String(v);
        s.out.textContent = v.toFixed(2);
      }
    }
  }

  _buildCastes(colony) {
    this.casteBox.textContent = '';
    if (!colony) return;
    const unlocked = unlockedCastes(colony);
    for (const [key, rule] of Object.entries(CASTE_UNLOCK)) {
      const def = CASTE_BY_KEY.get(key);
      if (!def) continue;
      const row = document.createElement('div');
      row.className = 'caste-row';
      const ok = unlocked.has(key);
      const have = colony.knownCastes.has(def.id);
      row.innerHTML = '<img src="' + this.sprites.dataURL('ant_' + key, 0) + '" alt="">'
        + '<span class="caste-name' + (ok ? ' ok' : '') + '">' + def.name + '</span>'
        + '<span class="caste-req">' + rule.gene + ' ' + colony.genome[rule.gene].toFixed(2)
        + '/' + rule.at + (have ? ' ✓' : '') + '</span>';
      const b = document.createElement('button');
      b.className = 'btn tiny';
      b.textContent = ok ? 'erfuellt' : 'freischalten';
      b.disabled = ok;
      b.title = 'Setzt die noetigen Gene knapp ueber die Schwelle';
      b.addEventListener('click', () => {
        const c = this.world.colonies.get(this.colonyId);
        if (!c) return;
        c.genome[rule.gene] = Math.min(1, rule.at + 0.05);
        if (rule.gene2) c.genome[rule.gene2] = Math.min(1, rule.at2 + 0.05);
        for (const need of rule.needs) {
          const nd = CASTE_BY_KEY.get(need);
          const nr = CASTE_UNLOCK[need];
          if (nd && !c.knownCastes.has(nd.id)) {
            if (nr) {
              c.genome[nr.gene] = Math.min(1, nr.at + 0.05);
              if (nr.gene2) c.genome[nr.gene2] = Math.min(1, nr.at2 + 0.05);
            }
            c.knownCastes.add(nd.id);
          }
        }
        c.unlocked = unlockedCastes(c);
        this._log(c.name + ': ' + def.name + ' freigeschaltet');
        this.refresh(true);
      });
      row.appendChild(b);
      this.casteBox.appendChild(row);
    }
  }

  _updateForecast(colony) {
    if (!colony || !colony.balanceArr) return;
    const fc = mutationForecast(colony);
    const parts = [];
    for (const g of fc) {
      const pct = Math.round((g.factor - 1) * 100);
      parts.push('<div><b>' + g.name + '</b> ' + (pct >= 0 ? '+' : '') + pct + ' % Mutationsstaerke</div>');
    }
    const bias = EVO.BIAS_MODES[this.world.biasMode] || 0;
    const b = colony.balanceArr;
    parts.push('<div class="tiny">Bilanz ' + NUTRIENT_NAMES.map((n, i) => n + ' ' + b[i].toFixed(2)).join(', ')
      + ' &middot; Stress ' + colony.stress.toFixed(2) + '</div>');
    parts.push('<div class="tiny">Richtungsneigung: ' + (bias === 0 ? 'aus (Realistisch)' : 'x' + bias) + '</div>');
    this.forecastBox.innerHTML = parts.join('');
  }

  _steps(label, values, current, onPick) {
    const box = document.createElement('div');
    box.className = 'res-row';
    const l = document.createElement('div');
    l.className = 'res-label';
    l.textContent = label;
    box.appendChild(l);
    const row = document.createElement('div');
    row.className = 'tool-row wrap';
    for (const v of values) {
      const b = document.createElement('button');
      b.className = 'btn tiny' + (Math.abs(v - current) < 1e-6 ? ' active' : '');
      b.textContent = v === 0 ? 'aus' : 'x' + v;
      b.addEventListener('click', () => {
        onPick(v);
        for (const other of row.children) other.classList.remove('active');
        b.classList.add('active');
      });
      row.appendChild(b);
    }
    box.appendChild(row);
    return box;
  }

  _choice(label, options, current, onPick) {
    const box = document.createElement('div');
    box.className = 'res-row';
    const l = document.createElement('div');
    l.className = 'res-label';
    l.textContent = label;
    box.appendChild(l);
    const row = document.createElement('div');
    row.className = 'tool-row wrap';
    for (const [value, name] of options) {
      const b = document.createElement('button');
      b.className = 'btn tiny' + (value === current ? ' active' : '');
      b.textContent = name;
      b.addEventListener('click', () => {
        onPick(value);
        for (const other of row.children) other.classList.remove('active');
        b.classList.add('active');
      });
      row.appendChild(b);
    }
    box.appendChild(row);
    return box;
  }

  _log(text) {
    bus.logEvent(CAT.EVOLUTION, 'Forschung: ' + text, { tick: this.world.tick });
  }
}

function section(title) {
  const box = document.createElement('div');
  box.className = 'tool-group';
  const h = document.createElement('h3');
  h.textContent = title;
  box.appendChild(h);
  return box;
}

export { CASTE_DEFS };
