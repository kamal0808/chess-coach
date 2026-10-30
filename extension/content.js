// Shows "Review with Chess Coach" on chess.com once a game is over. Fair play: it never reads the board,
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

let t;
new MutationObserver(() => { clearTimeout(t); t = setTimeout(check, 400); }).observe(document.body, { childList: true, subtree: true });
check();
