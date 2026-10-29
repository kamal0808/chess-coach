// Runs the browser's analysis code in node on real games and checks it against known results.
// usage: node test/check.mjs <dir of chess.com monthly JSON> <username> [games] [reference.jsonl]
import fs from "node:fs";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { analyseGame, buildStats, parsePgn, cpFromUci, openingName } from "../site/js/core.js";

const require = createRequire(import.meta.url);
const [dir, me, count = "20", ref] = process.argv.slice(2);

// parser self-checks
const p = parsePgn('[Event "x"]\n\n1. e4 {[%clk 0:02:59.9]} 1... d5 {[%clk 0:02:58.1]} 2. exd5 {[%clk 0:02:57]} 1-0');
assert.deepEqual(p.moves, ["e4", "d5", "exd5"]);
assert.deepEqual(p.clocks, [179.9, 178.1, 177]);
assert.equal(openingName("Scandinavian-Defense-Mieses-Kotrc-Variation-3...Qd8"), "Scandinavian Defense");
assert.equal(openingName("Kings-Pawn-Opening-Wayward-Queen-Attack"), "King's Pawn");

const sf = require("stockfish")("lite-single");
let pending = null, score = null, pv = "";
sf.listener = (line) => {
  const m = line.match(/score (cp|mate) (-?\d+)/); if (m) score = cpFromUci(m[1], +m[2]);
  const q = line.match(/ pv (.+)$/); if (q) pv = q[1];
  if (line.startsWith("bestmove") && pending) { const r = pending; pending = null; r({ cp: score, best: line.split(" ")[1], pv }); }
};
sf.processCommand("uci");
const evaluate = (fen) => new Promise((res) => { pending = res; score = null; pv = ""; sf.processCommand("position fen " + fen); sf.processCommand("go nodes 15000"); });

const games = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).flatMap((f) => JSON.parse(fs.readFileSync(dir + "/" + f)).games || [])
  .filter((g) => g.rules === "chess" && g.time_class === "blitz" && g.pgn).sort((a, b) => b.end_time - a.end_time).slice(0, +count);
const t0 = Date.now(), out = [];
for (const g of games) out.push(await analyseGame(g, me, evaluate));
const secs = (Date.now() - t0) / 1000;
console.log(`${out.length} games in ${secs.toFixed(1)}s (${(secs / out.length).toFixed(2)}s/game, 1 thread)`);

for (const g of out) assert.ok(g.moves.length > 0 && g.moves.every((m) => Number.isFinite(m.drop)), g.url);

if (ref) {
  const R = new Map(fs.readFileSync(ref, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((r) => [r.url, r]));
  let agree = 0, n = 0;
  for (const g of out) {
    const r = R.get(g.url); if (!r) continue;
    const a = g.moves.filter((m) => m.drop >= 30).length, b = r.moves.filter((m) => m.drop >= 30).length;
    n++; if (Math.abs(a - b) <= 1) agree++;
  }
  console.log(`blunder count within 1 of the python run: ${agree}/${n} games`);
}
const s = buildStats(out);
console.log(JSON.stringify({ n: s.n, score: s.score?.toFixed(1), winning: s.winning, thrown: s.thrown, onTime: s.thrownOnTime, leak: s.leak, clk20: [s.clk20Wins, s.clk20Flagged], phase: s.phase, openings: s.openings.slice(0, 3), blunders: s.blunders.map((b) => b.g.url) }, null, 1));
const evalNodes = (fen, nodes) => new Promise((res) => { pending = res; score = null; pv = ""; sf.processCommand("position fen " + fen); sf.processCommand("go nodes " + nodes); });
const { buildLessons, gameLesson } = await import("../site/js/lessons.js");
const { Chess } = await import("../site/vendor/chess.js");
const lessons = await buildLessons(s, out, evalNodes);
for (const g of out.slice(0, 5)) lessons.push(await gameLesson(g, out, evalNodes), await gameLesson(g, [], evalNodes));
for (const L of lessons) {
  const c = new Chess();
  for (const st of L.steps) {
    if (st.start) c.load(st.start);
    for (const m of st.moves.split(" ").filter(Boolean)) c.move(m); // throws on an illegal move
    assert.ok(st.name && st.body, L.title);
  }
  console.log(`lesson "${L.title}": ${L.steps.length} steps:`, L.steps.map((x) => x.name).join(" | "));
}
sf.terminate?.();
process.exit(0);
