// Explain for Chess Coach: the extension sends a finished chess.com game and the move the review is on; Claude says why.
// Secret: ANTHROPIC_API_KEY (wrangler secret put). The key has a spend limit in the Claude Console.
import Anthropic from '@anthropic-ai/sdk';
import { Chess } from 'chess.js';

const ORIGIN = 'https://www.chess.com';
const CORS = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const str = (v, max) => typeof v === 'string' && v.length <= max;

const SYSTEM = `You are a friendly chess coach for club players (roughly 600-1600 rated) reviewing a finished game on chess.com.
Explain the move the player is looking at in plain words, at most 120 words, no headings.
Say why it is good or bad, what was better and why, and the concrete line that punishes it if there is one.
Use normal move notation and square names. Work from the FEN positions given, check every line you mention is legal there, and if you are not sure about a line, say so rather than guess.
chess.com's verdict comes from its engine; trust its label, and explain it rather than argue with it.`;

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/explain') return json({ error: 'not found' }, 404);
    // shortcut: the Origin check only stops other websites, not scripts; add a per-IP rate limit if spend shows abuse.
    if (req.headers.get('origin') !== ORIGIN) return json({ error: 'forbidden' }, 403);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const { moves, ply, verdict = '', white = '', black = '', result = '' } = b || {};
    if (!Array.isArray(moves) || moves.length > 600 || !moves.every((m) => str(m, 10)) || !Number.isInteger(ply) || ply < 0 || ply >= moves.length
      || !str(verdict, 500) || !str(white, 40) || !str(black, 40) || !str(result, 10)) return json({ error: 'bad request' }, 400);

    const c = new Chess();
    let before;
    try { for (let i = 0; i <= ply; i++) { if (i === ply) before = c.fen(); c.move(moves[i]); } } catch { return json({ error: 'illegal move list' }, 400); }
    const numbered = moves.map((m, i) => (i % 2 ? m : `${i / 2 + 1}. ${m}`)).join(' ');
    const mover = ply % 2 ? 'Black' : 'White', no = `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}`;
    const user = `Game: ${white} (White) vs ${black} (Black), result ${result}.
Moves: ${numbered}

The move: ${no}${moves[ply]} by ${mover}.
Position before it (FEN): ${before}
Position after it (FEN): ${c.fen()}
chess.com's Game Review says: "${verdict}"

Explain this move.`;

    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
      const r = await client.beta.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium' },
        system: SYSTEM,
        messages: [{ role: 'user', content: user }],
      });
      if (r.stop_reason === 'refusal') return json({ error: 'Claude declined this one.' }, 502);
      const text = r.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
      return json({ text });
    } catch (err) {
      console.error(err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : String(err));
      return json({ error: 'Claude is busy, try again.' }, 502);
    }
  },
};
