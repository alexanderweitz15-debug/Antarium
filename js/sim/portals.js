/**
 * portals.js – Nesteingaenge als Verbindung zwischen Ebenen.
 *
 * Ein Portal ist ein PAAR aus einer Oberflaechenzelle (Seite A) und einer
 * Zelle in der Oberflaechenzeile einer Nest-Ebene (Seite B). Es ist die
 * EINZIGE Verbindung zwischen Ebenen – zwischen den Nestern VERSCHIEDENER
 * Voelker gibt es keine unterirdische Verbindung.
 *
 * Seit Phase 11 verbindet ein Portal auch zwei Nest-Ebenen DESSELBEN Volkes
 * (der Abstiegsschacht, siehe World.expandNest). Damit eine Ameise auf einer
 * mittleren Ebene den Weg nach draussen findet und nicht in den Schacht
 * nach unten laeuft, merkt sich jedes Portal in upLevelId, welche seiner
 * beiden Seiten die obere ist.
 *
 * Eigenschaften:
 *  - Kapazitaet pro Tick und Richtung (Engstelle, ab Phase 5 Schlachtpunkt)
 *  - verschliessbar (Kolonie) bzw. blockierbar (Panzerameise, Phase 8)
 *  - kurze Uebergangszeit: die Einheit steckt im Schacht und ist unsichtbar
 */

import { PORTALS } from '../config.js';

export class Portal {
  constructor(opts) {
    /** Wird von PortalSystem.create() vergeben (kein modulglobaler Zaehler). */
    this.id = -1;
    this.colonyId = opts.colonyId;
    /** Seite A = Oberflaeche */
    this.aLevelId = opts.aLevelId;
    this.ax = opts.ax;
    this.ay = opts.ay;
    /** Seite B = Nest */
    this.bLevelId = opts.bLevelId;
    this.bx = opts.bx;
    this.by = opts.by;
    /** Ebene der oberen Seite. Bei Eingaengen ist das die Oberflaeche. */
    this.upLevelId = opts.upLevelId !== undefined ? opts.upLevelId : opts.aLevelId;

    /** Von der Kolonie verschlossen (Nacht, Bedrohung). */
    this.closed = false;
    /** Ameisen-Index einer blockierenden Panzerameise, sonst -1 (Phase 8). */
    this.pluggedBy = -1;
    /** Durchlass pro Tick je Richtung. */
    this.capacity = PORTALS.CAPACITY_PER_TICK;
    this.usedAB = 0;
    this.usedBA = 0;
    /** Statistik fuers Overlay. */
    this.totalPassages = 0;
    /** Wie viele Einheiten gerade im Schacht stecken. */
    this.inTransit = 0;
  }

  key(levelId, x, y) { return levelId + ':' + x + ':' + y; }

  /** Gegenseite des Portals relativ zu einer Ebene. */
  other(levelId) {
    if (levelId === this.aLevelId) return { levelId: this.bLevelId, x: this.bx, y: this.by, side: 'B' };
    return { levelId: this.aLevelId, x: this.ax, y: this.ay, side: 'A' };
  }

  /** Position dieses Portals auf der angegebenen Ebene (oder null). */
  on(levelId) {
    if (levelId === this.aLevelId) return { x: this.ax, y: this.ay };
    if (levelId === this.bLevelId) return { x: this.bx, y: this.by };
    return null;
  }
}

export class PortalSystem {
  constructor() {
    /** @type {Portal[]} */
    this.portals = [];
    /** Zellindex -> Portal (beide Seiten eingetragen). */
    this.byCell = new Map();
    /** @type {Map<number, Portal[]>} */
    this.byColony = new Map();
  }

  /**
   * Neues Portalpaar anlegen.
   * @param {{colonyId:number, aLevelId:number, ax:number, ay:number, bLevelId:number, bx:number, by:number, upLevelId?:number}} opts
   */
  create(opts) {
    const p = new Portal(opts);
    p.id = this.portals.length;
    this.portals.push(p);
    this.byCell.set(p.aLevelId + ':' + p.ax + ':' + p.ay, p);
    this.byCell.set(p.bLevelId + ':' + p.bx + ':' + p.by, p);
    let list = this.byColony.get(p.colonyId);
    if (!list) { list = []; this.byColony.set(p.colonyId, list); }
    list.push(p);
    return p;
  }

  /** Portal auf einer Zelle, sonst null. */
  at(levelId, x, y) {
    return this.byCell.get(levelId + ':' + x + ':' + y) || null;
  }

  ofColony(colonyId) { return this.byColony.get(colonyId) || []; }

  byId(id) {
    for (let i = 0; i < this.portals.length; i++) if (this.portals[i].id === id) return this.portals[i];
    return null;
  }

  /** Naechstes Portal der Kolonie auf einer Ebene (quadratische Distanz). */
  nearest(levelId, colonyId, x, y) {
    const list = this.ofColony(colonyId);
    let best = null, bestD = Infinity;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const pos = p.on(levelId);
      if (!pos) continue;
      const dx = pos.x - x, dy = pos.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  /** Zaehler am Tickbeginn zuruecksetzen. */
  beginTick() {
    for (let i = 0; i < this.portals.length; i++) {
      this.portals[i].usedAB = 0;
      this.portals[i].usedBA = 0;
    }
  }

  /**
   * Darf eine Einheit der Kolonie colonyId gerade eintreten?
   *
   * Fremde Ameisen kommen nur als Raubzug hinein (raider = true, ab Phase 5).
   * Ohne diese Sperre laufen Sammlerinnen versehentlich in Nachbarnester,
   * nehmen dort Aufgaben an und fehlen dem eigenen Volk.
   */
  /**
   * Darf diese Einheit durch? Eigene immer, Raeuberinnen als Ausnahme –
   * und seit Phase 12 auch Verbuendete: wer zu Hilfe kommt, muss durch die
   * Tuer passen.
   * @param {boolean} ally true, wenn das Volk mit dem Besitzer verbuendet ist
   */
  canEnter(portal, fromLevelId, colonyId, raider = false, ally = false) {
    const own = portal.colonyId === colonyId;
    if (!own && !raider && !ally) return false;
    /**
     * Eine verstopfte Passage bleibt dicht: dort steckt eine Panzerameise,
     * und die kann man umbringen – dagegen gibt es ein Mittel. Ein bloss
     * geschlossenes Tor dagegen laesst sich aufbrechen, sonst waere
     * Zumachen eine Siegbedingung (siehe PORTALS.FORCED_CAPACITY).
     */
    if (portal.pluggedBy >= 0 && !own && !ally) return false;
    const forcing = portal.closed && !own && !ally;
    const cap = forcing ? PORTALS.FORCED_CAPACITY : portal.capacity;
    if (fromLevelId === portal.aLevelId) return portal.usedAB < cap;
    return portal.usedBA < cap;
  }

  /** Bricht diese Einheit gerade ein verschlossenes Tor auf? */
  isForcing(portal, colonyId, ally = false) {
    return portal.closed && portal.colonyId !== colonyId && !ally;
  }

  /** Durchlass verbuchen. */
  consume(portal, fromLevelId) {
    if (fromLevelId === portal.aLevelId) portal.usedAB++;
    else portal.usedBA++;
    portal.inTransit++;
  }

  /** Uebertritt abgeschlossen. */
  completed(portal) {
    portal.inTransit--;
    portal.totalPassages++;
  }
}
