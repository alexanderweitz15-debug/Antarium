/**
 * fx.js – Kennungen der Anzeige-Effekte.
 *
 * Liegt bewusst in sim/, obwohl nur der Renderer die Teilchen zeichnet: die
 * Simulation muss die Kennungen benennen koennen, ohne ein Render-Modul zu
 * importieren (sonst liefe sie headless nicht mehr).
 */
export const FX = {
  DUST: 0,    // Erde: Graben, Einsturz, Krater
  SPARK: 1,   // Funken: Blitz, Feuer, Sprengung
  SPLASH: 2,  // Wasser: Flut, Regen
  GORE: 3,    // Kampf: Bisse, Tod
  LEAF: 4,    // Pflanzenreste: Abweiden, Brand
};
