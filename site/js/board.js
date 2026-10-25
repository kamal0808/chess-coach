// Boards: a static one for the report, and the lesson board you can play on.
import { Chess } from "../vendor/chess.js";
import { winPct } from "./core.js";

export function sqXY(sq, flip) { const f = sq.charCodeAt(0) - 97, r = +sq[1]; return flip ? [7 - f, r - 1] : [f, 8 - r]; }
const ARROW = { orange: "rgba(255,170,0,.85)", red: "rgba(220,50,40,.85)", green: "rgba(70,170,60,.9)" };
function arrowsSvg(arrows, flip) {
  const pt = (s) => { const [x, y] = sqXY(s, flip); return [x + .5, y + .5]; };
  return `<svg viewBox="0 0 8 8" aria-hidden="true" class="arr">${arrows.map(([a0, b0, c]) => {
    const [a, b] = [a0, b0].map(pt), dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L;
    const tip = [b[0] - ux * .1, b[1] - uy * .1], base = [tip[0] - ux * .45, tip[1] - uy * .45], nx = -uy * .28, ny = ux * .28;
    return `<line x1="${a[0]}" y1="${a[1]}" x2="${base[0]}" y2="${base[1]}" stroke="${ARROW[c]}" stroke-width=".2" stroke-linecap="round"/><polygon fill="${ARROW[c]}" points="${tip[0]},${tip[1]} ${base[0] + nx},${base[1] + ny} ${base[0] - nx},${base[1] - ny}"/>`;
  }).join("")}</svg>`;
}
function squares(flip) {
  let h = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const file = flip ? 7 - x : x, rank = flip ? y + 1 : 8 - y;
    h += `<div class="s ${(x + y) % 2 ? "d" : "l"}">${x === 0 ? `<span class="co r">${rank}</span>` : ""}${y === 7 ? `<span class="co f">${"abcdefgh"[file]}</span>` : ""}</div>`;
  }
  return `<div class="sqs">${h}</div>`;
}

// A picture of a position: highlights on `hl` squares (red when bad), an optional arrow
export function staticBoard(el, fen, { flip = false, hl = [], bad = false, arrow = null } = {}) {
  const c = new Chess(fen);
  let pcs = "", hls = "";
  for (const sq of hl) { const [x, y] = sqXY(sq, flip); hls += `<div class="h ${bad ? "bad" : "last"}" style="left:${x * 12.5}%;top:${y * 12.5}%"></div>`; }
  for (const row of c.board()) for (const p of row) if (p) { const [x, y] = sqXY(p.square, flip); pcs += `<i class="pc ${p.color}${p.type}" style="left:${x * 12.5}%;top:${y * 12.5}%"></i>`; }
  el.classList.add("lb", "still");
  el.innerHTML = squares(flip) + `<div class="hls">${hls}</div><div class="pcs">${pcs}</div>` + (arrow ? arrowsSvg([[...arrow, "orange"]], flip) : "");
}

let actx;
function sfx(capture) {
  try {
    actx = actx || new AudioContext();
    const t = actx.currentTime, o = actx.createOscillator(), v = actx.createGain();
    o.type = "triangle";
    o.frequency.setValueAtTime(capture ? 260 : 520, t);
    o.frequency.exponentialRampToValueAtTime(capture ? 90 : 170, t + .07);
    v.gain.setValueAtTime(.22, t); v.gain.exponentialRampToValueAtTime(.001, t + .11);
    o.connect(v).connect(actx.destination); o.start(t); o.stop(t + .12);
  } catch {}
}

export function LessonBoard(el) {
  el.innerHTML = '<div class="sqs"></div><div class="hls"></div><div class="pcs"></div>';
  const hls = el.querySelector(".hls"), pcs = el.querySelector(".pcs");
  let flip = null, map = {}, g = new Chess(), sel = null, drag = null, busy = false, onUser = null;
  const place = (p, sq) => { const [x, y] = sqXY(sq, flip); p.style.left = x * 12.5 + "%"; p.style.top = y * 12.5 + "%"; };
  const addH = (cls, sq, html = "") => { const d = document.createElement("div"), [x, y] = sqXY(sq, flip); d.className = "h " + cls; d.style.left = x * 12.5 + "%"; d.style.top = y * 12.5 + "%"; d.innerHTML = html; hls.appendChild(d); };
  function set(fen, f) {
    if (f !== flip) { flip = f; el.querySelector(".sqs").outerHTML = squares(flip); }
    pcs.innerHTML = ""; map = {}; sel = null;
    g = new Chess(fen);
    for (const row of g.board()) for (const c of row) if (c) {
      const p = document.createElement("i"); p.className = "pc " + c.color + c.type; place(p, c.square); pcs.appendChild(p); map[c.square] = p;
    }
  }
  function mark(sqList, tone, arrows) {
    hls.innerHTML = ""; sel = null;
    for (const sq of sqList) addH(tone || "", sq);
    el.querySelector("svg.arr")?.remove();
    if (arrows && arrows.length) el.insertAdjacentHTML("beforeend", arrowsSvg(arrows, flip));
  }
  async function play(m, ms) {
    el.style.setProperty("--ms", ms + "ms");
    mark([m.from, m.to], "last");
    g.move(m.san);
    const p = map[m.from];
    const capSq = m.flags.includes("e") ? m.to[0] + m.from[1] : m.to;
    if (map[capSq] && capSq !== m.from) { const c = map[capSq]; c.classList.add("gone"); setTimeout(() => c.remove(), ms); delete map[capSq]; }
    place(p, m.to); delete map[m.from]; map[m.to] = p;
    if (m.flags.includes("k") || m.flags.includes("q")) {
      const r = m.color === "w" ? "1" : "8", [rf, rt] = m.flags.includes("k") ? ["h" + r, "f" + r] : ["a" + r, "d" + r];
      const rp = map[rf]; place(rp, rt); delete map[rf]; map[rt] = rp;
    }
    if (m.promotion) setTimeout(() => (p.className = "pc " + m.color + m.promotion), ms);
    setTimeout(() => sfx(!!m.captured), ms * .85);
    await new Promise((res) => setTimeout(res, ms + 60));
  }
  const ping = (sq) => { hls.querySelector(".ping")?.remove(); addH("ping", sq); };
  const badge = (sq, cls, sym) => addH("badge", sq, `<b class="bdg ${cls}">${sym}</b>`);

  const legalFrom = (sq) => g.moves({ square: sq, verbose: true });
  function select(sq) {
    hls.querySelectorAll(".sel,.dot").forEach((d) => d.remove()); sel = sq;
    if (!sq) return;
    addH("sel", sq);
    for (const m of legalFrom(sq)) addH(m.captured ? "dot cap" : "dot", m.to);
  }
  function sqAt(e) {
    const r = el.getBoundingClientRect(), x = Math.floor((e.clientX - r.left) / r.width * 8), y = Math.floor((e.clientY - r.top) / r.height * 8);
    if (x < 0 || x > 7 || y < 0 || y > 7) return null;
    return "abcdefgh"[flip ? 7 - x : x] + (flip ? y + 1 : 8 - y);
  }
  function tryMove(from, to, fromDrag) {
    const m = legalFrom(from).find((x) => x.to === to && (!x.promotion || x.promotion === "q"));
    select(null);
    if (m && onUser) onUser(m, fromDrag);
    return !!m;
  }
  el.addEventListener("pointerdown", (e) => {
    if (busy) return;
    const sq = sqAt(e); if (!sq) return;
    if (sel && sel !== sq && legalFrom(sel).some((m) => m.to === sq)) { e.preventDefault(); tryMove(sel, sq, false); return; }
    const pc = g.get(sq);
    if (!pc || pc.color !== g.turn()) { select(null); return; }
    e.preventDefault();
    const again = sel === sq;
    select(sq);
    drag = { p: map[sq], sq, again, moved: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const r = el.getBoundingClientRect();
    drag.moved = true; drag.p.classList.add("drag");
    drag.p.style.left = ((e.clientX - r.left) / r.width * 100 - 6.25) + "%";
    drag.p.style.top = ((e.clientY - r.top) / r.height * 100 - 6.25) + "%";
  });
  el.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag; drag = null; d.p.classList.remove("drag");
    const sq = sqAt(e);
    if (d.moved && sq && sq !== d.sq && tryMove(d.sq, sq, true)) return;
    place(d.p, d.sq);
    if (d.again && !d.moved) select(null);
  });
  return { set, mark, play, ping, badge, game: () => g, flip: () => flip, setBusy: (b) => (busy = b), onMove: (fn) => (onUser = fn) };
}

export function evalBar(el, whiteCp, flip) {
  el.classList.toggle("flip", !!flip);
  const s = el.querySelector("span");
  if (whiteCp === null) { s.textContent = ""; return; }
  el.querySelector("i").style.height = winPct(whiteCp) + "%";
  s.textContent = Math.abs(whiteCp) >= 9000 ? "M" + (10000 - Math.abs(whiteCp)) : (Math.abs(whiteCp) / 100).toFixed(1);
  s.className = whiteCp >= 0 ? "wa" : "ba";
}
