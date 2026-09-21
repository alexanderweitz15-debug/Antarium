/**
 * rng.js – Seedbarer Zufall.
 *
 * Gleicher Seed + gleiche Eingaben = gleiche Simulation. Es wird NIRGENDWO
 * Math.random() benutzt. Jedes System zieht seinen Strom aus einem Fork des
 * Welt-RNG, damit z.B. das Zeichnen von Sprites die Simulation nicht
 * verschiebt.
 */

/** xmur3 – String -> 32-Bit-Seedfolge. */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function next() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** sfc32 – schneller, gut verteilter 32-Bit-Generator. */
function sfc32(a, b, c, d) {
  return function rand() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export class RNG {
  /** @param {string|number} seed */
  constructor(seed) {
    this.seed = String(seed);
    const h = xmur3(this.seed);
    this._next = sfc32(h(), h(), h(), h());
    this._gaussSpare = NaN;
    // Kurzes Aufwaermen: die ersten Werte von sfc32 korrelieren leicht.
    for (let i = 0; i < 12; i++) this._next();
  }

  /** Neuer, unabhaengiger Strom mit stabilem Namen. */
  fork(tag) {
    return new RNG(this.seed + '/' + tag);
  }

  /** [0,1) */
  float() { return this._next(); }

  /** [min,max) */
  range(min, max) { return min + this._next() * (max - min); }

  /** Ganzzahl [0,n) */
  int(n) { return (this._next() * n) | 0; }

  /** Ganzzahl [min,max] inklusive. */
  intRange(min, max) { return min + ((this._next() * (max - min + 1)) | 0); }

  /** true mit Wahrscheinlichkeit p. */
  chance(p) { return this._next() < p; }

  /** Element aus einem Array. */
  pick(arr) { return arr[(this._next() * arr.length) | 0]; }

  /** Winkel in [0, 2pi). */
  angle() { return this._next() * Math.PI * 2; }

  /** Normalverteilung (Box-Muller, mit Zwischenspeicher). Fuer Phase 8. */
  gauss(mu = 0, sigma = 1) {
    if (!Number.isNaN(this._gaussSpare)) {
      const v = this._gaussSpare;
      this._gaussSpare = NaN;
      return mu + sigma * v;
    }
    let u = 0, v = 0, s = 0;
    do {
      u = this._next() * 2 - 1;
      v = this._next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const f = Math.sqrt((-2 * Math.log(s)) / s);
    this._gaussSpare = v * f;
    return mu + sigma * (u * f);
  }
}

// ---------------------------------------------------------------------------
// Deterministisches Wertrauschen (fuer Weltgenerierung und Texturvariation).
// Keine Objekte, keine Allokationen – reine Integerhashes.
// ---------------------------------------------------------------------------

/** 2D-Integerhash -> [0,1). */
export function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 2D-Integerhash -> vorzeichenlose 32-Bit-Zahl (fuer Bitmuster). */
export function hash2i(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2654435761) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h >>> 0;
}

function smooth(t) { return t * t * (3 - 2 * t); }

/** Wertrauschen mit glatter Interpolation, Ergebnis in [-1,1]. */
export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return (top + (bot - top) * fy) * 2 - 1;
}

/** Fraktales Wertrauschen (fBm) mit octaves Oktaven, Ergebnis ca. in [-1,1]. */
export function fbm(x, y, seed, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}
