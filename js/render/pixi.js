/**
 * pixi.js – Einziger Einstiegspunkt zu PixiJS.
 *
 * Primaer wird die per Importmap in index.html fest gepinnte CDN-Version
 * geladen. Ist das CDN nicht erreichbar (Offline, gesperrtes Netz), wird
 * automatisch die mitgelieferte Datei vendor/pixi.min.mjs derselben Version
 * benutzt. Alle Render-Module importieren PIXI ausschliesslich von hier.
 */

let PIXI;
let pixiSource;

try {
  PIXI = await import('pixi.js');
  pixiSource = 'cdn';
} catch {
  PIXI = await import('../../vendor/pixi.min.mjs');
  pixiSource = 'vendor';
}

export { PIXI, pixiSource };
