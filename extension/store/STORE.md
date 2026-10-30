# Chrome Web Store listing

Paste these into the developer dashboard. Upload `chess-coach-extension-<version>.zip` (built from `manifest.json`, `content.js` and `icons/` only) and the screenshots in this folder.

**Name:** Chess Coach: free game review

**Summary** (from the manifest): After every chess.com game, one click turns it into a lesson: your mistakes, the better moves, and whether it's a habit. Free.

**Category:** Education

**Description:**

Finish a game on chess.com and a "Review with Chess Coach" button appears. One click opens your game as a lesson:

- The game replays to each move that cost you, and shows what happened and what was better.
- Try your own moves on the board. Stockfish grades them and answers.
- Step through the whole game move by move. Your tries and the engine's lines branch off like a normal analysis board.
- If the mistake is one you keep making, it tells you: "you've done this in 12 of your last 30 blitz games", with a link to the last time.
- Ask Claude about any position. It opens your own Claude with the board, the engine's view and your question written out.

Free, no sign-up, no limits. Stockfish runs in your own browser: no account, no server checking your games.

Fair play: the extension never reads the board and does nothing while you play. It only shows its button after chess.com itself shows the game is over.

Open source (GPL-3.0): https://github.com/kamal0808/chess-coach. Made by TOPC (https://topc.social).

**Single purpose:** Adds a button to finished chess.com games that opens a free review of that game on chess.topc.social.

**Permission justification (content script on https://www.chess.com/*):** Needed to show the review button on chess.com game pages and to ask chess.com's own game endpoint whether the game on screen is finished. It reads no board positions and changes nothing on the page apart from adding the button.

**Remote code:** No.

**Data usage:** Collects nothing. The chess.com username and game id go into the review link the user clicks, and the review runs in the user's browser.

Not affiliated with chess.com.
