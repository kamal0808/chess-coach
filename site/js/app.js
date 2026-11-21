import { Chess } from "../vendor/chess.js";
import { analyseGame, buildStats, winPct, openingName, scoreOf } from "./core.js";
import { buildLessons, gameLesson, habitStep, moveNo, evalWords, CLS } from "./lessons.js";
import { Engine, poolSize } from "./engine.js";
import { staticBoard, LessonBoard, evalBar } from "./board.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtClock = (t) => { if (t == null) return "–"; t = Math.max(0, t); return t < 20 ? `0:${t.toFixed(1).padStart(4, "0")}` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
const ANALYSIS_VERSION = 2; // 2: per-position evals for the move-by-move review
// the report and the practice bot only need what version 1 saved, so they reuse those analyses instead of redoing every game
const cacheGetAny = async (user, url) => (await cacheGet(`${ANALYSIS_VERSION}:${user.toLowerCase()}:${url}`)) || cacheGet(`1:${user.toLowerCase()}:${url}`);

// ---------- screens ----------
function show(id) { for (const s of ["s1", "s2", "s3"]) $(s).hidden = s !== id; window.scrollTo(0, 0); }

// ---------- cache (IndexedDB, per game) ----------
const db = new Promise((res) => {
  try {
    const r = indexedDB.open("chess-coach", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("games");
    r.onsuccess = () => res(r.result); r.onerror = () => res(null);
  } catch { res(null); }
});
async function cacheGet(key) { const d = await db; if (!d) return null; return new Promise((res) => { const q = d.transaction("games").objectStore("games").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
async function cacheAll(prefix) { const d = await db; if (!d) return []; return new Promise((res) => { const q = d.transaction("games").objectStore("games").getAll(IDBKeyRange.bound(prefix, prefix + "\uffff")); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); }
async function cachePut(key, val) { const d = await db; if (!d) return; try { d.transaction("games", "readwrite").objectStore("games").put(val, key); } catch {} }

// ---------- fetching ----------
async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 404) throw new Error("not_found");
  if (!r.ok) throw new Error("http_" + r.status);
  return r.json();
}
async function fetchGames(user, range, onProgress) {
  const { archives } = await getJson(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (!archives || !archives.length) return [];
  const since = range === "3m" ? Date.now() / 1000 - 92 * 86400 : 0;
  const games = [];
  for (const url of [...archives].reverse()) {
    const { games: gs } = await getJson(url);
    const keep = (gs || []).filter((g) => g.rules === "chess" && g.pgn && ["bullet", "blitz", "rapid"].includes(g.time_class) && g.end_time >= since);
    games.push(...keep);
    onProgress(games.length);
    if (range === "3m" && gs.length && Math.min(...gs.map((g) => g.end_time)) < since) break;
    if (range === "500" && games.length >= 500) break;
  }
  games.sort((a, b) => b.end_time - a.end_time);
  return range === "500" ? games.slice(0, 500) : games;
}

// ---------- run ----------
let STATE = null;
// the player you analysed is remembered in this browser, so coming back opens your report straight away
const ME = "cc-me";
const remembered = () => { try { return JSON.parse(localStorage.getItem(ME)); } catch { return null; } };
async function run(user, range) {
  try { localStorage.setItem(ME, JSON.stringify({ u: user, r: range })); } catch {}
  show("s2");
  $("anUser").textContent = `${user} · ${{ "3m": "last 3 months", "500": "last 500 games", all: "all games" }[range]}`;
  $("anTitle").textContent = "Downloading your games…";
  $("fill").style.width = "0%"; $("found").innerHTML = '<p class="muted small">Findings appear here as games are checked.</p>';
  let all;
  try {
    all = await fetchGames(user, range, (n) => ($("count").textContent = `${n_(n)} games downloaded`));
  } catch (e) {
    show("s1");
    $("err").textContent = e.message === "not_found" ? `No chess.com player called "${user}". Check the spelling.` : "Couldn't reach chess.com. Check your connection and try again.";
    return;
  }
  if (!all.length) { show("s1"); $("err").textContent = `${user} has no bullet, blitz or rapid games in that range.`; return; }
  const counts = {}; for (const g of all) counts[g.time_class] = (counts[g.time_class] || 0) + 1;
  const tc = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const games = all.filter((g) => g.time_class === tc);
  const skipped = all.length - games.length;
  $("anTitle").textContent = `Checking ${n_(games.length)} ${tc} games…`;

  const done = [], todo = [];
  for (const g of games) { const c = await cacheGetAny(user, g.url); c ? done.push(c) : todo.push(g); }
  const engines = Array.from({ length: Math.min(poolSize(), Math.max(1, todo.length)) }, () => new Engine());
  const t0 = performance.now(); let next = 0, shown = 0;
  const tick = () => {
    const n = done.length, left = games.length - n, el = (performance.now() - t0) / 1000, k = n - (games.length - todo.length);
    const eta = k > 3 ? Math.ceil((left * el) / k / 60) : null;
    $("fill").style.width = (100 * n) / games.length + "%";
    $("count").textContent = `${n_(n)} / ${n_(games.length)} games${eta ? ` · about ${eta} min left` : ""} · keep this tab open`;
    if (n >= 60 && n - shown >= Math.max(60, games.length / 6)) { shown = n; spotted(buildStats(done)); }
  };
  tick();
  await Promise.all(engines.map(async (e) => {
    while (next < todo.length) {
      const g = todo[next++];
      try {
        const a = await analyseGame(g, user, (fen) => e.evaluate(fen, 15000));
        done.push(a); cachePut(`${ANALYSIS_VERSION}:${user.toLowerCase()}:${g.url}`, a);
      } catch (err) { console.warn("skipped", g.url, err); }
      tick();
    }
  }));
  engines.forEach((e) => e.stop());
  $("anTitle").textContent = "Writing your lessons…";
  const stats = buildStats(done);
  const coach = new Engine();
  const lessons = await buildLessons(stats, done.filter((g) => g.moves.length >= 5), (fen, nodes) => coach.evaluate(fen, nodes));
  STATE = { user, range, tc, skipped, stats, lessons, games: done, coach };
  renderReport();
  show("s3");
  history.replaceState(null, "", `?u=${encodeURIComponent(user)}&r=${range}`);
}
const n_ = (n) => n.toLocaleString("en-IN");

function spotted(s) {
  const items = [];
  if (s.thrown) items.push([n_(s.thrown), `won games thrown away so far${s.thrownOnTime ? `, ${n_(s.thrownOnTime)} on time` : ""}`]);
  if (s.phase.middlegame && s.phase.opening) items.push([`${(s.phase.middlegame / Math.max(.1, s.phase.opening)).toFixed(1)}×`, "more blunders in the middlegame than the opening"]);
  if (s.openings[0]) items.push([`${Math.round(s.openings[0].score)}%`, `with the ${s.openings[0].name} as ${s.openings[0].color}`]);
  if (s.clk20Wins && s.clk20Flagged) items.push([`${Math.round(s.clk20Flagged - s.clk20Wins)}s`, "on your clock by move 20 in games you flag, vs games you win"]);
  $("found").innerHTML = items.map(([b, t]) => `<div class="f"><b>${esc(b)}</b><span>${esc(t)}</span></div>`).join("");
}

// ---------- report ----------
const FIX = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="var(--go)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const fix = (t) => `<div class="fix">${FIX}<span>${t}</span></div>`;
const bar = (label, v, max, color) => `<div class="r"><span>${label}</span><span class="t"><i style="width:${Math.min(100, (100 * v) / max)}%;background:var(${color})"></i></span><span class="v">${v.toFixed(1)}%</span></div>`;
function renderReport() {
  const { user, tc, skipped, stats: s, lessons } = STATE;
  const d = (t) => new Date(t * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const conv = s.winning ? [s.converted, s.wonDrawn, s.thrown].map((x) => (x / s.winning) * 502.7) : [0, 0, 0];
  const thrownPct = s.winning ? Math.round((100 * s.thrown) / s.winning) : 0;
  const head = s.leak === "clock" && s.thrownOnTime ? "You win the board, then lose the clock." : s.thrown ? "You get winning positions, then give them back." : "Here's what's costing you games.";
  const lessonOf = (k) => lessons.find((l) => l.key === k);
  const pts = s.weekly, lo = Math.min(...pts) - 20, hi = Math.max(...pts) + 20;
  const xy = pts.map((v, i) => [30 + (i * 362) / Math.max(1, pts.length - 1), 120 - ((v - lo) * 110) / Math.max(1, hi - lo)]);
  const line = xy.map((p) => p.join(",")).join(" ");
  const ph = s.phase, phMax = Math.max(ph.opening || 0, ph.middlegame || 0, ph.endgame || 0) || 1;
  const hot = Object.entries(ph).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0][0];
  const op = s.openings.filter((o) => o.n >= 5);
  const worstOps = op.slice(0, 2), bestOps = op.filter((o) => o.score >= 55).slice(-1);
  const weak = s.byColor.black < s.byColor.white ? "black" : "white";
  const streak = s.last16;
  $("report").innerHTML = `
    <div class="top">
      <div class="av" aria-hidden="true">${esc(user[0].toUpperCase())}</div>
      <div class="who"><b>${esc(user)}</b><span class="muted small">${tc} · ${n_(s.n)} games · ${d(s.from)} – ${d(s.to)}${skipped ? ` · ${n_(skipped)} games in other time controls not included` : ""}</span></div>
      <div class="acts"><button class="btn sm ghost" type="button" id="again">Another player</button></div>
    </div>
    <div class="tiles">
      <div class="tile"><span class="eyebrow">Rating now</span><b>${s.ratingLast}</b><span class="muted small">peak ${s.ratingPeak}</span></div>
      <div class="tile"><span class="eyebrow">Score</span><b>${s.score.toFixed(1)}%</b><span class="muted small">${n_(s.w)} W · ${n_(s.d)} D · ${n_(s.l)} L</span></div>
      <div class="tile bad"><span class="eyebrow">Won games lost</span><b>${n_(s.thrown)}</b><span class="muted small">of ${n_(s.winning)} you were winning</span></div>
      <div class="tile bad"><span class="eyebrow">Lost on time</span><b>${n_(s.timeouts)}</b><span class="muted small">${s.l ? Math.round((100 * s.timeouts) / s.l) : 0}% of your losses</span></div>
    </div>
    <div class="card hero full">
      <svg viewBox="0 0 200 200" role="img" aria-label="${s.winning} winning positions: ${s.converted} won, ${s.wonDrawn} drawn, ${s.thrown} lost">
        <g transform="rotate(-90 100 100)" fill="none" stroke-width="24">
          <circle cx="100" cy="100" r="80" stroke="var(--line)"/>
          <circle cx="100" cy="100" r="80" stroke="var(--go)" stroke-dasharray="${conv[0]} 502.7"/>
          <circle cx="100" cy="100" r="80" stroke="var(--muted)" stroke-dasharray="${conv[1]} 502.7" stroke-dashoffset="${-conv[0]}"/>
          <circle cx="100" cy="100" r="80" stroke="var(--flag)" stroke-dasharray="${conv[2]} 502.7" stroke-dashoffset="${-(conv[0] + conv[1])}"/>
        </g>
        <text x="100" y="100" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="46" fill="var(--flag)">${thrownPct}%</text>
        <text x="100" y="122" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="11" fill="var(--muted)">of won games lost</text>
      </svg>
      <div class="copy">
        <span class="eyebrow" style="color:var(--flag)">Your #1 leak</span>
        <h1 style="font-size:clamp(26px,4.5vw,40px)">${head}</h1>
        <p class="muted">You were +3 or better in ${n_(s.winning)} games and lost ${n_(s.thrown)} of them.${s.thrownOnTime ? ` ${n_(s.thrownOnTime)} of those were on time` : ""}${s.flaggedAhead ? `, and in ${n_(s.flaggedAhead)} games you were still +2 when your flag fell` : ""}.</p>
        ${fix("Once you're +3, stop hunting mate. Trade pieces, push pawns, win simply.")}
        ${lessonOf("clock") ? '<div><button class="btn" type="button" data-wt="clock">Replay a game you lost like this</button></div>' : ""}
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <span class="eyebrow">Rating, week by week</span>
        <svg class="spark" viewBox="0 0 400 150" role="img" aria-label="Weekly rating from ${pts[0]} to ${pts[pts.length - 1]}">
          <g font-family="IBM Plex Mono, monospace" font-size="10" fill="var(--muted)"><text x="0" y="14">${Math.round(hi)}</text><text x="0" y="124">${Math.round(lo)}</text></g>
          <line x1="30" x2="400" y1="10" y2="10" stroke="var(--line)"/><line x1="30" x2="400" y1="120" y2="120" stroke="var(--line)"/>
          <polygon points="30,120 ${line} ${xy[xy.length - 1][0]},120" fill="var(--go)" opacity=".15"/>
          <polyline points="${line}" fill="none" stroke="var(--go)" stroke-width="2.5" stroke-linejoin="round"/>
          <circle cx="${xy[xy.length - 1][0]}" cy="${xy[xy.length - 1][1]}" r="5" fill="var(--go)" stroke="var(--card)" stroke-width="2"/>
        </svg>
      </div>
      ${s.clk20Wins && s.clk20Flagged ? `<div class="card">
        <span class="eyebrow">Clock left at move 20</span>
        <h2>${s.clk20Flagged < s.clk20Wins ? `In games you flag, you've already burned ${Math.round(s.clk20Wins - s.clk20Flagged)} extra seconds.` : "Your early clock use is fine. The time goes later."}</h2>
        <div class="clocks">
          <div class="clk"><span class="small">Games you won</span><b>${fmtClock(s.clk20Wins)}</b><span class="bar2"><i style="width:${(100 * s.clk20Wins) / s.base}%"></i></span></div>
          <div class="clk red"><span class="small">Lost on time</span><b>${fmtClock(s.clk20Flagged)}</b><span class="bar2"><i style="width:${(100 * s.clk20Flagged) / s.base}%"></i></span></div>
        </div>
        ${fix("Play your first 10–12 moves fast. Think in the middlegame.")}
      </div>` : ""}
    </div>
    ${s.blunders.length ? `<div class="card full">
      <span class="eyebrow">Replay these</span>
      <h2>${s.blunders.length === 1 ? "The time" : `${s.blunders.length} times`} you were winning big and threw it away</h2>
      <div class="bls" id="bls"></div>
      <p class="muted small">Red: your move. Arrow: what was winning.</p>
      ${lessonOf("captures") ? '<div><button class="btn" type="button" data-wt="captures">Walk through them, move by move</button></div>' : ""}
    </div>` : ""}
    <div class="grid2">
      <div class="card">
        <span class="eyebrow">Blunders per 100 moves</span>
        <h2>${hot === "middlegame" ? "It's the middlegame, not the clock." : hot === "opening" ? "Your openings leak the most." : "Endgames are where it goes wrong."}</h2>
        <div class="phase" role="img" aria-label="Opening ${ph.opening?.toFixed(1)}, middlegame ${ph.middlegame?.toFixed(1)}, endgame ${ph.endgame?.toFixed(1)}">
          ${["opening", "middlegame", "endgame"].map((k) => `<div class="${k === hot ? "hot" : ""}" style="height:${Math.max(18, (100 * (ph[k] || 0)) / phMax)}%"><b>${(ph[k] || 0).toFixed(1)}</b><span>${k}</span></div>`).join("")}
        </div>
        ${s.clockRate.plenty != null && s.clockRate.low != null ? `<p class="muted small">With plenty of time: ${s.clockRate.plenty.toFixed(1)}. Under 10% of your clock: ${s.clockRate.low.toFixed(1)}.</p>` : ""}
        ${fix("Before each move: what does their last move attack? Any captures for me?")}
      </div>
      <div class="card">
        <span class="eyebrow">Tilt</span>
        <h2>${s.tilt.after2 != null && s.tilt.after2 < (s.tilt.afterWin ?? 100) - 2 ? "Stop after two losses in a row." : "Losses don't tilt you much."}</h2>
        <div class="streak" aria-label="Your last ${streak.length} games">${streak.map((c, i) => `<i class="${c}${i > 1 && streak[i - 1] === "L" && streak[i - 2] === "L" ? " after" : ""}">${c}</i>`).join("")}</div>
        <p class="muted small">Your last ${streak.length} games. Gold ring: played right after two losses.</p>
        <div class="tl">
          ${s.tilt.afterWin != null ? bar("After a win", s.tilt.afterWin, 100, "--go") : ""}
          ${s.tilt.afterLoss != null ? bar("After a loss", s.tilt.afterLoss, 100, "--muted") : ""}
          ${s.tilt.after2 != null ? bar("After 2 losses", s.tilt.after2, 100, "--flag") : ""}
        </div>
      </div>
    </div>
    ${op.length ? `<div class="card full">
      <span class="eyebrow">Openings</span>
      <h2>${Math.abs(s.byColor.white - s.byColor.black) > 3 ? `${weak[0].toUpperCase() + weak.slice(1)} is your weak side: ${Math.round(s.byColor[weak])}% vs ${Math.round(s.byColor[weak === "black" ? "white" : "black"])}%.` : "Your openings, worst to best."}</h2>
      <div class="ops" id="ops"></div>
      ${lessonOf("opening") ? `<div><button class="btn" type="button" data-wt="opening">${esc(lessonOf("opening").title)}: walk through it</button></div>` : ""}
    </div>` : ""}
    <div class="card full">
      <span class="eyebrow">Your plan this week</span>
      <h2>Do these in order. Come back in a month and check again.</h2>
      <div class="plan" id="plan"></div>
    </div>
    <p class="foot">Stockfish 19 (lite) checked every move you played, quickly. Totals are reliable; a single move's verdict can be off. Opening names come from chess.com. Chess Coach is free and open source, a <a href="https://topc.social">TOPC</a> project, not affiliated with chess.com.</p>`;

  const bls = $("bls");
  if (bls) for (const { g, m } of s.blunders) {
    const c = new Chess(g.start || undefined); for (let i = 0; i < m.ply - 1; i++) c.move(g.san[i]);
    const best = m.best ? [m.best.slice(0, 2), m.best.slice(2, 4)] : null;
    const card = document.createElement("div"); card.className = "bl";
    const b = document.createElement("div"); b.className = "board";
    staticBoard(b, c.fen(), { flip: g.color === "black", hl: [m.uci.slice(0, 2), m.uci.slice(2, 4)], bad: true, arrow: best });
    card.appendChild(b);
    let bestSan = ""; try { bestSan = m.best ? c.move({ from: m.best.slice(0, 2), to: m.best.slice(2, 4), promotion: m.best[4] || "q" }).san : ""; } catch {}
    card.insertAdjacentHTML("beforeend", `<div class="mv"><span class="chip x">✗ ${moveNo(m.ply)}${esc(m.san)}</span>${bestSan ? `<span class="chip y">✓ ${esc(bestSan)}</span>` : ""}</div><div class="muted small">${evalWords(m.before)} → ${evalWords(m.after)} · ${fmtClock(m.clk)} on your clock · vs ${esc(g.op)} (${g.opRating})</div><div><a class="btn ghost sm" href="${esc(g.url)}" target="_blank" rel="noopener">Open on chess.com ↗</a></div>`);
    bls.appendChild(card);
  }
  const ops = $("ops");
  if (ops) for (const o of [...worstOps, ...bestOps]) {
    const ex = STATE.games.find((g) => g.color === o.color && openingName(g.eco) === o.name && !g.start);
    const card = document.createElement("div"); card.className = "op";
    const b = document.createElement("div"); b.className = "board";
    const c = new Chess(); if (ex) for (const sanMv of ex.san.slice(0, 6)) c.move(sanMv);
    staticBoard(b, c.fen(), { flip: o.color === "black" });
    card.appendChild(b);
    const good = o.score >= 55;
    card.insertAdjacentHTML("beforeend", `<div class="row"><b>${esc(o.name)}</b><span class="pill ${good ? "good" : "bad"}">${Math.round(o.score)}% · ${good ? "keep" : "fix"}</span></div><span class="muted">as ${o.color} · ${o.n} games</span>`);
    ops.appendChild(card);
  }
  const plan = [];
  if (lessonOf("clock")) plan.push(["Win won games before your flag falls", "Replay a game where you were winning and lost on time.", "clock"]);
  if (lessonOf("captures")) plan.push(["Stop throwing away winning positions", `Your ${s.blunders.length} biggest blunders, replayed. Then 10 puzzles a day.`, "captures", ["Puzzles", "https://www.chess.com/puzzles/rated"]]);
  if (lessonOf("opening")) plan.push([`Fix one line: ${lessonOf("opening").title.replace(/^Your /, "")}`, "The move you keep playing there, and the better one.", "opening"]);
  if (s.tilt.after2 != null && s.tilt.after2 < (s.tilt.afterWin ?? 100) - 2) plan.push(["Two losses in a row? Take a break", `You score ${Math.round(s.tilt.after2)}% in the next game.`]);
  $("plan").innerHTML = `<div class="step"><span class="ic" aria-hidden="true">♞</span><span class="tx"><b>Play a practice game</b><span class="muted small">A weak bot replays the lines your opponents used against you. Any mistake, and the coach stops you to fix it.</span></span><span class="go"><button class="btn sm" type="button" data-practice>Play</button></span></div>` + plan.map(([t, d2, wt, link], i) => `<div class="step"><span class="ic" aria-hidden="true">${i + 1}</span><span class="tx"><b>${esc(t)}</b><span class="muted small">${esc(d2)}</span></span><span class="go">${wt ? `<button class="btn sm" type="button" data-wt="${wt}">Start lesson</button>` : ""}${link ? `<a class="btn sm ghost" href="${link[1]}" target="_blank" rel="noopener">${link[0]} ↗</a>` : ""}</span></div>`).join("");
  $("again").onclick = () => { try { localStorage.removeItem(ME); } catch {} history.replaceState(null, "", location.pathname); $("user").value = ""; show("s1"); };
}

// ---------- lessons ----------
const wtEl = $("wt"), wb = LessonBoard($("wtBoard"));
let lesson = null, wi = 0, token = 0, explored = [];
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const plyOf = (fen) => { const p = fen.split(" "); return (+p[5] - 1) * 2 + (p[1] === "b" ? 1 : 0); };
const sqLinks = (t) => esc(t).replace(/(?<![\w/])((?:\d+(?:\.|…))?[KQRBN]?[a-h]?x?([a-h][1-8])(?:=[QRBN])?[+#]?)(?!\w)/g, '<button type="button" class="sqref" data-sq="$2">$1</button>');
function prep(L) {
  if (L.ready) return;
  const g = new Chess(); let frozen = null;
  for (const s of L.steps) {
    if (s.start) g.load(s.start);
    s.from = g.fen();
    s.mv = s.moves ? s.moves.split(" ").filter(Boolean).map((m) => g.move(m)) : [];
    s.to = g.fen();
    if (!s.alt) frozen = null; else if (frozen === null) frozen = plyOf(s.from);
    s.freeze = frozen;
  }
  L.ready = true;
}
function clockAt(gi, ply, white) {
  // clocks are per ply of the real game; game plies count from the start position
  for (let i = Math.min(ply, gi.clk.length) - 1; i >= 0; i--) if ((i % 2 === 0) === white && gi.clk[i] != null) return gi.clk[i];
  return gi.base;
}
function bars(s, ply) {
  const top = $("pTop"), bot = $("pBot");
  top.hidden = bot.hidden = !s.game;
  if (!s.game) return;
  const gi = s.game, P = s.alt ? s.freeze : ply, meWhite = gi.me === "white", turnWhite = P % 2 === 0;
  const one = (name, rating, white, mine) => {
    const t = clockAt(gi, P, white), on = !s.alt && turnWhite === white;
    return `<span class="who"><span class="pav ${white ? "w" : "b"}" aria-hidden="true"></span><b>${esc(name)}</b><span class="muted">(${rating})</span>${mine ? "" : `<span class="muted small gm">${gi.date} · ${gi.base / 60}|0 · ${esc(gi.res)}</span>`}</span>` +
      `<span class="pclk${on ? " on" : ""}${t < 20 ? " low" : ""}">${s.alt ? "<em>what if</em>" : ""}${fmtClock(t)}</span>`;
  };
  top.innerHTML = one(gi.op, gi.opR, !meWhite, false);
  bot.innerHTML = one("You", gi.myR, meWhite, true);
  material(); // redrawn with the bars, or the line vanishes mid-animation and the board jumps
}
const tryMsg = (html, explore) => { $("tryMsg").innerHTML = html; $("tryReset").hidden = !explore; };
const coachEval = (fen, nodes, stale) => STATE.coach.evaluate(fen, nodes, stale);
function evalHere(my) {
  const g = wb.game(), fen = g.fen(), turnW = g.turn() === "w";
  coachEval(fen, 60000, () => my !== token).then((r) => { if (r && my === token) evalBar($("evb"), turnW ? r.cp : -r.cp, wb.flip()); });
}
// ---------- move list: one move back/forward, your own moves branch off like on chess.com ----------
let nodes = [], cur = null, mainLen = 0;
const addNode = (m, parent) => { const n = { fen: m ? m.after : parent, m, parent: m ? parent : null, kids: [], id: nodes.length }; nodes.push(n); if (m) parent.kids.push(n); return n; };
const follow = (m) => (cur = cur.kids.find((k) => k.m.san === m.san) || addNode(m, cur));
function grow(m) { follow(m); renderMoves(); }
// main line = the real game when the step has one, so you can walk the whole game; the step's moves follow it or branch off
function buildTree(s) {
  nodes = []; mainLen = 0;
  const gi = s.game;
  if (gi && gi.san) {
    const c = new Chess(gi.start || undefined);
    let n = addNode(null, c.fen());
    for (const san of gi.san) n = addNode(c.move(san), n);
    mainLen = gi.san.length;
    cur = nodes.find((x) => x.fen === s.from);
  }
  if (!cur || !nodes.includes(cur)) { nodes = []; cur = addNode(null, s.from); }
  for (const m of s.mv) follow(m);
  renderMoves();
}
function mvTok(n, num, bare) {
  const p = plyOf(n.parent.fen) + 1;
  const lb = n.id <= mainLen && lesson.labels?.[n.id], flag = lb && ["inacc", "mist", "blun"].includes(lb[0]) ? ` <span class="bdg ${lb[0]} inl mvb">${lb[1]}</span>` : "";
  return `<button type="button" class="${n === cur ? "on" : ""}" data-n="${n.id}">${!bare && (p % 2 || num) ? moveNo(p) : ""}${esc(n.m.san)}${flag}</button>`;
}
function mvLine(n, num) {
  let h = "";
  while (n.kids.length) {
    const [main, ...alts] = n.kids;
    h += mvTok(main, num);
    for (const a of alts) h += `<span class="var">(${mvTok(a, true)}${mvLine(a, false)})</span>`;
    n = main; num = alts.length > 0;
  }
  return h;
}
// the game as numbered rows like chess.com, side lines on their own line under the move they branch from
function renderMoves() {
  let h = "", n = nodes[0], open = false;
  const close = () => { if (open) { h += "</div>"; open = false; } };
  while (n.kids.length) {
    const [main, ...alts] = n.kids, p = plyOf(n.fen) + 1, w = p % 2 === 1;
    if (w || !open) { close(); h += `<div class="mrow"><span class="no">${Math.ceil(p / 2)}.</span>${w ? "" : '<span class="mc"></span>'}`; open = true; }
    h += `<span class="mc">${mvTok(main, false, true)}</span>`;
    if (!w) close();
    for (const a of alts) { close(); h += `<div class="mvar">${mvTok(a, true)}${mvLine(a, false)}</div>`; }
    n = main;
  }
  close();
  $("mvList").innerHTML = h || '<span class="muted">Play a move to start a line.</span>';
  // scroll only the list itself: scrollIntoView also moves the page, which made the board jump
  const list = $("mvList"), on = list.querySelector(".on");
  if (on) { const r = on.getBoundingClientRect(), l = list.getBoundingClientRect(); if (r.top < l.top || r.bottom > l.bottom) list.scrollTop += r.top - l.top - l.height / 2; }
  $("mvPrev").disabled = $("mvFirst").disabled = !cur.parent; $("mvNext").disabled = $("mvLast").disabled = !cur.kids.length;
  graphMark();
}
// a game move shows its card; a move in a side line gets judged on the spot
function nav(n) {
  if (!n) return;
  const j = n.id <= mainLen ? lesson.plyStep?.[n.id] : null;
  if (j != null) wtShow(j, false); else goTo(n);
}
function graphMark() {
  const el = $("wtGraph"), G = lesson?.graph;
  el.hidden = !G;
  if (!G) return;
  const x = (i) => (100 * i) / Math.max(1, G.length - 1), ply = cur && cur.id <= mainLen ? cur.id : null;
  el.innerHTML = `<rect width="100" height="30" class="gb"/><path class="gw" d="M0,30 ${G.map((v, i) => `L${x(i).toFixed(2)},${(30 - v * 0.3).toFixed(2)}`).join(" ")} L100,30 Z"/><line x1="0" x2="100" y1="15" y2="15" class="gm"/>` +
    (ply != null ? `<line x1="${x(ply)}" x2="${x(ply)}" y1="0" y2="30" class="gc"/>` : "") +
    lesson.labels.map((l, i) => (l && ["inacc", "mist", "blun"].includes(l[0]) ? `<circle cx="${x(i)}" cy="${30 - G[i] * 0.3}" r="1.1" class="gd ${l[0]}"/>` : "")).join("");
}
$("wtGraph").addEventListener("click", (e) => {
  const G = lesson?.graph; if (!G) return;
  const r = e.currentTarget.getBoundingClientRect(), ply = Math.round(((e.clientX - r.left) / r.width) * (G.length - 1));
  nav(nodes[ply]);
});
// label a move from its position before, the way the game's own moves are labelled
async function judge(m, before, after, my) {
  const [b, a] = await Promise.all([coachEval(before, 60000), coachEval(after, 60000)]);
  if (my !== token || !b || !a) return null;
  const drop = winPct(b.cp) - winPct(-a.cp), best = b.best === m.from + m.to + (m.promotion || "");
  const [, cls, sym, word] = best ? CLS[0] : CLS.find((c) => drop < c[0]);
  let bestSan = ""; try { bestSan = new Chess(before).move({ from: b.best.slice(0, 2), to: b.best.slice(2, 4), promotion: b.best[4] || "q" }).san; } catch {}
  const msg = `<span class="bdg ${cls} inl">${sym}</span> <b>${esc(m.san)}</b> is ${word}.${best || !bestSan ? "" : ` Best was <b>${esc(bestSan)}</b>.`}`;
  return { cls, sym, word, a, b, bestSan, drop, msg };
}
function goTo(n) {
  if (!n) return;
  const my = ++token;
  cur = n;
  wb.set(n.fen, lesson.flip);
  wb.mark(n.m ? [n.m.from, n.m.to] : [], "last");
  wb.setBusy(false);
  renderMoves();
  material();
  evalHere(my);
  if (!n.m || n.id <= mainLen) return;
  tryMsg(`<b>${esc(n.m.san)}</b> · Stockfish is thinking…`, true);
  judge(n.m, n.parent.fen, n.fen, my).then((j) => { if (j && my === token) { tryMsg(j.msg, true); wb.badge(n.m.to, j.cls, j.sym); } });
}
function showBest() {
  const s = lesson.steps[wi];
  if (!s.best) return;
  ++token;
  wb.set(s.from, lesson.flip);
  wb.mark([], "", [[s.best.slice(0, 2), s.best.slice(2, 4), "green"]]);
  tryMsg(`<span class="bdg best inl">★</span> Best was <b>${esc(s.bestSan)}</b>. Next shows what happened in the game.`, true);
}

// ---------- what the coach's words point at: moves played with an arrow, squares with every piece aimed at them ----------
// a move named in the text plays from the first position where it's legal: the board now, the card's end, the card's start
async function showSan(tok) {
  const san = tok.replace(/^\d+(?:\.\.\.|\.|…)\s*/, ""), s = lesson.steps[wi];
  for (const fen of [wb.game().fen(), s.to, s.from]) {
    let m; try { m = new Chess(fen).move(san); } catch { continue; }
    const my = ++token;
    wb.set(fen, lesson.flip); wb.mark([], "");
    await wb.play(m, 350);
    if (my !== token) return true;
    wb.mark([m.from, m.to], "last", [[m.from, m.to, "green"]]);
    tryMsg(`<b>${esc(m.san)}</b> on the board.`, true);
    material(); evalHere(my);
    return true;
  }
  return false;
}
// a move inside a written line ("After 5...dxc6, 6.Nxe5? runs into 6...Bxf2+! 7.Kxf2 Qd4+"): replay the chain of moves written
// before it whose numbers follow on, from where the chain's first move starts in the game. The chain can leave the game
// (5...dxc6 where the game had 5...bxc6), so it must start at its own first move, not at the game's.
// Returns false when the tapped move isn't in a numbered chain, so the caller tries it on its own.
async function playLine(ref) {
  const gi = lesson.steps[wi].game;
  if (!gi || !gi.san) return false;
  const refs = [...ref.parentElement.querySelectorAll(".sqref")], plies = [];
  let prev = null;
  for (const r of refs) {
    const t = r.textContent.trim(), b = r.previousSibling;
    const num = t.match(/^(\d+)\s*(\.\.\.|…|\.)/) || (b && b.nodeType === 3 ? b.textContent.match(/(\d+)\s*(\.\.\.|…|\.)\s*$/) : null);
    prev = num ? (num[1] - 1) * 2 + (num[2] === "." ? 0 : 1) : /^[a-h][1-8]$/.test(t) || prev == null ? null : prev + 1;
    plies.push(prev);
  }
  const k = refs.indexOf(ref);
  if (plies[k] == null) return false;
  let i = k;
  while (i > 0 && plies[i - 1] != null && plies[i - 1] === plies[i] - 1) i--;
  if (plies[i] > gi.san.length) return false;
  const c = new Chess(gi.start || undefined);
  for (const m of gi.san.slice(0, plies[i])) c.move(m);
  const fen = c.fen(), mv = [];
  for (const t of refs.slice(i, k + 1)) { try { mv.push(c.move(t.textContent.trim().replace(/^\d+\s*(?:\.\.\.|\.|…)\s*/, ""))); } catch { return false; } }
  const my = ++token;
  wb.set(fen, lesson.flip); wb.mark([], "");
  for (const m of mv) { await wb.play(m, 320); if (my !== token) return true; }
  const last = mv[mv.length - 1];
  wb.mark([last.from, last.to], "last", [[last.from, last.to, "green"]]);
  tryMsg(`The coach's line: <b>${esc(mv.map((m) => m.san).join(" "))}</b>`, true);
  material(); evalHere(my);
  return true;
}
// direct attackers in orange, and the pieces lined up behind them (a battery, an x-ray) too
function showAttackers(sq) {
  const c = new Chess(wb.game().fen()), occ = c.get(sq), by = occ ? (occ.color === "w" ? "b" : "w") : c.turn(), arrows = [];
  for (let round = 0; round < 3; round++) {
    const from = c.attackers(sq, by);
    if (!from.length) break;
    for (const f of from) { arrows.push([f, sq, round ? "red" : "orange"]); c.remove(f); }
  }
  if (!arrows.length) { wb.ping(sq); return; }
  wb.mark([sq], "", arrows);
  tryMsg(`${arrows.length} ${by === "w" ? "white" : "black"} piece${arrows.length > 1 ? "s" : ""} aimed at <b>${sq}</b>${arrows.some((a) => a[2] === "red") ? ", red ones lined up behind (a battery)" : ""}.`, true);
}
// captured pieces and +N next to each player, like chess.com
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 }, FULL = { p: 8, n: 2, b: 2, r: 2, q: 1 }, ICON = { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛" };
function material() {
  const gi = lesson?.steps[wi]?.game;
  if (!gi) return;
  const have = { w: {}, b: {} };
  for (const row of wb.game().board()) for (const p of row) if (p) have[p.color][p.type] = (have[p.color][p.type] || 0) + 1;
  const pts = (col) => Object.entries(have[col]).reduce((a, [t, n]) => a + (VAL[t] || 0) * n, 0), diff = pts("w") - pts("b");
  const took = (col) => Object.keys(FULL).map((t) => ICON[t].repeat(Math.max(0, FULL[t] - (have[col === "w" ? "b" : "w"][t] || 0)))).join("");
  const meW = gi.me === "white";
  for (const [el, col] of [[$("pBot"), meW ? "w" : "b"], [$("pTop"), meW ? "b" : "w"]]) {
    el.querySelector(".mat")?.remove();
    const up = col === "w" ? diff : -diff, who = el.querySelector(".who");
    if (who) who.insertAdjacentHTML("beforeend", `<span class="mat">${took(col)}${up > 0 ? ` +${up}` : ""}</span>`);
  }
}

// ---------- practice games: a weak bot that steers into the lines you went wrong in before ----------
// The bot plays what your real opponents played against you (preferring games where you then erred); once the game leaves
// your history it plays handicapped Stockfish. Any inaccuracy or worse from you is taken back and the coach explains.
let practice = null, bot = null, nextColor = "w";
const STOP = ["inacc", "mist", "blun"];
const pastGames = () => { const seen = new Set(); return [...(STATE.games || []), STATE.game, ...(STATE.history || [])].filter((g) => g && !g.start && !seen.has(g.url) && seen.add(g.url)); };
function startPracticeGame() {
  const color = nextColor; nextColor = color === "w" ? "b" : "w";
  lesson = { key: "practice", title: "Practice game", flip: color === "b", steps: [{ start: new Chess().fen(), moves: "",
    name: `Practice game: you're ${color === "w" ? "White" : "Black"}`,
    body: "The bot plays the lines your opponents used against you. Make a mistake, even a small one, and the coach stops you to fix it." }] };
  prep(lesson); wtEl.hidden = false; wtShow(0, false);
  $("wtNext").textContent = "Done ✓"; $("wtPlay").hidden = true;
  practice = { color, sans: [], good: 0, stops: 0, fen: new Chess().fen(), seen: null };
  bot ||= new Engine(2);
  indexPast(practice);
  if (color === "b") botMove(token);
}
// every position from your past games where it was your move: how often it came up and what you played there
const posKey = (fen) => fen.split(" ").slice(0, 4).join(" ");
async function indexPast(p) {
  const mine = p.color === "w" ? "white" : "black", idx = new Map(), games = pastGames().filter((g) => g.color === mine);
  for (let i = 0; i < games.length; i++) {
    const c = new Chess();
    for (const san of games[i].san) {
      if (c.turn() === p.color) { const k = posKey(c.fen()), e = idx.get(k) || { n: 0, m: {} }; e.n++; e.m[san] = (e.m[san] || 0) + 1; idx.set(k, e); }
      try { c.move(san); } catch { break; }
    }
    if (i % 40 === 39) await new Promise((r) => setTimeout(r)); // stay responsive while it reads hundreds of games
  }
  p.seen = idx;
}
async function botMove(my) {
  const g = wb.game(), seq = practice.sans, mine = practice.color === "w" ? "white" : "black", cands = [];
  for (const pg of pastGames()) if (pg.color === mine && pg.san.length > seq.length && seq.every((m, i) => pg.san[i] === m))
    cands.push({ san: pg.san[seq.length], w: pg.moves.some((x) => x.ply > seq.length && x.drop >= 10) ? 3 : 1 });
  let m = null, fromPast = false;
  if (cands.length) {
    let r = Math.random() * cands.reduce((a, c) => a + c.w, 0);
    const pick = cands.find((c) => (r -= c.w) <= 0) || cands[0];
    try { m = new Chess(g.fen()).move(pick.san); fromPast = true; } catch {}
  }
  if (!m) {
    const r = await bot.evaluate(g.fen(), 4000);
    if (my !== token || !practice) return;
    m = r && g.moves({ verbose: true }).find((x) => x.from + x.to === (r.best || "").slice(0, 4) && (!x.promotion || x.promotion === (r.best[4] || "q")));
  }
  if (!m) return;
  wb.setBusy(true);
  await wb.play(m, 320);
  if (my !== token || !practice) return;
  grow(m); practice.sans.push(m.san); practice.fen = wb.game().fen(); wb.mark([m.from, m.to], "last"); material(); wb.setBusy(false);
  if (wb.game().isGameOver()) return practiceOver();
  tryMsg(`Bot played <b>${esc(m.san)}</b>${fromPast ? `, like your opponents did (${cands.length} of your games went this way)` : ""}. Your move.`, true);
  evalHere(my);
}
async function practiceTurn(m, before, j, my) {
  if (STOP.includes(j.cls)) {
    await new Promise((r) => setTimeout(r, 700));
    if (my !== token || !practice) return;
    cur = cur.parent; renderMoves();
    wb.set(before, lesson.flip); wb.mark([m.from, m.to], "bad"); material(); wb.setBusy(false);
    practice.stops++; practice.fen = before;
    const e = practice.seen?.get(posKey(before)), times = e ? ` This position came up in ${e.n} of your games${e.m[m.san] ? `, and you played <b>${esc(m.san)}</b> in ${e.m[m.san]} of them` : ""}.` : "";
    tryMsg(`<span class="bdg ${j.cls} inl">${j.sym}</span> <b>${esc(m.san)}</b> is ${j.word}.${times} The coach explains; then try again.`, true);
    // Claude explains Stockfish's own refutation instead of hunting for one: faster, and never "I'm not sure why"
    const ac = new Chess(before); ac.move(m.san);
    const deep = await coachEval(ac.fen(), 250000);
    if (my !== token || !practice) return;
    const refute = pvSan(ac.fen(), deep?.pv || j.a.pv), better = pvSan(before, j.b.pv);
    streamCoach({ moves: [...practice.sans, m.san], ply: practice.sans.length, fen: before,
      verdict: `Stockfish: ${m.san} is ${j.word}, the mover's win chance drops ${Math.round(j.drop)} points. How it gets punished: ${m.san} ${refute}. The better move and line (do NOT name it, hint only): ${better}.`.slice(0, 500),
      question: `In a practice game I played ${m.san}. Using the punishing line you were given, explain in 2-3 sentences what goes wrong, then give a one-line hint toward the better move without naming it.`,
      white: practice.color === "w" ? STATE.user : "Practice bot", black: practice.color === "w" ? "Practice bot" : STATE.user });
    return;
  }
  practice.good++; practice.sans.push(m.san); practice.fen = wb.game().fen();
  if (wb.game().isGameOver()) return practiceOver();
  tryMsg(`<span class="bdg ${j.cls} inl">${j.sym}</span> <b>${esc(m.san)}</b> is ${j.word}. The bot is thinking…`, true);
  await new Promise((r) => setTimeout(r, 400));
  if (my === token && practice) botMove(my);
}
function practiceOver() {
  const g = wb.game();
  tryMsg(`${g.isCheckmate() ? (g.turn() === practice.color ? "You got checkmated." : "Checkmate, you won!") : "Draw."} ${practice.good} good moves, stopped ${practice.stops} time${practice.stops === 1 ? "" : "s"}.`, true);
  practice = null;
}

function navUi() {
  $("wtStep").textContent = `${lesson.title} · step ${wi + 1} of ${lesson.steps.length}`;
  $("wtDots").innerHTML = lesson.steps.length > 24 ? "" : lesson.steps.map((x, j) => `<button type="button" aria-label="Step ${j + 1}" class="${j === wi ? "on" : x.tone || ""}" data-j="${j}"></button>`).join("");
  $("wtPrev").disabled = wi === 0;
  $("wtNext").textContent = wi === lesson.steps.length - 1 ? "Done ✓" : "Next →";
}
async function wtShow(i, animate) {
  $("askOut").textContent = ""; askToken++; // an answer belongs to the card it was asked on
  wi = Math.max(0, Math.min(lesson.steps.length - 1, i));
  const s = lesson.steps[wi], my = ++token;
  explored = [];
  const n = $("wtName"); n.textContent = s.name; n.className = "mvname " + (s.tone || "");
  $("wtIcon").innerHTML = s.badge ? `<span class="bdg ${s.badge[0]} inl">${s.badge[1]}</span>` : "";
  $("wtEval").textContent = s.ev || ""; $("wtEval").hidden = !s.ev;
  $("wtBest").hidden = !s.best;
  practice = null;
  $("wtPlay").hidden = lesson.key !== "game" || wi !== lesson.steps.length - 1;
  $("wtBody").innerHTML = sqLinks(s.body);
  $("wtExtra").innerHTML = (s.stat ? `<span class="stat">${esc(s.stat)}</span> ` : "") +
    (s.link ? `<a class="btn ghost sm" href="${esc(s.link)}" target="_blank" rel="noopener">See your game ↗</a>` : "") +
    (s.rule ? `<div class="rule"><b>Remember:</b> ${sqLinks(s.rule)}</div>` : "");
  navUi();
  tryMsg("Your turn: drag or tap any piece to try a move.", false);
  const p0 = plyOf(s.from);
  bars(s, animate && !reduce ? p0 : plyOf(s.to));
  const last = s.mv[s.mv.length - 1], tone = s.tone === "bad" ? "bad" : s.tone === "good" ? "good" : "last";
  wb.setBusy(true);
  if (animate && !reduce && s.mv.length) {
    wb.set(s.from, lesson.flip);
    await new Promise((r) => setTimeout(r, s.start ? 350 : 120));
    const ms = s.mv.length > 4 ? 330 : 480;
    for (const [k, m] of s.mv.entries()) { if (my !== token) return; await wb.play(m, ms); bars(s, p0 + k + 1); }
    if (my !== token) return;
  } else wb.set(s.to, lesson.flip);
  wb.mark(last ? [last.from, last.to] : [], tone, s.arrows);
  if (s.badge && last) wb.badge(last.to, s.badge[0], s.badge[1]);
  wb.setBusy(false);
  buildTree(s);
  material();
  evalHere(my);
}
wb.onMove(async (m, fromDrag) => {
  explored.push(m.san);
  const my = ++token, before = wb.game().fen(), turnW = wb.game().turn() === "w";
  wb.setBusy(true);
  await wb.play(m, fromDrag ? 0 : 200);
  grow(m);
  wb.mark([m.from, m.to], "last");
  material();
  const s = lesson.steps[wi];
  if (s.game) bars({ ...s, alt: true, freeze: s.alt ? s.freeze : plyOf(s.to) }, 0);
  const g = wb.game();
  if (g.isCheckmate()) { tryMsg(`<b>${esc(m.san)}</b> is checkmate.`, true); evalBar($("evb"), turnW ? 10000 : -10000, wb.flip()); return; }
  if (g.isGameOver()) { tryMsg(`<b>${esc(m.san)}</b>: it's a draw.`, true); evalBar($("evb"), 0, wb.flip()); return; }
  tryMsg(`<b>${esc(m.san)}</b> · Stockfish is thinking…`, true);
  const j = await judge(m, before, g.fen(), my);
  if (!j) return;
  if (practice) return practiceTurn(m, before, j, my);
  const { cls, sym, a } = j;
  wb.badge(m.to, cls, sym);
  evalBar($("evb"), turnW ? -a.cp : a.cp, wb.flip());
  tryMsg(j.msg, true);
  await new Promise((r) => setTimeout(r, 650));
  if (my !== token || !a.best || a.best === "(none)") { wb.setBusy(false); return; }
  const reply = g.moves({ verbose: true }).find((x) => x.from + x.to === a.best.slice(0, 4) && (!x.promotion || x.promotion === (a.best[4] || "q")));
  if (reply) { await wb.play(reply, 320); if (my !== token) return; explored.push(reply.san); grow(reply); wb.mark([reply.from, reply.to], "last"); if (reply.to !== m.to) wb.badge(m.to, cls, sym); }
  wb.setBusy(false);
  evalHere(my);
});

// ---------- one game, opened from the extension: /?game=<chess.com id>&u=<username> ----------
async function findGame(user, id) {
  const now = new Date(), seen = [];
  for (const k of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    let gs = [];
    try { ({ games: gs = [] } = await getJson(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`)); } catch (e) { if (e.message !== "not_found") throw e; }
    seen.push(...gs);
    const g = gs.find((x) => x.url.endsWith("/" + id));
    if (g) return { raw: g, month: seen };
  }
  return {};
}
async function review(user, id) {
  $("user").value = user;
  show("s2");
  $("anUser").textContent = user;
  $("anTitle").textContent = "Finding your game…";
  $("found").closest(".side").querySelectorAll(".eyebrow")[1].hidden = true;
  const fail = (msg) => { show("s1"); $("err").textContent = msg; };
  let raw, month;
  try { ({ raw, month } = await findGame(user, id)); } catch { return fail("Couldn't reach chess.com. Check your connection and reload."); }
  if (!raw) return fail("chess.com hasn't published that game yet. It usually takes a few seconds: reload this page.");
  if (![raw.white.username, raw.black.username].some((n) => n.toLowerCase() === user.toLowerCase())) return fail(`${user} didn't play in that game.`);
  $("anTitle").textContent = "Checking every move…";
  $("fill").style.width = "30%";
  const coach = new Engine(), key = `${ANALYSIS_VERSION}:${user.toLowerCase()}:${raw.url}`;
  const g = (await cacheGet(key)) || (await analyseGame(raw, user, (fen) => coach.evaluate(fen, 15000)));
  cachePut(key, g);
  $("anTitle").textContent = "Writing your lesson…";
  $("fill").style.width = "80%";
  STATE = { coach, user, tc: g.tc, game: g };
  const L = (lesson = await gameLesson(g, [], (fen, nodes) => coach.evaluate(fen, nodes)));
  show("s1");
  prep(lesson); wtEl.hidden = false; $("askOut").textContent = ""; wtShow(0, true); $("wtNext").focus();
  coachLines(id, g, L);
  // while they go through the lesson, check their last games of this kind for the same mistake
  STATE.history = await recentHistory(user, g, month);
  const hs = habitStep(g, STATE.history);
  if (!hs || lesson !== L) return;
  Object.assign(hs, { from: hs.start, to: hs.start, mv: [], freeze: null });
  L.steps.splice(L.steps.length - 1, 0, hs); // the verdict stays last
  navUi();
}
const HABIT_GAMES = 30, HABIT_ENGINES = 2; // light: it runs while they use the lesson
async function recentHistory(user, g, month) {
  const pre = `${ANALYSIS_VERSION}:${user.toLowerCase()}:`, have = await cacheAll(pre), got = new Set(have.map((h) => h.url));
  for (const h of await cacheAll(`1:${user.toLowerCase()}:`)) if (!got.has(h.url)) { have.push(h); got.add(h.url); }
  const todo = month.filter((x) => x.rules === "chess" && x.pgn && x.time_class === g.tc && x.url !== g.url)
    .sort((a, b) => b.end_time - a.end_time).slice(0, HABIT_GAMES).filter((x) => !got.has(x.url));
  const engines = Array.from({ length: Math.min(HABIT_ENGINES, todo.length) }, () => new Engine());
  let next = 0;
  await Promise.all(engines.map(async (e) => {
    while (next < todo.length) {
      const x = todo[next++];
      try { const a = await analyseGame(x, user, (fen) => e.evaluate(fen, 15000)); have.push(a); cachePut(pre + x.url, a); } catch {}
    }
  }));
  engines.forEach((e) => e.stop());
  return have;
}

// ---------- the coach bubble: Claude explains every move from our Stockfish facts, one cached call per game ----------
async function coachLines(id, g, L) {
  const me = g.color === "white", sc = scoreOf(g.result); // my score: 1 won, 0.5 drew, 0 lost
  const result = sc === 0.5 ? "1/2-1/2" : (sc === 1) === me ? "1-0" : "0-1";
  try {
    const r = await fetch("https://chess-api.topc.social/game", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, moves: g.san, facts: L.facts, white: me ? STATE.user : g.op, black: me ? g.op : STATE.user, result }) });
    if (!r.ok) throw new Error("game " + r.status);
    for (const m of (await r.json()).moves) { const j = L.plyStep[m.ply + 1]; if (j != null) L.steps[j].body = m.text; }
    if (lesson === L) $("wtBody").innerHTML = sqLinks(L.steps[wi].body);
  } catch (e) { console.warn("coach lines unavailable, keeping engine text", e); }
}

// ---------- ask the coach: answered right here by Claude through the Explain Worker, streamed ----------
async function askHere(q, s, gi, fen, engine) {
  const out = $("askOut"), my = ++askToken;
  let n = cur; while (n && n.id > mainLen) n = n.parent; // the game move this board hangs off
  const ply = Math.max(0, (n ? n.id : 1) - 1), meW = gi.me === "white";
  const verdict = `${s.name}. ${s.body}${explored.length ? ` | Moves the player tried on the board: ${explored.join(" ")}` : ""} | Stockfish on the board now: ${engine}`.slice(0, 500);
  return streamCoach({ moves: gi.san, ply, verdict, question: q.slice(0, 400), fen, white: meW ? STATE.user : gi.op, black: meW ? gi.op : STATE.user }, my);
}
async function streamCoach(body, my = ++askToken) {
  const out = $("askOut");
  out.textContent = "Coach is thinking…";
  try {
    const r = await fetch("https://chess-api.topc.social/explain", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("explain " + r.status);
    const rd = r.body.getReader(), dec = new TextDecoder();
    let text = "";
    for (;;) { const { done, value } = await rd.read(); if (done || my !== askToken) break; text += dec.decode(value, { stream: true }); out.innerHTML = sqLinks(text); }
  } catch (e) { console.warn(e); if (my === askToken) out.textContent = "The coach couldn't answer right now. Try again in a moment."; }
}
let askToken = 0;

// ---------- ask Claude (runs on the visitor's own Claude account) ----------
function pvSan(fen, pv) { const c = new Chess(fen), out = []; for (const u of (pv || "").split(" ").filter(Boolean).slice(0, 6)) { try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }).san); } catch { break; } } return out.join(" "); }
const evalTxt = (cp, wtm) => { const w = wtm ? cp : -cp; return Math.abs(w) >= 9000 ? (w > 0 ? "White mates" : "Black mates") : `${w >= 0 ? "+" : ""}${(w / 100).toFixed(1)} (White's view)`; };
async function askClaude(q) {
  const out = $("askOut");
  out.textContent = "Getting the engine's view of this board…";
  const g = wb.game(), fen = g.fen(), wtm = g.turn() === "w", s = lesson.steps[wi];
  const here = await coachEval(fen, 250000);
  const gi = s.game;
  const engine = `${evalTxt(here.cp, wtm)}, best line ${pvSan(fen, here.pv)}`;
  if (gi && gi.san && mainLen) return askHere(q, s, gi, fen, engine);
  // practice games and lessons without one game: answered in the card too, from the board itself
  const moves = practice ? practice.sans : [], meW = practice ? practice.color === "w" : gi?.me !== "black";
  return streamCoach({ moves, ply: Math.max(0, moves.length - 1), fen, question: q.slice(0, 400),
    verdict: `${s.name}. ${s.body} | Stockfish on the board now: ${engine}`.slice(0, 500),
    white: meW ? STATE.user : practice ? "Practice bot" : gi?.op || "", black: meW ? (practice ? "Practice bot" : gi?.op || "") : STATE.user });
}

document.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-practice]")) startPracticeGame();
  const b = ev.target.closest("[data-wt]");
  if (b) { lesson = STATE.lessons.find((l) => l.key === b.dataset.wt); if (lesson) { prep(lesson); wtEl.hidden = false; $("askOut").textContent = ""; wtShow(0, true); $("wtNext").focus(); } }
  const mv = ev.target.closest("#mvList button");
  if (mv) nav(nodes[+mv.dataset.n]);
  const dot = ev.target.closest("#wtDots button"); if (dot) wtShow(+dot.dataset.j, false);
  const ref = ev.target.closest(".sqref");
  if (ref) {
    const s = lesson.steps[wi], t = ref.textContent.trim();
    if (s.best && t === s.bestSan) showBest();
    else if (/^[a-h][1-8]$/.test(t)) showAttackers(t);
    else playLine(ref).then((ok) => ok || showSan(t)).then((ok) => ok || wb.ping(ref.dataset.sq));
  }
  const chip = ev.target.closest("#askChips button"); if (chip) askClaude(chip.textContent);
  if (ev.target === wtEl) wtEl.hidden = true;
});
$("askForm").addEventListener("submit", (ev) => { ev.preventDefault(); const q = $("askIn").value.trim(); if (q) askClaude(q); });
$("wtClose").addEventListener("click", () => (wtEl.hidden = true));
$("wtPrev").addEventListener("click", () => wtShow(wi - 1, false));
$("wtNext").addEventListener("click", () => (wi === lesson.steps.length - 1 ? (wtEl.hidden = true) : wtShow(wi + 1, true)));
$("wtReplay").addEventListener("click", () => wtShow(wi, true));
$("mvPrev").addEventListener("click", () => nav(cur.parent));
$("mvNext").addEventListener("click", () => nav(cur.kids[0]));
$("mvFirst").addEventListener("click", () => nav(nodes[0]));
$("mvLast").addEventListener("click", () => { let n = cur; while (n.kids.length) n = n.kids[0]; nav(n); });
$("wtBest").addEventListener("click", showBest);
$("wtPlay").addEventListener("click", startPracticeGame);
// in a practice game, "Back" returns to where you are in that game, not to its first move
$("tryReset").addEventListener("click", () => {
  if (!practice) return wtShow(wi, false);
  ++token;
  wb.set(practice.fen, lesson.flip); wb.mark([], ""); wb.setBusy(false);
  cur = [...nodes].reverse().find((n) => n.fen === practice.fen) || cur; renderMoves();
  tryMsg("Back in your practice game. Your move.", true);
});
document.addEventListener("keydown", (ev) => {
  if (wtEl.hidden || ev.target.closest("input")) return;
  if (ev.key === "ArrowRight") nav(cur.kids[0]);
  if (ev.key === "ArrowLeft") nav(cur.parent);
  if (ev.key === "Escape") wtEl.hidden = true;
});

// ---------- start ----------
$("enter").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const user = $("user").value.trim().replace(/^.*chess\.com\/member\//i, "").replace(/\/.*$/, "");
  $("err").textContent = "";
  if (!/^[\w-]{3,25}$/.test(user)) { $("err").textContent = "That doesn't look like a chess.com username."; return; }
  run(user, document.querySelector("input[name=range]:checked").value);
});
staticBoard($("heroBoard"), "2k1r1r1/ppp2p1p/2q1p2B/4Q3/2P5/1NP2PPb/PP6/R2R2K1 b - - 0 22", { flip: true, hl: ["g8", "g3"], bad: true, arrow: ["c6", "f3"] });
const qs = new URLSearchParams(location.search);
const me = !qs.get("u") && !qs.get("game") && remembered();
if (me && me.u) { $("user").value = me.u; if (["3m", "500", "all"].includes(me.r)) document.querySelector(`input[name=range][value="${me.r}"]`).checked = true; run(me.u, me.r || "3m"); }
if (qs.get("u") && !qs.get("game")) { $("user").value = qs.get("u"); const r = qs.get("r"); if (["3m", "500", "all"].includes(r)) document.querySelector(`input[name=range][value="${r}"]`).checked = true; run(qs.get("u"), r || "3m"); }
if (qs.get("game") && qs.get("u")) review(qs.get("u"), qs.get("game"));
