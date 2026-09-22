# Antarium

Ein 2D-Insekten-Oekosystem im Browser. Ameisenvoelker graben Nester,
sammeln Nahrung, fuehren Kriege, schliessen Buendnisse und entwickeln sich
ueber Generationen weiter. Alles laeuft in einer deterministischen
Simulation: gleicher Seed und gleiche Eingaben ergeben denselben Verlauf.

## Starten

Es gibt **kein Bauwerkzeug**. Das Spiel besteht aus ES6-Modulen, die der
Browser direkt laedt. Es braucht nur einen lokalen Server, weil Module
nicht ueber `file://` geladen werden duerfen:

```bash
npx serve -l 8123 .
```

Dann `http://localhost:8123/` oeffnen.

## Zwei Modi

| | Sandkasten | Feldzug |
|---|---|---|
| Werkzeuge | alle | nur Duefte und Bauauftraege |
| Goettliche Eingriffe | ja | nein |
| Eigenes Volk | nein | eines |
| Vorratsleiste | aus | an |

Im **Sandkasten** greift man von aussen ein: Wetter, Meteore, Seuchen,
Genome. Im **Feldzug** fuehrt man ein Volk mit den Mitteln, die eine
Koenigin wirklich haette – jedes Werkzeug erzeugt Arbeit, die das Volk
selbst leisten muss.

## Pruefungen

```bash
node test/sim-bench.mjs          # 45 Pruefungen ohne Browser
node test/fuzz.mjs 300 18000     # Massentest auf mehreren Kernen
node test/browser-check.mjs      # 48 Pruefungen im echten Browser
```

Der Browsertest braucht Playwright und einen laufenden Server auf Port
8123. Liegt Playwright nicht im Projekt, hilft `PLAYWRIGHT_MODULE`, ein
abweichender Chromium-Pfad `CHROME_PATH`.

## Aufbau

`ARCHITECTURE.md` beschreibt die Module, die Speicherlayouts, die
Naehrstoff- und Mutationsformeln, alle wichtigen Konstanten und die
bekannten Grenzen. `VERSIONS.md` nennt die Staende zum Zurueckrollen.

## Fremder Code

`vendor/pixi.min.mjs` ist [PixiJS](https://pixijs.com/) 8.21.0, MIT-Lizenz,
Copyright (c) 2013-2023 Mathew Groves, Chad Engler. Die Datei liegt bei,
damit das Spiel auch ohne Netzzugang laeuft; `index.html` laedt sonst
dieselbe Version vom CDN. Siehe `vendor/LICENSE-pixi.txt`.

Alles andere in diesem Verzeichnis ist eigener Code ohne Abhaengigkeiten.
