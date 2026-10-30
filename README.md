# Chess Coach

Type your chess.com username and find out why you keep losing. Stockfish checks every move of your recent games right in your browser, finds the few habits costing you rating, and turns them into move-by-move lessons from your own games. Live at [chess.topc.social](https://chess.topc.social).

- Everything runs in the visitor's browser: games come from chess.com's public API, and Stockfish 19 (lite, WebAssembly) runs in web workers. No server, no accounts.
- "Ask Claude" opens the visitor's own Claude with the board, the engine's view and their question written out.

## Run it

```bash
python3 -m http.server 3010 -d site
```

Then open http://localhost:3010. `npm install && node test/check.mjs <dir of chess.com monthly JSON> <username> [games]` runs the analysis and lesson code in node on real games.

## Review one game

`/?game=<chess.com game id>&u=<username>` turns one game into a lesson: the worst moves, what was better, and a "this is a habit" step when the same kind of mistake shows up in the player's last 30 games (checked in the background).

The Chrome extension in `extension/` adds a "Review with Chess Coach" button on chess.com once a game is over. For fair play it never reads the board: it waits for chess.com's own "Game Review" button, then asks chess.com's game endpoint whether that game is finished. Load it unpacked from `chrome://extensions` (Developer mode) and it points at `http://localhost:3010`; installed from the Chrome Web Store it points at chess.topc.social.

## Contribute

Tasks and the Neki ledger live in [topc-social/chess-coach-tasks](https://github.com/topc-social/chess-coach-tasks). Pick an issue, hand in a pull request here.

## Licence

GPL-3.0. Bundles [Stockfish](https://github.com/official-stockfish/Stockfish) via [stockfish.js](https://github.com/nmrugg/stockfish.js) (GPL-3.0), [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause) and the cburnett piece set by Colin M.L. Burnett (GPL-2.0+).
