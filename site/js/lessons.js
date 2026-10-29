// Turns a player's analysed games into move-by-move lessons. Pure: the engine comes in as evaluate(fen, nodes).
import { Chess } from "../vendor/chess.js";
import { scoreOf, MATE } from "./core.js";

const START = new Chess().fen();
const DEEP = 250000;

export const moveNo = (ply) => `${Math.ceil(ply / 2)}${ply % 2 ? "." : "…"}`;
export function evalWords(cp) {
  if (Math.abs(cp) >= MATE - 100) return cp > 0 ? "forced mate for you" : "forced mate against you";
  return (cp >= 0 ? "+" : "−") + (Math.abs(cp) / 100).toFixed(1);
}
const clockTxt = (s) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const dateTxt = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const RESULT = { win: "You won", timeout: "You lost on time", resigned: "You resigned", checkmated: "You got checkmated", abandoned: "You abandoned" };
export function gameInfo(g) {
  return { me: g.color, myR: g.myRating, op: g.op, opR: g.opRating, date: dateTxt(g.end), base: g.base, clk: g.clocks, url: g.url,
    res: RESULT[g.result] || (scoreOf(g.result) === 0.5 ? "Draw" : "You lost") };
}
function fenAt(g, plies) {
  const c = new Chess(g.start || undefined);
  for (let i = 0; i < plies; i++) c.move(g.san[i]);
  return c.fen();
}
function uciLine(fen, pv, max) {
  const c = new Chess(fen), out = [];
  for (const u of (pv || "").split(" ").filter(Boolean).slice(0, max)) {
    try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }).san); } catch { break; }
  }
  return out;
}
// eval from the player's side, whoever is to move
const mineCp = (r, fen, color) => ((fen.split(" ")[1] === (color === "white" ? "w" : "b")) ? r.cp : -r.cp);

export async function blundersLesson(stats, games, evaluate) {
  if (!stats.blunders.length) return null;
  const steps = [];
  let checks = 0;
  for (const [i, { g, m }] of stats.blunders.entries()) {
    const info = gameInfo(g), before = fenAt(g, m.ply - 1), side = g.color;
    const after = new Chess(before); after.move(m.san);
    const rep = after.isGameOver() ? null : await evaluate(after.fen(), DEEP);
    const reply = rep ? uciLine(after.fen(), rep.pv, 1)[0] : null;
    const deep = await evaluate(before, DEEP);
    const better = uciLine(before, deep.pv, 3);
    const replyCaptures = reply && reply.includes("x") && reply.replace(/[+#]/g, "").endsWith(m.uci.slice(2, 4));
    const wasCheck = m.san.includes("+");
    if (wasCheck && replyCaptures) checks++;
    steps.push({
      start: before, moves: "", game: info, name: `Blunder ${i + 1}: ${evalWords(m.before)}`, stat: `${evalWords(m.before)} for you`,
      body: `You're ${side} and winning here. Before you look at your move: what is attacked, and what can you take?`,
    });
    steps.push({
      moves: [m.san, reply].filter(Boolean).join(" "), game: info, tone: "bad", link: g.url,
      name: `${moveNo(m.ply)}${m.san}??${reply ? ` ${moveNo(m.ply + 1)}${reply}` : ""}`, stat: `${evalWords(m.before)} → ${evalWords(m.after)}`,
      body: wasCheck && replyCaptures ? `You gave a check, and the checking piece just got taken with ${reply}. A check is only good if the piece giving it is safe.`
        : reply && reply.includes("x") ? `This lets ${info.op} play ${reply}, and the game turns.`
        : reply ? `${info.op} answers ${reply}, and your advantage is gone.` : "This throws the game away.",
    });
    const b0 = better[0] || "";
    steps.push({
      start: before, moves: better.join(" "), game: info, alt: true, tone: "good", name: `Better: ${moveNo(m.ply)}${b0}!`,
      stat: `Engine: ${evalWords(mineCp(deep, before, side))}`,
      body: (b0.includes("x") ? `Take on ${b0.replace(/[+#]/g, "").slice(-2)} instead.` : b0.includes("+") ? `${b0} is a check that actually works.` : `${b0} is the move.`)
        + ` The engine keeps you at ${evalWords(mineCp(deep, before, side))}. Ask Claude why if it isn't clear.`,
    });
  }
  steps[steps.length - 1].rule = checks >= 2
    ? `${checks} of these were checks that lost the piece giving check. Before every move: checks, captures, threats, for you and for them.`
    : "Before every move, three questions in this order: checks, captures, threats, for you and for them.";
  return { key: "captures", title: `Your ${stats.blunders.length} biggest blunders`, flip: stats.blunders[0].g.color === "black", steps };
}

export async function flaggedLesson(games, evaluate) {
  const cands = games.filter((g) => g.result === "timeout" && g.moves.length >= 8 && g.moves[g.moves.length - 1].after >= 300);
  if (!cands.length) return null;
  const g = cands.sort((a, b) => b.moves[b.moves.length - 1].after - a.moves[a.moves.length - 1].after)[0];
  const info = gameInfo(g), side = g.color;
  // the longest think while clearly winning
  let k = -1, spent = 0;
  g.moves.forEach((m, i) => {
    const prev = i ? g.moves[i - 1].clk : g.base;
    const s = prev != null && m.clk != null ? prev - m.clk : 0;
    if (m.before >= 300 && s > spent) { spent = s; k = i; }
  });
  if (k < 0) k = g.moves.findIndex((m) => m.before >= 300);
  const km = g.moves[k], fen0 = fenAt(g, km.ply - 1), clockThen = k ? g.moves[k - 1].clk : g.base;
  const steps = [{
    start: fen0, moves: "", game: info, name: `Move ${Math.ceil(km.ply / 2)}: you're winning`, stat: `${evalWords(km.before)} · ${clockTxt(clockThen)} on your clock`,
    body: "You're clearly winning. The only way to lose this game is the clock.",
  }];
  const rest = g.san.slice(km.ply - 1);
  const chunks = [];
  for (let i = 0; i < rest.length; i += 12) chunks.push([i, rest.slice(i, i + 12)]);
  const show = chunks.length > 3 ? [chunks[0], chunks[chunks.length - 2], chunks[chunks.length - 1]] : chunks;
  show.forEach(([off, mv], j) => {
    const ply0 = km.ply - 1 + off, last = j === show.length - 1;
    const checks = mv.filter((s, x) => (ply0 + x) % 2 === (side === "white" ? 0 : 1) && s.includes("+")).length;
    const myClk = g.clocks[Math.min(g.clocks.length, ply0 + mv.length) - 1];
    steps.push({
      start: j && show[j - 1][0] + show[j - 1][1].length !== off ? fenAt(g, ply0) : undefined,
      moves: mv.join(" "), game: info, tone: "bad", link: last ? g.url : undefined,
      name: j === 0 ? `You thought ${Math.round(spent)} seconds` : last ? "Flag" : "The clock keeps running",
      stat: last ? "You lost on time" : checks ? `${checks} checks in these moves` : undefined,
      body: j === 0 ? `You spent ${Math.round(spent)} seconds on ${km.san}. In ${g.base / 60}-minute chess that's a lot, and the position was already won.`
        : last ? `You were still winning (${evalWords(g.moves[g.moves.length - 1].after)}) when your flag fell.`
        : `Your clock is down to about ${clockTxt(myClk)}.${checks ? ` ${checks} of your moves here were checks that didn't win anything.` : ""}`,
    });
  });
  const deep = await evaluate(fen0, DEEP), line = uciLine(fen0, deep.pv, 2);
  steps.push({
    start: fen0, moves: line.join(" "), game: info, alt: true, tone: "good", name: `Better: ${moveNo(km.ply)}${line[0]}!`, stat: `Engine: ${evalWords(mineCp(deep, fen0, side))}`,
    body: `Back to the moment you thought for ${Math.round(spent)} seconds. ${line[0]} is the engine's move, and a simple safe move played in 2 seconds would have kept the win too.`,
  });
  steps.push({
    start: fen0, moves: "", game: info, alt: true, tone: "good", name: "The rule",
    rule: "Clearly winning? Make the safe move fast: castle, trade queens, push a pawn. A check is only good if it wins something.",
    body: "In fast games, a simple move in 2 seconds beats the best move in 30.",
  });
  return { key: "clock", title: "Won, then flagged", flip: side === "black", steps };
}

export async function openingLesson(games, evaluate) {
  let worst = null;
  for (const color of ["white", "black"]) {
    const gs = games.filter((g) => g.color === color && !g.start && g.san.length >= 10);
    const tree = new Map();
    for (const g of gs) for (let k = 2; k <= 8; k++) {
      const key = g.san.slice(0, k).join(" ");
      if (!tree.has(key)) tree.set(key, []);
      tree.get(key).push(g);
    }
    for (const [key, v] of tree) {
      if (v.length < 5) continue;
      const score = (100 * v.reduce((a, g) => a + scoreOf(g.result), 0)) / v.length;
      if (score <= 40 && (!worst || score < worst.score || (score === worst.score && v.length > worst.n))) worst = { key, color, n: v.length, score, games: v };
    }
  }
  if (!worst) return null;
  // the mistake the player makes most often after reaching that line
  const k = worst.key.split(" ").length, hits = new Map();
  for (const g of worst.games) {
    const m = g.moves.find((x) => x.ply > k - 2 && x.ply <= 20 && x.drop >= 10);
    if (!m) continue;
    const id = g.san.slice(0, m.ply).join(" ");
    hits.set(id, (hits.get(id) || 0) + 1);
  }
  const top = [...hits.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const line = top[0].split(" "), mistake = line.pop(), ply = line.length + 1;
  const fen = new Chess(); for (const s of line) fen.move(s);
  const before = fen.fen(), deep = await evaluate(before, DEEP), better = uciLine(before, deep.pv, 3);
  const after = new Chess(before); after.move(mistake);
  const rep = await evaluate(after.fen(), DEEP), punish = uciLine(after.fen(), rep.pv, 1);
  const name = (games.find((g) => g.san.slice(0, line.length).join(" ") === line.join(" ")) || {}).eco || "";
  const opening = name.split("-").slice(0, 3).join(" ") || "This line";
  return {
    key: "opening", title: `Your ${opening}`, flip: worst.color === "black",
    steps: [
      { start: START, moves: line.join(" "), name: opening, stat: `${worst.n} games · ${Math.round(worst.score)}%`,
        body: `You've reached this line ${worst.n} times as ${worst.color} and scored ${Math.round(worst.score)}%. The problem is usually one move.` },
      { moves: [mistake, ...punish].join(" "), tone: "bad", name: `${moveNo(ply)}${mistake}?`, stat: `You played this in ${top[1]} games`,
        body: `This is the move you keep playing here.${punish[0] ? ` After ${punish[0]} your position is worse than it should be.` : ""}` },
      { start: before, alt: true, moves: better.join(" "), tone: "good", name: `Better: ${moveNo(ply)}${better[0]}!`, stat: `Engine: ${evalWords(mineCp(deep, before, worst.color))}`,
        rule: `In this line, play ${better[0]} instead of ${mistake}. Try it on the board, then ask Claude what the idea is.`,
        body: `${better[0]} is the engine's choice here. Try your own moves on the board to see why ${mistake} is worse.` },
    ],
  };
}

// Kinds of costly move we can spot from the game record alone. The next ply is what the opponent actually played.
const HABITS = [
  { key: "check", what: "giving a check that just loses the checking piece", rule: "A check is only good if the piece giving it is safe.",
    test: (g, m) => m.san.includes("+") && (g.san[m.ply] || "").includes("x") && g.san[m.ply].replace(/[+#]/g, "").endsWith(m.uci.slice(2, 4)) },
  { key: "clock", what: "a big mistake with under 10% of your clock left", rule: "Low on time? Play the safe, simple move fast. Don't start calculating.",
    test: (g, m) => m.clk != null && g.base > 0 && m.clk / g.base < 0.1 },
  { key: "taken", what: "a move that lets your opponent take something straight away", rule: "Before every move, three questions in this order: checks, captures, threats, for you and for them.",
    test: (g, m) => (g.san[m.ply] || "").includes("x") },
];
const BIG = 20;

// One game as a lesson: replay to each of the player's worst moves, show what happened and what was better,
// and if the worst one is a kind the player keeps making in `history` (their other analysed games), say so.
export async function gameLesson(g, history, evaluate) {
  const info = gameInfo(g), side = g.color;
  const worst = g.moves.filter((m) => m.drop >= 10).sort((a, b) => b.drop - a.drop).slice(0, 3).sort((a, b) => a.ply - b.ply);
  const steps = [{
    start: g.start || START, moves: g.san.slice(0, worst.length ? worst[0].ply - 1 : g.san.length).join(" "), game: info,
    name: `Your game vs ${info.op}`, stat: info.res,
    body: !worst.length ? "No real mistakes in this one: the engine has nothing to teach you here. Try your own ideas on the board."
      : worst.length === 1 ? "One move decided this game. Let's go to it." : `${worst.length} moves decided this game. Let's go through them.`,
  }];
  for (const m of worst) {
    const before = fenAt(g, m.ply - 1), after = new Chess(before); after.move(m.san);
    const rep = after.isGameOver() ? null : await evaluate(after.fen(), DEEP);
    const reply = rep ? uciLine(after.fen(), rep.pv, 1)[0] : null;
    const deep = await evaluate(before, DEEP), better = uciLine(before, deep.pv, 3), b0 = better[0] || "";
    const [kind, sym] = m.drop >= 30 ? ["Blunder", "??"] : m.drop >= BIG ? ["Mistake", "?"] : ["Inaccuracy", "?!"];
    steps.push({ start: before, moves: "", game: info, name: `${kind}: move ${Math.ceil(m.ply / 2)}`, stat: `${evalWords(m.before)} for you`,
      body: "Before you look at your move: what is attacked, and what can you take?" });
    steps.push({
      moves: [m.san, reply].filter(Boolean).join(" "), game: info, tone: "bad", link: g.url,
      name: `${moveNo(m.ply)}${m.san}${sym}${reply ? ` ${moveNo(m.ply + 1)}${reply}` : ""}`, stat: `${evalWords(m.before)} → ${evalWords(m.after)}`,
      body: reply && reply.includes("x") ? `This lets ${info.op} play ${reply}.` : reply ? `Best answer: ${reply}, and your position gets worse.` : "This throws the game away.",
    });
    if (b0) steps.push({
      start: before, moves: better.join(" "), game: info, alt: true, tone: "good", name: `Better: ${moveNo(m.ply)}${b0}!`,
      stat: `Engine: ${evalWords(mineCp(deep, before, side))}`, body: `${b0} is the move here. Try your own moves on the board, and ask Claude why if it isn't clear.`,
    });
  }
  const last = steps[steps.length - 1], top = [...worst].sort((a, b) => b.drop - a.drop)[0];
  const H = history.filter((h) => h.url !== g.url && h.tc === g.tc && h.moves.length >= 5);
  const habit = top && top.drop >= BIG && HABITS.find((k) => k.test(g, top));
  if (worst.length) last.rule = HABITS[2].rule;
  if (habit && H.length) {
    const hits = H.filter((h) => h.moves.some((m) => m.drop >= BIG && habit.test(h, m))).sort((a, b) => b.end - a.end);
    if (hits.length >= 3) steps.push({
      start: fenAt(g, top.ply - 1), moves: "", game: info, tone: "bad", link: hits[0].url, name: "This one is a habit",
      stat: `${hits.length} of your last ${H.length} ${g.tc} games`,
      body: `Move ${Math.ceil(top.ply / 2)} was ${habit.what}. You've done that in ${hits.length} of your last ${H.length} ${g.tc} games. The link shows the most recent one.`,
      rule: habit.rule,
    });
    else last.rule = habit.rule;
  }
  return { key: "game", title: "Game review", flip: side === "black", steps };
}

export async function buildLessons(stats, games, evaluate) {
  const out = [];
  for (const make of [() => flaggedLesson(games, evaluate), () => blundersLesson(stats, games, evaluate), () => openingLesson(games, evaluate)]) {
    try { const l = await make(); if (l) out.push(l); } catch (e) { console.warn("lesson skipped", e); }
  }
  return out;
}
