// Pure game logic, shared by the browser app and the node checks: no DOM here.
import { Chess } from "../vendor/chess.js";

export const DRAWS = new Set(["agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"]);
export const scoreOf = (result) => (result === "win" ? 1 : DRAWS.has(result) ? 0.5 : 0);
export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1);
export const MATE = 10000;
export const cpFromUci = (kind, n) => (kind === "cp" ? n : n > 0 ? MATE - n : -MATE - n);

// chess.com PGNs write every move as `SAN {[%clk 0:02:59.9]}`
export function parsePgn(pgn) {
  const body = pgn.replace(/^\[.*\]\s*$/gm, "");
  const moves = [], clocks = [];
  const re = /(?:^|\s)(?:\d+\.(?:\.\.)?\s*)?([^\s{}]+?)\s*(?:\{([^}]*)\})?(?=\s|$)/g;
  for (const m of body.matchAll(re)) {
    const tok = m[1];
    if (!tok || /^\d+\.+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok)) continue;
    moves.push(tok);
    const c = m[2] && m[2].match(/%clk (\d+):(\d+):([\d.]+)/);
    clocks.push(c ? +c[1] * 3600 + +c[2] * 60 + +c[3] : null);
  }
  return { moves, clocks };
}

export function baseSeconds(control) {
  const b = parseInt(String(control).split("+")[0].split("/").pop(), 10);
  return Number.isFinite(b) ? b : 0;
}

export function phaseOf(chess, ply) {
  if (ply <= 24) return "opening";
  let pieces = 0;
  for (const row of chess.board()) for (const c of row) if (c && c.type !== "p" && c.type !== "k") pieces++;
  return pieces <= 6 ? "endgame" : "middlegame";
}

// Walk a chess.com game, ask the engine about every position, and keep what the report needs about the player's own moves.
// evaluate(fen) -> {cp, best, pv}, cp from the side to move.
export async function analyseGame(game, me, evaluate) {
  const myColor = game.white.username.toLowerCase() === me.toLowerCase() ? "w" : "b";
  const { moves: sans, clocks } = parsePgn(game.pgn);
  const chess = new Chess(game.initial_setup || undefined);
  const fens = [chess.fen()], phases = [], san = [], uci = [];
  for (let i = 0; i < sans.length; i++) {
    phases.push(phaseOf(chess, i + 1));
    let m;
    try { m = chess.move(sans[i]); } catch { break; }
    san.push(m.san); uci.push(m.from + m.to + (m.promotion || ""));
    fens.push(chess.fen());
  }
  const mine = (cpStm, fen) => (fen.split(" ")[1] === myColor ? cpStm : -cpStm);
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    if (c.isCheckmate()) { evals.push({ cp: c.turn() === myColor ? -MATE : MATE, best: null }); continue; }
    if (c.isGameOver()) { evals.push({ cp: 0, best: null }); continue; }
    const r = await evaluate(fens[i]);
    evals.push({ cp: mine(r.cp ?? 0, fens[i]), best: r.best });
  }
  const meSide = myColor === "w" ? game.white : game.black, op = myColor === "w" ? game.black : game.white;
  const moves = [];
  for (let i = 0; i < san.length; i++) {
    const moverIsMe = (fens[i].split(" ")[1]) === myColor;
    if (!moverIsMe) continue;
    moves.push({
      ply: i + 1, san: san[i], uci: uci[i], phase: phases[i],
      before: evals[i].cp, after: evals[i + 1].cp,
      drop: Math.round((winPct(evals[i].cp) - winPct(evals[i + 1].cp)) * 10) / 10,
      best: evals[i].best, clk: clocks[i] ?? null,
    });
  }
  return {
    url: game.url, end: game.end_time, tc: game.time_class, control: game.time_control, base: baseSeconds(game.time_control),
    color: myColor === "w" ? "white" : "black", result: meSide.result, opResult: op.result,
    myRating: meSide.rating, op: op.username, opRating: op.rating,
    eco: (game.eco || "").split("/").pop(), start: game.initial_setup || null,
    san, clocks, moves,
  };
}

const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const pct = (xs) => (xs.length ? (100 * mean(xs)) : null);

export function openingName(eco, words = 2) {
  return eco.split("-").filter((w) => !/^\d|^[A-Z]\d/.test(w)).slice(0, words).join(" ").replace(/s /, "'s ").trim() || "Other";
}

// Everything the report shows, from analysed games of one time class, oldest first.
export function buildStats(games) {
  const G = [...games].sort((a, b) => a.end - b.end).filter((g) => g.moves.length >= 5);
  const S = (g) => scoreOf(g.result);
  const out = { n: G.length };
  if (!G.length) return out;
  out.w = G.filter((g) => S(g) === 1).length; out.d = G.filter((g) => S(g) === 0.5).length; out.l = G.length - out.w - out.d;
  out.score = pct(G.map(S));
  out.ratingFirst = G[0].myRating; out.ratingLast = G[G.length - 1].myRating; out.ratingPeak = Math.max(...G.map((g) => g.myRating));
  const weeks = new Map();
  for (const g of G) weeks.set(Math.floor(g.end / 604800), g.myRating);
  out.weekly = [...weeks.values()];
  out.from = G[0].end; out.to = G[G.length - 1].end;
  out.base = median(G.map((g) => g.base));

  const won = G.filter((g) => g.moves.some((m) => m.after >= 300));
  out.winning = won.length;
  out.converted = won.filter((g) => S(g) === 1).length;
  out.wonDrawn = won.filter((g) => S(g) === 0.5).length;
  out.thrown = won.filter((g) => S(g) === 0).length;
  out.thrownOnTime = won.filter((g) => S(g) === 0 && g.result === "timeout").length;
  out.timeouts = G.filter((g) => g.result === "timeout").length;
  out.flaggedAhead = G.filter((g) => g.result === "timeout" && g.moves.length && g.moves[g.moves.length - 1].after >= 200).length;

  const clkAt = (g, move) => { const m = g.moves.find((x) => x.ply >= move * 2 - 1 && x.clk != null); return m ? m.clk : null; };
  const c20 = (gs) => median(gs.map((g) => clkAt(g, 20)).filter((x) => x != null));
  out.clk20Wins = c20(G.filter((g) => S(g) === 1));
  out.clk20Flagged = c20(G.filter((g) => g.result === "timeout"));

  const per = (pred) => { let n = 0, b = 0; for (const g of G) for (const m of g.moves) if (pred(m, g)) { n++; if (m.drop >= 30) b++; } return n ? (100 * b) / n : null; };
  out.phase = { opening: per((m) => m.phase === "opening"), middlegame: per((m) => m.phase === "middlegame"), endgame: per((m) => m.phase === "endgame") };
  out.clockRate = {
    plenty: per((m, g) => m.clk != null && g.base && m.clk / g.base > 0.25),
    low: per((m, g) => m.clk != null && g.base && m.clk / g.base < 0.1),
  };

  const ops = new Map();
  for (const g of G) {
    const k = g.color + "|" + openingName(g.eco);
    if (!ops.has(k)) ops.set(k, []);
    ops.get(k).push(g);
  }
  const minN = Math.max(5, Math.round(G.length * 0.02));
  out.openings = [...ops.entries()].filter(([, v]) => v.length >= minN)
    .map(([k, v]) => ({ color: k.split("|")[0], name: k.split("|")[1], n: v.length, score: pct(v.map(S)), eco: v[0].eco }))
    .sort((a, b) => a.score - b.score);
  out.byColor = { white: pct(G.filter((g) => g.color === "white").map(S)), black: pct(G.filter((g) => g.color === "black").map(S)) };

  const days = new Map();
  for (const g of G) { const d = new Date(g.end * 1000).toDateString(); if (!days.has(d)) days.set(d, []); days.get(d).push(g); }
  const afterWin = [], afterLoss = [], after2 = [];
  for (const rs of days.values()) rs.forEach((g, i) => {
    if (!i) return;
    (S(rs[i - 1]) === 1 ? afterWin : S(rs[i - 1]) === 0 ? afterLoss : []).push(S(g));
    if (i > 1 && S(rs[i - 1]) === 0 && S(rs[i - 2]) === 0) after2.push(S(g));
  });
  out.tilt = { afterWin: pct(afterWin), afterLoss: pct(afterLoss), after2: pct(after2), n2: after2.length };
  out.bigDays = [...days.values()].filter((v) => v.length >= 20).length;
  out.last16 = G.slice(-16).map((g) => (S(g) === 1 ? "W" : S(g) === 0.5 ? "D" : "L"));

  const bl = [];
  for (const g of G) for (const m of g.moves) if (m.before >= 150 && m.after <= -300 && Math.abs(m.before) < 5000 && Math.abs(m.after) < 5000) bl.push({ g, m });
  bl.sort((a, b) => (b.m.before - b.m.after) - (a.m.before - a.m.after));
  const seen = new Set();
  out.blunders = bl.filter(({ g }) => !seen.has(g.url) && seen.add(g.url)).slice(0, 3);

  // the #1 leak: the habit that cost the most games
  const leaks = [
    { key: "clock", games: out.thrownOnTime },
    { key: "thrown", games: out.thrown - out.thrownOnTime },
  ];
  out.leak = leaks.sort((a, b) => b.games - a.games)[0].key;
  return out;
}

export { median, mean };
