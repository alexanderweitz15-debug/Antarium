/**
 * daynight.js – Tag-Nacht-Zyklus (Phase 10).
 *
 * Der Zyklus ist KEIN reiner Farbfilter. Er greift in die Simulation ein:
 *
 *   - tagaktive Arten (Fliege, Wespe, Marienkaefer) werden nachts traege,
 *   - nachtaktive Arten (Laufkaefer, Ohrwurm) tagsueber,
 *   - Ameisen sammeln nachts langsamer,
 *   - Pflanzen wachsen nur bei Licht nach.
 *
 * Dadurch verschiebt sich das Kraefteverhaeltnis im Lauf eines Tages von
 * selbst, statt dass nur das Bild dunkler wird.
 *
 * Er gilt nur fuer die OBERFLAECHE. Unter der Erde ist es immer dunkel –
 * eine Nest-Ebene sieht bei Tag und bei Nacht gleich aus.
 */

import { DAYNIGHT } from '../config.js';

export const PHASE_NAME = ['Nacht', 'Morgengrauen', 'Tag', 'Abenddaemmerung'];

/**
 * Tageszeit 0..1 aus dem Tick. 0 = Mitternacht.
 * @param {number} tick
 */
export function timeOfDay(tick) {
  const c = DAYNIGHT.CYCLE_TICKS;
  return ((tick % c) + c) % c / c;
}

/**
 * Helligkeit 0..1 zur gegebenen Tageszeit. Uebergaenge sind linear – eine
 * Sinuskurve saehe kaum anders aus und waere schwerer zu lesen.
 */
export function lightAt(t) {
  const { DAWN, DAY_END, DUSK, DAY_LIGHT, NIGHT_LIGHT } = DAYNIGHT;
  if (t < DAWN) return NIGHT_LIGHT + (DAY_LIGHT - NIGHT_LIGHT) * (t / DAWN);
  if (t < DAY_END) return DAY_LIGHT;
  if (t < DUSK) return DAY_LIGHT - (DAY_LIGHT - NIGHT_LIGHT) * ((t - DAY_END) / (DUSK - DAY_END));
  return NIGHT_LIGHT;
}

/** Abschnitt des Tages als Index in PHASE_NAME. */
export function phaseAt(t) {
  const { DAWN, DAY_END, DUSK } = DAYNIGHT;
  if (t < DAWN) return 1;
  if (t < DAY_END) return 2;
  if (t < DUSK) return 3;
  return 0;
}

/**
 * Aktivitaetsfaktor einer Art bei gegebenem Licht.
 * Arten ohne Angabe sind rund um die Uhr gleich aktiv.
 * @param {{nocturnal?:boolean, diurnal?:boolean}} sp
 * @param {number} light 0..1
 */
export function activityFor(sp, light) {
  const lo = DAYNIGHT.ACTIVITY_MIN;
  if (sp.nocturnal) return lo + (1 - lo) * (1 - light);
  if (sp.diurnal) return lo + (1 - lo) * light;
  return 1;
}

/** Uhrzeit als hh:mm fuer die Anzeige. */
export function clockString(t) {
  const mins = Math.floor(t * 24 * 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
