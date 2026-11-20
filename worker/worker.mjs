// Explain for Chess Coach: /game explains every move of a finished chess.com game once (cached); /explain streams one move.
// Secret: ANTHROPIC_API_KEY (wrangler secret put). The key has a spend limit in the Claude Console.
import Anthropic from '@anthropic-ai/sdk';
import { Chess } from 'chess.js';

const ORIGIN = 'https://www.chess.com';
const CORS = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const str = (v, max) => typeof v === 'string' && v.length <= max;

const SYSTEM = `You are a friendly chess coach for club players (roughly 600-1600 rated) reviewing a finished game on chess.com.
Explain the move the player is looking at in plain words, at most 100 words, plain text only: no markdown, no bold, no headings.
Say why it is good or bad, what was better and why, and the concrete line that punishes it if there is one.
Use normal move notation and square names. Work from the FEN positions given, check every line you mention is legal there, and if you are not sure about a line, say so rather than guess.
chess.com's verdict comes from its engine; trust its label, and explain it rather than argue with it.`;

const GAME_SYSTEM = `You are a friendly chess coach for club players (roughly 600-1600 rated) reviewing a finished game on chess.com.
For every move of the game, write a short explanation the player will read when they reach that move in the review: at most 45 words, plain text, no markdown.
Every move comes with Stockfish's verdict: its label, the mover's win chance before and after, the best move and line, and the opponent's best reply. Those facts are true: never contradict the label, explain it.
For a mistake or worse, say what it allowed (use the reply) and why the best move was better (use its line). For best and excellent moves, say what they do. Opening moves get one short line.
Use normal move notation and square names, and only lines given to you or ones you are sure are legal in the FEN.`;
const SCHEMA = { type: 'object', additionalProperties: false, required: ['moves'], properties: { moves: { type: 'array', items: {
  type: 'object', additionalProperties: false, required: ['ply', 'text'], properties: { ply: { type: 'integer' }, text: { type: 'string' } } } } } };

// One call per game: an explanation for every move, cached by chess.com game id so reopening the review is free.
async function wholeGame(b, env, ctx) {
  const { id, moves, facts, white = '', black = '', result = '' } = b;
  const ok = (f, i) => f && f.ply === i && ['label', 'best', 'bestLine', 'reply'].every((k) => str(f[k], 60)) && [f.winBefore, f.winAfter].every((n) => Number.isInteger(n) && n >= 0 && n <= 100);
  if (!/^\d{1,20}$/.test(String(id)) || !Array.isArray(facts) || facts.length !== moves.length || !facts.every(ok)) return json({ error: 'bad request' }, 400);
  const key = new Request(`https://chess-api.topc.social/cache/game/v2/${id}`);
  const hit = await caches.default.match(key);
  if (hit) return json(await hit.json());
  const c = new Chess(), lines = [];
  try { moves.forEach((m, i) => { const f = facts[i];
    lines.push(`ply ${i}: ${Math.floor(i / 2) + 1}${i % 2 ? '...' : '.'}${m} (${i % 2 ? 'Black' : 'White'}) | Stockfish: ${f.label}, win chance ${f.winBefore}% -> ${f.winAfter}%` +
      `${f.best ? `, best was ${f.best} (line: ${f.bestLine})` : ''}${f.reply ? `, best reply: ${f.reply}` : ''} | before: ${c.fen()}`); c.move(m); }); }
  catch { return json({ error: 'illegal move list' }, 400); }
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const stream = client.beta.messages.stream({
      model: 'claude-opus-5-5',
      max_tokens: 32000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: GAME_SYSTEM,
      messages: [{ role: 'user', content: `Game: ${white} (White) vs ${black} (Black), result ${result}.\n\n${lines.join('\n')}\n\nExplain every move, one entry per ply.` }],
    });
    const r = await stream.finalMessage();
    if (r.stop_reason !== 'end_turn') return json({ error: `stopped: ${r.stop_reason}` }, 502);
    const out = JSON.parse(r.content.find((x) => x.type === 'text').text);
    ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(out), { headers: { 'cache-control': 'max-age=2592000' } })));
    return json(out);
  } catch (err) {
    console.error(err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : String(err));
    return json({ error: 'Claude is busy' }, 502);
  }
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(req.url).pathname;
    if (req.method !== 'POST' || !['/explain', '/game'].includes(path)) return json({ error: 'not found' }, 404);
    // shortcut: the Origin check only stops other websites, not scripts; add a per-IP rate limit if spend shows abuse.
    if (req.headers.get('origin') !== ORIGIN) return json({ error: 'forbidden' }, 403);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const { moves, ply = 0, verdict = '', white = '', black = '', result = '' } = b || {};
    if (!Array.isArray(moves) || moves.length > 600 || !moves.every((m) => str(m, 10)) || !Number.isInteger(ply) || ply < 0 || ply >= moves.length
      || !str(verdict, 500) || !str(white, 40) || !str(black, 40) || !str(result, 10)) return json({ error: 'bad request' }, 400);
    if (path === '/game') return wholeGame(b, env, ctx);

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

    // streamed as plain text, so the first words show in a couple of seconds instead of after the whole answer
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter(), enc = new TextEncoder();
    (async () => {
      try {
        const stream = client.beta.messages.stream({
          model: 'claude-opus-5-5',
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'low' }, // speed matters more than depth for a one-move explanation
          system: SYSTEM,
          messages: [{ role: 'user', content: user }],
        });
        for await (const ev of stream) if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') await w.write(enc.encode(ev.delta.text));
        if ((await stream.finalMessage()).stop_reason === 'refusal') await w.write(enc.encode('Claude declined this one.'));
      } catch (err) {
        console.error(err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : String(err));
        await w.write(enc.encode('\nClaude is busy, try again.'));
      }
      await w.close();
    })();
    return new Response(readable, { headers: { ...CORS, 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
