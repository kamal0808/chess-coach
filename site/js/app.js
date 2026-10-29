import { Chess } from "../vendor/chess.js";
import { analyseGame, buildStats, winPct, openingName } from "./core.js";
import { buildLessons, gameLesson, moveNo, evalWords } from "./lessons.js";
import { Engine, poolSize } from "./engine.js";
import { staticBoard, LessonBoard, evalBar } from "./board.js";

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtClock = (t) => { if (t == null) return "–"; t = Math.max(0, t); return t < 20 ? `0:${t.toFixed(1).padStart(4, "0")}` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`; };
const ANALYSIS_VERSION = 1;

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
async function run(user, range) {
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
  for (const g of games) { const c = await cacheGet(`${ANALYSIS_VERSION}:${user.toLowerCase()}:${g.url}`); c ? done.push(c) : todo.push(g); }
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
  $("plan").innerHTML = plan.map(([t, d2, wt, link], i) => `<div class="step"><span class="ic" aria-hidden="true">${i + 1}</span><span class="tx"><b>${esc(t)}</b><span class="muted small">${esc(d2)}</span></span><span class="go">${wt ? `<button class="btn sm" type="button" data-wt="${wt}">Start lesson</button>` : ""}${link ? `<a class="btn sm ghost" href="${link[1]}" target="_blank" rel="noopener">${link[0]} ↗</a>` : ""}</span></div>`).join("");
  $("again").onclick = () => { history.replaceState(null, "", location.pathname); show("s1"); };
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
}
const tryMsg = (html, explore) => { $("tryMsg").innerHTML = html; $("tryReset").hidden = !explore; };
const CLS = [[0, "best", "★", "the best move"], [2, "exc", "✓", "excellent"], [5, "good", "✓", "good"], [10, "inacc", "?!", "an inaccuracy"], [20, "mist", "?", "a mistake"], [Infinity, "blun", "??", "a blunder"]];
const coachEval = (fen, nodes, stale) => STATE.coach.evaluate(fen, nodes, stale);
function evalHere(my) {
  const g = wb.game(), fen = g.fen(), turnW = g.turn() === "w";
  coachEval(fen, 60000, () => my !== token).then((r) => { if (r && my === token) evalBar($("evb"), turnW ? r.cp : -r.cp, wb.flip()); });
}
async function wtShow(i, animate) {
  wi = Math.max(0, Math.min(lesson.steps.length - 1, i));
  const s = lesson.steps[wi], my = ++token;
  explored = [];
  $("wtStep").textContent = `${lesson.title} · step ${wi + 1} of ${lesson.steps.length}`;
  const n = $("wtName"); n.textContent = s.name; n.className = "mvname " + (s.tone || "");
  $("wtBody").innerHTML = sqLinks(s.body);
  $("wtExtra").innerHTML = (s.stat ? `<span class="stat">${esc(s.stat)}</span> ` : "") +
    (s.link ? `<a class="btn ghost sm" href="${esc(s.link)}" target="_blank" rel="noopener">See your game ↗</a>` : "") +
    (s.cta ? `<a class="btn sm" href="${esc(s.cta[1])}">${esc(s.cta[0])}</a>` : "") +
    (s.rule ? `<div class="rule"><b>Remember:</b> ${sqLinks(s.rule)}</div>` : "");
  $("wtDots").innerHTML = lesson.steps.map((x, j) => `<button type="button" aria-label="Step ${j + 1}" class="${j === wi ? "on" : x.tone || ""}" data-j="${j}"></button>`).join("");
  $("wtPrev").disabled = wi === 0;
  $("wtNext").textContent = wi === lesson.steps.length - 1 ? "Done ✓" : "Next →";
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
  wb.setBusy(false);
  evalHere(my);
}
wb.onMove(async (m, fromDrag) => {
  explored.push(m.san);
  const my = ++token, before = wb.game().fen(), turnW = wb.game().turn() === "w";
  const pre = coachEval(before, 60000);
  wb.setBusy(true);
  await wb.play(m, fromDrag ? 0 : 200);
  wb.mark([m.from, m.to], "last");
  const s = lesson.steps[wi];
  if (s.game) bars({ ...s, alt: true, freeze: s.alt ? s.freeze : plyOf(s.to) }, 0);
  const g = wb.game();
  if (g.isCheckmate()) { tryMsg(`<b>${esc(m.san)}</b> is checkmate.`, true); evalBar($("evb"), turnW ? 10000 : -10000, wb.flip()); return; }
  if (g.isGameOver()) { tryMsg(`<b>${esc(m.san)}</b>: it's a draw.`, true); evalBar($("evb"), 0, wb.flip()); return; }
  tryMsg(`<b>${esc(m.san)}</b> · Stockfish is thinking…`, true);
  const [b, a] = await Promise.all([pre, coachEval(g.fen(), 60000)]);
  if (my !== token || !b || !a) return;
  const drop = winPct(b.cp) - winPct(-a.cp), best = b.best === m.from + m.to + (m.promotion || "");
  const [, cls, sym, word] = best ? CLS[0] : CLS.find((c) => drop < c[0]);
  wb.badge(m.to, cls, sym);
  evalBar($("evb"), turnW ? -a.cp : a.cp, wb.flip());
  let bestSan = ""; try { bestSan = new Chess(before).move({ from: b.best.slice(0, 2), to: b.best.slice(2, 4), promotion: b.best[4] || "q" }).san; } catch {}
  tryMsg(`<span class="bdg ${cls} inl">${sym}</span> <b>${esc(m.san)}</b> is ${word}.${best || !bestSan ? "" : ` Best was <b>${esc(bestSan)}</b>.`}`, true);
  await new Promise((r) => setTimeout(r, 650));
  if (my !== token || !a.best || a.best === "(none)") { wb.setBusy(false); return; }
  const reply = g.moves({ verbose: true }).find((x) => x.from + x.to === a.best.slice(0, 4) && (!x.promotion || x.promotion === (a.best[4] || "q")));
  if (reply) { await wb.play(reply, 320); if (my !== token) return; explored.push(reply.san); wb.mark([reply.from, reply.to], "last"); if (reply.to !== m.to) wb.badge(m.to, cls, sym); }
  wb.setBusy(false);
  evalHere(my);
});

// ---------- one game, opened from the extension: /?game=<chess.com id>&u=<username> ----------
async function findGame(user, id) {
  const now = new Date();
  for (const k of [0, 1]) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    let gs = [];
    try { ({ games: gs = [] } = await getJson(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`)); } catch (e) { if (e.message !== "not_found") throw e; }
    const g = gs.find((x) => x.url.endsWith("/" + id));
    if (g) return g;
  }
  return null;
}
async function review(user, id) {
  $("user").value = user;
  show("s2");
  $("anUser").textContent = user;
  $("anTitle").textContent = "Finding your game…";
  $("found").closest(".side").querySelectorAll(".eyebrow")[1].hidden = true;
  const fail = (msg) => { show("s1"); $("err").textContent = msg; };
  let raw;
  try { raw = await findGame(user, id); } catch { return fail("Couldn't reach chess.com. Check your connection and reload."); }
  if (!raw) return fail("chess.com hasn't published that game yet. It usually takes a few seconds: reload this page.");
  if (![raw.white.username, raw.black.username].some((n) => n.toLowerCase() === user.toLowerCase())) return fail(`${user} didn't play in that game.`);
  $("anTitle").textContent = "Checking every move…";
  $("fill").style.width = "30%";
  const coach = new Engine(), key = `${ANALYSIS_VERSION}:${user.toLowerCase()}:${raw.url}`;
  const g = (await cacheGet(key)) || (await analyseGame(raw, user, (fen) => coach.evaluate(fen, 15000)));
  cachePut(key, g);
  $("anTitle").textContent = "Writing your lesson…";
  $("fill").style.width = "80%";
  const history = await cacheAll(`${ANALYSIS_VERSION}:${user.toLowerCase()}:`);
  STATE = { coach, user, tc: g.tc, game: g };
  lesson = await gameLesson(g, history, (fen, nodes) => coach.evaluate(fen, nodes));
  if (!history.some((h) => h.url !== g.url)) lesson.steps[lesson.steps.length - 1].cta = ["Is this a habit? Check my last 3 months →", `/?u=${encodeURIComponent(user)}`];
  show("s1");
  prep(lesson); wtEl.hidden = false; $("askOut").textContent = ""; wtShow(0, true); $("wtNext").focus();
}

// ---------- ask Claude (runs on the visitor's own Claude account) ----------
function pvSan(fen, pv) { const c = new Chess(fen), out = []; for (const u of (pv || "").split(" ").filter(Boolean).slice(0, 6)) { try { out.push(c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }).san); } catch { break; } } return out.join(" "); }
const evalTxt = (cp, wtm) => { const w = wtm ? cp : -cp; return Math.abs(w) >= 9000 ? (w > 0 ? "White mates" : "Black mates") : `${w >= 0 ? "+" : ""}${(w / 100).toFixed(1)} (White's view)`; };
async function askClaude(q) {
  const out = $("askOut");
  out.textContent = "Getting the engine's view of this board…";
  const g = wb.game(), fen = g.fen(), wtm = g.turn() === "w", s = lesson.steps[wi];
  const here = await coachEval(fen, 250000);
  const gi = s.game;
  const prompt = `You're my chess coach. Answer in plain words, at most 150 words. Use square names (e4) and normal move notation.

About me: chess.com player ${STATE.user}, about ${gi ? gi.myR : STATE.stats.ratingLast} rated in ${STATE.tc}.${gi ? ` In this game I was ${gi.me} against ${gi.op} (${gi.opR}), ${gi.res.replace(/^You /, "I ").toLowerCase()}.` : ""}${STATE.game ? `
The whole game: ${STATE.game.san.map((m, i) => (i % 2 ? m : `${i / 2 + 1}. ${m}`)).join(" ")}` : ""}

The board right now (FEN): ${fen}
${wtm ? "White" : "Black"} to move.
Lesson: "${lesson.title}", step "${s.name}": ${s.body}
${explored.length ? `Moves I tried on the board from the lesson position: ${explored.join(" ")}\n` : ""}Stockfish 19 here: ${evalTxt(here.cp, wtm)}, best line: ${pvSan(fen, here.pv)}

Trust the engine's evaluation over your own calculation. If you're not sure about a line, say so.

My question: ${q}`;
  let copied = false;
  try { await navigator.clipboard.writeText(prompt); copied = true; } catch {}
  const url = "https://claude.ai/new?q=" + encodeURIComponent(prompt);
  // a side window, so the board stays in view; same name, so follow-ups reuse it
  const w = Math.min(560, Math.round(screen.availWidth * 0.4));
  window.open(url, "cc-claude", `popup,width=${w},height=${screen.availHeight},left=${screen.availWidth - w},top=0`);
  out.innerHTML = `Opened Claude beside the board with your question.${copied ? " It's also copied: if the box is empty there, paste it." : ""} <a href="${url}" target="_blank" rel="noopener">Open again ↗</a>`;
}

document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-wt]");
  if (b) { lesson = STATE.lessons.find((l) => l.key === b.dataset.wt); if (lesson) { prep(lesson); wtEl.hidden = false; $("askOut").textContent = ""; wtShow(0, true); $("wtNext").focus(); } }
  const dot = ev.target.closest("#wtDots button"); if (dot) wtShow(+dot.dataset.j, false);
  const ref = ev.target.closest(".sqref"); if (ref) wb.ping(ref.dataset.sq);
  const chip = ev.target.closest("#askChips button"); if (chip) askClaude(chip.textContent);
  if (ev.target === wtEl) wtEl.hidden = true;
});
$("askForm").addEventListener("submit", (ev) => { ev.preventDefault(); const q = $("askIn").value.trim(); if (q) askClaude(q); });
$("wtClose").addEventListener("click", () => (wtEl.hidden = true));
$("wtPrev").addEventListener("click", () => wtShow(wi - 1, false));
$("wtNext").addEventListener("click", () => (wi === lesson.steps.length - 1 ? (wtEl.hidden = true) : wtShow(wi + 1, true)));
$("wtReplay").addEventListener("click", () => wtShow(wi, true));
$("tryReset").addEventListener("click", () => wtShow(wi, false));
document.addEventListener("keydown", (ev) => {
  if (wtEl.hidden || ev.target.closest("input")) return;
  if (ev.key === "ArrowRight" && wi < lesson.steps.length - 1) wtShow(wi + 1, true);
  if (ev.key === "ArrowLeft") wtShow(wi - 1, false);
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
if (qs.get("u") && !qs.get("game")) { $("user").value = qs.get("u"); const r = qs.get("r"); if (["3m", "500", "all"].includes(r)) document.querySelector(`input[name=range][value="${r}"]`).checked = true; run(qs.get("u"), r || "3m"); }
if (qs.get("game") && qs.get("u")) review(qs.get("u"), qs.get("game"));
