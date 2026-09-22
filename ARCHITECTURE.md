# Formicarium – Architektur

2D-Sandbox-Insekten-OEkosystem im Browser. PixiJS v8 fuer das Rendering,
Vanilla-ES6-Module fuer die Simulation, kein Build-Tool.

**Stand: alle zehn Phasen plus Phase 11 umgesetzt** (Version 1.1.0).
Einzelne Restpunkte und bewusste Vereinfachungen stehen in den
Abschnitten 12 und 13.

Kurz: Ameisen suchen ueber Pheromone Futter und bilden ohne jedes Scripting
Ameisenstrassen, tragen Nahrung mit Naehrstoffprofilen ein, ziehen Brut auf,
graben und befestigen ihr Nest, fuehren Krieg gegeneinander, werden von elf
Kreaturenarten bejagt oder beim Futter verdraengt, schwaermen aus und
gruenden Toechter mit mutiertem Genom. Die Ernaehrung bestimmt Phaenotyp
und Mutationsstaerke. Ein Tag-Nacht-Zyklus verschiebt laufend, wer gerade
aktiv ist. Der Spieler gestaltet Welt und Voelker ueber eine
Werkzeugleiste mit 27 goettlichen Eingriffen und kann jeden Stand
speichern und bitgenau fortsetzen.

Seit Phase 11 hat jede Koenigin einen CHARAKTER und jede Ameise
EIGENSCHAFTEN (61 Stueck), die Voelker unterhalten BEZIEHUNGEN von Krieg
bis Buendnis, und sie erforschen im Spiel MATERIALIEN und BAUWERKE –
darunter Geschuetze in drei Stufen.

---

## 1. Start und Projektlage

Das Spiel liegt im Unterordner `antsim/` des Repositories, weil im Wurzel-
verzeichnis bereits ein unabhaengiges Vite/React-Projekt liegt (siehe
`../README.md`). Innerhalb von `antsim/` gilt die im Lastenheft vereinbarte
Struktur unveraendert; `antsim/` ist der Projektroot dieses Spiels.

```sh
cd antsim
npx serve        # oder: npx http-server -p 8123
# danach http://localhost:8123/ im Browser oeffnen
```

`file://` funktioniert NICHT (ES-Module und `fetch` des Manifests brauchen
HTTP). Seed waehlen: `?seed=meinSeed` an die URL haengen.

### Tests

```sh
node test/sim-bench.mjs          # 17 Pruefungen ohne Browser: Leistung, Determinismus,
                                 # Nestbau, Futtersuche, Brut, Oekosystem, Evolution
npm i -D playwright              # einmalig, fuer den Browsertest
npx serve -l 8123 .              # in einem zweiten Terminal
node test/browser-check.mjs      # 28 Abnahmepruefungen im echten Browser
```

`test/sim-bench.mjs` laeuft ohne Browser, weil `js/sim/*` weder PixiJS noch
das DOM kennt. Beide Skripte geben eine Liste "OK/FEHL" aus und enden mit
Exitcode 1, wenn etwas fehlschlaegt.

### PixiJS

Fest gepinnt auf **8.21.0**. `index.html` enthaelt eine Importmap auf
`cdn.jsdelivr.net`. `js/render/pixi.js` faengt einen Fehlschlag ab und laedt
dann `vendor/pixi.min.mjs` (dieselbe Version, mitgeliefert). Dadurch laeuft
das Spiel auch ohne Netz. Welche Quelle benutzt wurde, steht im
Performance-Overlay (F3).

---

## 2. Modueluebersicht

```
index.html, style.css, ARCHITECTURE.md
assets/manifest.json           Sprite-Manifest (siehe Abschnitt 7)
vendor/pixi.min.mjs            Offline-Fallback fuer PixiJS

js/config.js                   ALLE Balancing- und Systemwerte
js/rng.js                      Seedbarer Zufall (sfc32) + Wertrauschen/fBm
js/main.js                     Bootstrap, Spielschleife, Eingabe, Fassade

js/sim/  (kennt WEDER PixiJS NOCH das DOM – laeuft auch headless unter Node)
  world.js        Weltaufbau + Tick-Orchestrierung (Zusatz zur Lastenheftliste)
  construction.js Grabauftraege planen und abarbeiten
  flowfields.js   Distanzfelder fuer die Navigation im Nest
  pheromones.js   Pheromonfelder der Oberflaeche (Heimweg, Nahrung, Alarm)
  food.js         Nahrungsquellen, Naehrstoffprofile, Nachwachsen
  nutrition.js    Bedarf, Bilanz, Phaenotyp, Stress
  brood.js        Ei -> Larve -> Puppe -> Ameise
  creatures.js    Raeuber und andere Kreaturen mit eigener kleiner Evolution
  genome.js       Genom, Mutationsformeln, Kastenfreischaltung
  combat.js       Kolonie gegen Kolonie: Nahkampf, Bedrohung, Raubzuege
  stability.js    Deckenspannen, Einstuerze, Erdbeben, Pfeilerplaetze
  interventions.js Tabelle aller goettlichen Eingriffe + laufende Wirkungen
  daynight.js     Tageszeit, Helligkeit, Aktivitaetsfaktoren je Art
  traits.js       Eigenschaften von Ameisen und Koeniginnen (Phase 11)
  diplomacy.js    Beziehungen der Voelker, Kriegsduft, Wellenstaerke
  structures.js   Materialien, Bauwerke, Forschungsbaum
  save.js         Speichern und Laden (RLE + Base64, bitgenau fortsetzbar)
  fx.js           Kennungen der Anzeige-Effekte (Teilchen), ohne Render-Bezug
  levels.js       Level, LevelManager, Chunk-Dirty-Verwaltung, Kamerazustand
  surface.js      Oberflaechen-Grid, Zelltyp-Tabelle, Generator, Eingangsbau
  nest.js         Nest-Grid, Zelltyp- und Kammertabelle, Generator, Grabfunktionen
  portals.js      Portal, PortalSystem (Kapazitaet, Verschluss, Uebertritt)
  spatial.js      Spatial Hash pro Ebene (head/next, allokationsfrei)
  ants.js         Ameisen als Structure of Arrays + Zustandsmaschine
  castes.js       Kastendefinitionen (Werte aus config.js, Zeichenparameter)
  colony.js       Kolonie-Daten, ColonyManager, roemische Generationszahlen
  events.js       Ereignis-Bus + Log-Ringpuffer

js/render/
  pixi.js         Einziger PixiJS-Einstieg (CDN mit Vendor-Fallback)
  renderer.js     Szenengraph, Chunk-Texturen, Sprite-Pool, Kameratransform
  camera.js       Kamera pro Ebene (Zoom auf Mausposition, Clamping, Merken)
  transition.js   Uebergang zwischen Ebenen (Zoom + Blende)
  sprites.js      Manifest, Atlas, prozeduraler Pixel-Art-Generator, Rasterizer
  paint.js        Gemeinsame Chunk-Malhilfen (Farbpackung, Dithermuster)
  surfaceView.js  Aussehen der Oberflaeche je Zelltyp
  nestView.js     Aussehen der Nest-Ebene je Zelltyp (Tiefe, Kammerfarben)
  minimap.js      Uebersichtskarte (2D-Canvas, Zellaufloesung, Klick zum Springen)
  pip.js          Bild-in-Bild: DOM-Rahmen + Pixi-Inhalt derselben Texturen
  particles.js    Teilchen (Staub, Funken, Spritzer) – reine Anzeige

js/ui/
  hud.js          Obere Leiste, Schalter, Debug-Menue, Hilfe
  toolbar.js      Spieler-Werkzeuge (ebenenabhaengig)
  research.js     Forschungsmenue (Evolution im Zeitraffer, Genom-Editor)
  stats.js        Stammbaum und Statistik
  swatch.js       Farbfelder fuer Legende und Werkzeugleiste
  levelNav.js     Ebenen-Reiter + Brotkrumen
  legend.js       Datengetriebene, kontextabhaengige Legende
  panels.js       Kolonieliste
  inspector.js    Tooltip am Zeiger + Detailfenster
  log.js          Ereignis-Log mit Kategoriefiltern
  perf.js         Performance-Overlay (F3)
  alerts.js       Kampfalarme als Einblendungen ("Zum Kampf")
  settings.js     Einstellungen und Spielstaende (localStorage, Datei)
  audio.js        Ton – optional, ohne Dateien bleibt es still
```

Abweichungen von der Dateiliste des Lastenhefts:

* `predators.js` heisst `creatures.js`, weil nicht alle Arten Raeuber sind
  (Fliegen, Raupen und Asseln sind Beute bzw. Zersetzer).
* `fluids.js` gibt es nicht. Wasser ist ein Zelltyp, kein eigenes System:
  Fluten fuellen Zellen (`interventions.js`), Austrocknen laeuft in
  `updateInterventions`. Eine echte Stroemungssimulation waere fuer das,
  was das Spiel damit macht, unverhaeltnismaessig.
* `lineage.js` und `nutritionView.js` sind in `ui/stats.js` bzw.
  `ui/panels.js` aufgegangen – beide waren zu klein fuer ein eigenes Modul.

`js/sim/world.js` ist eine Ergaenzung zur Dateiliste des Lastenhefts: es
haelt die Teile zusammen und macht die Simulation ohne Browser testbar
(alle Messwerte in Abschnitt 9 stammen aus solchen Laeufen).

---

## 3. Ebenensystem

Eine Ebene (`Level`) = eigenes Grid + eigene Metadaten + eigener Spatial Hash
+ eigene Dirty-Chunk-Liste + gemerkte Kameraposition + eigener
Render-Container.

| | Oberflaeche | Nest-Ebene |
|---|---|---|
| Ansicht | Draufsicht | seitlicher Querschnitt |
| Groesse | 400 x 400 Zellen | 200 x 150 Zellen |
| Anzahl | genau eine | eine pro Kolonie (spaeter mehrere) |
| Zelltypen | `SURFACE_CELL` | `NEST_CELL` + Kammertyp in `meta` |

Aufbau einer Nest-Ebene von oben:

```
Zeile 0 .. 5    Himmelstreifen (Orientierung, fuer Einheiten undurchdringlich)
Zeile 6         Erdoberflaeche  <-- WORLD.NEST_SURFACE_ROW, hier liegen ALLE Portale
Zeile 7 ..      Erdreich, mit der Tiefe zunehmend hart
```

**Regel: alle Ebenen werden jeden Tick simuliert.** `World.step()` laeuft ueber
`levels.levels` und ruft fuer jede Ebene `fillSpatial()` und `ants.update()`.
Das Rendering beschraenkt sich auf die aktive Ebene. Unsichtbare Ebenen
sammeln geaenderte Chunks in `level.dirtyList`; beim Wechsel laedt
`Renderer.setActive()` alles auf einmal hoch (verdeckt vom Uebergang).
Eine "Optimierung", die nur sichtbare Ebenen simuliert, ist verboten – das
Performance-Overlay weist die Tickdauer je Ebene getrennt aus, damit das
ueberpruefbar bleibt.

Ebenen-IDs vergibt `LevelManager.add()`, Portal-IDs `PortalSystem.create()`.
Es gibt bewusst KEINE modulglobalen Zaehler: ein Neustart mit gleichem Seed
muss exakt dieselben IDs erzeugen.

### Chunks

Kantenlaenge `WORLD.CHUNK = 64` Zellen. Jeder Chunk ist eine eigene Textur
(Canvas, `CELL_PX = 4` Pixel je Zelle, `scaleMode: nearest`). Oberflaeche =
7 x 7 = 49 Chunks, Nest = 4 x 3 = 12 Chunks. `level.set()` markiert
automatisch den betroffenen Chunk. Pro Frame werden hoechstens
`RENDER.CHUNK_UPLOADS_PER_FRAME` Chunks neu gezeichnet.

---

## 4. Portale (Nesteingaenge)

Ein Portal ist ein **Paar** aus einer Oberflaechenzelle (Seite A) und einer
Zelle in Zeile `NEST_SURFACE_ROW` einer Nest-Ebene (Seite B). Es ist die
einzige Verbindung zwischen Ebenen; unterirdische Verbindungen zwischen
Nestern gibt es nicht.

```
Portal { id, colonyId,
         aLevelId, ax, ay,     // Oberflaeche
         bLevelId, bx, by,     // Nest
         closed, pluggedBy,    // Verschluss / Panzerameise als Pfropfen
         capacity, usedAB, usedBA, inTransit, totalPassages }
```

Ablauf eines Uebertritts:

1. Einheit erreicht die Portalzelle und ist im Zustand `RETURN`.
2. `PortalSystem.canEnter()` prueft Verschluss und Kapazitaet dieses Ticks
   (`PORTALS.CAPACITY_PER_TICK` je Richtung – die Engstelle, die den
   Eingang im Krieg zum Schlachtpunkt macht).
3. Zustand wird `TRANSIT`, `transit = PORTALS.TRANSIT_TICKS`. Waehrend dieser
   Zeit steckt die Einheit im Schacht: sie wird nicht gezeichnet und nicht in
   den Spatial Hash einsortiert.
4. Bei 0 wechselt `level`, die Position wird auf die Gegenseite gesetzt,
   `px/py` werden mitgezogen (sonst interpoliert der Renderer eine Linie
   quer ueber die Karte), und `portalCooldown` verhindert sofortiges
   Zurueckspringen.

Fremde Einheiten kommen nur durch Portale in ein fremdes Nest; verschlossene
oder blockierte Portale lassen ausschliesslich eigene Einheiten durch.

---

## 5. Datenlayout (Typed Arrays)

### Level

| Feld | Typ | Bedeutung |
|---|---|---|
| `cells` | `Uint8Array(w*h)` | Zelltyp |
| `meta` | `Uint8Array(w*h)` | Kammertyp, spaeter Besitzer/Bauzustand |
| `variant` | `Uint8Array(w*h)` | visuelle Variante (Dithermuster-Index) |
| `chunkDirty` | `Uint8Array(chunks)` | 1 = muss neu gezeichnet werden |
| `dirtyList` | `Int32Array(chunks)` | Stapel der dirty Chunks |
| `solidTable` | `Uint8Array(256)` | Zelltyp -> unpassierbar (O(1)-Abfrage) |

### Ameisen (Structure of Arrays, `LIMITS.MAX_ANTS = 6000`)

| Gruppe | Felder | Typ |
|---|---|---|
| Identitaet | `alive`, `level`, `colony`, `caste`, `state` | `Uint8Array` |
| Bewegung | `x`, `y`, `px`, `py`, `dir`, `speed` | `Float32Array` |
| Leben | `hp`, `hpMax`, `hunger` / `age` | `Float32Array` / `Uint32Array` |
| Tragelast | `carryType`, `carryNutrient` / `carryAmount` | `Uint8Array` / `Float32Array` |
| Ziel | `targetX`, `targetY` / `timer` | `Int16Array` / `Uint16Array` |
| Phaenotyp | `phenoSize`, `phenoSpeed`, `phenoLife` | `Float32Array` |
| Portale | `transit`, `portalCooldown` / `portalRef` | `Uint8Array` / `Int16Array` |
| Darstellung | `anim` | `Float32Array` |

`px`/`py` sind die Position des Vorticks und dienen ausschliesslich der
Renderinterpolation. Freie Slots liegen auf einer Free-List (`free`,
`freeCount`), `high` ist der hoechste je belegte Slot.

Pro Tick werden die Indizes einmal nach Ebene gebuckelt
(`Ants.rebuildBuckets`, ein Durchlauf, keine Allokation). Dabei entstehen
nebenbei die Kolonie-Zaehler (`population`, `populationByLevel`,
`knownCastes`) – Letzteres speist die Legende.

### Spatial Hash

Pro Ebene, Bucketkante 8 Zellen, `head`/`next` als `Int32Array`. Wird jeden
Tick geleert und neu gefuellt (O(n)).

---

## 6. Spielschleife

* Fester Tick: `SIM.TICK_RATE = 30` (33.33 ms), entkoppelt vom Rendering.
* Geschwindigkeiten `SIM.SPEEDS = [0, 1, 2, 5, 10]`; bei 10x also 300 Ticks/s.
* Pro Frame werden hoechstens `SIM.MAX_TICKS_PER_FRAME = 24` Ticks nachgeholt;
  danach wird der Rueckstand verworfen (keine Todesspirale).
* Gezeichnet wird mit `alpha = accumulator / TICK_MS` zwischen `px/py` und
  `x/y`. Bei Pause ist `alpha = 1`.
* Kamera, Uebergang und UI laufen in Echtzeit, unabhaengig vom Tempo.

---

## 7. Sprite-System und Manifestformat

`assets/manifest.json`:

```json
{
  "version": 1,
  "basePath": "assets/sprites/",
  "cell": 20,
  "sprites": {
    "ant_worker": {
      "file": null,
      "frameWidth": 20, "frameHeight": 20, "frames": 6,
      "anchor": [0.5, 0.5], "scale": 1.0,
      "animations": { "walk": { "from": 0, "to": 5, "fps": 14, "loop": true } }
    }
  }
}
```

* `file: null` heisst: prozedural erzeugen. Dann wird **keine** Datei
  angefragt – die Konsole bleibt sauber, und das Spiel laeuft ohne jede
  Asset-Datei vollstaendig.
* Eigene Grafik: Dateinamen eintragen. Frames liegen zeilenweise
  (links nach rechts, dann naechste Zeile), Zeilenlaenge =
  `floor(Bildbreite / frameWidth)`. Die Frames werden in die Atlaszelle
  skaliert.
* Schluesselkonvention: `ant_<kastenschluessel>` fuer Kasten (die Schluessel
  stehen in `castes.js`), ausserdem `marker_entrance` und `marker_select`.
  Fehlende Eintraege ergaenzt `defaultManifest()` automatisch – neue Kasten
  bekommen also ohne Handarbeit ein Sprite.

**Atlas.** Alle Eintraege landen in EINER Textur (Zeile = Sprite,
Spalte = Frame, 1 Pixel Rand gegen Texture-Bleeding). Damit gehen alle
Ameisen der Welt in einem Batch an die GPU.

**Prozedurale Erzeugung.** `sprites.js` enthaelt einen kleinen Rasterizer
(`Cell`: Ellipse, Linie, Umrisspass) und zeichnet daraus eine Ameise von
oben: Hinterleib, Taille, Brust, Kopf, Mandibeln, Fuehler und sechs Beine im
Dreifuss-Gang. Der Koerper wird auf 70 % der Zellbreite normiert, die Beine
reichen fast an den Zellrand – dadurch sieht die Silhouette wie ein Insekt
und nicht wie ein Strich aus. Zeichenparameter je Kaste stehen in
`castes.js` unter `art` (Segmentradien, Mandibellaenge, Beinlaenge, Fluegel,
Panzerplatten, Streifen).

**Groesse in der Welt.** Kasten sind in `config.js` mit `size` relativ zur
Arbeiterin definiert. Der Renderer stellt das **unterlinear** dar:
`scale = ANT_CELLS * CELL_SIZE / (SPRITE_PX * 0.7) * size^SIZE_EXPONENT` mit
`SIZE_EXPONENT = 0.65`. Sonst fuellt eine Koenigin (size 4.0) den halben
Tunnel.

**Tinting.** Die Grafiken sind hell/grau, die Koloniefarbe kommt als
`sprite.tint`. Umrisse bleiben dunkel und damit farbstabil.

---

## 8. Terrain-Darstellung

Terrain wird nicht mit Grafikprimitiven gezeichnet, sondern als Pixelpuffer:
pro Zelle ein Block von 4 x 4 Pixeln in der Chunk-Textur. Farbvariation kommt
aus zwei vorberechneten 4x4-Dithermustern (`PATTERN_A` grob, `PATTERN_B`
fein), ausgewaehlt ueber `level.variant` – kein Rauschen zur Laufzeit, keine
Allokation. Die Zelltyp-Tabellen (`SURFACE_CELL_DEFS`, `NEST_CELL_DEFS`,
`CHAMBER_DEFS`) liefern Basis- und Streufarbe, Name, Beschreibung,
Passierbarkeit und Legendenkategorie – Simulation, Renderer, Legende,
Tooltip und Inspektor lesen dieselbe Quelle.

Die Legende erzeugt ihre Farbfelder mit **demselben** Maler: sie baut ein
4x4-Zellen-Pseudolevel und ruft `paintSurfaceChunk` bzw. `paintNestChunk`.
Was in der Legende steht, sieht also garantiert aus wie im Spiel.

---

## 8a. Graben und Nestbau (vorgezogen aus Phase 3)

Damit man Ameisen beim Tunnelbau zusehen kann, ist der Bauteil von Phase 3
bereits enthalten – bewusst in der einfachsten Form, die emergent wirkt:

1. Jede Kolonie fuehrt eine **Warteschlange aus Grabauftraegen** (Zellindizes
   ihrer Nest-Ebene) in `colony.digQueue`.
2. **Immer nur der erste offene Auftrag ist die aktive Baustelle**
   (`colony.digActive`). Alle grabenden Ameisen laufen dorthin, es genuegt
   also ein einziges Distanzfeld je Nest-Ebene. Das Ergebnis sieht aus wie
   ein Trupp an der Tunnelbrust.
3. Jede Ameise in `DIG.REACH` Zellen Abstand steuert `DIG.RATE_PER_ANT`
   Grabpunkte bei. Sind die Kosten des Zelltyps erreicht
   (`DIG.COST`, Erde 150 … Wurzel 420), wird die Zelle zu Tunnel bzw.
   Kammerboden.
4. Die Ameise, die den letzten Punkt beigesteuert hat, nimmt den **Aushub**
   mit (`carryType = CARRY.SOIL`), traegt ihn durch das Portal und laedt ihn
   an der Oberflaeche ab – der Erdhuegel waechst sichtbar mit dem Nest.

**Wann geplant wird.** Alle `DIG.PLAN_INTERVAL` Ticks, versetzt nach
Kolonie-ID (sonst scannen acht Kolonien im selben Tick), und nur wenn
`level.airCount < colony.total * DIG.CELLS_PER_ANT`. Geplant wird eines von
drei Projekten: Schacht nach unten, waagerechter Gang oder Kammer. Der
Kammertyp richtet sich danach, was der Kolonie noch fehlt.

**Von Hand markierte Auftraege** (Werkzeug "Bauauftrag") liegen oft mitten im
Erdreich. `Construction.ensureReachable()` legt dann zuerst einen L-foermigen
Zugang von der naechstgelegenen Luftzelle aus in die Warteschlange; fuehrt
kein Weg daran vorbei (Fels), gibt es einen Log-Eintrag statt eines still
haengenden Auftrags.

### Distanzfelder (`flowfields.js`)

Pro Nest-Ebene gibt es zwei Felder als `Uint16Array`:

| Feld | Ziel | wird gebraucht fuer |
|---|---|---|
| `entrance` | alle Portalzellen der Ebene | Heimweg, Ausrueckweg |
| `dig` | Luftnachbarn der aktiven Baustelle | Weg zur Tunnelbrust |

Berechnet per Breitensuche ueber die Luftzellen (4 Nachbarn), rund 0.25 ms
fuer 200x150 Zellen. Eine Ameise liest nur ihre acht Nachbarzellen und laeuft
auf die mit dem kleinsten Wert (Diagonalen nur, wenn beide Achsen frei sind).
Neu gerechnet wird ein Feld nur bei geaenderter `level.airVersion` oder neuem
Ziel, und hoechstens `DIG.FIELD_BUDGET_PER_TICK` Felder pro Tick ueber ALLE
Ebenen zusammen.

---

## 8b. Sandbox-Werkzeuge und Kartenvorlagen

**Werkzeugleiste (`ui/toolbar.js`)** – links, ebenenabhaengig. Die Knoepfe
entstehen aus den Zelltyp-Tabellen und tragen das echte Terrainbild als
Symbol (`ui/swatch.js` benutzt denselben Maler wie das Spiel).

| Gruppe | Ebene | Wirkung |
|---|---|---|
| Allgemein | beide | Zeiger, Pheromon loeschen, Einheiten entfernen |
| Terrain | Oberflaeche | Gras, Erde, Sand, Stein, Wasser, Pflanze, Bluete, Kiesel, Erdhuegel, Kieselwall, Harzklecks, Spinnennetz, Trichter |
| Graben und Fuellen | Nest | Tunnel, Erde, Harte Erde, Stein, Kiesel, Verstaerkt, Pfeiler, Harz, Pfropfen, Fallgrube, Wasser, Geroell, Wurzel, Kammer |
| Nahrung | Oberflaeche | Zuckerwuerfel, Fleisch, Samenhaufen, Blattlaeuse, Fallobst, Aas, Samen |
| Mutagene | Oberflaeche | Leuchtpilz, Giftbeere |
| Bauen | Nest | Bauauftrag (die Kolonie graebt selbst), Kammertyp waehlbar |
| Einheiten | beide | Ameisen der gewaehlten Kolonie und Kaste, neue Kolonie gruenden |
| Brut | Nest | Eier, Larven oder Puppen absetzen (Stadium und Zielkaste waehlbar) |
| Kreaturen | Oberflaeche | alle elf Arten |
| Eingriffe | je nach Eingriff | alle 24 goettlichen Eingriffe (Abschnitt 8j) |

Unter den Gruppen stehen die Pinselgroesse, die Regler **Kraft** und
**Radius** fuer die Eingriffe, der Umschalter Sandkasten/Herausforderung
mit Energieanzeige, die Koloniefarben und die Kastenwahl.

Pinselgroesse 1–25 (`[`, `]` oder Shift+Mausrad), Vorschaukreis am Zeiger.
Mit aktivem Werkzeug malt die linke Maustaste (ziehen moeglich), geschoben
wird mit der mittleren Taste. Werkzeuge veraendern die Welt nie direkt,
sondern rufen `World.paint()`, `World.markDigOrders()`, `World.spawnAntsAt()`
bzw. `World.foundColony()`, `World.spawnBroodAt()`, `World.removeUnitsAt()`
oder `World.applyIntervention()` auf – Weltzustand wird ausschliesslich in
der Simulationsschicht geaendert. Portalzellen und die Oberflaechenzeile der
Nest-Ebenen sind gegen Uebermalen geschuetzt.

**Kartenvorlagen (`MAP_PRESETS` in config.js).** Jede Vorlage ueberschreibt
Werte aus `GEN` und bringt einen Standard-Seed mit:

| Schluessel | Karte |
|---|---|
| `wiese` | ausgewogen |
| `steppe` | trocken, sandig, kaum Wasser |
| `aue` | feucht, viele Pfuetzen und Pflanzen |
| `geroell` | steinig, hartes Erdreich, muehsames Graben |
| `garten` | viele Blueten und Kiesel |
| `zufall` | Standardparameter, frisch gewuerfelter Seed |

Auswahl und Seed stehen in der Kopfzeile; "Neue Welt" laedt die Seite mit
`?map=...&seed=...` neu. Das ist Absicht: ein vollstaendiger Neustart ist
robuster (und schneller geschrieben) als das Abraeumen aller Texturen,
Sprite-Pools und UI-Bindungen zur Laufzeit.

---

## 8c. Pheromone und Futtersuche (Phase 2)

Auf der Oberflaeche traegt jede Kolonie drei Felder als `Uint8Array` ueber
dem Grid: **Heimweg**, **Nahrung**, **Alarm**. Dazu kommt ein Feld, das je
Zelle den dominanten Naehrstoff der dortigen Nahrungsspur merkt.

**Warum die Gradienten stimmen.** Jede Ameise fuehrt einen Zaehler `trip`,
der an zwei Stellen auf 0 gesetzt wird: beim Verlassen des Nests und beim
Aufnehmen von Futter. Die Ablagemenge faellt mit diesem Zaehler ab.
Dadurch ist die Heimweg-Spur nahe am Nest am staerksten und die
Nahrungsspur nahe an der Fundstelle – ausrueckende Ameisen laufen den
Nahrungs-Gradienten hinauf, heimkehrende den Heimweg-Gradienten. Niemand
kennt einen Weg; die Strassen entstehen aus diesen zwei Regeln.

**Bedarfsgewichtung.** Beim Abtasten der Nahrungsspur wird der Wert mit
`colony.needWeight[naehrstoff]` multipliziert. Fehlt Protein, riechen
Proteinspuren staerker. Das ist die Umsetzung von "Ameisen gewichten Spuren
nach dem aktuellen Bedarf der Kolonie".

**Verdunstung ohne Vollscan.** Ein Durchlauf ueber 160 000 Zellen je Feld
und Kolonie waere zu teuer. Jedes Feld fuehrt deshalb eine Liste seiner
Zellen mit Wert > 0; verdunstet wird nur ueber diese Liste, die dabei
verdichtet wird. Eine Zelle kommt genau dann hinein, wenn sie von 0 auf
> 0 steigt – Doppeleintraege sind damit ausgeschlossen, ganz ohne
zusaetzliches Merkerarray. Diffusion wird nicht als eigener Durchlauf
gerechnet: die Ablage verteilt sich ueber einen kleinen Kern auf die vier
Nachbarzellen.

Gemessen: rund 0.14 ms pro Tick bei acht Kolonien und 5000 Ameisen.

---

## 8d. Nahrung, Naehrstoffe und Lebenszyklus (Phase 3)

**Nahrungsquellen** sind Oberflaechenzellen mit einem Nahrungstyp; der
Restbestand steht in `level.meta` derselben Zelle. Damit braucht es keine
zweite Datenstruktur, und die Helligkeit beim Zeichnen faellt automatisch
mit dem Bestand. Ein Register je Ebene haelt die Indizes aller Quellen,
damit Nachwachsen und Verderben nicht ueber das ganze Grid laufen.

| Quelle | Zucker / Protein / Fett | waechst nach |
|---|---|---|
| Bluete (Nektar) | 95 / 3 / 2 | ja |
| Blattlaeuse (Honigtau) | 90 / 8 / 2 | ja, schnell |
| Fallobst | 70 / 5 / 25 | ja, verdirbt |
| Samen | 15 / 25 / 60 | ja |
| Aas | 10 / 70 / 20 | nein, verdirbt |
| Zuckerwuerfel / Fleisch / Samenhaufen (Spieler) | 100 / 85 / 70 | nein |

**Regionale Verteilung.** Ein grobes Rauschfeld teilt die Karte in zucker-,
protein- und samenreiche Gegenden. Toechterkolonien landen in
unterschiedlichen Gegenden – das ist die Grundlage dafuer, dass sich Linien
auseinanderentwickeln.

**Kreislauf.** Ameise findet Quelle -> nimmt `FOOD.PICKUP` Einheiten ->
markiert die Fundstelle -> traegt die Fuhre durch das Portal -> laeuft ueber
das Distanzfeld `store` in die Vorratskammer -> `storeFood()` bucht sie
anteilig nach Profil auf die drei Naehrstoffe.

**Lebenszyklus.** Die Koenigin legt Eier (Intervall aus Gen `eierrate` und
Proteinbilanz). Ei -> Larve -> Puppe -> Ameise. Larven muessen von Ammen mit
Protein gefuettert werden; ohne Futter kommen sie nicht weiter und sterben.
Welche Kaste aus einer Larve wird, entscheidet `chooseCaste()` aus Genom,
Proteinlage und Bedrohung. Erwachsene verbrauchen Zucker und sterben an
Alter oder Hunger; Tote werden an der Oberflaeche zu Aas.

**Deckungsgrad statt Hungersnot.** `colony.supply` ist der Anteil des
gedeckten Bedarfs (0..1); der Hunger einer Ameise steigt anteilig zur
Luecke. Frueher galt jede Unterdeckung als Hungersnot und liess das ganze
Volk gleichzeitig sterben – jetzt schrumpft ein zu grosses Volk auf eine
tragfaehige Groesse.

**Phaenotyp (Schicht 1).** Beim Schluepfen wirken `colony.pheno.size`,
`.speed` und `.life` aus der Ernaehrungslage: Proteinueberschuss macht
groessere und staerkere Ameisen, Zuckerueberschuss schnellere mit kuerzerer
Lebensdauer, Fettueberschuss langlebigere. Ein Ungleichgewicht ist
schlechter als eine knappe, aber ausgewogene Ernaehrung (Strafterm ueber
die Log-Verhaeltnisse der Bilanzen).

---

## 8e. Kreaturen (Phase 7)

Eigene SoA-Tabelle, gleiche Bauweise wie die Ameisen.

Elf Arten, alle spawnbar, alle mit eigener kleiner Evolution:

| Art | Rolle | Rhythmus | Besonderheit |
|---|---|---|---|
| Fliege | Beute | tagaktiv | harmlos, vermehrt sich stark, frisst an Bluete, Obst und Aas |
| Radnetzspinne | Lauerjaeger | – | baut Netze zwischen Pflanzen und Steinen; Ameisen bleiben haengen |
| Wolfsspinne | aktiver Jaeger | – | folgt Beute, geht durch Nesteingaenge |
| Ameisenloewe | Lauerjaeger | – | graebt Trichter in Sand, die Ameisen Schaden zufuegen |
| Laufkaefer | Jaeger und Graeber | nachtaktiv | graebt eigene Zugaenge ins Nest, frisst auch Blattlaeuse |
| Raupe | Beute und Weidegaengerin | – | frisst Pflanzen kahl (einzige Art mit `mows`), zaeh und wehrlos |
| Marienkaefer | Nahrungskonkurrent | tagaktiv | frisst Blattlaeuse weg – direkt gegen die Zuckerversorgung der Ameisen |
| Assel | Zersetzerin | nachtaktiv | raeumt Aas ab, wandert auch ins Nest |
| Ohrwurm | Zangenjaeger | nachtaktiv | dringt in Nester ein, frisst nebenbei Obst und Aas |
| Wespe | Luftjaeger | tagaktiv | schnell und toedlich im Feld, geht nie unter die Erde |
| Gottesanbeterin | Apexraeuberin | – | lauert ohne Bauwerk (`ambush`) und schlaegt aus dem Stand zu |

Die Artentabelle steht vollstaendig in `CREATURES.SPECIES`; eine neue Art
braucht nur einen Eintrag (inklusive `art`-Bauplan fuer das prozedurale
Sprite) und taucht ueberall auf: Werkzeugleiste, Legende, Inspektor,
Statistik.

**Nahrung je Art** steht als `eats`-Liste von Zellschluesseln im Eintrag.
`diet: 'plants'` ohne Angabe heisst "alles Essbare"; Jaeger bekommen nur
das, was ausdruecklich dasteht. `grazes` heisst, dass die Zelle dabei
wirklich abgebaut wird – das macht den Marienkaefer zum spuerbaren
Konkurrenten der Ameisen.

**Pflanzen wachsen nach** (`FoodSystem.regrowVegetation`, abhaengig vom
Licht). Ohne das waere die Vegetation eine endliche Ressource: Raupen
fraessen die Karte kahl und stuerben danach aus, und Radnetzspinnen faenden
keine Ankerpunkte mehr.

**Die Bremse ist der Stoffwechsel.** Gejagt wird nur unterhalb von
`CREATURES.HUNT_HUNGER` der Energiekapazitaet. Ein satter Raeuber laesst
Ameisen in Ruhe; ein Riss deckt ungefaehr den Verbrauch bis zum naechsten.
Dadurch toetet ein Raeuber nur so oft, wie er zum Leben braucht. Das war
nicht die erste Fassung: zuerst biss jede Kreatur jeden Tick und einige
Spinnen loeschten ein ganzes Volk in Sekunden aus.

**Raeuber suchen ihre Beute NICHT.** Zwei Anlaeufe, beide verworfen:
Nesteingaenge ansteuern liess alle Jaeger am Tor campen; Ameisenstrassen
ansteuern sammelte sie auf der Hauptstrasse. In beiden Faellen war das Volk
binnen Minuten ausgeloescht und danach verhungerten die Jaeger mit. Auch
als schwache Tendenz (0.22 rad Kurskorrektur alle 32 Ticks) blieb es dabei.
Der Grund ist strukturell: eine Ameisenstrasse ist ein DAUERHAFTER
Beutestrom – wer sie findet, muss nie wieder suchen. Jetzt streifen sie
umher und begegnen Beute dort, wo viel Verkehr ist, einfach weil dort mehr
Ameisen sind. Das verteilt sie von selbst, ohne Rueckkopplung.

**Gegenwehr.** Ab `SWARM_COURAGE` Ameisen im Umkreis nimmt eine Kreatur
Schaden; ab der doppelten Zahl flieht sie. Erlegte Raeuber sind eine grosse
Proteinquelle – Jagd ist fuer die Kolonie ein Geschaeft.

**Eigene Evolution.** Jede Kreatur hat drei Gene (Groesse, Tempo,
Aggression), die bei der Fortpflanzung mutieren. Groessere Tiere werden
auch groesser gezeichnet.

---

## 8f. Genom und Evolution (Phase 8)

Das Genom gehoert der KOLONIE und aendert sich ausschliesslich bei der
Gruendung einer neuen Kolonie. 20 Gene in vier Gruppen (Stoffwechsel,
Koerper, Verhalten, Kaste), Werte 0..1.

**Hochzeitsflug.** Ein grosses, gut ernaehrtes Volk schickt Gefluegelte los.
Die Ernaehrungslage VOR dem Flug wird eingefroren (`flightSnapshot`) – sie
bestimmt die Mutation. Die meisten Gefluegelten sterben
(`EVO.FLIGHT_SURVIVAL`); wer lange genug ueberlebt und weit genug weg ist,
gruendet eine Tochterkolonie.

**Mutation.** Genau die Formeln aus dem Lastenheft, implementiert in
`genome.js` (`sigmaFor`, `muFor`, `mutateGenome`) – siehe Abschnitt 10.
Geprueft wird das in `test/sim-bench.mjs`: Proteinueberschuss macht
Koerpergene messbar instabiler (0.124 gegen 0.073), Zuckerueberschuss die
Stoffwechselgene (0.115 gegen 0.073), Stress vervielfacht die Streuung der
Verhaltensgene.

**Muetterlicher Effekt.** Toechter starten mit groesseren Reserven und
erben die Haelfte des Phaenotyps der Mutter.

**Evolutionaere Kasten.** `CASTE_UNLOCK` legt je Kaste Gen, Schwelle und
Voraussetzungen fest. Liegt das Gen darueber und ist Protein da, kann die
Kolonie die Kaste aufziehen. Im 50-Minuten-Lauf entstehen ohne jeden
Eingriff regelmaessig sechs bis sieben der acht evolutionaeren Kasten.

---

## 8g. Forschungsmenue (Sandbox)

Bewusst getrennt von den Werkzeugen: **Werkzeuge veraendern die Welt, das
Forschungsmenue veraendert die Regeln.** Alle Regler wirken auf Parameter,
die die Simulation ohnehin benutzt – niemand umgeht damit die Mechanik.

| Regler | wirkt auf |
|---|---|
| Mutationsstaerke x0.5 … x10 | `EVO.MUTATION_SCALE` in `sigmaFor` und der Sprungwahrscheinlichkeit |
| Hochzeitsfluege x0.5 … x20 | `EVO.FLIGHT_SCALE` (verkuerzt das Flugintervall) |
| Ernaehrungseinfluss | `biasStaerke` in `muFor`: Realistisch = 0, Standard = 0.2, Stark = 0.6 |
| Nahrungsnachwuchs 0 … x5 | `FOOD.REGROW_SCALE` |
| Raeuberdichte 0 … x4 | `CREATURES.DENSITY_SCALE` (Populationsobergrenze je Art) |
| Zeitraffer +1/+5/+15 min | rechnet Ticks ohne Bild, verteilt auf Frames mit 24 ms Budget |
| Hochzeitsflug jetzt | loest sofort einen Schwarmflug aus |
| Genom-Editor | 20 Schieberegler direkt auf `colony.genome` |
| Kaste freischalten | hebt die noetigen Gene knapp ueber die Schwelle |
| Mutationsprognose | `mutationForecast()`: Streuung je Gengruppe in Prozent |

---

## 8h. Kampf, Bedrohung und Raubzuege (Phase 5)

`sim/combat.js`. Es gibt **keinen** Kampfzustand als Skript – Kampf ist ein
Nebeneffekt von Naehe.

* **Nahkampf.** Jede Ameise prueft nur alle `COMBAT.CHECK_EVERY` Ticks
  (gestaffelt ueber `(i + tick) % n`, damit die Last gleich verteilt ist),
  ob eine feindliche Ameise in `COMBAT.SIGHT` Zellen steht. Der Schaden
  haengt an Kiefergen, Panzerung, Groesse und Hunger.
* **Enge Gaenge.** In einem Tunnel von einer Zelle Breite wird der Schaden
  geteilt: eine Uebermacht kann sich nicht entfalten. Das macht schmale
  Zugaenge zu einer echten Verteidigungsanlage.
* **Bedrohungsstufen 0–3** je Kolonie (`updateThreat`). Sie ergeben sich
  aus Feinden im Nest, Feinden am Eingang und Verlusten. `applyThreat`
  holt Sammlerinnen heim, laesst Brut evakuieren und die Koenigin fliehen.
* **Raubzug.** `considerRaid` waehlt ein Nachbarvolk, `startRaid` schickt
  einen Trupp. Ziele mit weniger als 40 Tieren werden uebergangen – ohne
  diese Sperre loeschten Raubzuege jede junge Kolonie sofort aus.
* Raeuberinnen behalten ihren Zustand RAID/LOOT, waehrend sie kaempfen
  (`onMission`). Vorher blieben sie im Torkampf haengen und **keine
  einzige** kam je ins Nest; jetzt schlagen sie im Vorbeigehen zu.

Fremde Ameisen duerfen ein Nest nur als `raider` betreten
(`PortalSystem.canEnter`). Ohne diese Sperre nahmen Sammlerinnen im
Nachbarnest Ammenposten an und fehlten dem eigenen Volk – ein Volk
verhungerte an der eigenen Brut.

---

## 8i. Stabilitaet und Einstuerze (Phase 6)

`sim/stability.js`. Modell: **Deckenspanne**. Eine solide Zelle mit Luft
darunter ist Decke. Ist eine zusammenhaengende Decke laenger als
`STABILITY.MAX_SPAN[Zelltyp]`, bricht sie ein: die Zelle wird Tunnel, die
Zelle darunter Geroell, und Einheiten darin nehmen Schaden.

Geprueft wird nicht die ganze Ebene, sondern eine Warteschlange lokaler
Anfragen (`request`) – ausgeloest vom Graben, von Eingriffen und von
Einstuerzen selbst (Kettenreaktion). Deshalb gehoert diese Warteschlange
auch in den Speicherstand.

Pfeiler (`NEST_CELL.PILLAR`) und verstaerkte Waende (`REINFORCED`)
verlaengern die zulaessige Spanne deutlich; `pillarSpots` schlaegt der
Kolonie Stellen vor.

---

## 8j. Goettliche Eingriffe (Phase 9)

`sim/interventions.js` ist eine **Tabelle**, kein Code-Haufen: jeder
Eingriff ist ein Eintrag mit `key`, `name`, `cost`, `where`, `icon`,
`desc`, optional `fx`/`fxCount` und einer `apply(world, level, x, y, o)`.
Die Werkzeugleiste baut ihre Knoepfe daraus – ein neuer Eingriff braucht
nur einen Tabelleneintrag, keine UI-Aenderung.

24 Eingriffe, nach Wirkort:

| `where` | Eingriffe |
|---|---|
| `surface` | Flut, Meteor, Duerre, Regen, Zucker-/Fleisch-/Samenregen, Raeuberschwarm, Feuer, Duftspur |
| `nest` | Sofortbau, Kammer ausheben, Sprengung |
| `both` | Erdbeben, Blitz |
| `colony` | Verstaerkung, Seuche, Segen, Raserei, Koenigin toeten, Kolonie ausloeschen, Hochzeitsflug, Vorrat fuellen, Brutschub |

Eingriffe wirken **ebenenuebergreifend**, wo das physikalisch Sinn ergibt:
ein Erdbeben an der Oberflaeche erschuettert jedes Nest, dessen Eingang im
Radius liegt; eine Flut laeuft ueber die Eingaenge in die Nester hinein
(`floodNest` mit Breitensuche nach unten und zur Seite).

Laufende Wirkungen (Wetter, Seuche, Raserei, Austrocknen, Abklingen des
Wackelns) stehen in `updateInterventions(world)`, das jeden Tick laeuft.

Zwei Modi (`world.godMode`): **Sandkasten** (unbegrenzt) und
**Herausforderung** (jeder Eingriff kostet goettliche Energie, die sich
langsam auflaedt). Umschaltbar in der Werkzeugleiste.

---

## 8k. Tag und Nacht, Teilchen, Ton (Phase 10)

**Tag und Nacht** (`sim/daynight.js`) gilt nur fuer die Oberflaeche – unter
der Erde ist es immer dunkel. `timeOfDay(tick)` liefert 0..1 (0 =
Mitternacht), `lightAt(t)` die Helligkeit, `phaseAt(t)` den Abschnitt.

Der Zyklus ist **kein Farbfilter**, er greift in die Simulation ein:

* Tagaktive Arten (Fliege, Wespe, Marienkaefer) werden nachts traege,
  nachtaktive (Laufkaefer, Ohrwurm, Assel) tagsueber – `activityFor(sp, licht)`
  skaliert Tempo und Jagdbereitschaft.
* Ameisen sammeln nachts langsamer (`DAYNIGHT.ANT_NIGHT_SPEED`).
* Pflanzen wachsen mit dem Licht nach.

**Wichtig:** Der Grundumsatz der Ameisen sinkt nachts mit demselben Faktor
(`demandPerTick`). Ohne das war die Nacht nichts als eine dauerhafte
Ertragsminderung, und ein Volk, das sonst 25 Minuten stabil lief, verhungerte
im Test nach elf Minuten. So bleibt die Tragfaehigkeit ueber den Tag
gemittelt gleich; was sich aendert, ist der Rhythmus.

**Teilchen** (`render/particles.js`): ein Ringpuffer fester Groesse und ein
einziges `Graphics`-Objekt, das jeden Frame neu gefuellt wird. Teilchen sind
reine Anzeige und benutzen absichtlich `Math.random()`.

Die Simulation meldet Effekte ueber `world.emitFx(kind, levelId, x, y, n)`
in einen kleinen Puffer, der zu Beginn jedes Ticks geleert und vom Renderer
abgeholt wird. `sim/fx.js` haelt nur die Kennungen – so braucht die
Simulation kein Render-Modul und laeuft weiter headless.

**Ton** (`ui/audio.js`) ist vollstaendig optional. Das Spiel bringt keine
Tondateien mit; wer welche hat, legt sie unter `assets/sfx/` ab. Fehlt eine
Datei, bleibt es an dieser Stelle still – ohne Fehlermeldung, denn geladen
wird nur bei eingeschaltetem Ton und ein Fehlschlag wird als "gibt es
nicht" vermerkt.

---

## 8l. Speichern und Laden (Phase 10)

`sim/save.js`. Format: **ein JSON-Objekt mit Versionsnummer**
(`saveVersion`, derzeit 1). Die grossen Typed Arrays stehen nicht als
Zahlenlisten darin:

| Datenart | Kodierung |
|---|---|
| Gitter (`cells`, `meta`, `variant`) | Lauflaengenkodierung **oder** roh – je nachdem, was kuerzer ist; ein Praefix (`r`/`b`) sagt es an. Terrain schrumpft per RLE auf wenige Prozent, die Variantenkarte ist Rauschen und wuerde sich dabei verdoppeln. |
| Einheiten (Ameisen, Brut, Kreaturen) | Spaltenweise Base64 des rohen Speichers, plus `high`, `count` und die **Free-List** |
| Pheromone | nur die aktiven Zellen als (Index, Wert) |
| Nahrungsregister | die Liste selbst, nicht aus dem Gitter abgeleitet |
| Kolonien | alle eigenen Felder generisch, nur echte Jede-Tick-Zaehler ausgenommen |

Groesse: rund 380 KB fuer acht Voelker und neun Ebenen.

**Nicht gespeichert** werden Distanzfelder und Spatial Hashes: beides ist
abgeleitet und wird beim Laden neu gerechnet. Das spart den groessten Teil
der Dateigroesse.

Der Anspruch ist hoeher als "sieht gleich aus": ein geladener Stand laeuft
**bitgenau** weiter. Dafuer noetig – und jeweils erst durch einen
Abweichungstest gefunden:

1. Der Zufallszustand (`RNG.getState/setState`; `sfc32` haelt seinen
   Zustand deshalb in einem `Int32Array` statt in Closure-Variablen).
2. Die **Free-List** der Pools. Ihre Reihenfolge entscheidet, welchen Platz
   die naechste Einheit bekommt. Aus den Luecken rekonstruiert wich der
   Verlauf nach wenigen hundert Ticks ab.
3. Das **Nahrungsregister**. Ein Neuaufbau aus dem Gitter liefert eine
   andere Liste als die laufende.
4. Die **Einsturz-Warteschlange** (`stability.queue`), die ueber mehrere
   Ticks abgearbeitet wird.
5. `colony.balance` und `colony.needWeight`. Sie sehen abgeleitet aus,
   werden aber nur alle `NUTRITION.UPDATE_INTERVAL` Ticks neu gerechnet –
   fehlen sie, sammeln die Ameisen nach den falschen Gewichten.
6. Die Distanzfelder muessen beim Laden **sofort und vollstaendig** gerechnet
   werden, nicht ueber das uebliche Budget von drei je Tick.

Die UI laedt einen Stand ueber einen Seitenneustart (`applySaveData` legt
ihn ab und setzt eine Marke). Das ist ehrlicher, als hundert Verweise auf
die alte Weltinstanz nachzuziehen und dabei einen zu vergessen.

---

## 8m. Einstellungen (Phase 10)

`ui/settings.js`, Werte im `localStorage` unter `formicarium.settings`.
Jeder Zugriff ist gekapselt, damit ein blockierter Speicher (privates
Fenster) das Spiel nicht anhaelt.

Die Einstellungen betreffen **Darstellung und Komfort, keine
Simulationswerte** – eine Einstellung, die das Ergebnis verschiebt, waere
eine versteckte Schwierigkeitsstufe. Die eine Ausnahme steht so im Menue:
"Tag und Nacht" schaltet einen Simulationsteil ab, weil manche Versuche
ohne Tagesrhythmus besser vergleichbar sind.

---

## 8n. Eigenschaften: Charakter von Koenigin und Ameise (Phase 11)

`sim/traits.js`, Daten in `TRAITS` (61 Eintraege: 41 fuer Ameisen, 20 fuer
Koeniginnen).

**Abgrenzung zu den Genen.** Gene gehoeren der KOLONIE, vererben und
mutieren sich ueber Generationen. Eigenschaften gehoeren dem EINZELTIER,
werden bei der Geburt gewuerfelt und aendern sich nie. Ein genetisch
friedliches Volk kann einzelne jaehzornige Ameisen hervorbringen.

**Wie die Wirkung ankommt.** Zahlenwerte (Tempo, Trefferpunkte, Grabtempo,
Tragfaehigkeit, Sicht, Spurtreue, Brutpflege, Kampfkraft) werden EINMAL bei
der Geburt in die Spalten der Ameisentabelle eingerechnet. Im Tick kostet
das nichts mehr. Verhalten (flieht nie, greift von selbst an, nachtaktiv,
giftig, platzt im Tod) braucht eine Abfrage zur Laufzeit und steckt in
einer Bitmaske `ants.traitBits`; eine Pruefung ist ein einzelnes UND.

Eine Ameise hat hoechstens zwei Eigenschaften, eine Koenigin bis zu drei,
und sich widersprechende Paare (tapfer/feige) schliessen sich aus.

Der Charakter der Koenigin wird in Koloniewerte umgerechnet
(`colony.character`): Eierrate, Soldatenanteil, Aggression, Expansion,
Bautrieb, Wellenstaerke, Forschung, Verteidigung, Handel – plus
`colony.warBias`, die Kriegsneigung. Er wird GEWUERFELT, nicht vererbt:
eine friedliche Mutter kann eine Kriegstreiberin hervorbringen. Das haelt
die Voelker ueber Generationen verschieden.

Im Forschungsmenue laesst sich der Charakter ansehen, einzeln umschalten
und neu wuerfeln – das ist der schnellste Weg, den Unterschied zwischen
einer Blutruenstigen und einer Friedfertigen zu erleben.

---

## 8o. Beziehungen und Krieg per Pheromon (Phase 11)

`sim/diplomacy.js`. Jedes Paar von Voelkern hat einen Wert von -1 bis +1:

| Wert | Haltung | Verhalten |
|---|---|---|
| bis -0.35 | **Krieg** | greift an, ohne zu rechnen; auch kleine Voelker |
| bis 0.15 | Feindselig | raubt, wenn es sich lohnt (Ausgangslage) |
| bis 0.5 | Frieden | greift nicht an |
| darueber | **Buendnis** | greift einander nie an |

Der Wert bewegt sich von selbst: jeder Verlust durch den anderen drueckt
ihn, Zeit ohne Zwischenfall hebt ihn. Die Ruhelage ist der gespiegelte
Mittelwert der Kriegsneigung beider Koeniginnen – zwei Friedfertige treiben
Richtung Buendnis, eine Blutruenstige zieht jede Beziehung nach unten.

**Kriegsduft.** Das Werkzeug wirkt nur ueber die KOENIGIN. Trifft es sie,
erklaert ihr Volk einem Nachbarn den Krieg und schickt von da an in
kuerzeren Abstaenden immer groessere Wellen (`WAVE_BASE` mal
`WAVE_GROWTH` je Welle, gedeckelt bei `RAID_MAX_SHARE` des Volkes).
Trifft der Duft nur Arbeiterinnen, macht er sie eine Weile angriffslustig
– aber kein Volk fuehrt Krieg, weil ein paar Sammlerinnen gereizt sind.
Damit das nicht zur Zielübung wird, gilt in der eigenen Nest-Ebene ein
grosszuegigerer Radius (`GODMODE.QUEEN_SCENT_SLACK`).

Dazu **Friedensduft** (beendet alle Feindschaften, wirkungslos bei einer
blutruenstigen Koenigin) und **Buendnisduft**.

Aggressive Koeniginnen erklaeren auch von selbst Krieg
(`DIPLO.SELF_WAR_CHANCE` mal Kriegsneigung mal Aggression).

---

## 8p. Materialien, Bauwerke und Forschung (Phase 11)

`sim/structures.js`, Daten in `MATERIALS`, `STRUCTURES`, `RESEARCH_TREE`.

**Fuenf Materialien.** Kiesel und Harz gab es schon; dazu kommen Lehm (aus
dem feuchten Saum um Wasser und aus tiefer Erde beim Graben), Kalk (aus
Stein geschlagen) und Chitin (von erlegten Tieren). Materialien werden
erst gesammelt, wenn die Kolonie sie kennt – vorher laeuft eine Ameise an
Lehm vorbei, ohne zu wissen, was sie damit soll.

**Sechs Bauwerke in je drei Stufen.** Anders als eine Befestigungszelle ist
ein Bauwerk ein Eintrag mit Zustand (Stufe, Trefferpunkte, Ladezeit):

| Bauwerk | Wirkung |
|---|---|
| Saeurespeier | schiesst auf Feinde und Raeuber in Reichweite, kostet Vorrat je Schuss |
| Harzschleuder | wenig Schaden, verklebt Feinde (Tempo runter) |
| Wachposten | eigene Kaempferinnen in Reichweite schlagen haerter zu |
| Speicherbau | vergroessert das Lager der Kolonie |
| Brutstube | Brut in Reichweite reift schneller |
| Werkstatt | beschleunigt die Forschung, senkt die Baukosten |

**Forschung ohne Knopf.** Punkte entstehen aus eingetragener Nahrung, aus
fertigen Bauten und aus der Werkstatt – das Volk lernt, weil es arbeitet.
Acht Stufen mit Vorbedingungen; jede schaltet Materialien und Bauwerks-
stufen frei. Im Forschungsmenue ist der Baum sichtbar und einzeln
freischaltbar (Sandkasten).

**Wie ein Bauwerk entsteht:** die Kolonie plant einen Auftrag (immer nur
einen), Ameisen im Zustand BUILD tragen Arbeit bei, beim Abschluss wird
das Material abgebucht. Fehlt es, faellt der Auftrag nach
`BUILD.MAX_STALLS` Versuchen heraus – im ersten Anlauf lief eine
unbezahlbare Baustelle endlos auf 85 Prozent und band immer mehr Ameisen,
bis das Volk verhungerte.

Fehlendes Material wird gezielt geholt: `updateWants` sucht die naechste
Fundstelle und ein kleiner Teil der Sammlerinnen zieht dorthin. Passives
Aufsammeln reichte nicht – im Test standen von 316 Ameisen NULL im
Lehmguertel, weil Sammlerinnen den Nahrungsspuren folgen und die verlaufen
woanders.

---

## 8r. Mehrere Stockwerke je Volk (Phase 11)

Ein Volk beginnt mit einer Nest-Ebene. Wird es gross und geht ihm der
Platz aus, graebt es sich ein **Stockwerk tiefer**: `World.expandNest`
legt eine neue Nest-Ebene an und verbindet sie mit einem Abstiegsschacht.

### Der Schacht ist ein gewoehnliches Portal

Nest zu Nest statt Oberflaeche zu Nest. Damit gelten Kapazitaet,
Uebergangszeit und die Engstellenregel im Kampf automatisch auch fuer
ihn. Ein zweiter Verbindungsmechanismus waere nur eine zweite
Fehlerquelle gewesen.

Jedes Portal merkt sich in `upLevelId`, welche Seite die obere ist. Das
Ausgangsfeld einer Ebene nimmt nur Portale auf, die von dort **nach
oben** fuehren – sonst bietet es einer Sammlerin auf einer mittleren
Ebene den Abstiegsschacht als Weg ins Freie an.

### Grabzustand je Ebene

`colony.digByLevel` bildet Ebenen-ID auf den Grabzustand ab
(`queue`, `meta`, `target`, `active`, `progress`, `goals`, `key`,
`descend`, `stall`). Bis dahin gab es **eine** Warteschlange am Volk;
mit zwei Ebenen wertete `Construction.update` dieselbe Liste gegen die
Zellen der falschen Ebene aus und raeumte deren Auftraege weg.

Zugriff ueber `Construction.stateFor(colony, levelId)` (legt an) bzw.
`peek` (legt nicht an, fuer heisse Pfade in `ants.js`).

### Wie ein neues Stockwerk besiedelt wird

Ameisen benutzen ein Portal nur, wenn sie darauf treten – tief im Bau
kommt zufaellig niemand vorbei. Deshalb gibt es einen **Sog**:

1. Neue Grabprojekte werden nur noch auf der **untersten** Ebene geplant
   (`_isDeepest`). Ein Nest waechst nach unten.
2. Wartet unten Arbeit und ist dort weniger als `EXPAND_STAFF_SHARE` des
   Volkes, zeigt das Grabfeld der oberen Ebene auf den Schacht statt auf
   die eigene Baustelle (`_descendTarget`). Wer schon an der Tunnelbrust
   steht, graebt weiter; alle anderen laufen hinunter.
3. `_tryEnter` laesst Ameisen im Zustand DIG durch das **eigene** Tor.

Die Abschaltschwelle liegt um `EXPAND_STAFF_HYST` hoeher als die
Einschaltschwelle. Ohne diese Hysterese kippte der Sog im Sekundentakt.

### Gefundene Fehler

| Befund | Ursache | Loesung |
|---|---|---|
| Neues Stockwerk blieb bei null Ameisen | Sog hing an "obere Warteschlange leer" – sie wurde es nie | Sog haengt an der Besetzung unten |
| Volk grub in 8000 Ticks keine Zelle | Sog kippte staendig, jeder Umschlag setzte `progress` auf 0 | Baustelle bleibt stehen, nur das Feld wandert; dazu Hysterese |
| 17 Auftraege kreisten ewig | `planProject` ueberspringt Fels im Zugangsgang stillschweigend, die Kammer haengt in der Luft | nach einem vollen Umlauf wird der Auftrag verworfen (`stall`) |
| Volk grub weiter trotz genug Platz | `needsSpace` mass nur EINE Ebene | `airOf(colony)` summiert alle Ebenen |
| Ausbau loeste nie aus | Festpreis von 90 Zucker; ein Volk mit 700 Ameisen haelt sein Lager dauerhaft bei etwa 60 | Preis gestrichen, die Grabarbeit ist der Preis |

### Grenzen

`LIMITS.MAX_NEST_LEVELS` = 20, `DIG.EXPAND_MAX_PER_COLONY` = 3. Jede
Ebene kostet rund ein Megabyte (Gitter, fuenf Distanzfelder, Chunk-
Texturen). Gemessen im schlimmsten Fall – acht Voelker, 20 Nest-Ebenen,
4296 Ameisen: **7.85 ms/Tick**, 23.5 % des Budgets von 33.3 ms.

## 8q. Massentest (test/fuzz.mjs)

```bash
node test/fuzz.mjs 1000 20000            # 1000 Welten, je 11 Minuten Spielzeit
node test/fuzz.mjs 200 20000 --workers 4 --json roh.json
```

Verteilt die Laeufe ueber `worker_threads` auf alle Kerne. Je Lauf wird
geprueft: keine Ausnahme, keine NaN oder Positionen ausserhalb der Karte,
keine negativen Vorraete, und der Speicherstand laesst sich schreiben und
wieder lesen. Ausgegeben werden Median, Mittel und Spannweite von Voelkern,
Groessen, Arten, Bauwerken, Forschungsstufen, Kriegen, Buendnissen und
Speichergroesse – je Kartenvorlage aufgeschluesselt.

**"Parallel" heisst hier: auf N Kernen.** Node laeuft einfaedig; tausend
wirklich gleichzeitige Welten gibt es auf keiner Maschine dieser Groesse.
Ein Lauf ueber 1000 Welten a 15 000 Ticks dauert auf drei Kernen rund
21 Minuten.

### Die Steppe: eine Verklemmung in drei Schichten

Der auffaelligste Einzelbefund. Auf der trockenen Karte entstand nach elf
Minuten kein einziges Bauwerk, waehrend es auf allen anderen fuenf bis
zehn waren. Drei Ursachen lagen uebereinander:

1. **Kein Wasser, also kein Lehm** – der Lehmsaum braucht Wasser in der
   Naehe, und die Steppe hat keines. Behoben: Lehm faellt auch beim Graben
   in tiefer Erde an, die jede Karte hat.
2. **Der Einstiegsbau verlangte Lehm.** Der Wachposten der Stufe 1 kostete
   Kiesel UND Lehm; ohne Lehm war auch er unerreichbar. Jetzt kostet er
   nur Kiesel, ab Stufe 2 bleibt Lehm noetig.
3. **Eine Reihenfolge-Verklemmung.** Ein Bauauftrag entstand nur, wenn das
   Material bereits im Lager lag. Ohne Auftrag holte aber niemand Material
   und niemand hielt etwas zurueck – die Befestigungen verbrauchten jeden
   Kiesel sofort, der Vorrat blieb bei null, also entstand nie ein
   Auftrag. Jetzt entsteht der Auftrag, sobald das Material ERREICHBAR
   ist; er meldet seinen Bedarf an, Sammlerinnen holen gezielt, und ein
   Sockelvorrat (`FORTIFY.PEBBLE_RESERVE`) bleibt fuer ihn reserviert.
   Bleibt das Material dauerhaft aus, faellt der Auftrag nach
   `BUILD.MAX_STALLS` Versuchen heraus.

Der Massentest hat die Balance dieser Phase bestimmt, nicht das Bauchgefuehl:

| Befund (200 Laeufe) | Aenderung |
|---|---|
| 49 % der Spiele ohne ein einziges Bauwerk, Median 1 Forschungsstufe von 8 | Forschungskosten rund ein Drittel runter, Punkte je Nahrung und je Tick rauf |
| Buendnisse kamen praktisch nie vor | `DIPLO.DRIFT` hoch, Buendnisschwelle von 0.6 auf 0.5 |
| Speicherstand 711 KB | Variantenkarte nicht mehr speichern (siehe 8l), abgeleitete Eigenschaftswerte neu rechnen: **279 KB** |
| Steppe bekam nie Lehm (kein Wasser) | Lehm auch aus tiefer Erde beim Graben |
| Steppe baute trotzdem nichts (0.7 gegen 5 Bauwerke) | drei Ursachen, alle behoben – siehe unten |

---

## 9. Wichtige Konstanten (`js/config.js`)

| Gruppe | Wert | Bedeutung |
|---|---|---|
| `SIM.TICK_RATE` | 30 | Simulationsticks pro Sekunde |
| `SIM.SPEEDS` | 0,1,2,5,10 | waehlbare Geschwindigkeiten |
| `SIM.MAX_TICKS_PER_FRAME` | 24 | Obergrenze nachgeholter Ticks |
| `WORLD.SURFACE_W/H` | 400 x 400 | Oberflaechengroesse in Zellen |
| `WORLD.NEST_W/H` | 200 x 150 | Nestgroesse in Zellen |
| `WORLD.NEST_SURFACE_ROW` | 6 | Zeile der Erdoberflaeche im Nest |
| `WORLD.CHUNK` | 64 | Chunk-Kantenlaenge in Zellen |
| `WORLD.CELL_SIZE` | 4 | Weltkoordinaten je Zelle |
| `WORLD.CELL_PX` | 4 | Texturpixel je Zelle |
| `LIMITS.MAX_ANTS` | 6000 | Ameisen ueber alle Ebenen |
| `LIMITS.MAX_COLONIES` | 8 | Kolonien |
| `LIMITS.MAX_NEST_LEVELS` | 12 | Nest-Ebenen |
| `PORTALS.CAPACITY_PER_TICK` | 4 | Durchlass je Tick und Richtung |
| `PORTALS.TRANSIT_TICKS` | 8 | Aufenthalt im Eingangsschacht |
| `CAMERA.DEFAULT_ZOOM` | 3 | Startzoom (0.5 bis 14) |
| `TRANSITION.DURATION_MS` | 500 | Ebenenuebergang |
| `RENDER.SPRITE_PX` | 20 | Atlaszelle je Einzelbild |
| `RENDER.ANT_CELLS` | 1.2 | Koerperlaenge einer Arbeiterin in Zellen |
| `RENDER.SIZE_EXPONENT` | 0.65 | unterlineare Groessendarstellung |
| `DIG.COST.soil` | 150 | Grabpunkte fuer eine Erdzelle |
| `DIG.RATE_PER_ANT` | 1.0 | Grabpunkte je Ameise und Tick |
| `DIG.CELLS_PER_ANT` | 1.2 | angestrebte Nestgroesse je Ameise |
| `DIG.PLAN_INTERVAL` | 45 | Ticks zwischen Planungsschritten |
| `DIG.FIELD_BUDGET_PER_TICK` | 1 | Distanzfelder pro Tick (alle Ebenen) |
| `TOOLS.BRUSH_DEFAULT` | 3 | Pinselgroesse beim Start |
| `TOOLS.SPAWN_ANTS` | 15 | Ameisen je Klick mit dem Spawn-Werkzeug |
| `TOOLS.FOUND_ANTS` | 45 | Startvolk einer per Werkzeug gegruendeten Kolonie |
| `FOOD.PICKUP` | 8 | Einheiten je Fuhre |
| `PHERO.DEPOSIT_FALLOFF` | 900 | Ticks, ueber die die Ablage abfaellt |
| `PHERO.DECAY_INTERVAL` | 6 | Ticks zwischen zwei Verdunstungsdurchlaeufen |
| `NUTRITION.SUGAR_PER_ADULT` | 0.00035 | Zucker je Ameise und Tick |
| `NUTRITION.BALANCE_WINDOW` | 1800 | Glaettungsfenster der Bilanz (3 Spieltage) |
| `BROOD.LARVA_PROTEIN` | 7.5 | Protein, das eine Larve insgesamt braucht |
| `BROOD.EGG_INTERVAL` | 90 | Ticks je Ei bei Gen 0.5 |
| `LIFE.WORKER_LIFESPAN` | 30000 | Lebensdauer einer Arbeiterin (ca. 16 min) |
| `CREATURES.HUNT_HUNGER` | 0.6 | Energieanteil, unter dem gejagt wird |
| `CREATURES.ATTACK_COOLDOWN` | 45 | Ticks zwischen zwei Bissen |
| `EVO.SIGMA_BASE` | 0.055 | Grundstreuung der Mutation |
| `EVO.FLIGHT_MIN_POP` | 140 | Mindestvolk fuer einen Hochzeitsflug |
| `EVO.DOWRY` | 140/110/70 | Mitgift einer Jungkoenigin (Zucker/Protein/Fett) |
| `NUTRITION.FAT_TO_SUGAR` | 0.8 | Umsatz von Fett in Energie bei Zuckermangel |
| `NUTRITION.HUNGER_TOL_MIN/MAX` | 0.80 / 1.60 | Streubreite der Hungertoleranz |
| `BROOD.CLAUSTRAL_WORKERS` | 4 | bis dahin fuettert die Koenigin die Brut selbst |
| `COMBAT.CHECK_EVERY` | – | Staffelung der Feindpruefung je Ameise |
| `STABILITY.MAX_SPAN` | je Zelltyp | zulaessige Deckenspanne vor dem Einsturz |
| `GODMODE.DEFAULT_MODE` | `sandbox` | `challenge` verlangt goettliche Energie |
| `GODMODE.ENERGY_MAX` | 100 | Energievorrat im Herausforderungsmodus |
| `DAYNIGHT.CYCLE_TICKS` | 10800 | voller Tag (6 min bei 1x, 36 s bei 10x) |
| `DAYNIGHT.NIGHT_LIGHT` | 0.34 | Helligkeit bei tiefer Nacht |
| `DAYNIGHT.ANT_NIGHT_SPEED` | 0.72 | Sammeltempo und Grundumsatz bei Nacht |
| `PARTICLES.MAX` | 700 | Ringpuffer der Teilchen |
| `CREATURES.GRAZE_CHANCE/BITE` | 0.03 / 1 | Frassdruck der Weidegaenger |
| `CREATURES.PLANT_REGROW_*` | 150 / 220 / 0.38 | Ausbreitung der Pflanzen |
| `CINEMA.FRONT_MIN_ANTS` | 4 | ab so vielen Kaempfenden folgt die Kamera |
| `TRAITS` | 61 | Eigenschaften (41 Ameise, 20 Koenigin) |
| `TRAIT_CFG.ANT_CHANCE` | 0.55 | Anteil Ameisen mit mindestens einer Eigenschaft |
| `TRAIT_CFG.BASE_COURAGE` | 0.3 | Fluchtschwelle ohne Eigenschaft |
| `DIPLO.WAR_BELOW` | -0.35 | ab hier gilt Krieg |
| `DIPLO.ALLY_ABOVE` | 0.5 | ab hier gilt Buendnis |
| `DIPLO.ZEAL_TICKS` | 9000 | wie lange der Kriegsduft nachwirkt (5 min) |
| `DIPLO.WAVE_BASE/GROWTH` | 8 / 1.45 | erste Welle und Wachstum je weiterer |
| `COMBAT.RAID_MAX_SHARE` | 0.45 | hoechstens dieser Anteil des Volkes je Welle |
| `BUILD.MAX_PER_COLONY` | 40 | Bauwerke je Volk |
| `BUILD.POINTS_PER_FOOD` | 0.022 | Forschung je eingetragener Nahrungseinheit |
| `BUILD.MAX_BUILDERS` | 12 | Ameisen gleichzeitig an einer Baustelle |
| `RESEARCH_TREE` | 8 Stufen | 60 bis 460 Punkte, mit Vorbedingungen |
| `EVO.MATE_RADIUS` | 14 | Reichweite der Paarung beim Hochzeitsflug |

Kastenwerte (`CASTE_STATS`) und Generatorparameter (`GEN`) liegen ebenfalls
vollstaendig in `config.js`.

---

## 10. Naehrstoff- und Mutationsformeln

Implementiert in `nutrition.js` und `genome.js`.

**Bilanz.** `b_n = Aufnahme_n / Bedarf_n`, geglaettet ueber ein gleitendes
Fenster (Standard 3 Spieltage). `b = 1` gedeckt, `< 1` Mangel, `> 1`
Ueberschuss. Naehrstoffe: Zucker, Protein, Fett.

**Stress.** `S = clamp( SUMME_n |ln(b_n)| * stressGewicht_n , 0, S_max )`,
zusaetzlich erhoeht durch Kriegsverluste, Raeuberdruck, Koeniginnenwechsel.

**Mutationsstaerke je Gen.**

```
sigma_g = sigma_basis
        * (1 + k_stress * S)
        * PRODUKT_n (1 + k_ueberschuss_n * w[n][g] * ln(1 + max(0, b_n - 1)))
sigma_g = min(sigma_g, sigma_max)
```

Fett-Ueberschuss senkt `sigma` aller Gene leicht (Stabilisierungsfaktor).

**Mutationsrichtung.** `mu_g = biasStaerke * SUMME_n w[n][g] * tanh(b_n - 1)`.
Einstellung "Ernaehrungseinfluss": Realistisch = 0, Standard = 0.2 * sigma_basis,
Stark fuer Experimente.

**Neues Gen.** `gen_neu = clamp(gen_eltern + Normal(mu_g, sigma_g), 0, 1)`,
dazu Sprungmutationen mit `p_sprung = p_basis * (1 + S)` (neuer Wert
gleichverteilt im Bereich +-0.3).

`w[naehrstoff][gen]` ist eine Gewichtstabelle in `config.js` (Stoffwechsel-
gene an Zucker, Koerper- und Kastengene an Protein bzw. Fett, Verhaltensgene
an Stress). `RNG.gauss()` steht dafuer bereits bereit.

---

## 11. Gemessene Performance

Headless unter Node (reine Simulation, ohne Rendering), 1500 Ticks nach
600 Ticks Aufwaermen, mit allen Systemen (Pheromone, Nahrung, Brut,
Kreaturen, Nestbau):

| Aufbau | Tick im Mittel | Spitze | Anteil am Tickbudget |
|---|---|---|---|
| Eingeschwungenes Oekosystem (447 Ameisen, 211 Tiere, 9 Ebenen) | **0.52 ms** | 1.78 ms | 1.5 % |
| 1 Volk, 5000 Ameisen, 2 Ebenen | **4.40 ms** | 11.49 ms | 13.2 % |
| 8 Voelker, 5000 Ameisen, 9 Ebenen | **4.32 ms** | 9.90 ms | 13.0 % |

Aufteilung im letzten Fall: Ameisen 7.49 ms (Spitze), Buckets 0.54 ms,
Kreaturen 0.56 ms, Pheromone 0.28 ms, Kolonie-KI 0.16 ms, Brut 0.07 ms,
Distanzfelder 0.01 ms.

Der Anstieg gegenueber Phase 8 (3.69 ms) geht auf Kampfpruefung,
Stabilitaet und die sechs zusaetzlichen Kreaturenarten. Bei 13 % des
Tickbudgets ist weiter reichlich Luft.

Im Browser (1600x900, eingeschwungenes Oekosystem): Simulation rund
0.5 ms, Sprite-Vorbereitung 4.5 ms (enthaelt das Chunk-Neuzeichnen beim
Start), GPU-Aufruf 0.2 ms, Pheromon-Overlay 0.9 ms alle sechs Frames.

Weitere Einzelwerte: Chunk-Neuzeichnen 0.77 ms (Oberflaeche ohne Nahrung)
bzw. 1.13 ms (mit Nahrung) und 1.24 ms (Nest) je 64x64-Chunk;
Breitensuche eines Distanzfeldes 0.25 ms.

**Einschraenkung:** Die Testumgebung hat keine GPU; Chromium rendert per
SwiftShader in Software. Die dort gemessenen FPS skalieren exakt umgekehrt
zur Pixelzahl bei konstanter JavaScript-Zeit – klassisch fuellratenbegrenzt.
Die 60-FPS-Anforderung auf echter Hardware ist damit **nicht gemessen**,
sondern nur plausibel. Das muss auf einem echten Laptop nachgeprueft werden.

**Determinismus** wurde mit allen Systemen geprueft: zwei Welten mit
gleichem Seed haben nach 2000 Ticks identische Grids, Ameisenzahlen,
Kreaturenzahlen und Grabstatistiken. Zusaetzlich laeuft ein geladener
Speicherstand 2000 Ticks lang bitgenau wie das Original weiter
(Abschnitt 8l).

---

## 12. Phasenstand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Engine, Ebenen, Portal, Kamera, Sprites, Chunks, Overlay, Legende | **fertig** |
| 2 | Pheromone, Sammeln, Ameisenstrassen, Stresstest | **fertig** |
| 3 | Nest, Graben, Lebenszyklus, Kolonie-KI, Naehrstoffe | **fertig** |
| 4 | Navigation, Minimap, Bild-in-Bild, Kinomodus, Front, Legenden-Hervorhebung | **fertig** |
| 5 | Krieg, Bedrohungsstufen, Raubzuege, Kampfalarme | **fertig** |
| 6 | Befestigungen, Stabilitaet, Einstuerze, Erdbeben | **fertig** (Reparatur ueber Baupheromon offen) |
| 7 | Raeuber, Netze, Trichter, Raeuber-Beute-Dynamik, 11 Arten | **fertig** |
| 8 | Evolution, Genom, Mutation, Hochzeitsflug, Kasten | **fertig** (Gen-Verlaufskurven offen) |
| 9 | Goettliche Eingriffe (24 Stueck), Energie-Modus, Forschungsmenue | **fertig** |
| 10 | Tag/Nacht, Teilchen, Ton, Speichern/Laden, Einstellungen, Balancing | **fertig** |
| 11 | Eigenschaften, Diplomatie und Kriegsduft, Materialien, Bauwerke, Forschung, Massentest | **fertig** |
| 11+ | Blattlaus-Bewachung, Buendnisse mit Wirkung, mehrere Stockwerke je Volk | **fertig** |

### Geprueft

Headless (`test/sim-bench.mjs`, **36/36**):

* Gleicher Seed erzeugt identischen Verlauf – mit allen Systemen.
* Die Kolonie erweitert ihr Nest ohne Eingriff, der Erdhuegel waechst mit.
* Sammlerinnen tragen ein (544 Lieferungen in 5 Minuten), es entstehen
  Ameisenstrassen (5040 aktive Pheromonzellen).
* Die Koenigin legt Eier, Brut schluepft (92 Eier, 65 Ameisen).
* Nach 50 Minuten: acht Voelker im Stammbaum, groesstes Volk 414 Ameisen,
  keine Linie waechst unbegrenzt.
* Ohne jeden Eingriff entstehen vier evolutionaere Kasten
  (Saeureschuetzin, Panzerameise, Honigtopfameise, Sanitaeterin).
* Zehn der elf Kreaturenarten ueberleben (nur die Gottesanbeterin nicht,
  siehe Abschnitt 13).
* Alle 24 goettlichen Eingriffe laufen fehlerfrei, und die Welt rechnet
  danach weiter.
* Tag ist heller als Nacht; nachtaktive und tagaktive Arten tauschen die
  Rollen; die Welt fuehrt eine Tageszeit mit.
* Ein Speicherstand (116 KB) laesst sich laden, hat denselben Bestand und
  laeuft **2000 Ticks bitgenau gleich** weiter.
* Jede Koenigin hat einen Charakter, Ameisen werden mit Eigenschaften
  geboren (131 von 243, 41 verschiedene), und die Werte aendern sich
  wirklich (kraeftig 1.35 HP gegen zierlich 0.75).
* Kriegsduft auf die Koenigin erklaert Krieg, es folgen acht immer
  groessere Wellen, Friedensduft beendet ihn wieder.
* Eine Kolonie erforscht ohne Zutun sieben von acht Stufen, sammelt Lehm,
  Kalk und Chitin und errichtet von selbst Bauwerke.
* Proteinueberschuss macht Koerpergene messbar instabiler als
  Zuckerueberschuss und umgekehrt; Stress vervielfacht die Streuung.

Im Browser (`test/browser-check.mjs`, **41/41**): Ebenenwechsel und
gemerkte Kamera, kontextabhaengige Legende und Werkzeugleiste,
Bauauftraege, Terrain malen, Kolonie gruenden, Ameisen absetzen, Nahrung
ablegen, Kreaturen spawnen, Forschungsmenue mit Genom-Editor und
Kastenfreischaltung, Hochzeitsflug, Schnelldurchlauf, Pheromon-Overlay,
Brut, Stammbaum, Kartenvorlagen, Bild-in-Bild mit echtem Terrain,
Eingriffe mit Reglern, Meteor mit Krater/Wackeln/Teilchen, Nachtblende,
Einstellungsfenster, Speichern und Laden, Einheiten entfernen,
Eigenschaften im Inspektor, Kriegsduft auf die Koenigin, Bauwerke setzen
und zeichnen, Forschungsbaum und Charakter im Forschungsmenue,
Kolonieliste mit Charakter, Baustoffen und Bauwerken – alles ohne
Konsolenfehler.

Massentest (`test/fuzz.mjs`), **1000 Welten a 15 000 Ticks auf fuenf
Kartenvorlagen, 21 Minuten**: keine Ausnahme, kein NaN, keine ungueltige
Position, kein negativer Vorrat, und jeder der 1000 Speicherstaende liess
sich schreiben und wieder lesen. Nach den Korrekturen dieser Phase sehen
95 Prozent der Laeufe mindestens ein Bauwerk (Median sieben), und keine
Linie waechst unbegrenzt. Einzelheiten in Abschnitt 8q.

---

## 13. Bekannte Probleme und bewusste Vereinfachungen

1. **60 FPS auf echter Hardware nicht gemessen** (siehe Abschnitt 11).
   Die Testumgebung hat keine GPU.
2. **Kollision ist achsenweise und grob.** Bei Blockade dreht die Ameise um
   0.7 rad. Das Distanzfeld entschaerft das im Nest, beseitigt es nicht.
3. **Speicherbedarf.** Chunk-Texturen rund 1.9 MB je Nest-Ebene und 10 MB
   fuer die Oberflaeche; Pheromonfelder rund 1 MB je Kolonie. Bei acht
   Kolonien also etwa 45 MB. Texturen nicht aktiver Ebenen werden **nicht**
   verworfen, weil Bild-in-Bild sie jederzeit braucht.
4. **Ein Sprite je Einheit.** Bei 5000 sichtbaren Ameisen sind das 5000
   `Sprite`-Objekte, die sich aber eine Textur und damit einen Batch teilen.
   Der Umstieg auf `ParticleContainer` ist vorbereitet.
5. **Die Brutpflege ist ortsgebunden.** Ammen laufen ueber das Distanzfeld
   in die Brutkammer und fuettern Larven im Umkreis von 7 Zellen. Liegen
   Larven in weit auseinanderliegenden Kammern, werden die entlegenen
   schlechter versorgt.
6. **`findHungryLarva` durchsucht die gesamte Bruttabelle.** Bei viel Brut
   und vielen Ammen ist das der teuerste Einzelposten der Brutpflege. Fuer
   die gemessenen Groessen unkritisch; bei deutlich mehr Brut braucht es
   einen Index je Kolonie.
7. **Raeuber suchen ihre Beute nicht.** Weder Nest noch Ameisenstrasse
   werden angesteuert. Beides wurde gebaut und beides hat das Spiel
   zerstoert: Nest ansteuern liess alle Jaeger am Eingang campen, Spur
   ansteuern sammelte sie auf der Hauptstrasse – in beiden Faellen war das
   Volk binnen Minuten ausgeloescht, danach verhungerten die Jaeger. Der
   Grund ist strukturell: eine Ameisenstrasse ist ein DAUERHAFTER
   Beutestrom, wer sie findet, muss nie wieder suchen. Deshalb streifen
   Jaeger umher; die Verteilung entlang der Routen ergibt sich von selbst,
   ohne Rueckkopplung. Der Code in `creatures.js:_seek` haelt das fest.
8. **Die Gottesanbeterin haelt sich nicht selbst.** Sie ist ein
   Lauerjaeger mit Sichtweite 11 auf einer 400x400-Karte: ohne
   Beutesuche (Punkt 7) laeuft ihr statistisch zu selten etwas vor die
   Fangarme. Sie ist als Apexraeuber zum Aussetzen gedacht; vier Stueck
   loeschen im Test ein Volk von 300 Ameisen aus. Der Starbesatz ist
   deshalb auf 2 gesetzt, und die Artbeschreibung sagt es offen.
9. **Toechter aus dem Hochzeitsflug bleiben klein.** Sie erreichen 20 bis
   30 Tiere und schrumpfen danach wieder. Das ist kein Fehler, sondern
   Verdraengung: das Mutterschiff mit 400 Sammlerinnen bindet die Nahrung
   in seinem Umkreis, und eine Zwoelf-Ameisen-Kolonie schafft es nicht,
   eine eigene Ameisenstrasse zu etablieren. Die Mitgift der Jungkoenigin
   (`EVO.DOWRY`) und die klaustrale Gruendung (`BROOD.CLAUSTRAL_*`) bringen
   die erste Generation durch; danach entscheidet der Standort.
10. **Die Konsole meldet einen Netzfehler**, wenn das CDN nicht erreichbar
    ist, bevor der Vendor-Fallback greift. Das laesst sich nicht vermeiden,
    ohne den CDN-Pfad aufzugeben.
11. **Der Ton bringt keine Dateien mit.** `ui/audio.js` laedt
    `assets/sfx/*.wav`, wenn es sie gibt, und bleibt sonst still – ohne
    Fehlermeldung. Erfundene Assetpfade waeren schlimmer als Stille.
12. **Teilchen sind nicht Teil der Simulation.** Sie benutzen bewusst
    `Math.random()` und beeinflussen den Determinismus nicht. Im
    Schnelldurchlauf gehen sie verloren; das ist Absicht.
13. **Eigenschaften sind nicht vererbbar.** Sie werden bei jeder Geburt
    neu gewuerfelt. Eine Kolonie voller tapferer Ameisen kann man sich
    also nicht zuechten – dafuer sind die Gene da. Das ist Absicht: sonst
    gaebe es zwei konkurrierende Vererbungssysteme nebeneinander, und die
    Gene wuerden bedeutungslos.
14. **Die Diplomatie kennt nur Paare.** Es gibt keine Buendnisblöcke, keine
    Kriegserklaerung "alle gegen einen" und keine Buendnistreue: ein
    Verbuendeter hilft passiv (er greift nicht an), zieht aber nicht mit
    in den Krieg. Das waere der naechste sinnvolle Schritt.
15. **Ein Volk baut immer nur an EINER Baustelle.** Mehr liesse sich mit
    den vorhandenen Arbeiterinnen ohnehin nicht bedienen, und die
    Warteschlange bliebe staendig stecken.
16. **Der Speicherstand haelt keine abgeleiteten Daten.** Distanzfelder,
    Spatial Hashes und Zaehler werden beim Laden neu gerechnet. Die
    Distanzfelder werden dabei SOFORT und vollstaendig gerechnet (nicht
    ueber das uebliche Budget von drei je Tick), sonst laufen die ersten
    Ticks auf halbfertigen Feldern und der Verlauf weicht ab. Seit
    Version 1.1.0 wird auch die Variantenkarte nicht mehr gespeichert,
    sondern aus ihrem Seed neu erzeugt – das allein hat den Stand von
    800 KB auf 279 KB gebracht.
