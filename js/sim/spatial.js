/**
 * spatial.js – Spatial Hash pro Ebene.
 *
 * Gitter aus Buckets ueber der Ebene. Wird jeden Tick komplett neu gefuellt
 * (O(n), keine Allokation): head[] zeigt auf den ersten Eintrag eines
 * Buckets, next[] verkettet die weiteren. Entitaeten werden ueber ihren
 * Index adressiert.
 */

export class SpatialHash {
  /**
   * @param {number} w Breite der Ebene in Zellen
   * @param {number} h Hoehe der Ebene in Zellen
   * @param {number} bucketCells Kantenlaenge eines Buckets in Zellen
   * @param {number} capacity maximale Entitaetsanzahl
   */
  constructor(w, h, bucketCells, capacity) {
    this.bucket = bucketCells;
    this.cols = Math.ceil(w / bucketCells);
    this.rows = Math.ceil(h / bucketCells);
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
    this.count = 0;
  }

  clear() {
    this.head.fill(-1);
    this.count = 0;
  }

  /** Entitaet mit Index id an Zellposition (x,y) einsortieren. */
  insert(id, x, y) {
    let bx = (x / this.bucket) | 0;
    let by = (y / this.bucket) | 0;
    if (bx < 0) bx = 0; else if (bx >= this.cols) bx = this.cols - 1;
    if (by < 0) by = 0; else if (by >= this.rows) by = this.rows - 1;
    const b = by * this.cols + bx;
    this.next[id] = this.head[b];
    this.head[b] = id;
    this.count++;
  }

  /**
   * Alle Entitaeten im Umkreis r (Zellen) um (x,y) besuchen.
   * @param {(id:number)=>void} cb
   */
  query(x, y, r, cb) {
    const b = this.bucket;
    let x0 = (((x - r) / b) | 0), x1 = (((x + r) / b) | 0);
    let y0 = (((y - r) / b) | 0), y1 = (((y + r) / b) | 0);
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1;
    if (y1 >= this.rows) y1 = this.rows - 1;
    for (let by = y0; by <= y1; by++) {
      const row = by * this.cols;
      for (let bx = x0; bx <= x1; bx++) {
        let id = this.head[row + bx];
        while (id !== -1) {
          cb(id);
          id = this.next[id];
        }
      }
    }
  }
}
