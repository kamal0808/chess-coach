// Stockfish 19 lite (single-threaded WASM) in web workers: one per core for the bulk analysis, one for the board.
import { cpFromUci } from "./core.js";

export class Engine {
  constructor() {
    this.w = new Worker(new URL("../engine/stockfish-19-lite-single.js", import.meta.url));
    this.q = Promise.resolve();
    this.w.postMessage("uci");
  }
  // cp is from the side to move; stale() lets a caller drop work that is no longer wanted
  evaluate(fen, nodes = 15000, stale) {
    const run = () => new Promise((res) => {
      if (stale && stale()) return res(null);
      let cp = null, pv = "";
      this.w.onmessage = (e) => {
        const l = String(e.data);
        const m = l.match(/score (cp|mate) (-?\d+)/); if (m) cp = cpFromUci(m[1], +m[2]);
        const p = l.match(/ pv (.+)$/); if (p) pv = p[1];
        if (l.startsWith("bestmove")) res({ cp: cp ?? 0, best: l.split(" ")[1], pv });
      };
      this.w.postMessage("position fen " + fen);
      this.w.postMessage("go nodes " + nodes);
    });
    this.q = this.q.then(run);
    return this.q;
  }
  stop() { this.w.terminate(); }
}

export const poolSize = () => Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
