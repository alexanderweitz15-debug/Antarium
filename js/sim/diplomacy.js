/**
 * diplomacy.js – Beziehungen zwischen Voelkern (Phase 11).
 *
 * GRUNDGEDANKE
 *   Jedes Paar von Voelkern hat einen Beziehungswert zwischen -1 und +1:
 *
 *      -1.0 … -0.35   Krieg        greift an, ohne zu rechnen
 *      -0.35 … 0.15   Feindselig   raubt, wenn es sich lohnt (Ausgangslage)
 *       0.15 … 0.6    Frieden      greift nicht an
 *       0.6  … 1.0    Buendnis     hilft bei Angriffen auf den Partner
 *
 *   Der Wert bewegt sich von selbst: Verluste durch den anderen druecken
 *   ihn, Zeit ohne Zwischenfall hebt ihn langsam wieder. Der Charakter der
 *   Koenigin verschiebt die Ruhelage – eine Blutruenstige kommt nie ueber
 *   "Krieg" hinaus, eine Friedfertige rutscht schnell zurueck.
 *
 * KRIEGSDUFT
 *   Der Spieler kann mit dem Werkzeug "Kriegsduft" ein Volk auf ein anderes
 *   hetzen. Trifft der Duft die KOENIGIN, erklaert sie einem zufaellig
 *   gewaehlten Nachbarn den Krieg und schickt von da an in immer kuerzeren
 *   Abstaenden immer groessere Wellen. Trifft er nur Arbeiterinnen, wirkt er
 *   schwaecher und laeuft nach einiger Zeit aus.
 *
 *   Das ist der einzige Weg, einen Krieg von aussen zu erzwingen. Alles
 *   andere – wer wen angreift, wie gross die Welle ist, wann Frieden kommt –
 *   entscheidet die Simulation.
 */

import { DIPLO } from '../config.js';
import { queenHas } from './traits.js';
import { CASTE } from './castes.js';
import { ANT_STATE } from './ants.js';
import { bus, CAT } from './events.js';

export const STANCE = { WAR: 0, HOSTILE: 1, PEACE: 2, ALLIED: 3 };
export const STANCE_LABEL = ['Krieg', 'Feindselig', 'Frieden', 'Buendnis'];
export const STANCE_COLOR = ['#d9483b', '#d9a441', '#6ec177', '#3f7fd9'];

/** Haltung aus einem Beziehungswert. */
export function stanceOf(v) {
  if (v <= DIPLO.WAR_BELOW) return STANCE.WAR;
  if (v < DIPLO.PEACE_ABOVE) return STANCE.HOSTILE;
  if (v < DIPLO.ALLY_ABOVE) return STANCE.PEACE;
  return STANCE.ALLIED;
}

export class Diplomacy {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    /**
     * Beziehungswerte als flaches Feld ueber Kolonie-IDs. Bei hoechstens
     * acht Voelkern ist eine 8x8-Matrix billiger als jede Map.
     */
    this.size = 8;
    this.rel = new Float32Array(this.size * this.size);
    /** Laufende Kriegszuege: Restticks der Hetze je Volk. */
    this.zeal = new Float32Array(this.size);
    /** Wellenzaehler je Volk – jede Welle wird groesser. */
    this.wave = new Uint16Array(this.size);
    this.reset();
  }

  reset() {
    this.rel.fill(DIPLO.START);
    for (let i = 0; i < this.size; i++) this.rel[i * this.size + i] = 1;
    this.zeal.fill(0);
    this.wave.fill(0);
  }

  _i(a, b) { return a * this.size + b; }

  /** Beziehungswert (immer symmetrisch gelesen). */
  get(a, b) {
    if (a === b) return 1;
    if (a < 0 || b < 0 || a >= this.size || b >= this.size) return DIPLO.START;
    return this.rel[this._i(a, b)];
  }

  stance(a, b) { return stanceOf(this.get(a, b)); }

  atWar(a, b) { return a !== b && this.stance(a, b) === STANCE.WAR; }

  allied(a, b) { return a !== b && this.stance(a, b) === STANCE.ALLIED; }

  /** Beziehung veraendern. Der Wert bleibt symmetrisch. */
  shift(a, b, delta) {
    if (a === b || a < 0 || b < 0 || a >= this.size || b >= this.size) return;
    const before = stanceOf(this.rel[this._i(a, b)]);
    const v = Math.max(-1, Math.min(1, this.rel[this._i(a, b)] + delta));
    this.rel[this._i(a, b)] = v;
    this.rel[this._i(b, a)] = v;
    const after = stanceOf(v);
    if (after !== before) this._announce(a, b, after);
  }

  /** Beziehung setzen (Werkzeuge, Speicherstand). */
  set(a, b, v) {
    if (a === b) return;
    const before = stanceOf(this.get(a, b));
    const nv = Math.max(-1, Math.min(1, v));
    this.rel[this._i(a, b)] = nv;
    this.rel[this._i(b, a)] = nv;
    const after = stanceOf(nv);
    if (after !== before) this._announce(a, b, after);
  }

  _announce(a, b, stance) {
    const A = this.world.colonies.get(a), B = this.world.colonies.get(b);
    if (!A || !B) return;
    const text = {
      [STANCE.WAR]: A.name + ' erklaert ' + B.name + ' den Krieg',
      [STANCE.HOSTILE]: A.name + ' und ' + B.name + ' sind nur noch feindselig',
      [STANCE.PEACE]: A.name + ' und ' + B.name + ' schliessen Frieden',
      [STANCE.ALLIED]: A.name + ' und ' + B.name + ' schliessen ein Buendnis',
    }[stance];
    bus.logEvent(CAT.KAMPF, text, {
      tick: this.world.tick, colonyId: a,
      levelId: A.nestLevelIds[0], x: -1, y: -1,
    });
  }

  // -------------------------------------------------------------------------
  // Kriegsduft
  // -------------------------------------------------------------------------

  /**
   * Kriegsduft anwenden.
   * @param {object} colony Volk, das gehetzt wird
   * @param {boolean} onQueen true, wenn der Duft die Koenigin getroffen hat
   * @param {number} power Staerke des Eingriffs
   * @returns {{ok:boolean, target?:object, reason?:string}}
   */
  incite(colony, onQueen, power, rng) {
    if (!colony || !colony.alive) return { ok: false, reason: 'kein Volk' };
    const others = this.world.colonies.colonies.filter(
      (c) => c.alive && c.id !== colony.id && c.total > 0);
    if (!others.length) return { ok: false, reason: 'kein zweites Volk vorhanden' };

    /**
     * Der Duft wirkt nur ueber die Koenigin wirklich. Auf Arbeiterinnen
     * gesprueht macht er sie kurz aggressiv, aber kein Volk fuehrt Krieg,
     * weil ein paar Sammlerinnen gereizt sind.
     */
    if (!onQueen) {
      colony.rage = Math.max(colony.rage || 0, Math.round(DIPLO.RAGE_TICKS * power));
      return { ok: true, target: null };
    }

    // Ziel: das naechstgelegene Volk, das noch nicht bekriegt wird,
    // sonst irgendeines. "Zufaellig" heisst hier: aus den plausiblen.
    const fresh = others.filter((c) => !this.atWar(colony.id, c.id));
    const pool = fresh.length ? fresh : others;
    const target = pool[rng.int(pool.length)];

    this.set(colony.id, target.id, DIPLO.WAR_BELOW - 0.3);
    colony.warTarget = target.id;
    this.zeal[colony.id] = Math.max(this.zeal[colony.id],
      Math.round(DIPLO.ZEAL_TICKS * power));
    this.wave[colony.id] = 0;
    colony.lastRaidTick = -1e9;                  // erste Welle sofort
    return { ok: true, target };
  }

  /** Friedensduft: eine bestehende Feindschaft entschaerfen. */
  pacify(colony, power) {
    if (!colony) return { ok: false, reason: 'kein Volk' };
    if (queenHas(colony, 'KEIN_FRIEDEN')) {
      return { ok: false, reason: colony.name + ' kennt keinen Frieden' };
    }
    let n = 0;
    for (const other of this.world.colonies.colonies) {
      if (other.id === colony.id || !other.alive) continue;
      if (this.get(colony.id, other.id) >= DIPLO.PEACE_ABOVE) continue;
      this.set(colony.id, other.id, DIPLO.PEACE_ABOVE + 0.1 * power);
      n++;
    }
    this.zeal[colony.id] = 0;
    colony.warTarget = -1;
    colony.rage = 0;
    return { ok: true, count: n };
  }

  /** Buendnisduft: ein Volk mit seinem naechsten Nachbarn verbuenden. */
  ally(colony, power, rng) {
    if (!colony) return { ok: false, reason: 'kein Volk' };
    const others = this.world.colonies.colonies.filter(
      (c) => c.alive && c.id !== colony.id && c.total > 0);
    if (!others.length) return { ok: false, reason: 'kein zweites Volk vorhanden' };
    const target = others[rng.int(others.length)];
    this.set(colony.id, target.id, DIPLO.ALLY_ABOVE + 0.15 * power);
    return { ok: true, target };
  }

  // -------------------------------------------------------------------------
  // Laufende Entwicklung
  // -------------------------------------------------------------------------

  /**
   * Jeden DIPLO.UPDATE_INTERVAL Ticks: Beziehungen driften zur Ruhelage,
   * Koeniginnen erklaeren von sich aus Krieg, Hetze klingt ab.
   */
  update(tick, rng) {
    if (tick % DIPLO.UPDATE_INTERVAL !== 0) return;
    const colonies = this.world.colonies.colonies;

    for (const c of colonies) {
      if (!c.alive) continue;
      if (this.zeal[c.id] > 0) this.zeal[c.id] -= DIPLO.UPDATE_INTERVAL;
      if (c.rage > 0) c.rage = Math.max(0, c.rage - DIPLO.UPDATE_INTERVAL);
    }

    for (let a = 0; a < colonies.length; a++) {
      const A = colonies[a];
      if (!A.alive) continue;
      for (let b = a + 1; b < colonies.length; b++) {
        const B = colonies[b];
        if (!B.alive) continue;

        /**
         * Ruhelage: der Mittelwert der Kriegsneigung beider Koeniginnen,
         * gespiegelt. Zwei Friedfertige treiben Richtung Buendnis, eine
         * Blutruenstige zieht jede Beziehung nach unten.
         */
        const bias = ((A.warBias || 0) + (B.warBias || 0)) * 0.5;
        const rest = -bias * DIPLO.BIAS_WEIGHT;
        const cur = this.get(A.id, B.id);
        const drift = Math.sign(rest - cur) * DIPLO.DRIFT
          * (Math.abs(rest - cur) > DIPLO.DRIFT ? 1 : 0);
        if (drift !== 0) this.shift(A.id, B.id, drift);

        // Eine aggressive Koenigin erklaert von selbst Krieg
        if (this.stance(A.id, B.id) !== STANCE.WAR) {
          for (const [me, foe] of [[A, B], [B, A]]) {
            const p = DIPLO.SELF_WAR_CHANCE * Math.max(0, me.warBias || 0)
              * (me.character ? me.character.aggression : 1);
            if (p > 0 && rng.chance(p)) {
              this.set(me.id, foe.id, DIPLO.WAR_BELOW - 0.2);
              me.warTarget = foe.id;
              this.zeal[me.id] = DIPLO.ZEAL_TICKS;
              this.wave[me.id] = 0;
              break;
            }
          }
        }
      }
    }
  }

  /**
   * Wie gross soll die naechste Welle dieses Volkes sein?
   * Jede Welle waechst, solange die Hetze anhaelt – genau das macht einen
   * Krieg spuerbar, statt nur einen Dauerzustand zu benennen.
   */
  waveSize(colony) {
    const n = this.wave[colony.id] || 0;
    const ch = colony.character ? colony.character.raidSize : 1;
    return Math.round(DIPLO.WAVE_BASE * ch * Math.pow(DIPLO.WAVE_GROWTH, n));
  }

  /** Zaehlt eine losgeschickte Welle. */
  countWave(colony) {
    if (this.wave[colony.id] < DIPLO.WAVE_MAX_STEPS) this.wave[colony.id]++;
  }

  /** Ist dieses Volk gerade auf Kriegspfad (Duft oder eigener Antrieb)? */
  onWarpath(colony) {
    return (this.zeal[colony.id] || 0) > 0;
  }

  /** Abstand zwischen zwei Wellen – auf Kriegspfad deutlich kuerzer. */
  raidInterval(colony, base) {
    return this.onWarpath(colony) ? Math.round(base * DIPLO.WARPATH_SPEEDUP) : base;
  }

  // -------------------------------------------------------------------------
  // Beistand
  // -------------------------------------------------------------------------

  /**
   * Braucht ein Verbuendeter Hilfe – und schickt dieses Volk welche?
   *
   * Ein Buendnis, das nur "wir greifen uns nicht an" bedeutet, ist keines.
   * Steht ein Verbuendeter unter Druck, ruecken Kaempferinnen aus, laufen
   * zu seinem Eingang und gehen hinein. Gekaempft wird dort ueber die
   * normale Nahkampfregel – der Angreifer ist weder das eigene Volk noch
   * ein Verbuendeter, also ein Feind.
   */
  considerAid(colony, ctx) {
    const world = this.world;
    if (world.tick - (colony.lastAidTick || -1e9) < DIPLO.AID_INTERVAL) return false;
    if ((colony.threat || 0) >= 2) return false;          // erst das eigene Haus
    if (colony.total < DIPLO.AID_MIN_POP) return false;

    let friend = null;
    for (const other of world.colonies.colonies) {
      if (!other.alive || other.id === colony.id) continue;
      if (!this.allied(colony.id, other.id)) continue;
      if ((other.threat || 0) < DIPLO.AID_THREAT) continue;
      if (!friend || other.threat > friend.threat) friend = other;
    }
    if (!friend) return false;

    /**
     * NUR KAEMPFERINNEN. Der erste Anlauf zog auch Arbeiterinnen ein und
     * schickte alle fuenfzig Sekunden achtzehn Prozent des Volkes los. Das
     * Ergebnis war ein Fleischwolf: der Helfer fiel von 330 auf 189, der
     * Beschuetzte von 122 auf 53 – schlechter als ganz ohne Buendnis.
     * Jetzt gehen ausschliesslich Soldatinnen, und nur wenn genug davon
     * zu Hause bleiben.
     */
    const soldiers = colony.population[CASTE.SOLDIER]
      + colony.population[CASTE.ARMOR] + colony.population[CASTE.TITAN];
    if (soldiers < DIPLO.AID_MIN_SOLDIERS) return false;

    const portal = world.portals.ofColony(friend.id)[0];
    if (!portal) return false;
    const ants = ctx.ants;
    const want = Math.max(4, Math.round(soldiers * DIPLO.AID_SHARE));
    let sent = 0;
    for (let i = 0; i < ants.high && sent < want; i++) {
      if (!ants.alive[i] || ants.colony[i] !== colony.id) continue;
      if (ants.level[i] !== world.levels.surface.id) continue;
      const caste = ants.caste[i];
      const fighter = caste === CASTE.SOLDIER || caste === CASTE.ARMOR || caste === CASTE.TITAN;
      if (!fighter) continue;
      const st = ants.state[i];
      if (st === ANT_STATE.RAID || st === ANT_STATE.LOOT || st === ANT_STATE.AID) continue;
      ants.state[i] = ANT_STATE.AID;
      ants.targetX[i] = portal.ax;
      ants.targetY[i] = portal.ay;
      ants.timer[i] = DIPLO.AID_TIMEOUT;
      sent++;
    }
    if (sent < 4) return false;
    colony.lastAidTick = world.tick;
    colony.aided = (colony.aided || 0) + 1;
    bus.logEvent(CAT.KAMPF, colony.name + ' schickt ' + sent
      + ' Kaempferinnen zur Hilfe nach ' + friend.name, {
      tick: world.tick, levelId: world.levels.surface.id,
      x: portal.ax, y: portal.ay, colonyId: colony.id,
    });
    return true;
  }

  /**
   * Nahrungshilfe unter Verbuendeten. Ein Volk mit vollem Lager laesst
   * einem hungernden Verbuendeten etwas zukommen – aber nur einen
   * Bruchteil und nur, solange es selbst im Ueberfluss lebt.
   */
  shareFood(tick) {
    if (tick % DIPLO.SHARE_INTERVAL !== 0) return;
    const colonies = this.world.colonies.colonies;
    for (const giver of colonies) {
      if (!giver.alive || !giver.storeArr) continue;
      for (const taker of colonies) {
        if (!taker.alive || taker.id === giver.id || !taker.storeArr) continue;
        if (!this.allied(giver.id, taker.id)) continue;
        if (!taker.starving) continue;
        for (let n = 0; n < 3; n++) {
          const spare = giver.storeArr[n] - giver.capacity[n] * DIPLO.SHARE_KEEP;
          if (spare <= 0) continue;
          const give = Math.min(spare, giver.capacity[n] * DIPLO.SHARE_RATE);
          giver.storeArr[n] -= give;
          taker.storeArr[n] = Math.min(taker.capacity[n], taker.storeArr[n] + give);
          taker.intakeAcc[n] += give;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Speicherstand
  // -------------------------------------------------------------------------
  toJSON() {
    return { rel: Array.from(this.rel), zeal: Array.from(this.zeal), wave: Array.from(this.wave) };
  }

  fromJSON(d) {
    if (!d) return;
    this.rel.set(d.rel);
    this.zeal.set(d.zeal);
    this.wave.set(d.wave);
  }
}
