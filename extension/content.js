// Shows "Review with Chess Coach" on chess.com once a game is over, and an Explain button in chess.com's Game Review. Fair play: it never reads the board,
// and only asks chess.com whether the game is finished after chess.com itself shows its "Game Review" button.
const SITE = "update_url" in chrome.runtime.getManifest() ? "https://chess.topc.social" : "http://localhost:3010"; // unpacked = local dev
let shownFor = null, checking = false;

const gameId = () => (location.pathname.match(/^\/game\/(?:live\/)?(\d+)/) || [])[1];
const hasReviewButton = () => [...document.querySelectorAll("button, a")].some((b) => b.textContent.trim() === "Game Review");

async function check() {
  const id = gameId();
  if (shownFor && shownFor !== id) { document.getElementById("cc-review")?.remove(); shownFor = null; }
  if (!id || shownFor === id || checking || !hasReviewButton()) return;
  checking = true;
  try {
    const d = await fetch(`/callback/live/game/${id}`).then((r) => r.json());
    if (!d.game?.isFinished || gameId() !== id) return;
    const a = document.createElement("a");
    a.id = "cc-review";
    a.href = `${SITE}/?game=${id}&u=${encodeURIComponent(d.players.bottom.username)}`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "♞ Review with Chess Coach · free";
    a.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:99999;background:#7dbb53;color:#12210a;font:700 16px system-ui,sans-serif;padding:14px 20px;border-radius:10px;text-decoration:none;box-shadow:0 6px 20px rgba(0,0,0,.4)";
    document.body.append(a);
    shownFor = id;
  } catch {} finally { checking = false; }
}

// ---------- inside chess.com's own Game Review: an Explain button next to their Next ----------
// The game is over by then, so reading it is fair play. ?move=N in the address is the move the review is on.
const reviewId = () => (location.pathname.match(/^\/analysis\/game\/(?:live|daily)\/(\d+)\/review/) || [])[1];
const games = {};
async function gameMoves(id) {
  if (games[id]) return games[id];
  const d = await fetch(`/callback/live/game/${id}`).then((r) => r.json());
  const h = d.game.pgnHeaders, [y, m] = h.Date.split(".");
  const month = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(h.White)}/games/${y}/${m}`).then((r) => r.json());
  const g = month.games.find((x) => x.url.endsWith("/" + id));
  if (!g) throw new Error("not published yet");
  const san = g.pgn.replace(/\[[^\]]*\]/g, "").replace(/\{[^}]*\}/g, "").replace(/\d+\.(\.\.)?/g, "").split(/\s+/).filter((x) => x && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(x));
  return (games[id] = { h, san });
}
// chess.com's coach bubble for the current move: the smallest element saying "X is a mistake", plus its comment
function verdict() {
  let el = null;
  for (const e of document.querySelectorAll("div, span, p")) {
    const t = e.textContent.trim();
    if (t.length < 80 && / is (?:a |an |the )?(?:best|book|brilliant|great|excellent|good|inaccuracy|mistake|miss|blunder|forced)/i.test(t) && (!el || t.length < el.textContent.trim().length)) el = e;
  }
  if (!el) return "";
  const head = el.textContent.trim();
  for (let p = el.parentElement, i = 0; p && i < 4; p = p.parentElement, i++) if (p.textContent.trim().length > head.length + 15) return p.innerText.replace(/\s+/g, " ").trim().slice(0, 400);
  return head;
}
const numbered = (san) => san.map((m, i) => (i % 2 ? m : `${i / 2 + 1}. ${m}`)).join(" ");
async function explain(btn) {
  const id = reviewId(), ply = +(new URLSearchParams(location.search).get("move") || 0);
  const label = btn.textContent;
  btn.textContent = "Getting the game…";
  try {
    const { h, san } = await gameMoves(id), mv = san[ply];
    const prompt = `You're my chess coach. Answer in plain words, at most 150 words. Use square names (e4) and normal move notation.

Game: ${h.White} (${h.WhiteElo}) vs ${h.Black} (${h.BlackElo}), ${h.Result}, ${h.TimeControl}s.
The moves: ${numbered(san)}

I'm looking at move ${Math.floor(ply / 2) + 1}${ply % 2 ? "…" : "."}${mv} (${ply % 2 ? "Black" : "White"}).
chess.com's Game Review says: "${verdict()}"

Explain why this move is good or bad, what was better and why, and the line that punishes it if there is one. Set up the position from the moves before you answer. If you're not sure about a line, say so instead of guessing.`;
    try { await navigator.clipboard.writeText(prompt); } catch {}
    window.open("https://claude.ai/new?q=" + encodeURIComponent(prompt), "_blank", "noopener");
  } catch { alert("Chess Coach couldn't get this game from chess.com yet. Try again in a few seconds."); }
  btn.textContent = label;
}
function addExplain() {
  if (!reviewId()) { document.getElementById("cc-explain")?.remove(); return; }
  if (document.getElementById("cc-explain")) return;
  const next = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Next");
  const b = document.createElement("button");
  b.id = "cc-explain";
  b.type = "button";
  b.textContent = "💡 Explain";
  b.title = "Chess Coach: ask your Claude why";
  b.style.cssText = "flex:1;min-height:48px;margin-right:8px;border:0;border-radius:6px;background:#3c3a37;color:#fff;font:700 16px system-ui,sans-serif;cursor:pointer;box-shadow:0 3px 0 #2b2926";
  b.addEventListener("click", () => explain(b));
  if (next) next.before(b);
  else { b.style.cssText += ";position:fixed;right:20px;bottom:84px;z-index:99999;flex:none;padding:0 20px"; document.body.append(b); }
}

let t;
new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { check(); addExplain(); }, 400); }).observe(document.body, { childList: true, subtree: true });
check();
addExplain();
