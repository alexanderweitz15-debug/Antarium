/**
 * castes.js – Kastendefinitionen.
 *
 * Reine Datentabelle. Zahlen kommen aus config.js (CASTE_STATS), die
 * Zeichenparameter (art) beschreiben die Silhouette fuer den prozeduralen
 * Sprite-Generator. Sprite-System und Legende lesen ausschliesslich diese
 * Tabelle – neue Kasten erscheinen dadurch automatisch ueberall.
 */

import { CASTE_STATS } from '../config.js';

export const CASTE = {
  QUEEN: 0,
  WORKER: 1,
  SOLDIER: 2,
  ALATE: 3,
  ARMOR: 4,
  ACID: 5,
  BOMB: 6,
  REPLETE: 7,
  PIONEER: 8,
  MEDIC: 9,
  SCOUT: 10,
  TITAN: 11,
};

/**
 * art-Parameter (in Sprite-Pixeln bei 16x16, Koerperachse zeigt nach +X):
 *   ab   : Abdomen  [rx, ry]
 *   th   : Thorax   [rx, ry]
 *   hd   : Kopf     [rx, ry]
 *   mand : Mandibellaenge (0 = keine sichtbaren Kiefer)
 *   leg  : Beinlaenge
 *   ant  : Fuehlerlaenge
 *   wings: Fluegel zeichnen
 *   plate: Panzerplatten auf dem Abdomen
 *   stripe: Querstreifen auf dem Abdomen
 */
export const CASTE_DEFS = [
  {
    id: CASTE.QUEEN, key: 'queen', name: 'Koenigin', role: 'Legt die Eier, verlaesst die Kammer nur in Not.',
    evolutionary: false, requires: '',
    ...CASTE_STATS.queen,
    art: { ab: [4.6, 2.9], th: [2.2, 1.7], hd: [2.0, 1.8], mand: 1.2, leg: 5.6, ant: 3.8, wings: false, plate: 0, stripe: 3 },
  },
  {
    id: CASTE.WORKER, key: 'worker', name: 'Arbeiterin', role: 'Sammeln, Graben, Bauen, Brutpflege.',
    evolutionary: false, requires: '',
    ...CASTE_STATS.worker,
    art: { ab: [3.2, 2.2], th: [2.0, 1.5], hd: [1.9, 1.7], mand: 1.4, leg: 5.6, ant: 3.5, wings: false, plate: 0, stripe: 1 },
  },
  {
    id: CASTE.SOLDIER, key: 'soldier', name: 'Soldatin', role: 'Wache, Patrouille, Verteidigung, Raubzuege.',
    evolutionary: false, requires: '',
    ...CASTE_STATS.soldier,
    art: { ab: [3.4, 2.4], th: [2.2, 1.7], hd: [2.8, 2.4], mand: 2.8, leg: 5.9, ant: 3.0, wings: false, plate: 1, stripe: 1 },
  },
  {
    id: CASTE.ALATE, key: 'alate', name: 'Gefluegelte', role: 'Jungkoenigin oder Drohne vor dem Hochzeitsflug.',
    evolutionary: false, requires: '',
    ...CASTE_STATS.alate,
    art: { ab: [3.8, 2.4], th: [2.2, 1.7], hd: [2.0, 1.8], mand: 1.2, leg: 5.3, ant: 3.5, wings: true, plate: 0, stripe: 2 },
  },
  {
    id: CASTE.ARMOR, key: 'armor', name: 'Panzerameise', role: 'Verschliesst Eingaenge als lebende Tuer.',
    evolutionary: true, requires: 'Soldatin vorhanden, Gen "panzerung" ueber Schwelle',
    ...CASTE_STATS.armor,
    art: { ab: [3.0, 2.4], th: [2.2, 1.9], hd: [3.2, 3.0], mand: 1.0, leg: 4.6, ant: 2.0, wings: false, plate: 3, stripe: 0 },
  },
  {
    id: CASTE.ACID, key: 'acid', name: 'Saeureschuetzin', role: 'Fernkampf mit Saeurestrahl, loest Harz und Netze.',
    evolutionary: true, requires: 'Gen "saeure" ueber Schwelle',
    ...CASTE_STATS.acid,
    art: { ab: [3.4, 2.0], th: [2.0, 1.5], hd: [1.9, 1.7], mand: 1.0, leg: 5.6, ant: 3.8, wings: false, plate: 0, stripe: 2, nozzle: true },
  },
  {
    id: CASTE.BOMB, key: 'bomb', name: 'Sprengameise', role: 'Opfert sich in einer klebrigen Saeureexplosion.',
    evolutionary: true, requires: 'Gene "saeure" und "aufopferung"',
    ...CASTE_STATS.bomb,
    art: { ab: [3.8, 3.0], th: [1.8, 1.4], hd: [1.7, 1.5], mand: 1.0, leg: 5.3, ant: 3.2, wings: false, plate: 0, stripe: 0, bulge: true },
  },
  {
    id: CASTE.REPLETE, key: 'replete', name: 'Honigtopfameise', role: 'Lebender Vorratsspeicher fuer Zucker und Fett.',
    evolutionary: true, requires: 'Gen "speicher" ueber Schwelle',
    ...CASTE_STATS.replete,
    art: { ab: [5.0, 4.4], th: [1.8, 1.4], hd: [1.6, 1.5], mand: 0.8, leg: 4.0, ant: 2.5, wings: false, plate: 0, stripe: 0, bulge: true },
  },
  {
    id: CASTE.PIONEER, key: 'pioneer', name: 'Pionierin', role: 'Baut und repariert dreifach schnell, traegt Kiesel und Harz.',
    evolutionary: true, requires: 'Gen "bautrieb" ueber Schwelle',
    ...CASTE_STATS.pioneer,
    art: { ab: [3.2, 2.2], th: [2.3, 1.8], hd: [2.2, 1.9], mand: 2.0, leg: 5.9, ant: 3.0, wings: false, plate: 1, stripe: 2 },
  },
  {
    id: CASTE.MEDIC, key: 'medic', name: 'Sanitaeterin', role: 'Traegt Verwundete ins Lazarett und heilt sie.',
    evolutionary: true, requires: 'Gen "fuersorge" ueber Schwelle',
    ...CASTE_STATS.medic,
    art: { ab: [3.0, 2.1], th: [2.0, 1.5], hd: [1.9, 1.7], mand: 1.2, leg: 5.6, ant: 4.0, wings: false, plate: 0, stripe: 3 },
  },
  {
    id: CASTE.SCOUT, key: 'scout', name: 'Spaeherin', role: 'Schnell, grosse Sensorreichweite, legt starke Spuren.',
    evolutionary: true, requires: 'Gen "sensorik" ueber Schwelle',
    ...CASTE_STATS.scout,
    art: { ab: [2.8, 1.8], th: [1.9, 1.4], hd: [1.8, 1.5], mand: 1.2, leg: 7.3, ant: 5.2, wings: false, plate: 0, stripe: 1 },
  },
  {
    id: CASTE.TITAN, key: 'titan', name: 'Titanin', role: 'Schwerste Kampfkaste, passt nicht durch enge Tunnel.',
    evolutionary: true, requires: 'Soldatin und Panzerameise vorhanden, "koerpergroesse" und "panzerung" sehr hoch',
    ...CASTE_STATS.titan,
    art: { ab: [4.2, 3.2], th: [2.6, 2.2], hd: [3.4, 2.9], mand: 3.4, leg: 6.6, ant: 2.8, wings: false, plate: 3, stripe: 1 },
  },
];

/** Schneller Zugriff per ID. */
export const CASTE_BY_ID = CASTE_DEFS.slice().sort((a, b) => a.id - b.id);
export const CASTE_BY_KEY = new Map(CASTE_DEFS.map((c) => [c.key, c]));

export function casteDef(id) { return CASTE_BY_ID[id]; }
