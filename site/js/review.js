// One game as a lesson, opened from ?game=<id>. Mock game for now: the real one comes from chess.com and the engine.
const info = { me: "white", myR: 1180, op: "rookstar_91", opR: 1215, date: "today", base: 300, clk: [], url: "https://www.chess.com/games", res: "You lost" };
const BEFORE_7 = "r1bqkb1r/pp3ppp/2p2n2/nB1Pp1N1/8/8/PPPP1PPP/RNBQK2R w KQkq - 0 7";
const BEFORE_11 = "r1bqk2r/p4pp1/2pb1n1p/n3N3/4p3/8/PPPPBPPP/RNBQK2R w KQkq - 2 11";

export function mockReview() {
  const steps = [
    { moves: "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6", game: info, name: "Your game vs rookstar_91",
      body: "Two Knights Defence. You grabbed a pawn early and you're doing fine. Let's go through the two moments that decided this game." },
    { start: BEFORE_7, moves: "", game: info, name: "Mistake 1: move 7", stat: "+0.3 for you",
      body: "Black's c6 pawn hits your bishop on b5. Before you take anything: what happens to your bishop afterwards?" },
    { moves: "dxc6 bxc6", game: info, tone: "bad", link: info.url, name: "7.dxc6?! 7…bxc6", stat: "+0.3 → −0.2",
      body: "Taking on c6 opens the b-file and attacks your bishop with tempo. Black gets quick play for the pawn." },
    { start: BEFORE_7, moves: "Be2 h6 Nf3", game: info, alt: true, tone: "good", name: "Better: 7.Be2!", stat: "Engine: +0.3",
      body: "Drop the bishop back to e2 first. Your extra pawn stays safe and Black has nothing to hit. Ask Claude why if it isn't clear." },
    { start: BEFORE_11, moves: "", game: info, name: "Mistake 2: move 11", stat: "+0.4 for you",
      body: "Black's bishop just landed on d6. What is it attacking? Look before you castle." },
    { moves: "O-O Bxe5", game: info, tone: "bad", link: info.url, name: "11.O-O?? 11…Bxe5", stat: "+0.4 → −3.1",
      body: "Your knight on e5 was attacked by the bishop and nothing defended it. Black took it, and the game was gone." },
    { start: BEFORE_11, moves: "d4", game: info, alt: true, tone: "good", name: "Better: 11.d4!", stat: "Engine: +0.4",
      body: "d4 defends the knight and hits e4 at the same time. Castle next move." },
    { start: BEFORE_11, moves: "", game: info, tone: "bad", name: "This one is a habit", stat: "14 of your last 212 blitz games",
      body: "You've left a piece hanging right after it got attacked in 14 of your last 212 blitz games. It's your most expensive habit.",
      rule: "When your opponent's move attacks something, look at that piece before anything else. Castling can wait." },
  ];
  return { key: "game", title: "Game review", flip: false, steps };
}
