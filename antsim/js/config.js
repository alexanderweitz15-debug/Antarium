/**
 * config.js – Zentrale Balancing- und Systemwerte.
 *
 * REGEL: Alle Zahlen, die das Spielgefuehl, die Performance oder die Simulation
 * beeinflussen, stehen hier. Kein anderes Modul definiert "magische Zahlen".
 * Gruppen sind thematisch sortiert und kommentiert.
 */

export const VERSION = '0.1.0';
export const PHASE = 1;

/** Fest gepinnte PixiJS-Version (CDN). Siehe index.html importmap. */
export const PIXI_VERSION = '8.21.0';

// ---------------------------------------------------------------------------
// SIMULATION / ZEIT
// ---------------------------------------------------------------------------
export const SIM = {
  /** Feste Simulationsrate in Ticks pro Sekunde (entkoppelt vom Rendering). */
  TICK_RATE: 30,
  /** Dauer eines Ticks in ms (abgeleitet, hier vorberechnet). */
  TICK_MS: 1000 / 30,
  /** Waehlbare Geschwindigkeiten. 0 = Pause. */
  SPEEDS: [0, 1, 2, 5, 10],
  DEFAULT_SPEED_INDEX: 1,
  /**
   * Obergrenze an Ticks pro dargestelltem Frame. Verhindert die
   * "Todesspirale", wenn die Simulation langsamer laeuft als Echtzeit.
   */
  MAX_TICKS_PER_FRAME: 24,
  /** Groesster akzeptierter Frame-Abstand in ms (Tab-Wechsel etc.). */
  MAX_FRAME_MS: 250,
};

// ---------------------------------------------------------------------------
// WELT / GRIDS
// ---------------------------------------------------------------------------
export const WORLD = {
  /** Oberflaeche (Draufsicht). */
  SURFACE_W: 400,
  SURFACE_H: 400,
  /** Nest-Ebene (Querschnitt). */
  NEST_W: 200,
  NEST_H: 150,
  /**
   * Zeile, die in einer Nest-Ebene die Erdoberflaeche darstellt. Darueber
   * liegt ein schmaler Himmel-/Oberflaechenstreifen zur Orientierung.
   * Nesteingaenge (Portale) liegen IMMER genau auf dieser Zeile.
   */
  NEST_SURFACE_ROW: 6,
  /** Kantenlaenge eines Terrain-Chunks in Zellen. */
  CHUNK: 64,
  /** Weltkoordinaten pro Zelle. */
  CELL_SIZE: 4,
  /** Texturpixel pro Zelle in einer Chunk-Textur (Pixel-Art-Aufloesung). */
  CELL_PX: 4,
};

// ---------------------------------------------------------------------------
// HARTE OBERGRENZEN (Speicher wird beim Start reserviert)
// ---------------------------------------------------------------------------
export const LIMITS = {
  MAX_COLONIES: 8,
  MAX_NEST_LEVELS: 12,
  /** Gesamtzahl Ameisen ueber ALLE Ebenen. */
  MAX_ANTS: 6000,
  MAX_PREDATORS: 64,
  /** Ringpuffer des Ereignis-Logs. */
  EVENT_LOG_SIZE: 400,
};

// ---------------------------------------------------------------------------
// PORTALE (Nesteingaenge)
// ---------------------------------------------------------------------------
export const PORTALS = {
  /** Ticks, die eine Einheit im Eingangsschacht "unterwegs" ist. */
  TRANSIT_TICKS: 8,
  /** Wie viele Einheiten pro Tick und Richtung ein Portal aufnimmt. */
  CAPACITY_PER_TICK: 4,
  /** Abstand zum Portalmittelpunkt (Zellen), ab dem ein Uebertritt greift. */
  ENTER_RADIUS: 0.9,
  /**
   * Ticks, die eine Einheit nach dem Uebertritt kein Portal erneut benutzt.
   * Verhindert Ping-Pong direkt am Ausgang.
   */
  REENTRY_COOLDOWN: 45,
};

// ---------------------------------------------------------------------------
// AMEISEN (Phase 1: Grundbewegung; Verhalten folgt in Phase 2/3)
// ---------------------------------------------------------------------------
export const ANTS = {
  /** Basisgeschwindigkeit einer Arbeiterin in Zellen pro Tick. */
  BASE_SPEED: 0.34,
  /** Zufaelliger Richtungswechsel beim Erkunden (Radiant pro Tick, max). */
  WANDER_TURN: 0.35,
  /** Lenkstaerke Richtung Ziel (0..1 pro Tick). */
  STEER_GAIN: 0.18,
  /** Ticks, die eine Ameise erkundet, bevor sie heimkehrt (Phase-1-Platzhalter). */
  EXPLORE_TICKS_MIN: 240,
  EXPLORE_TICKS_MAX: 900,
  /** Ticks, die eine Ameise im Nest bleibt, bevor sie wieder ausrueckt. */
  NEST_STAY_MIN: 90,
  NEST_STAY_MAX: 420,
  /** Animationsgeschwindigkeit: Laufbilder pro zurueckgelegter Zelle. */
  ANIM_FRAMES_PER_CELL: 2.2,
};

// ---------------------------------------------------------------------------
// KAMERA
// ---------------------------------------------------------------------------
export const CAMERA = {
  MIN_ZOOM: 0.5,
  MAX_ZOOM: 14,
  DEFAULT_ZOOM: 3,
  /** Multiplikator pro Mausrad-Raste. */
  ZOOM_STEP: 1.18,
  /** Tastatur-Panning in Weltpixeln pro Sekunde (bei Zoom 1). */
  PAN_SPEED: 700,
  /** Wie weit man ueber den Kartenrand hinausschieben darf (Bildschirmanteil). */
  OVERSCROLL: 0.35,
};

// ---------------------------------------------------------------------------
// EBENENWECHSEL / UEBERGANG
// ---------------------------------------------------------------------------
export const TRANSITION = {
  ENABLED: true,
  /** Gesamtdauer des Uebergangs in ms (Hinein + Heraus). */
  DURATION_MS: 500,
  /** Zoomfaktor, auf den waehrend des Hineinziehens beschleunigt wird. */
  ZOOM_IN_FACTOR: 2.4,
  /** Zielzoom in der neuen Ebene. */
  ARRIVE_ZOOM: 4,
};

// ---------------------------------------------------------------------------
// RENDERING
// ---------------------------------------------------------------------------
export const RENDER = {
  /** Kantenlaenge eines prozeduralen Ameisen-Sprites in Pixeln. */
  SPRITE_PX: 20,
  /** Anzahl Laufbilder pro Kaste. */
  WALK_FRAMES: 6,
  /** Koerperlaenge einer Arbeiterin in Zellen (Groesse 1.0, ohne Beine). */
  ANT_CELLS: 1.2,
  /**
   * Groessenunterschiede werden unterlinear dargestellt (size^SIZE_EXPONENT).
   * Sonst fuellt eine Koenigin (size 4.0) den halben Tunnel, obwohl sie
   * simulationsseitig nur viermal so "gross" ist.
   */
  SIZE_EXPONENT: 0.65,
  /** Zusaetzlicher Rand beim Culling in Zellen. */
  CULL_MARGIN: 6,
  /** Maximale Chunk-Uploads pro Frame in der aktiven Ebene. */
  CHUNK_UPLOADS_PER_FRAME: 6,
  /** Hintergrundfarbe (ausserhalb der Karte). */
  BACKGROUND: 0x0b0d0c,
  /** Obergrenze gleichzeitig sichtbarer Ameisen-Sprites. */
  MAX_ANT_SPRITES: 6000,
};

// ---------------------------------------------------------------------------
// KOLONIEN (Namen und Farben; Kolonie-Logik folgt in Phase 3)
// ---------------------------------------------------------------------------
export const COLONY = {
  NAMES: ['Rot', 'Blau', 'Gruen', 'Gelb', 'Violett', 'Tuerkis', 'Orange', 'Sand'],
  COLORS: [0xd9483b, 0x3f7fd9, 0x4caf50, 0xe0c341, 0x9b59d0, 0x33c2c2, 0xe08a33, 0xd8cdb4],
  /** Startpopulation einer Kolonie in Phase 1 (nur zur Demonstration). */
  START_ANTS: 260,
};

// ---------------------------------------------------------------------------
// WELTGENERATOR (deterministisch aus dem Seed)
// ---------------------------------------------------------------------------
export const GEN = {
  /** Standard-Seed, falls keiner per URL (?seed=...) uebergeben wird. */
  DEFAULT_SEED: 'formica-1',
  SURFACE: {
    /** Frequenzen des Wertrauschens (kleiner = groessere Strukturen). */
    BIOME_FREQ: 0.012,
    DETAIL_FREQ: 0.06,
    /** Schwellen fuer Terrain aus dem Rauschen. */
    WATER_LEVEL: -0.45,
    SAND_LEVEL: -0.30,
    DIRT_LEVEL: 0.16,
    /** Streudichten (Wahrscheinlichkeit pro passender Zelle). */
    STONE_DENSITY: 0.010,
    PEBBLE_DENSITY: 0.004,
    PLANT_DENSITY: 0.006,
    FLOWER_DENSITY: 0.0025,
  },
  NEST: {
    /** Tiefe (Zeilen unter der Oberflaeche), ab der harte Erde haeufiger wird. */
    HARD_SOIL_START: 40,
    HARD_SOIL_FREQ: 0.09,
    STONE_FREQ: 0.055,
    STONE_THRESHOLD: 0.62,
    ROOT_DENSITY: 0.010,
    PEBBLE_DENSITY: 0.008,
    /** Startnest: Schachtbreite, Schachttiefe, Kammermasse. */
    START_SHAFT_W: 2,
    START_SHAFT_DEPTH: 34,
    START_QUEEN_RX: 7,
    START_QUEEN_RY: 4,
    START_STORE_RX: 5,
    START_STORE_RY: 3,
  },
};

// ---------------------------------------------------------------------------
// PERFORMANCE-OVERLAY
// ---------------------------------------------------------------------------
export const PERF = {
  /** Glaettungsfaktor der gleitenden Mittelwerte (0..1, hoeher = traeger). */
  SMOOTHING: 0.9,
  /** Aktualisierungsintervall des Overlay-Textes in ms. */
  UPDATE_MS: 250,
};

// ---------------------------------------------------------------------------
// KASTEN – Werte relativ zur Arbeiterin (= 1.0).
// size   : Koerpergroesse (skaliert Sprite, HP-Basis, Nahrungsbedarf)
// hp     : Trefferpunkte
// speed  : Laufgeschwindigkeit
// damage : Nahkampfschaden pro Tick
// Die evolutionaeren Kasten sind ab Phase 8 verfuegbar; ihre Werte stehen
// bereits hier, damit Sprites, Legende und Bilanzformeln eine Quelle haben.
// ---------------------------------------------------------------------------
export const CASTE_STATS = {
  queen:   { size: 4.0, hp: 20.0, speed: 0.25, damage: 0.5 },
  worker:  { size: 1.0, hp: 1.0,  speed: 1.00, damage: 0.3 },
  soldier: { size: 1.8, hp: 3.0,  speed: 0.80, damage: 1.5 },
  alate:   { size: 1.5, hp: 1.5,  speed: 1.10, damage: 0.3 },
  armor:   { size: 1.6, hp: 6.0,  speed: 0.40, damage: 0.8 },
  acid:    { size: 1.2, hp: 1.2,  speed: 0.90, damage: 0.6 },
  bomb:    { size: 1.0, hp: 0.8,  speed: 1.00, damage: 0.0 },
  replete: { size: 2.5, hp: 1.5,  speed: 0.10, damage: 0.1 },
  pioneer: { size: 1.1, hp: 1.2,  speed: 0.90, damage: 0.3 },
  medic:   { size: 1.0, hp: 1.0,  speed: 1.10, damage: 0.2 },
  scout:   { size: 0.9, hp: 0.8,  speed: 1.80, damage: 0.2 },
  titan:   { size: 3.0, hp: 15.0, speed: 0.35, damage: 5.0 },
};

// ---------------------------------------------------------------------------
// GRABEN UND NESTBAU
// Vorgezogen aus Phase 3, damit man Ameisen beim Tunnelbau zusehen kann.
// Kosten sind "Grabpunkte"; eine Ameise bringt RATE_PER_ANT Punkte pro Tick.
// ---------------------------------------------------------------------------
export const DIG = {
  /** Ticks zwischen zwei Planungsschritten der Kolonie. */
  PLAN_INTERVAL: 45,
  /** Unter dieser Warteschlangenlaenge plant die Kolonie neu. */
  MIN_QUEUE: 5,
  /** Obergrenze offener Grabauftraege je Kolonie. */
  MAX_QUEUE: 400,
  /** Grabaufwand je Zelltyp (Punkte). */
  COST: { soil: 150, hardsoil: 380, pebble: 300, root: 420, debris: 60 },
  /** Grabpunkte, die eine Arbeiterin pro Tick beisteuert. */
  RATE_PER_ANT: 1.0,
  /** Aus dieser Entfernung (Zellen) kann gegraben werden. */
  REACH: 1.7,
  /** Anteil der Ameisen im Nest, die sich am Graben beteiligen. */
  DIGGER_SHARE: 0.6,
  /** Wie viele Zellen Nest je Ameise der Kolonie angestrebt werden. */
  CELLS_PER_ANT: 1.2,
  /** Mindestgroesse, unter der immer weitergegraben wird. */
  MIN_NEST_CELLS: 60,
  /** Wahrscheinlichkeit, dass ein neues Projekt eine Kammer wird. */
  CHAMBER_CHANCE: 0.38,
  /** Laengenbereiche neuer Projekte. */
  SHAFT_LEN: [6, 16],
  TUNNEL_LEN: [8, 24],
  CHAMBER_RX: [4, 8],
  CHAMBER_RY: [3, 5],
  /** Mindestabstand zum unteren Kartenrand. */
  BOTTOM_MARGIN: 6,
  /** Flow Fields, die pro Tick hoechstens neu berechnet werden. */
  FIELD_BUDGET_PER_TICK: 1,
  /** Ticks, die eine Ameise hoechstens an einem Grabauftrag haengt. */
  JOB_TIMEOUT: 900,
  /** Ticks, die eine Ameise nach dem Abladen an der Oberflaeche bleibt. */
  DUMP_STAY: [60, 200],
};

// ---------------------------------------------------------------------------
// SPIELER-WERKZEUGE (Sandbox)
// ---------------------------------------------------------------------------
export const TOOLS = {
  BRUSH_MIN: 1,
  BRUSH_MAX: 25,
  BRUSH_DEFAULT: 3,
  /** Ameisen pro Klick mit dem Spawn-Werkzeug. */
  SPAWN_ANTS: 15,
  /** Startpopulation einer per Werkzeug gegruendeten Kolonie. */
  FOUND_ANTS: 45,
};

// ---------------------------------------------------------------------------
// KARTENVORLAGEN
// Jede Vorlage ueberschreibt Werte aus GEN. "seed: null" = Seed frei waehlbar.
// ---------------------------------------------------------------------------
export const MAP_PRESETS = [
  {
    key: 'wiese', name: 'Wiese', seed: 'formica-1',
    desc: 'Ausgewogen: viel Gras, verstreute Erdflecken, einzelne Pfuetzen.',
    surface: {},
    nest: {},
  },
  {
    key: 'steppe', name: 'Steppe', seed: 'steppe-1',
    desc: 'Trocken und sandig, kaum Wasser, viele offene Flaechen.',
    surface: { WATER_LEVEL: -0.78, SAND_LEVEL: 0.05, DIRT_LEVEL: 0.42, PLANT_DENSITY: 0.002, FLOWER_DENSITY: 0.001, STONE_DENSITY: 0.006 },
    nest: { HARD_SOIL_START: 26 },
  },
  {
    key: 'aue', name: 'Flussaue', seed: 'aue-1',
    desc: 'Feucht: viele Pfuetzen, Sandbaenke und dichter Bewuchs.',
    surface: { WATER_LEVEL: -0.18, SAND_LEVEL: -0.02, DIRT_LEVEL: 0.10, PLANT_DENSITY: 0.016, FLOWER_DENSITY: 0.008 },
    nest: { HARD_SOIL_START: 55, ROOT_DENSITY: 0.022 },
  },
  {
    key: 'geroell', name: 'Geroellhang', seed: 'geroell-1',
    desc: 'Steinig und karg. Graben ist muehsam, Deckung gibt es reichlich.',
    surface: { STONE_DENSITY: 0.055, PEBBLE_DENSITY: 0.02, PLANT_DENSITY: 0.003, DIRT_LEVEL: 0.30 },
    nest: { HARD_SOIL_START: 12, STONE_THRESHOLD: 0.50, PEBBLE_DENSITY: 0.02 },
  },
  {
    key: 'garten', name: 'Bluetengarten', seed: 'garten-1',
    desc: 'Viele Bluetenpflanzen und Kiesel – gut fuer zuckerreiche Linien.',
    surface: { PLANT_DENSITY: 0.02, FLOWER_DENSITY: 0.014, PEBBLE_DENSITY: 0.012, WATER_LEVEL: -0.35 },
    nest: {},
  },
  {
    key: 'zufall', name: 'Zufall', seed: null,
    desc: 'Standardparameter mit frisch gewuerfeltem Seed.',
    surface: {},
    nest: {},
  },
];

export function mapPreset(key) {
  return MAP_PRESETS.find((p) => p.key === key) || MAP_PRESETS[0];
}
