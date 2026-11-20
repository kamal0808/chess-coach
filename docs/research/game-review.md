# Game Review research: chess.com, lichess, and what players complain about

Researched 2026-11-20 for Chess Coach (chess.topc.social). The question: how chess.com's one-game review works move by move, what players dislike about it, and which complaints a free, browser-only reviewer (Stockfish WASM plus a link out to the user's own Claude) could beat cheaply.

**Gaps.** Reddit (r/chess, r/chessbeginners) could not be reached. reddit.com and old.reddit.com refused automated fetches, and web search returned no Reddit threads. So the complaints below come from chess.com forums and blogs, the App Store, Trustpilot and lichess. Some chess.com announcements and lichess pages sit behind a login or return 403. Where I relied on a search-result snippet instead of the full page, the item says so.

---

## 1. How chess.com Game Review works

### Move classifications

- **The Expected Points model.** Chess.com estimates a player's winning chances from **their rating and the engine eval**, on a scale where 1.00 is a sure win, 0.00 a sure loss and 0.50 even. Each move is labelled by how many expected points it loses. ([support: how are moves classified](https://support.chess.com/en/articles/8572705-how-are-moves-classified-what-is-a-blunder-or-brilliant-and-etc))

| Label | Expected points lost |
|---|---|
| Best | 0.00 |
| Excellent | 0.00 to 0.02 |
| Good | 0.02 to 0.05 |
| Inaccuracy | 0.05 to 0.10 |
| Mistake | 0.10 to 0.20 |
| Blunder | 0.20 to 1.00 |

  (same source)
- **Labels that don't come from the thresholds** (same source):
  - **Great**: a move "critical to the outcome of the game", for example turning a losing position into an equal one, an equal one into a winning one, or finding the only good move.
  - **Brilliant**: "a good piece sacrifice". The move must be the best or nearly best, must not leave you in a bad position, and you must not already have been completely winning.
  - **Miss**: you "fail to capitalize on your opponent's mistake" and lose the chance to reach a winning position.
  - **Rating matters.** Great and Brilliant are "more generous" for newer players, including what counts as a sacrifice. The eval needed to call a position winning, equal or losing also changes with rating.
- **Book** isn't defined on that page. The Game Review help page says the first key move is usually the last book move, and the coach can show the opening's name. ([support: How does Game Review work?](https://support.chess.com/en/articles/8584089), dated 2026-09-25)
- **Exact Great, Brilliant and Miss cutoffs are not published.** I found no official numbers. A forum user says the exact values aren't released, but that is a community claim, read in a search snippet. ([forum: move evaluation descriptions](https://www.chess.com/forum/view/general/move-evaluation-descriptions))

### The coach and its buttons

- **The coach** shows up by default and can be switched or muted. Its feedback updates with each move. Key moves are "a critical move during a game that significantly influences the outcome or course of the match." ([support: Game Review](https://support.chess.com/en/articles/8584089))
- **Best.** "If multiple options are available, you can click 'Best' to see the strongest move." (same source)
- **Retry.** "Click 'Retry' to replay the position and try to find the best move." (same source, 2026-09-25)
- **Explain vs Show Follow-Up.** A chess.com announcement says the old Show Follow-Up button became **Explain**: the coach now pauses after each move of the suggested line and says why it's best. The same announcement says Retry was removed. That page is behind a login, so I only read this in a search snippet. ([announcement: Coach now with more in-depth line explanation](https://www.chess.com/announcements/view/update-game-reviews-coach-now-with-more-in-depth-line-explanation)) The September 2026 help page still lists Retry, so the current buttons need checking in the app.
- **Coach arrows** ([support: coloured arrows](https://support.chess.com/en/articles/17665907-what-do-the-colored-arrows-in-game-review-mean), 2026-10-19):
  - green: a stronger move or another good option
  - red: a threat or danger
  - orange: the main idea being explained
  - blue: the opponent's plans

### Eval graph, accuracy and game rating

- **Eval graph.** "This graph indicates who had the advantage at each stage of the game." The coach adds "a brief, one-line summary of how the game unfolded." ([support: Game Review](https://support.chess.com/en/articles/8584089))
- **Accuracy (CAPS2).** A score from 0 to 100 against the engine's top moves. The formula isn't published: "the math on how these are calculated has changed". Most scores land between 50 and 95, and the scale is meant to feel like a school grade. ([support: how is accuracy in analysis](https://support.chess.com/en/articles/8708970-how-is-accuracy-in-analysis))
- **Game Rating.** It "estimates how well you played in a single game based on the quality of your moves." ([support: Game Review](https://support.chess.com/en/articles/8584089))
- **The 2024 redesign** moved the eval graph and the performance rating to the top of the screen, with the coach "always at the top of the screen, guiding you through the key moments." ([chess.com news, 2024-07-25](https://chess.com/news/view/game-review-design-update))

### End-of-review summary

- **Report Card.** The coach grades each phase (opening, middlegame, endgame) with a classification glyph from blunder to brilliant, and hovering a glyph shows your accuracy for that phase. Login-walled, read in a search snippet. ([announcement: Report Card in Game Review](https://www.chess.com/announcements/view/report-card-in-game-review))
- **Openings, Tactics and Strategy cards**: I found no official source for summary cards with those names. Not confirmed.
- **Insights** is the cross-game view: accuracy over time, accuracy by move number, openings, tactics, move quality. It is **Diamond only**. ([support: what is Insights](https://support.chess.com/en/articles/8708925-what-is-insights-on-chess-com))

### Free vs paid

| Plan | Game Review |
|---|---|
| Free (Basic) | "1 full game review analysis per day" |
| Gold | no Game Review or Coach Explanations listed |
| Platinum | "UNLIMITED game review and analysis" |
| Diamond | unlimited reviews plus "coach explanations on all of your moves!" |

  ([support: Premium plans](https://support.chess.com/en/articles/8562418-what-are-the-differences-between-membership-types))
- **Old reviews are free to reopen.** Viewing a Game Review that was already generated doesn't count against the daily limit. ([support: Game Review](https://support.chess.com/en/articles/8584089))
- **After the daily review**, a basic member's further reviews show no explanations. ([forum: Coach Explanations, Martin_Stahl, 2022-09-02](https://www.chess.com/forum/view/game-analysis/chess-game-review-coach-explanations))

### How lichess compares (free, open source)

- **Thresholds**, from the code itself ([lila `Advice.scala`](https://github.com/lichess-org/lila/blob/master/modules/tree/src/main/Advice.scala)):
  - lichess marks a move by how much it drops the mover's winning chances: **0.3 Blunder, 0.2 Mistake, 0.1 Inaccuracy**.
  - Winning chances run from -1 to +1, so 0.1 equals **5 points of win %**.
  - Mate swings get their own labels ("Checkmate is now unavoidable", "Lost forced checkmate sequence").
  - It has **no Brilliant, Great, Excellent or Good labels**: just the three error labels plus "X was best."
- **Win-chance formula**: `2 / (1 + exp(-0.00368208 * cp)) - 1`, fitted on lichess games ([PR #11148](https://github.com/lichess-org/lila/pull/11148)). Code: [scalachess `eval.scala`](https://github.com/lichess-org/scalachess/blob/master/core/src/main/scala/eval.scala).
- **The side effect**: once a position is decided, big eval swings stop being errors.
  - lichess's blog says a +1 swing is a mistake when the position is equal "but not so much if the position was already won or lost". Read in a search snippet; the page returns 403. ([lichess blog: Learn from your mistakes](https://lichess.org/@/lichess/blog/learn-from-your-mistakes/WFvLpiQA))
  - A forum user points out that below about 30% winning chances you can no longer make a "blunder" at all. Search snippet. ([lichess forum: zero inaccuracies despite blunder](https://lichess.org/forum/lichess-feedback/bug-zero-inaccuracies-evaluation-despite-blunder?page=2))
- **Learn from your mistakes** walks you through your errors and asks you to find a better move, then shows the best one if you ask. It needs a computer analysis to exist first, and it skips some flagged moves. Users have asked for it to work across all their games and with spaced repetition; those are requests, not features. (lichess blog above; [forum: across all games](https://lichess.org/forum/lichess-feedback/create-learn-from-your-mistakes-across-all-games))

### Other reference points

- **WintrChess** ([github.com/wintrcat/wintrchess](https://github.com/wintrcat/wintrchess)) is a free, open-source copy of chess.com-style labels in TypeScript: Forced, Theory, Best, Critical, Brilliant, Excellent, Okay, Inaccuracy, Mistake, Blunder.
  - Labels are based on expected points lost (`classification/pointLoss.ts`). Brilliant uses piece-safety and trapped-piece checks (`classification/brilliant.ts`).
  - It is **GPL-3.0**: copying its code would put Chess Coach under the GPL. Reading it for the approach doesn't.
- **Duolingo's chess review** (2026-09-08) shows key moments only. It labels mistakes and blunders from changes in expected Win-Draw-Loss adjusted to the player's level, and spots brilliant moves with Maia-style "human-like" networks. It doesn't say how its explanations are written. ([Duolingo engineering blog](https://blog.duolingo.com/engineering-game-review/))

---

## 2. What players complain about

### A. Moves aren't explained, or the explanations are generic or wrong

- **No reason given.** "That's an unfortunate error," with no word on why the move was bad. A long-time forum regular replies: "when there's no clear way to explain a move, no explanation is given." ([forum, 2024-12-15](https://www.chess.com/forum/view/game-analysis/why-does-the-coach-occasionally-just-not-explain-why-a-move-was-evaluated-the-way-it-was))
- **Too shallow, or wrong.** "c6 is an inaccuracy, when in fact it is the top move for both Komodo and Stockfish." "It is the case that the review is just too superficial?" ([forum: coach review worse than useless, 2022-08-08](https://chess.com/forum/view/general/coach-review-worse-than-useless-can-harm-your-game))
- **The coach contradicts the result.** One player got "blundered" on a move that "was necessary to enable checkmate in 2". Another had a knight sacrifice that won a rook called a blunder. The reply blames depth: "game review at lower depths can miss things that are found at higher depth." ([forum: bot coach being wrong, 2023](https://www.chess.com/forum/view/site-feedback/bot-coach-usually-excellent-being-wrong))
- **Simplified and patronising.** The review "has been rapidly moving in the wrong direction", "Moves and move times are often hidden", and its "'explain like I'm five' mentality is already obnoxious enough". ([forum: new Game Review, 2025-12](https://www.chess.com/forum/view/general/chesscoms-new-game-review-what-the-heck-happened?lc=1))
- **"More about fun than serious learning."** davidk67, 2025-12-11 (forum thread on missing explanations, linked above).
- **Comments that repeat.** "both of the reviewed comments are practically identical." The replies blame the daily limit on explanations. ([forum: Coach Explanations, 2022-09-02](https://www.chess.com/forum/view/game-analysis/chess-game-review-coach-explanations))
- **Wrong labels in the App Store.** "it will label moves as mistakes that simply where not." The developer replied that they're "looking into any potential issues with analysis feedback." ([App Store, FreemanMoser, 2020-11-04](https://apps.apple.com/us/app/chess-play-learn/id329218549?see-all=reviews))
- **AI coaches inventing things.** A lichess blog argues that an analysis tool shouldn't make up a story about the board and state it as fact. Search snippet only. ([lichess blog: baskervile](https://lichess.org/@/baskervile/blog/why-a-chess-coach-shouldnt-be-allowed-to-invent-the-position/MUo90GyJ))

### B. Labels feel inflated, inconsistent or nitpicky

- **Brilliant is too easy.** "Many of the brilliant moves I've seen here would only be considered great move (!) at most in any other context." (MasterMatthew52, 2023-04-12) Also: "Id also like it to not be limited to ONLY be for sacrafices." (2024-01-26) ([forum: Brilliant moves aren't all that brilliant](https://www.chess.com/forum/view/site-feedback/brilliant-moves-arent-all-that-brilliant))
- **Praise feels hollow.** The labels feel "condescending rather than constructive", "Not every mistake is called out for what it truly is", and "The inflated praise might feel good in the moment, but it's not helping players improve." ([forum, 2025-07-25](https://www.chess.com/forum/view/game-analysis/can-we-get-honest-feedback-from-the-game-review-bot?lc=1))
- **Labels and scores disagree.** "With every one coming out different it seems to me there is very little value in what is shown." "It's not uncommon for a move that saves a hanging queen to be assessed as an inaccuracy." ([forum: Quality of Game Reviews, 2025-07-20](https://www.chess.com/forum/view/game-analysis/quality-of-game-reviews?lc=1))
- **73% accuracy with no errors flagged.** "0 inaccuracy, 0 mistake, 0 blunder" and still 73%. The reply: once you're far ahead, most weaker moves stop being flagged. ([forum, 2025-10-22](https://www.chess.com/forum/view/game-analysis/game-review-1-miss-means-73-accuracy))
- **Labels go both ways at club level.** A 1600–1900 blogger: "Game review might count a normal looking move as a blunder" and "a normal looking move as a brilliancy". Engine-only lines 13 or more moves deep get counted as missed chances. ([chess.com blog, 2023-06-29](https://chess.com/blog/DSTirana1/why-the-game-review-is-not-very-helpful))
- **Miss vs Missed Win.** The two labels show differently on PC and mobile, and players ask what a Miss even is. Read in search snippets. ([forum: Misses vs Missed Wins](https://www.chess.com/forum/view/site-feedback/misses-vs-missed-wins), [forum: What does 'miss' mean](https://www.chess.com/forum/view/for-beginners/what-does-miss-mean-in-review))

### C. Paywall and daily limits

- **One full review a day.** Coach explanations on every move are Diamond only. ([support: Premium plans](https://support.chess.com/en/articles/8562418-what-are-the-differences-between-membership-types))
- **A free tool taken away.** "Very disappointed to see my way of learning chess put behind a paywall." ([forum, 2024-05-21](https://www.chess.com/forum/view/game-analysis/you-just-gutted-my-way-of-improving-and-put-it-behind-a-paywall-thanks-for-nothing))
- **"Premium to do basically anything."** ([App Store, C00pSc00p](https://apps.apple.com/us/app/chess-play-learn/id329218549?see-all=reviews)) On Trustpilot: "Game review has problems", "Analysis engine is too basic", "Premium services are overpriced". ([Trustpilot, Aug–Sep 2026](https://www.trustpilot.com/review/chess.com?page=5))
- **Free alternatives keep appearing**, which shows the demand: Chessigma, WintrChess, Chess It Up, a Product Hunt "Chess Review". These are self-promotional; they appear in search results and I didn't check them. ([forum: Game Review alternatives](https://www.chess.com/forum/view/for-beginners/game-review-alternatives))

### D. No patterns across games

- **Cross-game patterns are Diamond only.** chess.com's view across games is Insights. ([support](https://support.chess.com/en/articles/8708925-what-is-insights-on-chess-com))
- **Players do it by hand.** One sorts their games into "4 types" to find recurring patterns. ([club forum, 2025-10-05](https://www.chess.com/clubs/forum/view/analyzing-your-games-games-patterns?lc=1))
- **lichess users want it too.** They ask for Learn from your mistakes across all their games (linked above).
- **Rarely raised.** This came up less often than A–C.

---

## 3. Top 3 complaints worth beating

Ranked by how often they came up in what I could read, and how cheap a fix is for a free, browser-only app.

1. **"It doesn't tell me WHY", or the reason is generic or wrong (A).** It came up most often, across forums, blogs and the App Store, and chess.com sells the fix (explanations on every move) as Diamond.
   - **Cheap fix:** for every flagged move, show Stockfish's actual refutation: "after your move, they play X, Y, and win the knight" (the PV plus the material or mate change), and the line you missed.
   - **Ask Claude:** pass Claude the FEN, the move played, the best move and both PVs, so it explains real lines instead of inventing them (the lichess "invent the position" concern).
   - **Cost:** no backend; the engine output is already there.
2. **Labels feel wrong, inflated or nitpicky (B).** This is the "nitpicky" feeling the current version has.
   - **Cheap fix:** use win-probability thresholds the way lichess does, so a move only counts as a mistake when it changes who is likely to win. "Mistakes" in a position that's already won or lost then stop.
   - Show why each label was given ("win chance 62% → 31%").
   - Run a deeper search on the few flagged moves only, to avoid the depth false positives.
   - Skip or tightly limit Brilliant, the most mocked label.
   - **Cost:** a few lines of math on evals we already compute.
3. **Paywall and daily limits (C).** Easy to beat: unlimited reviews, with an explanation on every flagged move, free.
   - **Cost:** nothing; it's already true for a browser app.
   - **Watch:** Stockfish WASM is slow on phones. Reviewing the whole game shallow and only key moves deep keeps it unlimited in practice.

**Runner-up: patterns across games (D).** chess.com has this only in Diamond Insights. A browser-only app could keep past reviews in localStorage and count repeats, like "hung a piece in 4 of your last 10 games", but it came up less than the three above.
