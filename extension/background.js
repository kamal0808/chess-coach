// Runs Stockfish for the content script: workers can't start inside chess.com's page, so they live in an offscreen document.
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["WORKERS"], justification: "Run Stockfish on a finished game for the review" });
}
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== "analyse") return;
  ensureOffscreen()
    .then(() => chrome.runtime.sendMessage({ ...msg, target: "offscreen" }))
    .then(reply, (e) => reply({ error: String(e) }));
  return true;
});
