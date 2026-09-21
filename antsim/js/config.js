/**
 * config.js – Zentrale Balancing- und Systemwerte.
 *
 * REGEL: Alle Zahlen, die das Spielgefuehl, die Performance oder die Simulation
 * beeinflussen, stehen hier. Kein anderes Modul definiert "magische Zahlen".
 * Gruppen sind thematisch sortiert und kommentiert.
 */

export const VERSION = '1.0.0';
export const PHASE = 10;

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
  NEST_STAY_MIN: 30,
  NEST_STAY_MAX: 150,
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
  FIELD_BUDGET_PER_TICK: 3,
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
  /** Brut pro Klick mit dem Brut-Werkzeug. */
  SPAWN_BROOD: 8,
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

// ===========================================================================
// PHASE 2/3 – NAHRUNG UND ERNAEHRUNG
// ===========================================================================

/** Die drei Naehrstoffe. Reihenfolge = Index in allen Naehrstoff-Arrays. */
export const NUTRIENT = { SUGAR: 0, PROTEIN: 1, FAT: 2 };
export const NUTRIENT_KEYS = ['sugar', 'protein', 'fat'];
export const NUTRIENT_NAMES = ['Zucker', 'Protein', 'Fett'];
export const NUTRIENT_COLORS = [0xe8c246, 0xd1543f, 0xd8c9a3];

export const FOOD = {
  /** Einheiten, die eine Ameise pro Fuhre aufnimmt. */
  PICKUP: 8,
  /** Ticks zwischen zwei Nachwachs-Durchlaeufen. */
  REGROW_INTERVAL: 30,
  /** Globaler Regler (Umweltregler in der UI). */
  REGROW_SCALE: 1.0,
  /** Ab welchem Restbestand eine Quelle als leer gilt. */
  EMPTY_AT: 1,
  /**
   * Profile je Nahrungstyp:
   *   n      : Anteile [Zucker, Protein, Fett], Summe 1
   *   max    : Hoechstbestand einer Zelle
   *   regrow : Einheiten je Nachwachs-Durchlauf (0 = waechst nicht nach)
   *   decay  : Einheiten, die je Durchlauf verderben (Aas)
   */
  PROFILES: {
    flower:   { n: [0.95, 0.03, 0.02], max: 60,  regrow: 0.8, decay: 0 },
    aphids:   { n: [0.90, 0.08, 0.02], max: 180, regrow: 2.2, decay: 0 },
    fruit:    { n: [0.70, 0.05, 0.25], max: 140, regrow: 0.6, decay: 0.05 },
    seeds:    { n: [0.15, 0.25, 0.60], max: 120, regrow: 0.5, decay: 0 },
    carrion:  { n: [0.10, 0.70, 0.20], max: 160, regrow: 0,   decay: 0.12 },
    sugarcube:{ n: [1.00, 0.00, 0.00], max: 255, regrow: 0,   decay: 0 },
    meat:     { n: [0.05, 0.85, 0.10], max: 255, regrow: 0,   decay: 0.08 },
    seedpile: { n: [0.10, 0.20, 0.70], max: 255, regrow: 0,   decay: 0 },
  },
  /** Regionale Verteilung: Frequenz des Rauschens fuer Nahrungszonen. */
  REGION_FREQ: 0.009,
  /** Grunddichte der jeweiligen Quelle in ihrer Vorzugsregion. */
  DENSITY: { flower: 0.0045, aphids: 0.0016, fruit: 0.0012, seeds: 0.0030, carrion: 0.0008 },
};

export const NUTRITION = {
  /** Grundverbrauch einer erwachsenen Arbeiterin pro Tick (Zucker). */
  SUGAR_PER_ADULT: 0.00035,
  /** Zusatzverbrauch durch Tempo und Koerpergroesse. */
  SUGAR_SPEED_FACTOR: 0.7,
  /** Proteinbedarf je Larve und Tick. */
  PROTEIN_PER_LARVA: 0.0085,
  /** Proteinbedarf der Koenigin je Ei. */
  PROTEIN_PER_EGG: 0.9,
  /** Fettbedarf je Erwachsener und Tick (Reserven). */
  FAT_PER_ADULT: 0.00012,
  /** Ticks des gleitenden Fensters fuer die Bilanz (3 Spieltage a 600 Ticks). */
  BALANCE_WINDOW: 1800,
  /** Ticks zwischen zwei Bilanz-/KI-Durchlaeufen (gestaffelt). */
  UPDATE_INTERVAL: 15,
  /** Hunger je Tick ohne Zucker; ab 1.0 stirbt die Ameise. */
  /**
   * Umsatz von Fett in Energie, wenn der Zucker fehlt. Unter 1, weil die
   * Umwandlung Verluste hat – eine fettreiche Kolonie ueberlebt eine
   * Duerre, zahlt aber drauf.
   */
  FAT_TO_SUGAR: 0.8,
  HUNGER_RATE: 0.0016,
  /** Streubreite der individuellen Hungertoleranz (Faktor auf die Schwelle 1). */
  HUNGER_TOL_MIN: 0.80,
  HUNGER_TOL_MAX: 1.60,
  /** Hunger, ab dem eine Ameise langsamer wird. */
  HUNGER_SLOW: 0.5,
  /** Speicherkapazitaet je Naehrstoff und Vorratskammerzelle. */
  STORE_PER_CELL: 26,
  /** Grundkapazitaet ohne Vorratskammer. */
  STORE_BASE: 260,
  /** Phaenotyp: maximale Auswirkung von Ueberschuss/Mangel. */
  PHENO_SIZE_RANGE: [0.75, 1.25],
  PHENO_SPEED_RANGE: [0.85, 1.15],
  PHENO_LIFE_RANGE: [0.80, 1.25],
};

// ===========================================================================
// PHASE 2 – PHEROMONE (nur Oberflaeche; im Nest navigieren Flow Fields)
// ===========================================================================
export const PHERO = {
  /** Typen je Kolonie. */
  TYPES: { HOME: 0, FOOD: 1, ALARM: 2 },
  TYPE_NAMES: ['Heimweg', 'Nahrung', 'Alarm'],
  TYPE_COLORS: [0x4f9ad8, 0x66d07a, 0xd9604a],
  COUNT: 3,
  /** Hoechstwert einer Zelle (Uint8). */
  MAX: 255,
  /** Ablagemenge je Tick und Ameise. */
  DEPOSIT: { HOME: 26, FOOD: 34, ALARM: 60 },
  /** Ablage faellt mit der Entfernung zur Quelle ab (Ticks seit Start). */
  DEPOSIT_FALLOFF: 900,
  /** Ticks zwischen zwei Verdunstungsdurchlaeufen. */
  DECAY_INTERVAL: 6,
  /** Restanteil je Durchlauf (0.985^(1/6) pro Tick). */
  DECAY: { HOME: 0.94, FOOD: 0.955, ALARM: 0.88 },
  /** Sensorabstand in Zellen und Oeffnungswinkel. */
  SENSE_DIST: 2.6,
  SENSE_ANGLE: 0.62,
  /** Lenkstaerke der Spurverfolgung. */
  STEER: 0.55,
  /** Zufallsanteil, damit Spuren nicht einfrieren. */
  NOISE: 0.22,
  /** Hoechstzahl aktiver Zellen je Feld (Ringpuffer). */
  MAX_ACTIVE: 48000,
};

// ===========================================================================
// PHASE 3 – BRUT UND LEBENSZYKLUS
// ===========================================================================
export const BROOD = {
  MAX: 6000,
  /** Ticks je Stadium (bei voller Versorgung). */
  EGG_TICKS: 420,
  LARVA_TICKS: 900,
  PUPA_TICKS: 700,
  /** Protein, das eine Larve insgesamt braucht. */
  LARVA_PROTEIN: 7.5,
  /** Ohne Fuetterung wird die Larve langsamer und stirbt irgendwann. */
  LARVA_STARVE_TICKS: 1400,
  /** Eierrate der Koenigin: Ticks zwischen zwei Eiern bei Gen 0.5. */
  EGG_INTERVAL: 90,
  /** Hoechstzahl Brut je Kolonie. */
  MAX_PER_COLONY: 900,
  /** Proteinanteil, ab dem teure Kasten aufgezogen werden koennen. */
  RICH_PROTEIN: 0.9,
  /** Bei extremem Mangel frisst die Kolonie eigene Eier. */
  CANNIBAL_BALANCE: 0.35,
  /**
   * Klaustrale Gruendung: bis zu so vielen Ameisen versorgt die Koenigin
   * die Brut selbst aus dem Lager (siehe sim/brood.js).
   */
  CLAUSTRAL_WORKERS: 4,
  /** Protein je Tick und Larve, das die Koenigin dabei zusteuert. */
  CLAUSTRAL_RATE: 0.006,
};

export const LIFE = {
  /** Lebensdauer einer Arbeiterin in Ticks (Gen 0.5, Phaenotyp 1.0). */
  WORKER_LIFESPAN: 30000,
  QUEEN_LIFESPAN: 240000,
  /** Streuung der Lebensdauer. */
  LIFESPAN_JITTER: 0.25,
  /** Tote werden zu Aas mit dieser Menge. */
  CORPSE_FOOD: 22,
};

// ===========================================================================
// PHASE 7 – RAEUBER UND ANDERE KREATUREN
// ===========================================================================
export const CREATURES = {
  MAX: 400,
  /** Ticks zwischen zwei Durchlaeufen der Fortpflanzungspruefung. */
  BREED_INTERVAL: 120,
  /** Globaler Dichteregler (Umweltregler in der UI). */
  DENSITY_SCALE: 1.0,
  /**
   * Artentabelle. energy = Nahrungsspeicher, drain = Verbrauch je Tick.
   *   diet   : 'ants' (jagt Ameisen) | 'plants' (frisst Zellen)
   *   eats   : Schluessel der Nahrungszellen fuer diet 'plants'
   *            (Vorgabe: flower, fruit, carrion, aphids)
   *   grazes : frisst die Zelle dabei auf, statt nur daran zu naschen
   *   nocturnal/diurnal: Tagesrhythmus (siehe sim/daynight.js)
   *   mows   : raeumt beim Grasen auch Pflanzen und Blueten ganz ab
   *   ambush : lauert ohne Bauwerk und schlaegt aus dem Stand zu
   *   web/funnel: baut Netz bzw. Trichter
   *   entersNest: darf durch Portale in Nest-Ebenen
   */
  SPECIES: [
    {
      key: 'fly', name: 'Fliege', color: 0x8fa3b8,
      size: 0.8, hp: 0.6, speed: 2.2, damage: 0, sense: 6,
      energy: 46, drain: 0.006, breedAt: 36, breedCost: 20, maxAge: 9000,
      diet: 'plants', prey: false, entersNest: false, diurnal: true,
      art: { body: [2.6, 1.9], head: [1.5, 1.4], legs: 6, legLen: 3.4, wings: 2, shell: 0, jaws: 0, abdomen: [3.0, 2.0] },
      desc: 'Harmlos, schnell, vermehrt sich stark. Beute fuer Spinnen und Ameisen.',
    },
    {
      key: 'orbweaver', name: 'Radnetzspinne', color: 0xbfa66a,
      size: 1.8, hp: 6, speed: 0.35, damage: 2.2, sense: 9,
      energy: 90, drain: 0.0028, breedAt: 80, breedCost: 45, maxAge: 55000,
      diet: 'ants', prey: true, entersNest: false, web: true,
      art: { body: [2.2, 2.0], head: [1.4, 1.3], legs: 8, legLen: 6.4, wings: 0, shell: 0, jaws: 0.8, abdomen: [3.8, 3.4] },
      desc: 'Baut Netze zwischen Pflanzen und Steinen und wartet auf Beute.',
    },
    {
      key: 'wolfspider', name: 'Wolfsspinne', color: 0x8d6f4a,
      size: 2.2, hp: 9, speed: 1.15, damage: 3.0, sense: 18,
      energy: 110, drain: 0.011, breedAt: 95, breedCost: 55, maxAge: 36000,
      diet: 'ants', prey: true, entersNest: true,
      art: { body: [2.6, 2.2], head: [1.7, 1.6], legs: 8, legLen: 5.2, wings: 0, shell: 0, jaws: 1.2, abdomen: [3.4, 2.9] },
      desc: 'Jagt aktiv, dringt ueber Eingaenge in Nester ein.',
    },
    {
      key: 'antlion', name: 'Ameisenloewe', color: 0xa89066,
      size: 1.6, hp: 7, speed: 0.12, damage: 2.6, sense: 5,
      energy: 100, drain: 0.0018, breedAt: 88, breedCost: 50, maxAge: 70000,
      diet: 'ants', prey: true, entersNest: false, funnel: true,
      art: { body: [3.0, 2.2], head: [2.2, 2.0], legs: 6, legLen: 3.0, wings: 0, shell: 1, jaws: 3.2, abdomen: [3.6, 2.6] },
      desc: 'Graebt Trichter in Sand und zieht hineingerutschte Beute hinab.',
    },
    {
      key: 'beetle', name: 'Laufkaefer', color: 0x4a5a3c,
      size: 2.4, hp: 11, speed: 0.95, damage: 2.4, sense: 16,
      energy: 120, drain: 0.012, breedAt: 100, breedCost: 60, maxAge: 44000,
      diet: 'ants', prey: true, entersNest: true, digsEntrance: true, nocturnal: true,
      eats: ['aphids', 'carrion'],
      art: { body: [3.2, 2.6], head: [1.8, 1.7], legs: 6, legLen: 3.6, wings: 0, shell: 2, jaws: 1.6, abdomen: [4.2, 3.2] },
      desc: 'Nachtaktiv, frisst auch Blattlaeuse und graebt eigene Zugaenge.',
    },
    {
      key: 'caterpillar', name: 'Raupe', color: 0x7fae4c,
      size: 2.0, hp: 14, speed: 0.30, damage: 0, sense: 7,
      energy: 130, drain: 0.0035, breedAt: 118, breedCost: 70, maxAge: 26000,
      diet: 'plants', prey: false, entersNest: false, grazes: true, mows: true,
      eats: ['plant'],
      art: { body: [3.4, 2.8], head: [1.8, 1.8], legs: 6, legLen: 1.8, wings: 0, shell: 0, jaws: 0.4, abdomen: [5.2, 3.0] },
      desc: 'Frisst Pflanzen kahl. Wehrlos, aber zaeh – eine wandernde Fleischportion.',
    },
    {
      key: 'ladybug', name: 'Marienkaefer', color: 0xc8402f,
      size: 1.1, hp: 3.5, speed: 1.0, damage: 0, sense: 12,
      energy: 70, drain: 0.006, breedAt: 58, breedCost: 34, maxAge: 20000,
      diet: 'plants', prey: false, entersNest: false, grazes: true, diurnal: true,
      eats: ['aphids', 'flower'],
      art: { body: [2.4, 2.2], head: [1.4, 1.3], legs: 6, legLen: 2.6, wings: 1, shell: 2, jaws: 0.5, abdomen: [3.2, 3.0] },
      desc: 'Frisst Blattlaeuse weg – steht damit in direkter Nahrungskonkurrenz zu den Ameisen.',
    },
    {
      key: 'woodlouse', name: 'Assel', color: 0x6b6f78,
      size: 1.0, hp: 4.5, speed: 0.55, damage: 0, sense: 6,
      energy: 64, drain: 0.0035, breedAt: 52, breedCost: 30, maxAge: 30000,
      diet: 'plants', prey: false, entersNest: true, grazes: true, nocturnal: true,
      eats: ['carrion', 'fruit'],
      art: { body: [2.6, 2.2], head: [1.3, 1.2], legs: 8, legLen: 1.6, wings: 0, shell: 2, jaws: 0.3, abdomen: [3.4, 2.6] },
      desc: 'Zersetzer. Raeumt Aas weg, bevor die Ameisen es holen, und wandert auch ins Nest.',
    },
    {
      key: 'earwig', name: 'Ohrwurm', color: 0x93502a,
      size: 1.5, hp: 7, speed: 1.05, damage: 1.8, sense: 13,
      energy: 88, drain: 0.008, breedAt: 74, breedCost: 42, maxAge: 32000,
      diet: 'ants', prey: true, entersNest: true, nocturnal: true,
      eats: ['fruit', 'carrion'],
      art: { body: [2.8, 2.0], head: [1.6, 1.4], legs: 6, legLen: 2.8, wings: 0, shell: 1, jaws: 2.4, abdomen: [4.0, 2.4] },
      desc: 'Zangenjaeger. Dringt gern in Nester ein und holt sich Brut aus den Kammern.',
    },
    {
      key: 'wasp', name: 'Wespe', color: 0xe0b020,
      size: 1.4, hp: 5, speed: 2.0, damage: 3.6, sense: 22,
      energy: 95, drain: 0.012, breedAt: 82, breedCost: 48, maxAge: 22000,
      diet: 'ants', prey: true, entersNest: false, diurnal: true,
      eats: ['flower', 'fruit', 'carrion'],
      art: { body: [2.6, 1.8], head: [1.5, 1.4], legs: 6, legLen: 3.0, wings: 2, shell: 0, jaws: 1.4, abdomen: [3.8, 2.2] },
      desc: 'Schneller Luftjaeger. Toedlich im offenen Feld, geht aber nie unter die Erde.',
    },
    {
      key: 'mantis', name: 'Gottesanbeterin', color: 0x66a05a,
      size: 2.6, hp: 20, speed: 0.75, damage: 4.2, sense: 11,
      energy: 150, drain: 0.005, breedAt: 130, breedCost: 80, maxAge: 48000,
      diet: 'ants', prey: true, entersNest: false, ambush: true,
      art: { body: [3.0, 2.2], head: [1.8, 1.6], legs: 6, legLen: 5.6, wings: 1, shell: 0, jaws: 3.6, abdomen: [5.0, 2.6] },
      desc: 'Lauert regungslos und schlaegt aus dem Stand zu. Apexraeuber:'
        + ' toedlich, aber als Lauerjaegerin mit kurzer Sichtweite nicht'
        + ' selbsterhaltend – auf Dauer haelt sie sich nur, wenn der Spieler'
        + ' nachsetzt oder Beute in ihre Naehe geraet.',
    },
  ],
  /** Obergrenze je Art als Vielfaches des Startbesatzes. */
  POP_CAP: 2.2,
  /** Startbesatz je Art auf einer frischen Karte. */
  START: {
    fly: 45, orbweaver: 8, wolfspider: 6, antlion: 5, beetle: 4,
    caterpillar: 8, ladybug: 6, woodlouse: 12, earwig: 4, wasp: 4, mantis: 2,
  },
  /** Kreaturen mutieren bei der Fortpflanzung (eigene kleine Evolution). */
  MUTATION: 0.06,
  /** Ameisen greifen Raeuber an, wenn mindestens so viele in der Naehe sind. */
  SWARM_COURAGE: 5,
  /** Schaden pro Tick je Ameise ueber der Schwelle. */
  ANT_DAMAGE: 0.022,
  /**
   * Gejagt wird nur unterhalb dieses Anteils der Energiekapazitaet. Damit
   * bestimmt der Stoffwechsel die Beutemenge – ein satter Raeuber laesst
   * Ameisen in Ruhe.
   */
  HUNT_HUNGER: 0.6,
  /** Ticks zwischen zwei Bissen. */
  ATTACK_COOLDOWN: 45,
  /** Schadensfaktor eines Bisses (mal Artschaden mal Groesse). */
  BITE: 0.8,
  /** Energie je erbeuteter Ameise (mal Kastengroesse). */
  MEAL: 48,
  /** Ticks, die eine Kreatur nach einer Mahlzeit frisst. */
  FEED_TICKS: 260,
  /** Mindestabstand des Startbesatzes zu Nesteingaengen (Zellen). */
  START_MIN_DIST: 55,
  /**
   * Weidegang: Wahrscheinlichkeit je Tick und Bissgroesse.
   *
   * Beim ersten Anlauf waren das 0.05 und 4 Einheiten. Ein Dutzend
   * Marienkaefer nahm den Blattlaeusen damit rund 2.6 Einheiten pro Tick ab
   * – mehr als nachwuchs. Die Ameisen fanden spaeter keinen Zucker mehr und
   * das Volk verhungerte nach etwa 35 Minuten. Jetzt ist der Frassdruck
   * klein genug, dass er als Konkurrenz spuerbar ist, ohne die Quelle zu
   * vernichten.
   */
  GRAZE_CHANCE: 0.03,
  GRAZE_BITE: 1,
  /** Zellen um einen Nesteingang, die Raeuber bei der Spursuche meiden. */
  PORTAL_AVOID: 18,
  /** Pflanzen breiten sich aus: geprueft alle N Ticks. */
  PLANT_REGROW_INTERVAL: 150,
  /** Stichproben je Durchlauf und Wahrscheinlichkeit, dass eine greift. */
  PLANT_REGROW_SAMPLES: 220,
  PLANT_REGROW_CHANCE: 0.52,
};

// ===========================================================================
// PHASE 8 – GENOM UND EVOLUTION
// ===========================================================================
export const GENES = [
  // Stoffwechsel -> Zucker
  { key: 'geschwindigkeit', name: 'Geschwindigkeit', group: 'stoffwechsel' },
  { key: 'lebensdauer', name: 'Lebensdauer', group: 'stoffwechsel' },
  { key: 'eierrate', name: 'Eierrate', group: 'stoffwechsel' },
  { key: 'temperatur', name: 'Temperaturtoleranz', group: 'stoffwechsel' },
  // Koerper -> Protein
  { key: 'koerpergroesse', name: 'Koerpergroesse', group: 'koerper' },
  { key: 'panzerung', name: 'Panzerung', group: 'koerper' },
  { key: 'kieferkraft', name: 'Kieferkraft', group: 'koerper' },
  { key: 'grabgeschwindigkeit', name: 'Grabtempo', group: 'koerper' },
  { key: 'sensorik', name: 'Sensorik', group: 'koerper' },
  // Verhalten -> Stress
  { key: 'aggressivitaet', name: 'Aggressivitaet', group: 'verhalten' },
  { key: 'verteidigung', name: 'Verteidigung', group: 'verhalten' },
  { key: 'bautrieb', name: 'Bautrieb', group: 'verhalten' },
  { key: 'expansionsdrang', name: 'Expansionsdrang', group: 'verhalten' },
  { key: 'soldatenanteil', name: 'Soldatenanteil', group: 'verhalten' },
  { key: 'pheromonstaerke', name: 'Pheromonstaerke', group: 'verhalten' },
  { key: 'rueckzugsschwelle', name: 'Rueckzugsschwelle', group: 'verhalten' },
  // Kastengene
  { key: 'saeure', name: 'Saeure', group: 'kaste' },
  { key: 'aufopferung', name: 'Aufopferung', group: 'kaste' },
  { key: 'speicher', name: 'Speicher', group: 'kaste' },
  { key: 'fuersorge', name: 'Fuersorge', group: 'kaste' },
];

export const EVO = {
  /** Mitgift einer Jungkoenigin [Zucker, Protein, Fett]. */
  DOWRY: [140, 110, 70],
  /** Grundstreuung der Mutation. */
  SIGMA_BASE: 0.055,
  SIGMA_MAX: 0.30,
  /** Einfluss von Stress auf die Mutationsstaerke. */
  K_STRESS: 1.6,
  /** Einfluss eines Naehrstoffueberschusses je Naehrstoff. */
  K_SURPLUS: [0.9, 1.1, 0.7],
  /** Fett-Ueberschuss stabilisiert alle Gene. */
  FAT_STABILIZE: 0.30,
  /** Richtungsstaerke; 0 = "Realistisch". */
  BIAS_MODES: { realistisch: 0, standard: 0.2, stark: 0.6 },
  DEFAULT_BIAS: 'standard',
  /** Sprungmutation. */
  JUMP_BASE: 0.012,
  JUMP_RANGE: 0.3,
  /** Stressgewichte je Naehstoff und Zusatzquellen. */
  STRESS_WEIGHT: [0.8, 1.0, 0.6],
  STRESS_WAR: 0.030,
  STRESS_PREDATOR: 0.018,
  STRESS_QUEENLOSS: 0.6,
  STRESS_MAX: 2.5,
  STRESS_DECAY: 0.9985,
  /** Mutagene. */
  FUNGUS_SIGMA: 2.0,
  BERRY_JUMP: 3.0,
  /** Hochzeitsflug. */
  FLIGHT_MIN_POP: 140,
  FLIGHT_MIN_BALANCE: 0.85,
  FLIGHT_INTERVAL: 5400,
  FLIGHT_ALATES: [4, 14],
  FLIGHT_SURVIVAL: 0.35,
  /** Muetterlicher Effekt. */
  MATERNAL_PHENO: 0.5,
  MATERNAL_DECAY: 0.0006,
  /** Sandbox-Regler (Forschungsmenue). */
  MUTATION_SCALE: 1.0,
  FLIGHT_SCALE: 1.0,
};

/**
 * Gewichtstabelle w[naehrstoff][gen]: wie stark ein Naehrstoffueberschuss
 * die Stabilitaet einer Gengruppe beeinflusst. Verhaltensgene haengen am
 * Stress und stehen deshalb in keiner Naehrstoffspalte.
 */
export const GENE_WEIGHTS = {
  sugar: { geschwindigkeit: 1, lebensdauer: 1, eierrate: 1, temperatur: 1, sensorik: 0.6, bautrieb: 0.6 },
  protein: { koerpergroesse: 1, panzerung: 1, kieferkraft: 1, grabgeschwindigkeit: 1, saeure: 0.8, aufopferung: 0.8 },
  fat: { speicher: 1, fuersorge: 1, lebensdauer: 0.4 },
};

/** Schwellen, ab denen eine evolutionaere Kaste aufgezogen werden kann. */
export const CASTE_UNLOCK = {
  armor:   { gene: 'panzerung', at: 0.62, needs: ['soldier'] },
  acid:    { gene: 'saeure', at: 0.55, needs: [] },
  bomb:    { gene: 'aufopferung', at: 0.60, needs: ['acid'] },
  replete: { gene: 'speicher', at: 0.58, needs: [] },
  pioneer: { gene: 'bautrieb', at: 0.66, needs: [] },
  medic:   { gene: 'fuersorge', at: 0.60, needs: [] },
  scout:   { gene: 'sensorik', at: 0.64, needs: [] },
  titan:   { gene: 'koerpergroesse', at: 0.78, needs: ['soldier', 'armor'], gene2: 'panzerung', at2: 0.72 },
};

// ===========================================================================
// FORSCHUNGSMENUE (Sandbox) – Regler, die die Simulation beschleunigen
// ===========================================================================
export const RESEARCH = {
  /** Auswahl fuer den Zeitraffer der Evolution. */
  MUTATION_STEPS: [0.5, 1, 2, 5, 10],
  FLIGHT_STEPS: [0.5, 1, 2, 5, 20],
  FOOD_STEPS: [0, 0.5, 1, 2, 5],
  PREDATOR_STEPS: [0, 0.5, 1, 2, 4],
  /** Generationen, die "Generation ueberspringen" auf einmal rechnet. */
  FAST_FORWARD_TICKS: 9000,
};

// ===========================================================================
// PHASE 6 – STABILITAET UND BEFESTIGUNGEN
// ===========================================================================
export const STABILITY = {
  /**
   * Tragbare Deckenspannweite je Zelltyp (Zellen). Laeuft eine Decke
   * weiter, ohne dass darunter etwas steht, stuerzt sie ein.
   */
  MAX_SPAN: {
    soil: 7, hardsoil: 11, stone: 99, root: 13, pebble: 8,
    reinforced: 24, pillar: 99, resin: 9, plug: 7, debris: 5, topsoil: 14,
  },
  /** Wahrscheinlichkeit, dass eine ueberspannte Zelle bei der Pruefung faellt. */
  COLLAPSE_CHANCE: 0.30,
  /** Radius einer lokalen Pruefung nach dem Graben. */
  CHECK_RADIUS: 7,
  /** Hoechstzahl Pruefungen pro Tick (Warteschlange). */
  MAX_CHECKS_PER_TICK: 2,
  /** Ticks, die eine verschuettete Einheit zum Freigraben braucht. */
  BURY_TICKS: 120,
  /** Schaden beim Verschuetten. */
  BURY_DAMAGE: 0.6,
  /** Abstand, in dem die Kolonie in breiten Kammern Pfeiler setzt. */
  PILLAR_SPACING: 5,
  /** Ab dieser Kammerbreite baut die Kolonie ueberhaupt Pfeiler. */
  PILLAR_MIN_WIDTH: 8,
};

export const FORTIFY = {
  /** Materialkosten je Befestigungszelle. */
  COST: {
    reinforced: { pebble: 2, soil: 0 },
    pillar: { pebble: 3 },
    resin: { resin: 2 },
    plug: { pebble: 2 },
    wall: { pebble: 2 },
  },
  /** Bauaufwand (Punkte wie beim Graben). */
  EFFORT: { reinforced: 120, pillar: 140, resin: 90, plug: 70, wall: 80 },
  /** Ticks zwischen zwei Planungsschritten der Verteidigung. */
  PLAN_INTERVAL: 90,
  /** Ab dieser Bedrohungsstufe wird ueberhaupt befestigt. */
  MIN_THREAT: 1,
  /** Gen "verteidigung", ab dem auch im Frieden vorgebaut wird. */
  PREEMPTIVE_GENE: 0.6,
  /** Hoechstzahl offener Bauauftraege je Kolonie. */
  MAX_ORDERS: 220,
  /** Kiesel je abgebauter Kieselzelle. */
  PEBBLE_PER_CELL: 3,
  /** Harz je Ernte an einer Pflanze. */
  RESIN_PER_HARVEST: 2,
  /** Ticks, bis eine Pflanze wieder Harz gibt. */
  RESIN_REGROW: 900,
};

// ===========================================================================
// PHASE 5 – KAMPF, BEDROHUNG UND RAUBZUEGE
// ===========================================================================
export const COMBAT = {
  /** Reichweite eines Nahkampfangriffs in Zellen. */
  REACH: 1.3,
  /** Grundschaden pro Tick = Kastenschaden * DAMAGE_SCALE. */
  DAMAGE_SCALE: 0.09,
  /** Panzerung: Schadensminderung bei Gen 1.0. */
  ARMOR_MAX: 0.6,
  /** Zuckermangel senkt die Kampfkraft bis auf diesen Anteil. */
  HUNGER_PENALTY: 0.45,
  /**
   * Jede Ameise prueft nur alle CHECK_EVERY Ticks auf Feinde, nach Index
   * versetzt. Bei 5000 Ameisen sind das rund 600 Abfragen pro Tick statt
   * 5000 – ohne dass ein Kampf spuerbar spaeter beginnt.
   */
  CHECK_EVERY: 8,
  /** Sichtweite fuer Feinde. */
  SIGHT: 6,
  /** In Engstellen (wenige freie Nachbarn) kaempft nur die vorderste Reihe. */
  NARROW_NEIGHBOURS: 3,
  /** Ticks, die eine Ameise einem Feind nachsetzt. */
  PURSUE_TICKS: 240,
  /** Unter diesem HP-Anteil zieht sich eine Ameise zurueck (mal Gen). */
  RETREAT_HP: 0.35,

  /** Bedrohungsstufen: Radien um die Eingaenge. */
  THREAT_NEAR: 26,
  THREAT_AT_GATE: 7,
  /** Ticks zwischen zwei Bedrohungsauswertungen. */
  THREAT_INTERVAL: 20,

  /** Raubzuege. */
  RAID_MIN_POP: 90,
  RAID_MIN_SOLDIERS: 8,
  RAID_INTERVAL: 3600,
  RAID_SQUAD: [8, 26],
  /** Proteinbilanz, unter der auch friedliche Voelker raubziehen. */
  RAID_HUNGER: 0.7,
  /** Ticks, nach denen ein Raubzug aufgibt und heimkehrt. */
  RAID_TIMEOUT: 5400,
  /** Protein je erbeuteter Brut. */
  LOOT_BROOD: 9,
  /** Nahrung je Zugriff auf eine fremde Vorratskammer. */
  LOOT_STORE: 25,
};

// ===========================================================================
// PHASE 4 – KINOMODUS UND FRONTVERFOLGUNG
// ===========================================================================
export const CINEMA = {
  /** Millisekunden zwischen zwei Spruengen. */
  INTERVAL_MS: 9000,
  /** Kategorien, die als sehenswert gelten. */
  CATEGORIES: ['kampf', 'evolution', 'katastrophe', 'raeuber'],
  /** Zoom, mit dem angeflogen wird. */
  ZOOM: 5,
  /** Ticks, die ein Ereignis hoechstens alt sein darf. */
  MAX_AGE: 1800,
  /** Frontverfolgung: so viele Kaempfende muessen es mindestens sein. */
  FRONT_MIN_ANTS: 4,
  /** Anteil der Reststrecke, den die Kamera je Sekunde aufholt. */
  FRONT_GLIDE: 3.0,
};

// ===========================================================================
// PHASE 10 – TAG UND NACHT, TEILCHEN, TON, EINSTELLUNGEN
// ===========================================================================
export const DAYNIGHT = {
  /** Eingeschaltet? Kann in den Einstellungen abgeschaltet werden. */
  ENABLED: true,
  /**
   * Ticks fuer einen vollen Tag. 10800 = 6 Minuten bei 1x, 36 Sekunden bei
   * 10x – lang genug, um Nacht als Phase zu erleben, kurz genug, um bei
   * einer Sitzung mehrere Zyklen zu sehen.
   */
  CYCLE_TICKS: 10800,
  /**
   * Anteile des Tages. 0 ist Mitternacht, 0.5 ist Mittag – die Uhr in der
   * Kopfzeile rechnet den Anteil direkt in eine Uhrzeit um, deshalb muessen
   * die Schwellen zu plausiblen Zeiten passen (Morgengrauen 06:29,
   * Abenddaemmerung ab 18:43, Nacht ab 20:38).
   */
  DAWN: 0.27,
  DAY_END: 0.78,
  DUSK: 0.86,
  /** Helligkeit tagsueber und tiefste Helligkeit nachts (0..1). */
  DAY_LIGHT: 1.0,
  NIGHT_LIGHT: 0.34,
  /** Farbe der Nachtblende und des Daemmerungsschimmers. */
  NIGHT_TINT: 0x0d1a33,
  DUSK_TINT: 0x4a2a18,
  /** Wie stark tagaktive bzw. nachtaktive Arten gebremst werden. */
  ACTIVITY_MIN: 0.30,
  /** Sammelrate der Ameisen bei voller Nacht (1 = kein Einfluss). */
  ANT_NIGHT_SPEED: 0.72,
};

export const PARTICLES = {
  ENABLED: true,
  /** Obergrenze gleichzeitiger Teilchen (Ringpuffer, keine Allokation). */
  MAX: 700,
  /** Lebensdauer in Frames je Sorte. */
  LIFE: { dust: 48, spark: 32, splash: 34, gore: 40, leaf: 110 },
  /** Groesse in Weltpixeln. */
  SIZE: { dust: 2.2, spark: 2.0, splash: 2.4, gore: 2.0, leaf: 2.6 },
  /** Teilchen je Ereignis. */
  BURST: { dig: 3, collapse: 14, lightning: 26, meteor: 40, death: 6, blast: 30 },
  GRAVITY: 0.06,
  DRAG: 0.93,
};

export const AUDIO = {
  /** Ton ist optional. Fehlt eine Datei, bleibt es still – ohne Fehler. */
  ENABLED: false,
  VOLUME: 0.5,
  DIR: 'assets/sfx/',
  /** Ereignis -> Dateiname (ohne Pfad). */
  FILES: {
    click: 'click.wav',
    dig: 'dig.wav',
    collapse: 'collapse.wav',
    fight: 'fight.wav',
    thunder: 'thunder.wav',
    alarm: 'alarm.wav',
  },
  /** Mindestabstand in ms zwischen zwei gleichen Toenen. */
  THROTTLE_MS: 120,
};

export const SETTINGS_DEFAULTS = {
  daynight: true,
  particles: true,
  shake: true,
  sound: false,
  volume: 0.5,
  transition: true,
  interpolate: true,
  autosave: false,
};

/** Schluessel im localStorage. */
export const STORAGE = {
  SETTINGS: 'formicarium.settings',
  SAVE: 'formicarium.save',
};

// ===========================================================================
// PHASE 9 – GOETTLICHE EINGRIFFE
// ===========================================================================
export const GODMODE = {
  /** "sandbox" = unbegrenzt, "challenge" = goettliche Energie laedt auf. */
  DEFAULT_MODE: 'sandbox',
  ENERGY_MAX: 100,
  /** Energie pro Sekunde im Herausforderungsmodus. */
  ENERGY_REGEN: 1.2,
  /** Voreingestellte Staerke und Radius (per UI verstellbar). */
  DEFAULT_RADIUS: 14,
  DEFAULT_POWER: 1.0,
  RADIUS_RANGE: [3, 60],
  POWER_RANGE: [0.2, 3],

  QUAKE_NEST_RADIUS: 40,
  FLOOD_DEPTH: 26,
  FLOOD_DAMAGE: 0.05,
  WATER_DRY_INTERVAL: 90,
  WATER_DRY_CHANCE: 0.06,
  DROUGHT_TICKS: 5400,
  RAIN_TICKS: 2700,
  PLAGUE_TICKS: 3600,
  PLAGUE_DAMAGE: 0.0016,
  PLAGUE_SPREAD: 0.02,
  FRENZY_TICKS: 1800,
  FRENZY_SPEED: 1.6,
  BLESSING_HEAL: 1.0,
  METEOR_CRATER: 0.6,
  LIGHTNING_DAMAGE: 12,
  REINFORCE_COUNT: 25,
  SWARM_COUNT: 10,
  FOODRAIN_AMOUNT: 200,
  /** "Vorrat fuellen": Zuckereinheiten (Protein und Fett anteilig). */
  SUPPLY_AMOUNT: 400,
  /** "Brutschub": Zahl der gesetzten Eier. */
  BROOD_COUNT: 25,
  /** Schaden einer Sprengung an Einheiten im Radius. */
  BLAST_DAMAGE: 14,
  /** Staerke der kuenstlichen Duftspur je Zelle. */
  SCENT_AMOUNT: 180,
};
