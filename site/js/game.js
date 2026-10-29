// Single-game review. Mock data for now: the real version takes ?game=<chess.com id>.
import { Chess } from "../vendor/chess.js";
import { staticBoard } from "./board.js";

const SANS = "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Na5 Bb5+ c6 dxc6 bxc6 Be2 h6 Nf3 e4 Ne5 Bd6 O-O Bxe5".split(" ");
const MOMENTS = [
  { ply: 13, cls: "inacc", sym: "?!", best: "Be2", swing: "+0.3 → −0.2", text: "Taking on c6 opens the b-file and gives Black quick play. Be2 keeps your extra pawn safer." },
  { ply: 21, cls: "blun", sym: "??", best: "d4", swing: "+0.4 → −3.1", text: "Your knight on e5 was attacked by the bishop and nothing defended it. Black took it next move.",
    habit: { what: "Leaving a piece hanging right after it gets attacked", n: 14, of: 212 } },
];

const box = document.getElementById("moments");
for (const m of MOMENTS) {
  const c = new Chess();
  for (const s of SANS.slice(0, m.ply - 1)) c.move(s);
  const mv = c.move(SANS[m.ply - 1]);
  const no = `${Math.ceil(m.ply / 2)}${m.ply % 2 ? "." : "..."}`;
  const el = document.createElement("div");
  el.className = "mo";
  el.innerHTML = `<div class="board"></div><div>
    <h3><span class="bdg ${m.cls} inl">${m.sym}</span> ${no} ${mv.san}</h3>
    <div class="sw">${m.swing} · best was <b>${m.best}</b></div>
    <p>${m.text}</p>
    ${m.habit ? `<div class="habit"><b>This is a habit.</b> ${m.habit.what}: ${m.habit.n} times in your last ${m.habit.of} blitz games. <a href="/?u=you">Practise it →</a></div>` : ""}
    <div class="acts"><button class="btn sm" type="button">Ask Claude about this move</button><a class="btn ghost sm" href="#">See on chess.com ↗</a></div>
  </div>`;
  box.append(el);
  staticBoard(el.querySelector(".board"), c.fen(), { hl: [mv.from, mv.to], bad: m.cls === "blun" });
}
