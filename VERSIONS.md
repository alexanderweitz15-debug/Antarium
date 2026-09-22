# Versionen und Rollback-Punkte

Jede Zeile nennt einen Stand, auf den zurueckgesetzt werden kann. Der
Commit ist die Wahrheit – lokale Tags existieren zusaetzlich, lassen sich
in dieser Umgebung aber nicht zum Server schieben.

| Version | Commit | Stand |
|---|---|---|
| 1.0.0 | `b0433e6` | Alle zehn Phasen fertig. 24/24 headless, 36/36 Browser. Elf Kreaturenarten, 24 goettliche Eingriffe, Tag/Nacht, Speichern und Laden bitgenau. |
| 1.1.0 | `b7ce794` | Phase 11: 61 Eigenschaften, Diplomatie mit Kriegsduft, fuenf Materialien, sechs Bauwerke in drei Stufen, Forschungsbaum, Massentest. Speicherformat **Version 2** – Staende aus 1.0.0 werden abgelehnt, nicht falsch geladen. |
| 1.2.0 | (dieser Commit) | Blattlaus-Bewachung, Buendnisse mit Wirkung (Beistand und Nahrungsteilung), mehrere Stockwerke je Volk mit Abstiegsschacht. Grabzustand liegt jetzt je Ebene (`colony.digByLevel`) – Speicherformat bleibt Version 2, alte Staende laden weiter. 42/42 Pruefungen. |

## Zurueckrollen

```bash
# Stand ansehen, ohne etwas zu aendern
git show b0433e6 --stat

# Einzelne Datei zurueckholen
git checkout b0433e6 -- antsim/js/sim/creatures.js

# Den ganzen Ordner auf 1.0.0 zuruecksetzen (Arbeitsstand geht verloren)
git checkout b0433e6 -- antsim/

# Als neuer Commit obendrauf, ohne Verlauf zu verbiegen
git revert --no-commit <spaetere-commits> && git commit
```

Die Speicherstaende (`saveVersion` in `js/sim/save.js`) sind **nicht**
versionsuebergreifend lesbar. Wird das Format geaendert, steigt die Nummer
und aeltere Staende werden mit einer klaren Meldung abgelehnt, statt
falsch geladen zu werden.

## Vor jedem groesseren Umbau

```bash
node test/sim-bench.mjs            # Simulation, muss vollstaendig gruen sein
node test/fuzz.mjs 200 20000       # Massentest, sucht Abstuerze und Balancebrueche
npx serve -l 8123 . &               # dann:
node test/browser-check.mjs        # Oberflaeche im echten Browser
```

Der Massentest ist der wichtigste: er hat in dieser Phase vier
Balanceprobleme gefunden, die in Einzelpartien nicht auffielen.
