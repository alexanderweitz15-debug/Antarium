# Formicarium – Architektur

2D-Sandbox-Insekten-OEkosystem im Browser. PixiJS v8 fuer das Rendering,
Vanilla-ES6-Module fuer die Simulation, kein Build-Tool.

**Stand: Phase 1 abgeschlossen** (Engine, Ebenen, Portale, Kamera, Sprites,
Chunk-Terrain, Performance-Overlay, Legenden-Grundgeruest).

**Zusaetzlich vorgezogen** (auf ausdrueckliche Anforderung, siehe Abschnitt 12):
Graben und Nestbau (aus Phase 3), mehrere Kolonien mit eigenen Nest-Ebenen
(aus Phase 5), Sandbox-Werkzeuge und Kartenvorlagen (aus Phase 9).

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
node test/sim-bench.mjs          # Simulation ohne Browser: Leistung, Determinismus, Nestbau
npm i -D playwright              # einmalig, fuer den Browsertest
npx serve -l 8123 .              # in einem zweiten Terminal
node test/browser-check.mjs      # 18 Abnahmepruefungen im echten Browser
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
  construction.js Grabauftraege planen und abarbeiten (vorgezogen aus Phase 3)
  flowfields.js   Distanzfelder fuer die Navigation im Nest
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

js/ui/
  hud.js          Obere Leiste, Schalter, Debug-Menue, Hilfe
  toolbar.js      Spieler-Werkzeuge (ebenenabhaengig)
  swatch.js       Farbfelder fuer Legende und Werkzeugleiste
  levelNav.js     Ebenen-Reiter + Brotkrumen
  legend.js       Datengetriebene, kontextabhaengige Legende
  panels.js       Kolonieliste
  inspector.js    Tooltip am Zeiger + Detailfenster
  log.js          Ereignis-Log mit Kategoriefiltern
  perf.js         Performance-Overlay (F3)
```

Noch nicht vorhanden (kommt in der jeweiligen Phase): `pheromones.js`,
`fluids.js`, `stability.js`, `food.js`, `nutrition.js`, `combat.js`,
`genome.js`, `predators.js`, `interventions.js`, `minimap.js`, `pip.js`,
`particles.js`, `save.js`, `stats.js`, `lineage.js`, `alerts.js`,
`nutritionView.js`.

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
         closed, pluggedBy,    // Verschluss / Panzerameise (ab Phase 6/8)
         capacity, usedAB, usedBA, inTransit, totalPassages }
```

Ablauf eines Uebertritts:

1. Einheit erreicht die Portalzelle und ist im Zustand `RETURN`.
2. `PortalSystem.canEnter()` prueft Verschluss und Kapazitaet dieses Ticks
   (`PORTALS.CAPACITY_PER_TICK` je Richtung – die Engstelle, die ab Phase 5
   den Schlachtpunkt bildet).
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

## 8b. Sandbox-Werkzeuge und Kartenvorlagen (vorgezogen aus Phase 9)

**Werkzeugleiste (`ui/toolbar.js`)** – links, ebenenabhaengig. Die Knoepfe
entstehen aus den Zelltyp-Tabellen und tragen das echte Terrainbild als
Symbol (`ui/swatch.js` benutzt denselben Maler wie das Spiel).

| Werkzeug | Ebene | Wirkung |
|---|---|---|
| Zeiger | beide | Auswaehlen, Eingang anklicken, Karte ziehen |
| Gras/Erde/Sand/Stein/Wasser/Pflanze/Bluete/Kiesel/Erdhuegel | Oberflaeche | Terrain malen |
| Tunnel/Erde/Harte Erde/Stein/Kiesel | Nest | sofort graben bzw. zuschuetten |
| Bauauftrag | Nest | Zellen markieren, die die Kolonie selbst abbaut |
| Ameisen | beide | Einheiten der gewaehlten Kolonie und Kaste absetzen |
| Kolonie gruenden | Oberflaeche | neues Volk mit eigener Nest-Ebene und Portal |

Pinselgroesse 1–25 (`[`, `]` oder Shift+Mausrad), Vorschaukreis am Zeiger.
Mit aktivem Werkzeug malt die linke Maustaste (ziehen moeglich), geschoben
wird mit der mittleren Taste. Werkzeuge veraendern die Welt nie direkt,
sondern rufen `World.paint()`, `World.markDigOrders()`, `World.spawnAntsAt()`
bzw. `World.foundColony()` auf – Weltzustand wird ausschliesslich in der
Simulationsschicht geaendert. Portalzellen und die Oberflaechenzeile der
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

Kastenwerte (`CASTE_STATS`) und Generatorparameter (`GEN`) liegen ebenfalls
vollstaendig in `config.js`.

---

## 10. Naehrstoff- und Mutationsformeln (Vertrag fuer Phase 3 und 8)

Noch nicht implementiert – hier festgehalten, damit die spaeteren Phasen
nicht davon abweichen.

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

Headless unter Node (reine Simulation, ohne Rendering), jeweils 1500 Ticks
nach 300 Ticks Aufwaermen, inklusive laufendem Nestbau:

| Aufbau | Tick im Mittel | Spitze |
|---|---|---|
| 1 Kolonie, 5000 Ameisen, 2 Ebenen | **1.87 ms** | 3.73 ms |
| 8 Kolonien, 5000 Ameisen, 9 Ebenen | **2.17 ms** | 6.63 ms |

Aufteilung im zweiten Fall: Buckets 0.34 ms, Bau + Distanzfelder 0.03 ms,
Spatial Hash 0.07 ms, Ameisen 1.81 ms. Das entspricht rund 6.5 % eines Kerns
bei 1x und 65 % bei 10x.

Im Browser (1280x720, 5000 Ameisen, ca. 2500 sichtbare Sprites):
Simulation 2.1 ms, Sprite-Vorbereitung 0.7 ms, GPU-Aufruf 1.2 ms
– zusammen rund **4 ms JavaScript pro Frame**.

Chunk-Neuzeichnen: 0.77 ms (Oberflaeche) bzw. 1.24 ms (Nest) je 64x64-Chunk.
Breitensuche eines Distanzfeldes: 0.25 ms.

**Einschraenkung:** Die Testumgebung hat keine GPU; Chromium rendert per
SwiftShader in Software. Die dort gemessenen 5–40 FPS skalieren exakt
umgekehrt zur Pixelzahl (320x240 -> 39.7 FPS, 640x480 -> 12.7 FPS,
1280x720 -> 6.9 FPS) bei konstanter JavaScript-Zeit – klassisch
fuellratenbegrenzt. Die 60-FPS-Anforderung auf echter Hardware ist damit
**nicht gemessen**, sondern nur plausibel (4 ms JS von 16.7 ms Budget).
Das muss auf einem echten Laptop nachgeprueft werden.

**Determinismus** wurde mit laufendem Nestbau geprueft: zwei Welten mit
gleichem Seed haben nach 1500 Ticks identische Grids, Ameisenpositionen und
Grabstatistiken.

---

## 12. Phasenstand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Engine, Ebenen, Portal, Kamera, Sprites, Chunks, Overlay, Legende | **fertig** |
| 2 | Pheromone, Sammeln, Ameisenstrassen, Stresstest | offen |
| 3 | Nest, Graben, Lebenszyklus, Kolonie-KI, Naehrstoffe | **Graben und Kammern fertig**, Rest offen |
| 4 | Navigation, Minimap, Bild-in-Bild, vollstaendige Legende | offen |
| 5 | Krieg, Bedrohungsstufen, Raubzuege, Kinomodus | **mehrere Kolonien mit eigenen Nest-Ebenen fertig**, Kampf offen |
| 6 | Befestigungen, Stabilitaet, Einstuerze | offen |
| 7 | Raeuber | offen |
| 8 | Evolution, Genom, Mutation, Hochzeitsflug | offen |
| 9 | Goettliche Eingriffe | **Terrain-, Ameisen- und Koloniewerkzeuge fertig**, Rest offen |
| 10 | Tag/Nacht, Partikel, Sound, Speichern/Laden, Balancing | offen |

### Abnahme Phase 1

* Klick auf den Nesteingang wechselt fluessig in die Nest-Ebene und zurueck –
  geprueft, inklusive Uebergang (Zoom + Blende, abschaltbar).
* Kameraposition und Zoom bleiben pro Ebene exakt erhalten – geprueft ueber
  Reiter, Tasten 0–8 und Esc.
* Beide Ebenen werden jeden Tick simuliert, auch die unsichtbare – geprueft
  (50 von 50 beobachteten Ameisen im Nest bewegen sich, waehrend die
  Oberflaeche gezeigt wird).

### Zusaetzlich geprueft (vorgezogene Inhalte)

* Terrain malen aendert Zellen und Chunks werden neu gezeichnet.
* "Kolonie gruenden" erzeugt Volk, Nest-Ebene, Portal und Reiter in einem Zug.
* Das Ameisen-Werkzeug setzt Einheiten der gewaehlten Kolonie und Kaste ab.
* Die Werkzeugleiste wechselt beim Ebenenwechsel den Werkzeugsatz.
* Ein von Hand markierter Bauauftrag mitten im Erdreich wird ueber einen
  selbst gegrabenen Zugang tatsaechlich abgebaut.
* Die Kolonie erweitert ihr Nest ohne Eingriff: 152 Zellen in 100 Sekunden,
  dabei waechst der Erdhuegel an der Oberflaeche von 47 auf 130 Zellen und es
  entstehen Brut-, Vorrats-, Wach- und Fluchtkammern.
* Kartenvorlagen wirken (Geroellhang: 7309 Steinzellen statt rund 1500).

---

## 13. Bekannte Probleme und bewusste Vereinfachungen

1. **60 FPS auf echter Hardware nicht gemessen** (siehe Abschnitt 11).
2. **Das Verhalten an der Oberflaeche ist ein Platzhalter.** Dort wechseln
   Ameisen zwischen Erkunden (Zufallslauf) und Heimkehren (Kurs auf das
   naechste eigene Portal). Das erzeugt sichtbaren Portalverkehr, ist aber
   bewusst keine emergente Futtersuche – Pheromone (Phase 2) ersetzen es
   vollstaendig. Im Nest laeuft die Navigation dagegen schon ueber
   Distanzfelder.
3. **Kollision ist achsenweise und grob.** Bei Blockade dreht die Ameise um
   0.7 rad. In 1–2 Zellen breiten Schaechten fuehrt das zu leichtem Zickzack.
   Das Distanzfeld entschaerft es, beseitigt es aber nicht ganz.
4. **Speicherbedarf der Chunk-Texturen** waechst mit der Zahl der Nest-Ebenen
   (rund 1.9 MB je Nest, 10 MB Oberflaeche; bei 12 Nestern also ca. 33 MB
   GPU-Speicher). Ab Phase 5 sollten Texturen nicht aktiver Ebenen verworfen
   und beim Wechsel neu aufgebaut werden.
5. **Ein Sprite je Ameise.** Bei 5000 sichtbaren Ameisen sind das 5000
   `Sprite`-Objekte. Sie teilen sich eine Textur und damit einen Batch; falls
   der Stresstest in Phase 2 es noetig macht, ist der Umstieg auf
   `ParticleContainer` vorbereitet (ein Atlas, feste Ankerpunkte).
6. **Der Himmelstreifen der Nest-Ebene ist fuer Einheiten undurchdringlich.**
   Das ist Absicht (die Oberflaeche erreicht man nur ueber Portale), aber
   technisch ein Sonderfall im `solidTable`.
7. **Die Konsole meldet einen Netzfehler**, wenn das CDN nicht erreichbar ist,
   bevor der Vendor-Fallback greift. Das laesst sich nicht vermeiden, ohne
   den CDN-Pfad aufzugeben.
8. **Keine Brut, keine Nahrung, keine Vorraete** – die Felder dafuer
   existieren bereits in `Colony` und `Ants`, sind aber noch unbenutzt.
   Kolonien wachsen deshalb nicht von selbst; Nachschub kommt nur ueber das
   Ameisen-Werkzeug. Das kommt mit Phase 3.
9. **Kolonien sind einander noch gleichgueltig.** Rote und blaue Ameisen
   laufen durcheinander, ohne zu kaempfen. Das Kampfsystem ist Phase 5.
10. **Die Kolonie graebt nur, solange sie Platz braucht.** Erreicht das Nest
   `colony.total * DIG.CELLS_PER_ANT` Luftzellen, ruht der Bau. Ohne
   Bevoelkerungswachstum (Phase 3) bleibt es dann dabei – mit dem Werkzeug
   "Bauauftrag" oder mehr Ameisen geht es sofort weiter.
11. **"Neue Welt" laedt die Seite neu.** Ein Neustart im laufenden Betrieb
   muesste alle Chunk-Texturen, Sprite-Pools und UI-Bindungen abraeumen; der
   Reload ist robuster. Der aktuelle Stand geht dabei verloren (Speichern
   kommt in Phase 10).
