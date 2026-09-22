/**
 * save.js – Speichern und Laden (Phase 10).
 *
 * FORMAT
 *   Ein JSON-Objekt mit einer Versionsnummer. Die grossen Typed Arrays
 *   (Gitter, Pheromone, Einheiten) stehen NICHT als Zahlenlisten darin –
 *   das waere ein Vielfaches an Groesse. Stattdessen:
 *
 *     Gitter (Uint8Array)   -> Lauflaengenkodierung, dann Base64
 *                              (Paare aus Wert und Laenge, Laenge 1..255)
 *     Float/Int-Spalten     -> Base64 des rohen Speichers
 *     Pheromone             -> nur die aktiven Zellen als (Index, Wert)
 *
 *   Eine Oberflaeche hat 160 000 Zellen. Als JSON-Zahlenliste waeren das
 *   ueber 300 KB je Gitter; lauflaengenkodiert sind es wenige KB, weil
 *   Terrain in Flaechen auftritt.
 *
 * WAS NICHT GESPEICHERT WIRD
 *   Distanzfelder (Flow Fields) und Spatial Hashes. Beides ist abgeleiteter
 *   Zustand und wird beim Laden in wenigen Ticks neu gerechnet. Das spart
 *   den groessten Teil der Dateigroesse, ohne dass etwas verloren geht.
 *
 * DETERMINISMUS
 *   Der Zufallsstrom wird mit gespeichert (rng.getState/setState), damit ein
 *   geladener Stand exakt so weiterlaeuft wie der gespeicherte.
 */

import { VERSION, TRAIT_CFG } from '../config.js';
import { antEffects } from './traits.js';
import { LEVEL_KIND } from './levels.js';

/** Formatversion. Wird beim Laden geprueft. */
export const SAVE_VERSION = 2;

// ---------------------------------------------------------------------------
// Kodierung
// ---------------------------------------------------------------------------

/** Bytes -> Base64 (laeuft im Browser und unter Node). */
function b64encode(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
  }
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
}

function b64decode(str) {
  const bin = typeof atob === 'function' ? atob(str) : Buffer.from(str, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Gitter kodieren: lauflaengenkodiert, wenn das kuerzer ist, sonst roh.
 *
 * Terrain besteht aus Flaechen und schrumpft per RLE auf wenige Prozent.
 * Die Variantenkarte ist dagegen reines Rauschen – dort verdoppelt RLE die
 * Groesse. Deshalb wird je Feld das kuerzere Ergebnis genommen; das
 * Praefix sagt beim Laden, welches es war.
 */
export function packGrid(arr) {
  const rle = rleEncode(arr);
  const raw = b64encode(arr);
  return rle.length < raw.length ? 'r' + rle : 'b' + raw;
}

export function unpackGrid(str, length) {
  if (str.charCodeAt(0) === 114) return rleDecode(str.slice(1), length); // 'r'
  const bytes = b64decode(str.slice(1));
  const out = new Uint8Array(length);
  out.set(bytes.subarray(0, length));
  return out;
}

/** Uint8Array lauflaengenkodieren: [Wert, Laenge] mit Laenge 1..255. */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  return b64encode(new Uint8Array(out));
}

export function rleDecode(str, length) {
  const bytes = b64decode(str);
  const out = new Uint8Array(length);
  let p = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const v = bytes[i], n = bytes[i + 1];
    for (let k = 0; k < n && p < length; k++) out[p++] = v;
  }
  return out;
}

/** Beliebiges Typed Array roh als Base64. */
function rawEncode(ta, count) {
  const view = new Uint8Array(ta.buffer, ta.byteOffset, count * ta.BYTES_PER_ELEMENT);
  return b64encode(view);
}

function rawDecodeInto(str, ta, count) {
  const bytes = b64decode(str);
  const view = new Uint8Array(ta.buffer, ta.byteOffset, count * ta.BYTES_PER_ELEMENT);
  view.set(bytes.subarray(0, view.length));
}

// ---------------------------------------------------------------------------
// Spaltenlisten der Structure-of-Arrays
// ---------------------------------------------------------------------------
const ANT_COLS = ['alive', 'level', 'colony', 'caste', 'state', 'x', 'y', 'px', 'py',
  'dir', 'speed', 'hp', 'hpMax', 'hunger', 'age', 'carryType', 'carryNutrient',
  'carryAmount', 'carrySource', 'carryRef', 'targetX', 'targetY', 'timer',
  'phenoSize', 'phenoSpeed', 'phenoLife', 'transit', 'portalRef', 'portalCooldown',
  'resumeState',
  'trip', 'lifespan', 'stuck', 'raidTarget', 'anim', 'hungerTol',
  /**
   * Phase 11: nur die Eigenschaften selbst und das Gift. Alles andere
   * (Mut, Arbeits- und Tragfaktoren, Bitmaske) ist eine reine Funktion der
   * beiden Eigenschaften und wird beim Laden neu gerechnet – das spart
   * neun Float-Spalten und damit rund die Haelfte der Dateigroesse.
   */
  'trait1', 'trait2', 'poison'];

const BROOD_COLS = ['alive', 'colony', 'level', 'x', 'y', 'stage', 'progress', 'fed',
  'hungry', 'target', 'carrier', 'pSize', 'pSpeed', 'pLife'];

const CREATURE_COLS = ['alive', 'species', 'level', 'x', 'y', 'px', 'py', 'dir',
  'hp', 'hpMax', 'energy', 'age', 'maxAge', 'state', 'timer', 'attackCd',
  'target', 'home', 'gSize', 'gSpeed', 'gAggr', 'anim', 'generation'];

function poolToJSON(pool, cols) {
  /**
   * Die Free-List wird MITGESPEICHERT und nicht aus den Luecken abgeleitet.
   * Ihre Reihenfolge entscheidet, welchen Platz die naechste Einheit bekommt –
   * und damit den weiteren Verlauf. Aus den Luecken rekonstruiert wich der
   * geladene Stand schon nach wenigen hundert Ticks ab.
   */
  const out = {
    high: pool.high, count: pool.count, freeCount: pool.freeCount,
    free: rawEncode(pool.free, pool.freeCount),
    cols: {},
  };
  for (const c of cols) {
    if (!pool[c]) continue;
    out.cols[c] = rawEncode(pool[c], pool.high);
  }
  return out;
}

function poolFromJSON(pool, data, cols) {
  pool.clear();
  pool.high = data.high;
  pool.count = data.count;
  for (const c of cols) {
    if (!pool[c] || !data.cols[c]) continue;
    rawDecodeInto(data.cols[c], pool[c], data.high);
  }
  pool.freeCount = data.freeCount;
  if (data.freeCount > 0) rawDecodeInto(data.free, pool.free, data.freeCount);
}


// ---------------------------------------------------------------------------
// Kolonien
// ---------------------------------------------------------------------------

/**
 * Felder, die JEDEN Tick neu gezaehlt werden. Sie wandern nicht in die Datei:
 * sie waeren nur Ballast und koennten nach dem Laden sogar widerspruechlich
 * zum tatsaechlichen Bestand sein.
 */
/** Kennung im Speicherstand. */
export const SAVE_FORMAT = 'antarium-save';
/**
 * Staende aus der Zeit vor der Umbenennung tragen noch die alte Kennung.
 * Sie werden weiter angenommen – der Inhalt hat sich nicht geaendert.
 */
export const SAVE_FORMAT_LEGACY = 'formicarium-save';

/** Ist das ueberhaupt ein Stand dieses Spiels? */
export function isSaveFile(data) {
  return !!data && (data.format === SAVE_FORMAT || data.format === SAVE_FORMAT_LEGACY);
}

const COLONY_DERIVED = new Set([
  // Diese Zaehler entstehen in JEDEM Tick neu (rebuildBuckets, brood.recount).
  'population', 'populationByLevel', 'total', 'diggers', 'diggersByLevel',
  'nurses', 'foragers',
  'broodCount', 'baseName', 'color', 'id',
]);
/**
 * NICHT hier hineinnehmen: balance und needWeight sehen abgeleitet aus,
 * werden aber nur alle NUTRITION.UPDATE_INTERVAL Ticks neu gerechnet. Fehlen
 * sie im Stand, laufen die Sammlerinnen nach dem Laden bis zur naechsten
 * Ernaehrungsrechnung nach den falschen Gewichten – der Verlauf weicht dann
 * schon im ersten Tick ab.
 */

/**
 * Eine Kolonie vollstaendig kodieren – ohne Feldliste im Code.
 *
 * Eine feste Liste war der erste Versuch und ging schief: jedes neu
 * hinzugekommene Feld (Gelege-Zaehler, Raubzug-Sperre, Kammerliste) fehlte
 * stillschweigend im Stand, und der geladene Verlauf lief auseinander.
 * Deshalb wird hier ueber alle eigenen Felder gelaufen und nur der Typ
 * unterschieden.
 */
function encodeColony(c) {
  const out = {};
  for (const k of Object.keys(c)) {
    if (COLONY_DERIVED.has(k)) continue;
    const v = c[k];
    if (v instanceof Set) out[k] = { __t: 'set', v: Array.from(v) };
    else if (v instanceof Map) out[k] = { __t: 'map', v: Array.from(v) };
    else if (ArrayBuffer.isView(v)) out[k] = { __t: 'ta', v: Array.from(v) };
    else if (typeof v === 'function' || v === undefined) continue;
    else out[k] = v;
  }
  out.generation = c.generation;
  out.parentId = c.parentId;
  return out;
}

/**
 * Abgeleitete Eigenschaftswerte nach dem Laden neu berechnen. Exakt
 * dieselbe Rechnung wie bei der Geburt, deshalb bitgleich.
 */
function rebuildAntTraits(ants) {
  for (let i = 0; i < ants.high; i++) {
    const t1 = ants.trait1[i], t2 = ants.trait2[i];
    if (!t1 && !t2) {
      ants.traitBits[i] = 0;
      ants.courage[i] = TRAIT_CFG.BASE_COURAGE;
      ants.workMul[i] = 1; ants.carryMul[i] = 1; ants.senseMul[i] = 1;
      ants.trailMul[i] = 1; ants.nurseMul[i] = 1; ants.damageMul[i] = 1;
      ants.buildMul[i] = 1; ants.loyalty[i] = 0;
      continue;
    }
    const e = antEffects(t1, t2);
    ants.traitBits[i] = e.bits;
    ants.courage[i] = e.courage;
    ants.workMul[i] = e.dig;
    ants.carryMul[i] = e.carry;
    ants.senseMul[i] = e.sense;
    ants.trailMul[i] = e.trail;
    ants.nurseMul[i] = e.nurse;
    ants.damageMul[i] = e.damage;
    ants.buildMul[i] = e.build;
    ants.loyalty[i] = e.loyalty;
  }
}

/** Gegenstueck zu encodeColony. Typisierte Felder bleiben typisiert. */
function decodeColony(c, data) {
  for (const k of Object.keys(data)) {
    if (COLONY_DERIVED.has(k)) continue;
    const v = data[k];
    if (v && typeof v === 'object' && v.__t === 'set') c[k] = new Set(v.v);
    else if (v && typeof v === 'object' && v.__t === 'map') c[k] = new Map(v.v);
    else if (v && typeof v === 'object' && v.__t === 'ta') {
      if (ArrayBuffer.isView(c[k]) && c[k].length === v.v.length) c[k].set(v.v);
      else c[k] = Float32Array.from(v.v);
    } else c[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Speichern
// ---------------------------------------------------------------------------

/**
 * Weltzustand als einfaches Objekt (JSON-tauglich).
 * @param {import('./world.js').World} world
 */
export function saveWorld(world) {
  const levels = world.levels.levels.map((l) => ({
    id: l.id, kind: l.kind, w: l.w, h: l.h, name: l.name,
    colonyId: l.colonyId, abandoned: l.abandoned, depth: l.depth,
    airVersion: l.airVersion, airCount: l.airCount,
    cells: packGrid(l.cells),
    meta: packGrid(l.meta),
    // Statt der Variantenkarte nur ihr Seed – siehe Level.fillVariant.
    variantSeed: l.variantSeed,
    view: { x: l.view.x, y: l.view.y, zoom: l.view.zoom, init: l.view.init },
  }));

  const portals = world.portals.portals.map((p) => ({
    id: p.id, colonyId: p.colonyId,
    aLevelId: p.aLevelId, ax: p.ax, ay: p.ay,
    bLevelId: p.bLevelId, bx: p.bx, by: p.by,
    upLevelId: p.upLevelId,
    closed: !!p.closed, pluggedBy: p.pluggedBy !== undefined ? p.pluggedBy : -1,
  }));

  const colonies = world.colonies.colonies.map(encodeColony);

  // Pheromone: nur aktive Zellen, als Indexliste plus Werteliste
  const phero = [];
  if (world.phero) {
    for (const [cid, data] of world.phero.byColony) {
      const fields = [];
      for (let t = 0; t < data.fields.length; t++) {
        const f = data.fields[t];
        const idx = new Int32Array(f.count);
        const val = new Uint8Array(f.count);
        for (let k = 0; k < f.count; k++) { idx[k] = f.active[k]; val[k] = f.grid[f.active[k]]; }
        fields.push({ n: f.count, idx: rawEncode(idx, f.count), val: rawEncode(val, f.count) });
      }
      phero.push({ colonyId: cid, fields, nutrient: packGrid(data.nutrient) });
    }
  }

  /**
   * Nahrungsregister mitspeichern statt neu aufbauen. Ein Neuaufbau aus dem
   * Gitter liefert eine ANDERE Liste (er nimmt auch Quellen auf, die das
   * laufende Register bereits verworfen hat) – und damit einen anderen
   * weiteren Verlauf.
   */
  const foodReg = [];
  for (const [levelId, r] of world.food.reg) {
    foodReg.push({ levelId, count: r.count, list: rawEncode(r.list, r.count) });
  }

  /**
   * Grabfelder. Warum nur diese fuenf Prozent der Distanzfelder im Stand
   * landen, steht bei FieldSet.digToJSON.
   */
  const digFields = [];
  for (const [levelId, fs] of world.fields) {
    digFields.push({ levelId, ...fs.digToJSON(rawEncode) });
  }

  return {
    format: SAVE_FORMAT,
    saveVersion: SAVE_VERSION,
    gameVersion: VERSION,
    savedAt: new Date().toISOString(),
    seed: world.seed,
    preset: world.preset.key,
    /** Spielmodus: er bestimmt die Regeln und gehoert deshalb in den Stand. */
    mode: world.mode || null,
    playerColonyId: world.playerColonyId !== undefined ? world.playerColonyId : -1,
    tick: world.tick,
    biasMode: world.biasMode,
    godMode: world.godMode,
    energy: world.energy,
    weather: { ...world.weather },
    nextColonyId: world.colonies.colonies.length,
    activeLevelId: world.levels.activeId,
    rng: { sim: world.rngSim.getState(), gen: world.rngGen.getState() },
    lineage: world.lineage.map((e) => ({ ...e })),
    seenCastes: Array.from(world.seenCastes),
    levels, portals, colonies, phero, foodReg, digFields,
    /** Grabduft des Spielers je Nest-Ebene (siehe digscent.js). */
    digScent: world.digScent.toJSON(rawEncode),
    /**
     * Die Einsturz-Warteschlange gehoert dazu: sie wird ueber mehrere Ticks
     * abgearbeitet. Fehlt sie, faengt ein geladener Stand ohne die
     * anstehenden Pruefungen an und laeuft sofort anders weiter.
     */
    stability: { queue: world.stability.queue.map((e) => ({ ...e })),
      collapses: world.stability.collapses },
    combatKills: world.combat.kills,
    /** Wer gegen wen kaempft (siehe combat.js, Combat.pairs). */
    combatPairs: world.combat.toJSON(),
    /** Phase 11: Beziehungen zwischen den Voelkern und alle Bauwerke. */
    diplomacy: world.diplomacy.toJSON(),
    structures: world.structures.toJSON(),
    ants: poolToJSON(world.ants, ANT_COLS),
    brood: poolToJSON(world.brood, BROOD_COLS),
    creatures: poolToJSON(world.creatures, CREATURE_COLS),
  };
}

// ---------------------------------------------------------------------------
// Laden
// ---------------------------------------------------------------------------

/**
 * Laedt einen Stand in eine FRISCHE Welt. Der Aufrufer erzeugt die Welt mit
 * dem gespeicherten Seed und Preset (dadurch stimmen Zelltabellen, Portale
 * und Systemobjekte), danach wird jeder Zustand ueberschrieben.
 *
 * @param {import('./world.js').World} world frisch erzeugte Welt
 * @param {object} data Ergebnis von saveWorld
 * @returns {{ok:boolean, reason?:string}}
 */
export function loadWorld(world, data, deps) {
  if (!data || !isSaveFile(data)) {
    return { ok: false, reason: 'Keine Antarium-Speicherdatei' };
  }
  if (data.saveVersion !== SAVE_VERSION) {
    return { ok: false, reason: 'Speicherstand Version ' + data.saveVersion
      + ', diese Fassung liest Version ' + SAVE_VERSION };
  }

  const { createLevel, FieldSet, initNutrition, Construction } = deps;

  // --- Ebenen ------------------------------------------------------------
  world.levels.levels.length = 0;
  world.levels.byId.clear();
  world.levels.surface = null;
  world.fields.clear();
  for (const ld of data.levels) {
    const lvl = createLevel(ld);
    lvl.cells.set(unpackGrid(ld.cells, lvl.cells.length));
    lvl.meta.set(unpackGrid(ld.meta, lvl.meta.length));
    lvl.fillVariant(ld.variantSeed || 0);
    lvl.abandoned = !!ld.abandoned;
    lvl.airVersion = ld.airVersion;
    lvl.airCount = ld.airCount;
    lvl.view.x = ld.view.x; lvl.view.y = ld.view.y;
    lvl.view.zoom = ld.view.zoom; lvl.view.init = ld.view.init;
    lvl.markAllDirty();
    world.levels.add(lvl);
    world.ants.registerLevel(lvl.id);
    world.creatures.registerLevel(lvl.id);
    if (lvl.kind === LEVEL_KIND.NEST) world.digScent.registerLevel(lvl);
    if (lvl.kind === LEVEL_KIND.NEST) world.fields.set(lvl.id, new FieldSet(lvl));
  }
  world.levels.activeId = data.activeLevelId;

  // --- Portale -----------------------------------------------------------
  world.portals.portals.length = 0;
  world.portals.byCell.clear();
  world.portals.byColony.clear();
  for (const pd of data.portals) {
    const p = world.portals.create({
      colonyId: pd.colonyId,
      aLevelId: pd.aLevelId, ax: pd.ax, ay: pd.ay,
      bLevelId: pd.bLevelId, bx: pd.bx, by: pd.by,
      upLevelId: pd.upLevelId,
    });
    p.closed = pd.closed;
    p.pluggedBy = pd.pluggedBy;
  }

  // --- Kolonien ----------------------------------------------------------
  world.colonies.colonies.length = 0;
  world.colonies.byId.clear();
  const construction = new Construction(world);
  for (const cd of data.colonies) {
    const c = world.colonies.create({ generation: cd.generation, parentId: cd.parentId });
    initNutrition(c);
    construction.init(c);
    decodeColony(c, cd);
    if (world.phero) world.phero.addColony(c.id);
  }

  // --- Einheiten ---------------------------------------------------------
  poolFromJSON(world.ants, data.ants, ANT_COLS);
  rebuildAntTraits(world.ants);
  poolFromJSON(world.brood, data.brood, BROOD_COLS);
  poolFromJSON(world.creatures, data.creatures, CREATURE_COLS);

  // --- Pheromone ---------------------------------------------------------
  if (world.phero) {
    for (const pd of data.phero) {
      const entry = world.phero.byColony.get(pd.colonyId);
      if (!entry) continue;
      for (let t = 0; t < pd.fields.length && t < entry.fields.length; t++) {
        const fd = pd.fields[t];
        const f = entry.fields[t];
        f.grid.fill(0);
        const idx = new Int32Array(fd.n);
        const val = new Uint8Array(fd.n);
        rawDecodeInto(fd.idx, idx, fd.n);
        rawDecodeInto(fd.val, val, fd.n);
        f.count = 0;
        for (let k = 0; k < fd.n; k++) {
          f.grid[idx[k]] = val[k];
          if (f.count < f.active.length) f.active[f.count++] = idx[k];
        }
      }
      entry.nutrient.set(unpackGrid(pd.nutrient, entry.nutrient.length));
    }
  }

  // --- Restlicher Weltzustand --------------------------------------------
  world.tick = data.tick;
  if (data.mode) world.mode = data.mode;
  if (data.playerColonyId !== undefined) world.playerColonyId = data.playerColonyId;
  world.biasMode = data.biasMode;
  world.godMode = data.godMode;
  world.energy = data.energy;
  world.weather = { ...data.weather };
  world.lineage = data.lineage.map((e) => ({ ...e }));
  world.seenCastes = new Set(data.seenCastes);
  world.rngSim.setState(data.rng.sim);
  world.rngGen.setState(data.rng.gen);
  world.ctx.tick = world.tick;

  // Nahrungsregister genau so wiederherstellen, wie es gespeichert wurde
  for (const fd of data.foodReg || []) {
    const level = world.levels.get(fd.levelId);
    if (!level) continue;
    world.food.reg.delete(fd.levelId);
    world.food.registerLevel(level);
    const r = world.food.reg.get(fd.levelId);
    rawDecodeInto(fd.list, r.list, fd.count);
    r.count = fd.count;
    for (let k = 0; k < fd.count; k++) r.flag[r.list[k]] = 1;
  }
  if (!data.foodReg) world.food.reindex(world.levels.surface);
  if (data.stability) {
    world.stability.queue = data.stability.queue.map((e) => ({ ...e }));
    world.stability.collapses = data.stability.collapses;
  }
  if (data.combatKills !== undefined) world.combat.kills = data.combatKills;
  world.combat.fromJSON(data.combatPairs);
  world.diplomacy.fromJSON(data.diplomacy);
  // Bauwerke NACH den Kolonien, weil create() deren Boni neu zusammenrechnet
  world.structures.fromJSON(data.structures);
  world.ants.rebuildBuckets(world.levels);
  /**
   * Distanzfelder sofort und VOLLSTAENDIG neu rechnen, nicht ueber das
   * uebliche Budget von drei Feldern je Tick. Sonst laufen die ersten Ticks
   * nach dem Laden auf halbfertigen Feldern und der Verlauf weicht ab.
   */
  const fullBudget = { left: 1e9 };
  for (const colony of world.colonies.colonies) {
    for (const levelId of colony.nestLevelIds) {
      const fs = world.fields.get(levelId);
      if (fs) fs.update(colony, world.portals, fullBudget, world.construction.peek(colony, levelId));
    }
  }
  /**
   * Das Grabfeld ZULETZT, nach dem Vollaufbau: es wird nicht neu gerechnet,
   * sondern genau so wiederhergestellt, wie es beim Speichern stand – samt
   * seiner Rueckstaendigkeit. Sonst ist der geladene Stand frischer als der
   * laufende und weicht ab dem ersten Tick ab.
   */
  for (const fd of data.digFields || []) {
    const fs = world.fields.get(fd.levelId);
    if (fs) fs.digFromJSON(fd, rawDecodeInto);
  }
  world.digScent.fromJSON(data.digScent, rawDecodeInto);
  world.creatures.rebuildBuckets(world.levels);
  world.brood.recount(world.colonies);

  return { ok: true };
}
