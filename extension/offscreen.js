// Engine facts for every move of a finished game: win chance before and after, its label, the best move and the reply it allows.
import { Chess } from "./vendor/chess.js";

const MATE = 10000, NODES = 60000, POOL = 3;
const cpFromUci = (kind, n) => (kind === "cp" ? n : n > 0 ? MATE - n : -MATE - n);
const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
// same thresholds as the Chess Coach site: drop in the mover's winning chance, no "brilliant"
const LABELS = [[2, "excellent"], [5, "good"], [10, "inaccuracy"], [20, "mistake"], [Infinity, "blunder"]];

function engine() {
  const w = new Worker("engine/stockfish-19-lite-single.js");
  w.postMessage("uci");
  return (fen) => new Promise((res) => {
    let cp = 0, pv = "";
    w.onmessage = (e) => {
      const l = String(e.data);
      const m = l.match(/score (cp|mate) (-?\d+)/); if (m) cp = cpFromUci(m[1], +m[2]);
      const p = l.match(/ pv (.+)$/); if (p) pv = p[1];
      if (l.startsWith("bestmove")) res({ cp, best: l.split(" ")[1], pv });
    };
    w.postMessage("position fen " + fen);
    w.postMessage("go nodes " + NODES);
  });
}
const sanLine = (fen, pv, max) => {
  const c = new Chess(fen), out = [];
  for (const u of (pv || "").split(" ").filter(Boolean).slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }).san); } catch { break; }
  }
  return out;
};

async function analyse(moves) {
  const c = new Chess(), fens = [c.fen()], uci = [];
  for (const m of moves) { const x = c.move(m); uci.push(x.from + x.to + (x.promotion || "")); fens.push(c.fen()); }
  const ev = new Array(fens.length), pool = Array.from({ length: POOL }, engine);
  let next = 0;
  await Promise.all(pool.map(async (run) => {
    while (next < fens.length) {
      const i = next++, g = new Chess(fens[i]);
      ev[i] = g.isCheckmate() ? { cp: -MATE, best: null, pv: "" } : g.isGameOver() ? { cp: 0, best: null, pv: "" } : await run(fens[i]);
    }
  }));
  return moves.map((san, i) => {
    const before = ev[i].cp, after = -ev[i + 1].cp, mated = after <= -(MATE - 100) && before > -(MATE - 100);
    const isBest = ev[i].best === uci[i], drop = winPct(before) - winPct(after);
    const label = isBest ? "best" : mated ? "blunder" : LABELS.find(([t]) => drop < t)[1];
    return {
      ply: i, san, label, winBefore: Math.round(winPct(before)), winAfter: Math.round(winPct(after)),
      best: isBest ? "" : sanLine(fens[i], ev[i].best, 1)[0] || "", bestLine: isBest ? "" : sanLine(fens[i], ev[i].pv, 4).join(" "),
      reply: sanLine(fens[i + 1], ev[i + 1].pv, 3).join(" "),
    };
  });
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.target !== "offscreen" || msg.type !== "analyse") return;
  analyse(msg.moves).then((facts) => reply({ facts }), (e) => reply({ error: String(e) }));
  return true;
});
