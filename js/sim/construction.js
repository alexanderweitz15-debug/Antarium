/**
 * construction.js – Nestbau: Grabauftraege planen und abarbeiten.
 *
 * Vorgezogen aus Phase 3, damit man Ameisen beim Tunnelbau zusehen kann.
 * Absichtlich einfach gehalten:
 *
 *   1. Die Kolonie fuehrt eine Warteschlange aus Grabauftraegen (Zellindizes).
 *   2. Immer nur der ERSTE offene Auftrag ist die aktive Baustelle. Alle
 *      grabenden Ameisen laufen dorthin (ein Distanzfeld reicht) – das sieht
 *      aus wie ein Trupp an der Tunnelbrust und ist genau das, was echte
 *      Ameisen tun.
 *   3. Jede Ameise in Reichweite steuert Grabpunkte bei. Sind genug Punkte
 *      zusammen, wird die Zelle zu Tunnel bzw. Kammerboden, und die Ameise,
 *      die den letzten Punkt beigesteuert hat, nimmt den Aushub mit.
 *   4. Der Aushub wandert durch das Portal an die Oberflaeche und landet dort
 *      als Erdhuegel (siehe ants.js, _arrive).
 *
 * Geplant wird alle DIG.PLAN_INTERVAL Ticks und nur, wenn die Kolonie Platz
 * braucht (Population gegen begehbare Zellen).
 */

import { DIG, WORLD, FORTIFY, STABILITY } from '../config.js';
import { NEST_CELL, NEST_CELL_DEFS, CHAMBER } from './nest.js';
import { bus, CAT } from './events.js';
import { FX } from './fx.js';
import { UNREACHABLE } from './flowfields.js';

/** Grabaufwand je Zelltyp (Index = Zelltyp-ID, 0 = nicht grabbar). */
const COST = new Float32Array(NEST_CELL_DEFS.length);
for (const d of NEST_CELL_DEFS) {
  COST[d.id] = DIG.COST[d.key] !== undefined ? DIG.COST[d.key] : 0;
}
// Befestigungen sind grabbar, aber zaeh – sonst koennte man sie nie abtragen.
COST[NEST_CELL.REINFORCED] = DIG.COST.soil * 6;
COST[NEST_CELL.PILLAR] = DIG.COST.soil * 5;
COST[NEST_CELL.RESIN] = DIG.COST.soil * 3;
COST[NEST_CELL.PLUG] = DIG.COST.soil * 1.5;

/** Bauaufwand je Zieltyp. */
const EFFORT = new Float32Array(NEST_CELL_DEFS.length);
const MATERIAL = new Array(NEST_CELL_DEFS.length).fill(null);
for (const d of NEST_CELL_DEFS) {
  if (FORTIFY.EFFORT[d.key] !== undefined) EFFORT[d.id] = FORTIFY.EFFORT[d.key];
  if (FORTIFY.COST[d.key]) MATERIAL[d.id] = FORTIFY.COST[d.key];
}

/** Ist diese Zelle grabbar? (Stein und Luft sind es nicht.) */
export function diggable(level, x, y) {
  if (!level.inBounds(x, y)) return false;
  if (y <= WORLD.NEST_SURFACE_ROW) return false;
  if (y >= level.h - DIG.BOTTOM_MARGIN) return false;
  return COST[level.cells[y * level.w + x]] > 0;
}

export class Construction {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
  }

  /**
   * Zustandsfelder an einer Kolonie anlegen.
   *
   * Die Grabzustaende liegen JE NEST-EBENE in colony.digByLevel. Bis Phase 11
   * war es eine einzige Warteschlange fuer die ganze Kolonie; solange jede
   * Kolonie genau eine Ebene hatte, fiel das nicht auf. Mit einer zweiten
   * Ebene wertet update() dieselbe Warteschlange gegen die Zellen der
   * falschen Ebene aus und raeumt die Auftraege der anderen Ebene weg.
   */
  init(colony) {
    /** @type {Map<number, object>} Ebenen-ID -> Grabzustand */
    colony.digByLevel = new Map();
    colony.diggers = 0;        // Ameisen, die gerade graben
    // Beim Laden eines Standes aus 1.1.0 fehlt digByLevel, die Statistik
    // steht aber schon da – sie darf nicht auf null zurueckfallen.
    if (colony.dugTotal === undefined) colony.dugTotal = 0;
    // Felder aus 1.1.0 abraeumen, sonst wandern sie in jeden neuen Stand.
    for (const k of ['digQueue', 'digMeta', 'digTarget', 'digActive',
                     'digProgress', 'digGoals', 'digKey', 'lastDugType']) {
      if (k in colony) delete colony[k];
    }
  }

  /** Grabzustand einer Ebene; wird bei Bedarf angelegt. */
  stateFor(colony, levelId) {
    if (colony.digByLevel === undefined) this.init(colony);
    let st = colony.digByLevel.get(levelId);
    if (st === undefined) {
      st = {
        queue: [],        // Zellindizes
        meta: [],         // Kammertyp je Auftrag (0 = Gang)
        /**
         * Zieltyp je Auftrag. 0 = ausgraben (wird Tunnel bzw. Kammer),
         * sonst der Zelltyp, der dort entstehen soll (Befestigung).
         */
        target: [],
        /** Zelltyp der zuletzt fertig gegrabenen Zelle (fuer die Tragelast). */
        lastDugType: 0,
        progress: 0,      // Punkte auf der aktiven Baustelle
        active: -1,       // Zellindex der aktiven Baustelle
        /**
         * Zellindex des Abstiegsschachts, wenn HIER nichts zu graben ist,
         * eine Ebene TIEFER aber schon. Graeberinnen laufen dann dorthin
         * und steigen ab. Ohne diesen Sog bliebe ein frisch geoeffnetes
         * Stockwerk leer: Ameisen benutzen ein Portal nur, wenn sie darauf
         * treten, und tief im Bau kommt zufaellig niemand vorbei.
         */
        descend: -1,
        goals: [],        // Luftnachbarn der Baustelle (Ziel des Feldes)
        key: '',          // Kennung fuer den Feld-Cache
      };
      colony.digByLevel.set(levelId, st);
    }
    return st;
  }

  /** Wie stateFor, legt aber nichts an (fuer heisse Pfade in ants.js). */
  peek(colony, levelId) {
    return colony.digByLevel ? colony.digByLevel.get(levelId) : undefined;
  }

  /** Summe aller offenen Auftraege ueber alle Ebenen (Anzeige). */
  queueLength(colony) {
    if (!colony.digByLevel) return 0;
    let n = 0;
    for (const st of colony.digByLevel.values()) n += st.queue.length;
    return n;
  }

  /**
   * Auftrag von Hand hinzufuegen (Werkzeug "Bauauftrag").
   * @returns {boolean} true, wenn der Auftrag neu war
   */
  addOrder(colony, level, x, y, chamberType = CHAMBER.NONE) {
    if (!diggable(level, x, y)) return false;
    const st = this.stateFor(colony, level.id);
    const idx = y * level.w + x;
    if (st.queue.includes(idx)) return false;
    if (st.queue.length >= DIG.MAX_QUEUE) return false;
    // Von Hand gesetzte Auftraege kommen nach vorn.
    st.queue.unshift(idx);
    st.meta.unshift(chamberType);
    st.target.unshift(0);
    st.active = -1;
    return true;
  }

  /**
   * Bauauftrag: an dieser Stelle soll eine Befestigung entstehen.
   * Anders als beim Graben darf das Ziel auch eine Luftzelle sein.
   * @param {number} cellType Zieltyp (NEST_CELL.REINFORCED, .PILLAR, …)
   */
  addBuildOrder(colony, level, x, y, cellType, front = false) {
    if (!level.inBounds(x, y)) return false;
    const st = this.stateFor(colony, level.id);
    if (y <= WORLD.NEST_SURFACE_ROW) return false;
    const idx = y * level.w + x;
    if (level.cells[idx] === cellType) return false;
    if (level.cells[idx] === NEST_CELL.STONE) return false;
    if (st.queue.includes(idx)) return false;
    if (st.queue.length >= FORTIFY.MAX_ORDERS) return false;
    if (front) {
      st.queue.unshift(idx);
      st.meta.unshift(0);
      st.target.unshift(cellType);
    } else {
      st.queue.push(idx);
      st.meta.push(0);
      st.target.push(cellType);
    }
    st.active = -1;
    return true;
  }

  /** Aufwand des vordersten Auftrags. */
  _effortOf(st, level, idx) {
    const target = st.target[0] || 0;
    const cur = level.cells[idx];
    if (target === 0) return COST[cur];
    // Bauen: Material anbringen, bei solidem Untergrund zusaetzlich abtragen
    return EFFORT[target] + (level.solidTable[cur] ? COST[cur] * 0.3 : 0);
  }

  /**
   * Sorgt dafuer, dass eine von Hand markierte Stelle ueberhaupt erreichbar
   * ist: liegt sie mitten im Erdreich, wird zuerst ein Zugang von der
   * naechsten Luftzelle dorthin in die Warteschlange gestellt (L-foermig,
   * damit Felsen umgangen werden koennen).
   * @returns {number} Anzahl eingefuegter Zugangszellen
   */
  ensureReachable(colony, level, cx, cy) {
    if (!diggable(level, cx, cy)) return 0;
    const st = this.stateFor(colony, level.id);
    if (airNeighbours(level, cy * level.w + cx).length > 0) return 0;

    // Naechstgelegene Luftzelle suchen
    let bx = -1, by = -1, bestD = Infinity;
    const cells = level.cells, solid = level.solidTable, w = level.w;
    for (let y = WORLD.NEST_SURFACE_ROW; y < level.h; y++) {
      for (let x = 0; x < w; x++) {
        if (solid[cells[y * w + x]]) continue;
        const dx = x - cx, dy = y - cy;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bx = x; by = y; }
      }
    }
    if (bx < 0) return 0;

    // Zwei L-Varianten probieren; die erste ohne Fels gewinnt.
    const a = lPath(level, bx, by, cx, cy, true);
    const b = lPath(level, bx, by, cx, cy, false);
    const path = a || b;
    if (!path) {
      bus.logEvent(CAT.BAU, colony.name + ': kein Weg zur markierten Stelle (Fels)', {
        tick: this.world.tick, levelId: level.id, x: cx, y: cy, colonyId: colony.id,
      });
      return 0;
    }
    let added = 0;
    for (let i = path.length - 1; i >= 0; i--) {
      const idx = path[i];
      if (st.queue.includes(idx)) continue;
      st.queue.unshift(idx);
      st.meta.unshift(CHAMBER.NONE);
      st.target.unshift(0);
      added++;
    }
    if (added) st.active = -1;
    return added;
  }

  /** Pro Tick: Baustelle bestimmen und bei Bedarf neue Projekte planen. */
  update(colony, level, rng, tick) {
    const st = this.stateFor(colony, level.id);

    // Erledigte oder unmoegliche Auftraege vorne abraeumen
    while (st.queue.length > 0) {
      const idx = st.queue[0];
      const x = idx % level.w, y = (idx / level.w) | 0;
      const target = st.target[0] || 0;
      const ok = target === 0
        ? diggable(level, x, y)
        : (level.inBounds(x, y) && level.cells[idx] !== target
           && level.cells[idx] !== NEST_CELL.STONE && y > WORLD.NEST_SURFACE_ROW);
      if (ok) break;
      st.queue.shift();
      st.meta.shift();
      st.target.shift();
      st.progress = 0;
      st.active = -1;
    }

    /**
     * GRABDUFT GEHT VOR. Hat der Spieler auf dieser Ebene gemalt, ist die
     * staerkste erreichbare bemalte Zelle die Baustelle – noch vor allem,
     * was das Volk sich selbst vorgenommen hat. Ein Befehl soll sofort
     * wirken, sonst fuehlt er sich nicht wie ein Befehl an.
     */
    this._applyScent(colony, st, level);

    /**
     * Erreichbaren Auftrag an die Spitze holen – IN EINEM TICK, nicht einen
     * Dreh pro Tick.
     *
     * Vorher wurde je Tick genau ein unerreichbarer Auftrag nach hinten
     * gedreht und solange active auf -1 gesetzt. Das liess die Baustelle
     * im Sekundentakt zwischen "keine" und "diese" flackern – und die
     * Ameisen mit ihr: eine Graeberin faellt bei active < 0 sofort in
     * EXPLORE zurueck, folgt dann dem Ausgangsfeld nach oben, wird im
     * naechsten Tick wieder Graeberin und folgt dem Grabfeld nach unten.
     * Netto kam sie nicht vom Fleck. Das war das "Ameisen laufen im
     * Kreis" – kein Fehler der Distanzfelder, sondern ein Zustandsflattern.
     *
     * Wer nach einem vollen Umlauf keinen Zugang hat, fliegt raus: das
     * sind Kammern, deren Zugangsgang planProject stillschweigend um eine
     * Felszelle gekuerzt hat und die deshalb in der Luft haengen.
     */
    /**
     * ERREICHBAR HEISST NICHT "HAT EINEN LUFTNACHBARN".
     *
     * Eine Zelle kann an Luft grenzen, die in einer abgeschlossenen Blase
     * liegt – ausgehoben beim Anlegen der Ebene oder von einem Einsturz
     * abgeschnitten. Gemessen: die Baustelle 5306 stand dreitausend Ticks
     * unveraendert, waehrend siebenundachtzig Graeberinnen auf derselben
     * Ebene im Grabzustand herumliefen und genau EINE Zelle entstand. Sie
     * kamen nie hin, weil das Grabfeld von ihrer Seite aus unerreichbar
     * war.
     *
     * Das Ausgangsfeld weiss, welche Luft mit dem Rest der Ebene
     * zusammenhaengt: es ist immer auf Stand und geht von den Toren aus.
     * Eine Baustelle zaehlt nur, wenn wenigstens ein Luftnachbar von dort
     * aus erreichbar ist.
     */
    const fsHere = this.world.fields.get(level.id);
    const erreichbar = (idx) => {
      const ns = airNeighbours(level, idx);
      if (ns.length === 0) return false;
      if (!fsHere || !fsHere.entrance.valid) return true;   // noch kein Feld: durchlassen
      const ent = fsHere.entrance;
      for (let k = 0; k < ns.length; k++) {
        if (ent.dist[ns[k]] !== UNREACHABLE) return true;
      }
      return false;
    };

    let head = -1;
    for (let tries = st.queue.length; tries > 0; tries--) {
      if (erreichbar(st.queue[0])) { head = st.queue[0]; break; }
      st.queue.push(st.queue.shift());
      st.meta.push(st.meta.shift());
      st.target.push(st.target.shift());
    }
    if (head < 0 && st.queue.length > 0) {
      // Voller Umlauf ohne Zugang: den vordersten verwerfen. So raeumt sich
      // eine Liste aus lauter Luftschloessern in ebenso vielen Ticks ab.
      st.queue.shift(); st.meta.shift(); st.target.shift();
    }
    if (head !== st.active) {
      st.active = head;
      st.progress = 0;
    }

    /**
     * BESETZUNG DES STOCKWERKS GEHT VOR. Wartet eine Ebene tiefer Arbeit
     * und ist dort kaum jemand, zeigt das Grabfeld dieser Ebene auf den
     * Abstiegsschacht statt auf die eigene Baustelle: wer schon an der
     * Tunnelbrust steht, graebt weiter, alle anderen laufen hinunter.
     *
     * Die Baustelle und ihr Fortschritt bleiben dabei unangetastet. Ein
     * frueherer Entwurf setzte beides zurueck, und weil die
     * Besetzungsschwelle ohne Hysterese staendig hin- und herkippte,
     * begann das Volk alle paar Sekunden von vorn und grub gar nichts
     * mehr.
     */
    const down = this._descendTarget(colony, level, st.descend >= 0);
    st.descend = down;
    if (down >= 0) {
      const key = 'v' + down;
      if (st.key !== key) { st.goals = [down]; st.key = key; }
    } else if (head >= 0) {
      const key = 'd' + head;
      if (st.key !== key) { st.goals = airNeighbours(level, head); st.key = key; }
    } else if (st.key !== '') {
      st.goals = [];
      st.key = '';
    }

    // Planung der Kolonien versetzen, sonst scannen alle im selben Tick.
    if ((tick + colony.id * 7) % DIG.PLAN_INTERVAL !== 0) return;
    if (st.queue.length >= DIG.MIN_QUEUE) return;
    /**
     * Ein Nest waechst NACH UNTEN. Gibt es ein tieferes Stockwerk, werden
     * neue Grabprojekte nur noch dort geplant; die oberen Ebenen arbeiten
     * ihre Restauftraege ab und schicken ihre Graeberinnen danach hinunter
     * (siehe _descendTarget). Ohne diese Regel hatte die obere Ebene immer
     * Arbeit, der Sog nach unten sprang nie an, und das frisch geoeffnete
     * Stockwerk blieb ueber Stunden leer.
     */
    if (!this._isDeepest(colony, level)) return;
    // Solange ein Befehl des Spielers offen ist, plant das Volk nichts Eigenes.
    if (this.world.digScent && this.world.digScent.total(level.id) > 0) return;
    if (!this.needsSpace(colony)) return;
    this.planProject(colony, level, rng);
  }

  /**
   * Bemalte Zelle an die Spitze der Warteschlange holen.
   *
   * Gemalt wird oft mitten in den Fels. Die staerkste Zelle MIT Luftkontakt
   * wird sofort Baustelle; liegt keine bemalte Zelle am Luftrand, wird fuer
   * die staerkste ueberhaupt ein Zugang gegraben (ensureReachable). So
   * frisst sich ein Gang Zelle fuer Zelle in den bemalten Streifen hinein,
   * ohne dass der Spieler die Reihenfolge angeben muss.
   */
  _applyScent(colony, st, level) {
    const scent = this.world.digScent;
    if (!scent || scent.total(level.id) === 0) return;

    const w = level.w;
    const reachable = (i) => {
      const x = i % w, y = (i / w) | 0;
      return diggable(level, x, y) && airNeighbours(level, i).length > 0;
    };
    let idx = scent.best(level.id, reachable);
    if (idx < 0) {
      // Nichts am Luftrand: Zugang zur staerksten bemalten Zelle bahnen
      const far = scent.best(level.id, (i) => diggable(level, i % w, (i / w) | 0));
      if (far < 0) { scent.clear(level.id, scent.best(level.id, () => true)); return; }
      this.ensureReachable(colony, level, far % w, (far / w) | 0);
      return;
    }

    const at = st.queue.indexOf(idx);
    if (at === 0) return;                       // steht schon vorn
    if (at > 0) {
      st.queue.splice(at, 1); st.meta.splice(at, 1); st.target.splice(at, 1);
    }
    st.queue.unshift(idx);
    st.meta.unshift(CHAMBER.NONE);
    st.target.unshift(0);
    st.active = -1;
  }

  /** Ist das die unterste Ebene des Volkes? */
  _isDeepest(colony, level) {
    if (colony.nestLevelIds.length < 2) return true;
    for (const id of colony.nestLevelIds) {
      const l = this.world.levels.get(id);
      if (l && !l.abandoned && l.depth > level.depth) return false;
    }
    return true;
  }

  /**
   * Zelle des Abstiegsschachts dieser Ebene, wenn auf einer TIEFEREN Ebene
   * desselben Volkes Grabauftraege offen sind – sonst -1.
   *
   * Nur nach unten: sonst schicken sich zwei Ebenen gegenseitig ihre
   * Graeberinnen zu und niemand graebt mehr.
   */
  _descendTarget(colony, level, wasOn) {
    const world = this.world;
    if (!colony.digByLevel || colony.nestLevelIds.length < 2) return -1;
    for (const p of world.portals.ofColony(colony.id)) {
      if (p.upLevelId !== level.id) continue;      // fuehrt nicht nach unten
      const other = p.other(level.id);
      const lower = world.levels.get(other.levelId);
      if (!lower || lower.abandoned) continue;
      /**
       * EIN STOCKWERK BRAUCHT EINE STAENDIGE BESATZUNG, nicht nur eine
       * Baukolonne. Der erste Entwurf zog nur dann Ameisen hinunter, wenn
       * dort noch Grabauftraege offen waren. Fertige Zwischenebenen liefen
       * damit leer: niemand zog hin, und wer dort war, wanderte beim
       * naechsten Sammelgang nach oben ab und kam nie zurueck. Gemessen
       * ueber dreitausend Ticks: null Ameisen auf einer Ebene mit
       * dreihundertachtzig begehbaren Zellen.
       *
       * Jetzt gilt der Sog, solange die Ebene unterbesetzt ist – ob dort
       * gegraben wird oder nicht.
       */
      /**
       * Genug Volk unten? Dann darf diese Ebene fuer sich selbst graben.
       * Die Schwelle zum Abschalten liegt hoeher als die zum Einschalten
       * (Hysterese), sonst kippt der Sog im Sekundentakt.
       */
      const below = colony.digByLevel.get(other.levelId);
      const arbeit = !!below && below.queue.length > 0;
      const there = colony.populationByLevel.get(other.levelId) || 0;
      const anteil = arbeit ? DIG.EXPAND_WORK_SHARE : DIG.EXPAND_STAFF_SHARE;
      const want = Math.max(arbeit ? 12 : 4, colony.total * anteil)
        * (wasOn ? DIG.EXPAND_STAFF_HYST : 1);
      if (there >= want) continue;
      const pos = p.on(level.id);
      if (pos) return pos.y * level.w + pos.x;
    }
    return -1;
  }

  /**
   * Braucht die Kolonie mehr Platz? Massstab ist die GESAMTE Population –
   * Sammlerinnen sind nur voruebergehend draussen und brauchen trotzdem
   * einen Platz im Nest.
   */
  needsSpace(colony) {
    // Eine hungernde Kolonie baut nicht aus.
    if (colony.starving) return false;
    const want = Math.max(DIG.MIN_NEST_CELLS, colony.total * DIG.CELLS_PER_ANT);
    return this.airOf(colony) < want;
  }

  /**
   * Begehbare Zellen ueber ALLE Ebenen des Volkes. Frueher verglich
   * needsSpace nur die eine Ebene; mit einem zweiten Stockwerk grub ein
   * Volk mit vierhundert Zellen auf der oberen und dreihundert auf der
   * unteren weiter, als haette es nur dreihundert.
   */
  airOf(colony) {
    let air = 0;
    for (const id of colony.nestLevelIds) {
      const l = this.world.levels.get(id);
      if (l && !l.abandoned) air += l.airCount;
    }
    return air;
  }

  /**
   * Neues Grabprojekt planen: Schacht, Seitengang oder Kammer, ausgehend von
   * einer vorhandenen Luftzelle mit Erdkontakt.
   */
  planProject(colony, level, rng) {
    const st = this.stateFor(colony, level.id);
    const start = this.findGrowthPoint(level, rng);
    if (!start) return false;

    const cells = [];
    let meta = CHAMBER.NONE;
    const roll = rng.float();

    if (roll < DIG.CHAMBER_CHANCE) {
      // Kammer: Typ nach dem, was der Kolonie fehlt.
      meta = this.pickChamberType(colony, level, rng);
      const rx = rng.intRange(DIG.CHAMBER_RX[0], DIG.CHAMBER_RX[1]);
      const ry = rng.intRange(DIG.CHAMBER_RY[0], DIG.CHAMBER_RY[1]);
      const cx = start.x + (rng.chance(0.5) ? -1 : 1) * rng.intRange(0, 2);
      const cy = start.y + ry + 1;
      for (let y = cy - ry; y <= cy + ry; y++) {
        for (let x = cx - rx; x <= cx + rx; x++) {
          const nx = (x - cx) / rx, ny = (y - cy) / ry;
          if (nx * nx + ny * ny > 1) continue;
          if (diggable(level, x, y)) cells.push(y * level.w + x);
        }
      }
      // Zugang von der Startzelle zur Kammer
      for (let y = start.y; y <= cy - ry; y++) if (diggable(level, start.x, y)) cells.unshift(y * level.w + start.x);
    } else if (roll < DIG.CHAMBER_CHANCE + 0.32) {
      // Schacht nach unten
      const len = rng.intRange(DIG.SHAFT_LEN[0], DIG.SHAFT_LEN[1]);
      for (let k = 1; k <= len; k++) {
        const y = start.y + k;
        if (!diggable(level, start.x, y)) break;
        cells.push(y * level.w + start.x);
      }
    } else {
      // Waagerechter Gang, leicht abfallend
      const dir = rng.chance(0.5) ? -1 : 1;
      const len = rng.intRange(DIG.TUNNEL_LEN[0], DIG.TUNNEL_LEN[1]);
      let y = start.y;
      for (let k = 1; k <= len; k++) {
        const x = start.x + dir * k;
        if (rng.chance(0.09)) y++;
        if (!diggable(level, x, y)) break;
        cells.push(y * level.w + x);
      }
    }

    if (cells.length === 0) return false;
    for (let i = 0; i < cells.length; i++) {
      if (st.queue.length >= DIG.MAX_QUEUE) break;
      st.queue.push(cells[i]);
      st.meta.push(meta);
      st.target.push(0);
    }
    if (meta !== CHAMBER.NONE) {
      bus.logEvent(CAT.BAU, colony.name + ' beginnt eine neue Kammer', {
        tick: this.world.tick, levelId: level.id,
        x: cells[cells.length - 1] % level.w, y: (cells[cells.length - 1] / level.w) | 0,
        colonyId: colony.id,
      });
    }
    return true;
  }

  /** Welcher Kammertyp fehlt? Reihenfolge nach Dringlichkeit. */
  pickChamberType(colony, level, rng) {
    const have = countChambers(level);
    if (!have[CHAMBER.BROOD]) return CHAMBER.BROOD;
    if (!have[CHAMBER.STORE]) return CHAMBER.STORE;
    if (!have[CHAMBER.GUARD]) return CHAMBER.GUARD;
    if (!have[CHAMBER.ESCAPE]) return CHAMBER.ESCAPE;
    if (!have[CHAMBER.GRAVE]) return CHAMBER.GRAVE;
    if (!have[CHAMBER.INFIRMARY]) return CHAMBER.INFIRMARY;
    return rng.pick([CHAMBER.BROOD, CHAMBER.STORE, CHAMBER.BROOD]);
  }

  /**
   * Luftzelle mit Erdkontakt suchen, moeglichst tief (dort waechst das Nest).
   * Ein voller Scan ueber 30k Zellen kostet Bruchteile einer Millisekunde und
   * laeuft nur alle DIG.PLAN_INTERVAL Ticks.
   */
  findGrowthPoint(level, rng) {
    const w = level.w, h = level.h;
    let best = null, bestScore = -1;
    const cells = level.cells;
    const solid = level.solidTable;
    for (let y = WORLD.NEST_SURFACE_ROW + 2; y < h - DIG.BOTTOM_MARGIN; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (solid[cells[i]]) continue;
        // Erdkontakt?
        if (!diggable(level, x, y + 1) && !diggable(level, x - 1, y)
            && !diggable(level, x + 1, y) && !diggable(level, x, y - 1)) continue;
        // Tiefe bevorzugen, Zufall dazu, damit nicht immer derselbe Punkt gewinnt
        const score = y * 0.6 + rng.float() * 40;
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    return best;
  }

  /**
   * Grabpunkte auf die aktive Baustelle buchen.
   * @returns {number} Zellindex, wenn die Zelle fertig gegraben wurde, sonst -1
   */
  contribute(colony, level, amount) {
    const st = this.stateFor(colony, level.id);
    const idx = st.active;
    if (idx < 0) return -1;
    const target = st.target[0] || 0;
    const effort = this._effortOf(st, level, idx);
    if (effort <= 0) { st.active = -1; return -1; }
    st.progress += amount;
    if (st.progress < effort) return -1;

    const x = idx % level.w, y = (idx / level.w) | 0;
    st.lastDugType = level.cells[idx];

    if (target === 0) {
      // Ausgraben
      const meta = st.meta[0] !== undefined ? st.meta[0] : CHAMBER.NONE;
      level.set(x, y, meta === CHAMBER.NONE ? NEST_CELL.TUNNEL : NEST_CELL.CHAMBER);
      level.setMeta(x, y, meta);
      // Erledigt ist erledigt: der Befehl auf dieser Zelle erlischt.
      if (this.world.digScent) this.world.digScent.clear(level.id, idx);
      colony.dugTotal++;
      this.world.emitFx(FX.DUST, level.id, x, y, 3);
      // Frisch geoeffnete Decke kann einstuerzen
      if (this.world.stability) this.world.stability.request(level, x, y, STABILITY.CHECK_RADIUS);
    } else {
      // Bauen: Material pruefen und abbuchen
      const need = MATERIAL[target];
      if (need) {
        /**
         * BAUWERKE HABEN VORRANG. Steht ein Bauwerksauftrag an, wird ein
         * Sockelvorrat nicht fuer Wandverstaerkungen angetastet. Ohne das
         * fressen die Befestigungen jeden Kiesel sofort weg, und auf
         * rohstoffarmen Karten entsteht nie ein Bauwerk: auf der Steppe
         * stand der Kieselvorrat dauerhaft bei null.
         */
        const reserve = (colony.pendingBuild && colony.pendingBuild.length)
          ? FORTIFY.PEBBLE_RESERVE : 0;
        for (const [res, n] of Object.entries(need)) {
          const keep = res === 'pebble' ? reserve : 0;
          if ((colony.stores[res] || 0) - keep < n) {
            // Material fehlt: Auftrag nach hinten schieben statt blockieren
            st.progress = effort * 0.8;
            st.queue.push(st.queue.shift());
            st.meta.push(st.meta.shift());
            st.target.push(st.target.shift());
            st.active = -1;
            return -1;
          }
        }
        for (const [res, n] of Object.entries(need)) colony.stores[res] -= n;
      }
      level.set(x, y, target);
      level.setMeta(x, y, 0);
      colony.builtTotal = (colony.builtTotal || 0) + 1;
    }

    st.queue.shift();
    st.meta.shift();
    st.target.shift();
    st.progress = 0;
    st.active = -1;
    return idx;
  }

  // =========================================================================
  // Befestigungen planen (Phase 6)
  // =========================================================================

  /**
   * Verteidigungsbau: Engstelle am Eingang, verstaerkte Waende um die
   * Koeniginnenkammer, Stuetzpfeiler in breiten Kammern, Harzbarrieren in
   * den Zulaufgaengen. Geplant wird nach Bedrohungsstufe und Genom.
   */
  planDefence(colony, level, portals, rng) {
    const g = colony.genome;
    const defence = g ? g.verteidigung : 0.5;
    if (colony.threat < FORTIFY.MIN_THREAT && defence < FORTIFY.PREEMPTIVE_GENE) return 0;
    const st = this.stateFor(colony, level.id);
    if (st.queue.length > FORTIFY.MAX_ORDERS * 0.6) return 0;
    let added = 0;

    // 0. Ohne Kiesel keine Befestigung: Kieselzellen zum Abbau vormerken
    if ((colony.stores.pebble || 0) < 12) {
      const cells = level.cells;
      let found = 0;
      for (let i = 0; i < cells.length && found < 6; i++) {
        if (cells[i] !== NEST_CELL.PEBBLE) continue;
        const x = i % level.w, y = (i / level.w) | 0;
        // Nur erreichbare Kiesel (mit Luftkontakt)
        if (level.isSolid(x - 1, y) && level.isSolid(x + 1, y)
            && level.isSolid(x, y - 1) && level.isSolid(x, y + 1)) continue;
        if (this.addOrder(colony, level, x, y, CHAMBER.NONE)) { added++; found++; }
      }
    }

    // 1. Stuetzpfeiler in breiten Kammern (auch im Frieden sinnvoll)
    const spots = [];
    for (const lid of colony.nestLevelIds) {
      if (lid !== level.id) continue;
      const c = colony.layout;
      if (!c) break;
      if (this.world.stability) {
        this.world.stability.pillarSpots(level, c.queen.x, c.queen.y, spots);
        for (const idx of spots) {
          const x = idx % level.w, y = (idx / level.w) | 0;
          if (this.addBuildOrder(colony, level, x, y, NEST_CELL.PILLAR)) added++;
        }
      }
    }

    // 2. Verstaerkte Waende rund um die Koeniginnenkammer
    if (colony.threat >= 2 || defence > 0.75) {
      const q = colony.layout ? colony.layout.queen : null;
      if (q) {
        const r = 9;
        for (let a = 0; a < Math.PI * 2; a += 0.35) {
          const x = Math.round(q.x + Math.cos(a) * r);
          const y = Math.round(q.y + Math.sin(a) * r * 0.6);
          if (!level.inBounds(x, y) || !level.solidTable[level.cells[y * level.w + x]]) continue;
          if (this.addBuildOrder(colony, level, x, y, NEST_CELL.REINFORCED)) added++;
        }
      }
    }

    // 3. Harzbarriere im Schacht unter einem bedrohten Eingang
    if (colony.threat >= 2 && (colony.stores.resin || 0) >= 2) {
      for (const p of portals.ofColony(colony.id)) {
        const pos = p.on(level.id);
        if (!pos) continue;
        for (let d = 3; d <= 6; d++) {
          const y = pos.y + d;
          if (level.isSolid(pos.x, y)) continue;
          if (this.addBuildOrder(colony, level, pos.x, y, NEST_CELL.RESIN, true)) { added++; break; }
        }
      }
    }

    // 4. Bei Stufe 3 Eingaenge verschliessen
    if (colony.threat >= 3 && (colony.stores.pebble || 0) >= 2) {
      for (const p of portals.ofColony(colony.id)) {
        const pos = p.on(level.id);
        if (!pos) continue;
        const y = pos.y + 1;
        if (level.isSolid(pos.x, y)) continue;
        if (this.addBuildOrder(colony, level, pos.x, y, NEST_CELL.PLUG, true)) {
          added++;
          p.closed = true;
        }
      }
    }
    void rng;
    return added;
  }
}

/**
 * L-foermiger Weg von (x0,y0) nach (x1,y1). horizontalFirst entscheidet die
 * Reihenfolge der Schenkel. Liefert null, wenn eine nicht grabbare Zelle
 * (Fels) im Weg liegt, sonst die grabbaren Zellen in Laufrichtung.
 */
function lPath(level, x0, y0, x1, y1, horizontalFirst) {
  const out = [];
  const w = level.w;
  const step = (x, y) => {
    if (!level.inBounds(x, y)) return false;
    if (!level.isSolid(x, y)) return true;           // Luft: nichts zu tun
    if (!diggable(level, x, y)) return false;        // Fels: Weg blockiert
    out.push(y * w + x);
    return true;
  };
  const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
  if (horizontalFirst) {
    for (let x = x0; x !== x1 + sx && sx !== 0; x += sx) if (!step(x, y0)) return null;
    for (let y = y0; y !== y1 + sy && sy !== 0; y += sy) if (!step(x1, y)) return null;
  } else {
    for (let y = y0; y !== y1 + sy && sy !== 0; y += sy) if (!step(x0, y)) return null;
    for (let x = x0; x !== x1 + sx && sx !== 0; x += sx) if (!step(x, y1)) return null;
  }
  if (!step(x1, y1)) return null;
  return out;
}

/** Begehbare Nachbarn einer Zelle (Ziele des Grab-Distanzfeldes). */
function airNeighbours(level, idx) {
  const w = level.w;
  const x = idx % w, y = (idx / w) | 0;
  const out = [];
  const push = (nx, ny) => {
    if (!level.inBounds(nx, ny)) return;
    if (!level.isSolid(nx, ny)) out.push(ny * w + nx);
  };
  push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  push(x - 1, y - 1); push(x + 1, y - 1); push(x - 1, y + 1); push(x + 1, y + 1);
  return out;
}

/** Wie viele Zellen je Kammertyp existieren bereits? */
function countChambers(level) {
  const have = new Uint16Array(16);
  const cells = level.cells, meta = level.meta;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === NEST_CELL.CHAMBER) have[meta[i] & 15]++;
  }
  return have;
}
