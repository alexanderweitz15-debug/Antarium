# Formicarium – Architektur

2D-Sandbox-Insekten-OEkosystem im Browser. PixiJS v8 fuer das Rendering,
Vanilla-ES6-Module fuer die Simulation, kein Build-Tool.

**Stand: Phase 1 abgeschlossen** (Engine, Ebenen, Portale, Kamera, Sprites,
Chunk-Terrain, Performance-Overlay, Legenden-Grundgeruest).

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
  levelNav.js     Ebenen-Reiter + Brotkrumen
  legend.js       Datengetriebene, kontextabhaengige Legende
  panels.js       Kolonieliste
  inspector.js    Tooltip am Zeiger + Detailfenster
  log.js          Ereignis-Log mit Kategoriefiltern
  perf.js         Performance-Overlay (F3)
```

Noch nicht vorhanden (kommt in der jeweiligen Phase): `pheromones.js`,
`flowfields.js`, `fluids.js`, `stability.js`, `food.js`, `nutrition.js`,
`construction.js`, `combat.js`, `genome.js`, `predators.js`,
`interventions.js`, `minimap.js`, `pip.js`, `particles.js`, `save.js`,
`stats.js`, `lineage.js`, `alerts.js`, `nutritionView.js`, `toolbar.js`.

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

Headless unter Node (reine Simulation, ohne Rendering), 5000 Ameisen,
2 Ebenen, 2000 Ticks:

| Groesse | Wert |
|---|---|
| Tick gesamt | **1.6 ms** (Spitze 3.0 ms) |
| davon Buckets | 0.22 ms |
| davon Spatial Hash | 0.07 ms |
| davon Ameisen | 1.20 ms |
| Auslastung bei 1x (30 Ticks/s) | ca. 5 % eines Kerns |
| Auslastung bei 10x (300 Ticks/s) | ca. 47 % eines Kerns |

Im Browser (1280x720, 5000 Ameisen, ca. 2500 sichtbare Sprites):
Simulation 2.1 ms, Sprite-Vorbereitung 0.7 ms, GPU-Aufruf 1.2 ms
– zusammen rund **4 ms JavaScript pro Frame**.

Chunk-Neuzeichnen: 0.77 ms (Oberflaeche) bzw. 1.24 ms (Nest) je 64x64-Chunk.

**Einschraenkung:** Die Testumgebung hat keine GPU; Chromium rendert per
SwiftShader in Software. Die dort gemessenen 5–40 FPS skalieren exakt
umgekehrt zur Pixelzahl (320x240 -> 39.7 FPS, 640x480 -> 12.7 FPS,
1280x720 -> 6.9 FPS) bei konstanter JavaScript-Zeit – klassisch
fuellratenbegrenzt. Die 60-FPS-Anforderung auf echter Hardware ist damit
**nicht gemessen**, sondern nur plausibel (4 ms JS von 16.7 ms Budget).
Das muss auf einem echten Laptop nachgeprueft werden.

---

## 12. Phasenstand

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Engine, Ebenen, Portal, Kamera, Sprites, Chunks, Overlay, Legende | **fertig** |
| 2 | Pheromone, Sammeln, Ameisenstrassen, Stresstest | offen |
| 3 | Nest, Graben, Lebenszyklus, Kolonie-KI, Naehrstoffe | offen |
| 4 | Navigation, Minimap, Bild-in-Bild, vollstaendige Legende | offen |
| 5 | Krieg, Bedrohungsstufen, Raubzuege, Kinomodus | offen |
| 6 | Befestigungen, Stabilitaet, Einstuerze | offen |
| 7 | Raeuber | offen |
| 8 | Evolution, Genom, Mutation, Hochzeitsflug | offen |
| 9 | Goettliche Eingriffe | offen |
| 10 | Tag/Nacht, Partikel, Sound, Speichern/Laden, Balancing | offen |

### Abnahme Phase 1

* Klick auf den Nesteingang wechselt fluessig in die Nest-Ebene und zurueck –
  geprueft, inklusive Uebergang (Zoom + Blende, abschaltbar).
* Kameraposition und Zoom bleiben pro Ebene exakt erhalten – geprueft ueber
  Reiter, Tasten 0–8 und Esc.
* Beide Ebenen werden jeden Tick simuliert, auch die unsichtbare – geprueft
  (50 von 50 beobachteten Ameisen im Nest bewegen sich, waehrend die
  Oberflaeche gezeigt wird).

---

## 13. Bekannte Probleme und bewusste Vereinfachungen

1. **60 FPS auf echter Hardware nicht gemessen** (siehe Abschnitt 11).
2. **Ameisenverhalten ist ein Platzhalter.** In Phase 1 wechseln Ameisen
   zwischen Erkunden (Zufallslauf) und Heimkehren (Kurs auf das naechste
   eigene Portal). Das erzeugt sichtbaren Portalverkehr, ist aber bewusst
   keine emergente Futtersuche – Pheromone (Phase 2) und Aufgabenwahl
   (Phase 3) ersetzen es vollstaendig.
3. **Kollision ist achsenweise und grob.** Bei Blockade dreht die Ameise um
   0.7 rad. In 1–2 Zellen breiten Schaechten fuehrt das zu leichtem Zickzack.
   Mit den Flow Fields aus Phase 3 verschwindet das.
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
8. **Keine Bruttiere, keine Nahrung, keine Vorraete** – die Felder dafuer
   existieren bereits in `Colony` und `Ants`, sind aber noch unbenutzt.
