// memory.span leaderboard Worker.
// The Worker creates every round and checks every answer, so a score can't be
// made up in the browser: it only exists if each round was answered correctly.

const MODES = {
  fwd: { start: 3, max: 14, show: 900, gap: 200 },
  bwd: { start: 2, max: 12, show: 900, gap: 200 },
  ptr: { start: 2, max: 7, show: 1300, update: 1700, gap: 300 },
};
const LIVES = 3;
const LEAD_IN_MS = 650;            // pause before the first item, matches the page
const ANSWER_TIMEOUT_MS = 15 * 60 * 1000;
const GAMES_PER_HOUR = 60;
const LETTERS = ["a", "b", "c", "d", "e", "f", "g"];

// ---------- helpers ----------
const now = () => Date.now();
const randInt = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
function randomId(bytes = 16) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const mult = (streak) => Math.min(3, 1 + 0.25 * Math.max(0, streak - 1));

// ---------- nicknames ----------
const BLOCKED = ["fuck", "shit", "cunt", "bitch", "dick", "cock", "pussy", "slut", "whore", "nigg", "fag", "rape", "nazi", "porn", "penis", "vagina", "hitler", "retard", "bastard", "asshole", "wank", "twat", "boob", "tits"];
function cleanNickname(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (!/^[A-Za-z0-9 _-]{3,24}$/.test(name)) return { error: "Use 3 to 24 letters, numbers, spaces, - or _." };
  const flat = name.toLowerCase().replace(/0/g, "o").replace(/[1!|]/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t").replace(/[^a-z]/g, "");
  if (BLOCKED.some((w) => flat.includes(w))) return { error: "Please pick a different name." };
  return { name };
}

// ---------- rounds ----------
function makeRound(mode, level) {
  if (mode === "ptr") {
    const names = LETTERS.slice(0, level), vals = {}, steps = [];
    names.forEach((n) => { vals[n] = randInt(9) + 1; steps.push({ text: `${n} = ${vals[n]}`, init: true }); });
    for (let i = 0; i < level + 1; i++) {
      const t = names[randInt(level)];
      if (level > 1 && randInt(100) < 55) {
        let s; do { s = names[randInt(level)]; } while (s === t);
        vals[t] = vals[s]; steps.push({ text: `${t} = ${s}` });
      } else {
        let v; do { v = randInt(9) + 1; } while (v === vals[t]);
        vals[t] = v; steps.push({ text: `${t} = ${v}` });
      }
    }
    const m = MODES.ptr;
    const showMs = LEAD_IN_MS + steps.reduce((t, s) => t + (s.init ? m.show : m.update) + m.gap, 0);
    return { items: steps, names, answer: JSON.stringify(vals), showMs };
  }
  const d = [];
  while (d.length < level) { const x = randInt(10); if (d.length && x === d[d.length - 1]) continue; d.push(x); }
  const m = MODES[mode];
  const want = (mode === "bwd" ? [...d].reverse() : d).join("");
  return { items: d, answer: want, showMs: LEAD_IN_MS + level * (m.show + m.gap) };
}

function publicRound(mode, level, r) {
  return mode === "ptr" ? { level, items: r.items, names: r.names } : { level, items: r.items };
}
function readableAnswer(mode, answer) {
  if (mode !== "ptr") return answer;
  const v = JSON.parse(answer);
  return Object.keys(v).map((k) => `${k}=${v[k]}`).join(" ");
}

// ---------- HTTP ----------
function cors(env, req) {
  const origin = req.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "null",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (h, status, body) => new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

async function auth(env, req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer ([a-f0-9]{32}):([a-f0-9]{64})$/);
  if (!m) return null;
  const row = await env.DB.prepare("SELECT id, nickname, token_hash FROM players WHERE id = ?").bind(m[1]).first();
  if (!row || row.token_hash !== (await sha256(m[2]))) return null;
  return row;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "");
    let body = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch (_) { return json(h, 400, { error: "Send JSON." }); }
    }

    try {
      // Register a player with a nickname. Returns the credentials the browser keeps.
      if (req.method === "POST" && path === "/api/player") {
        const c = cleanNickname(body.nickname);
        if (c.error) return json(h, 400, { error: c.error });
        const id = randomId(16), token = randomId(32);
        try {
          await env.DB.prepare("INSERT INTO players (id, nickname, token_hash, created_at) VALUES (?, ?, ?, ?)")
            .bind(id, c.name, await sha256(token), now()).run();
        } catch (e) {
          if (String(e).includes("UNIQUE")) return json(h, 409, { error: "That name is taken." });
          throw e;
        }
        return json(h, 200, { id, token, nickname: c.name });
      }

      // Change nickname.
      if (req.method === "POST" && path === "/api/player/name") {
        const p = await auth(env, req);
        if (!p) return json(h, 401, { error: "Sign-in expired. Reload the page." });
        const c = cleanNickname(body.nickname);
        if (c.error) return json(h, 400, { error: c.error });
        try {
          await env.DB.prepare("UPDATE players SET nickname = ? WHERE id = ?").bind(c.name, p.id).run();
        } catch (e) {
          if (String(e).includes("UNIQUE")) return json(h, 409, { error: "That name is taken." });
          throw e;
        }
        return json(h, 200, { nickname: c.name });
      }

      // Start a game: returns the first round.
      if (req.method === "POST" && path === "/api/game/start") {
        const p = await auth(env, req);
        if (!p) return json(h, 401, { error: "Sign-in expired. Reload the page." });
        const mode = body.mode;
        if (!MODES[mode]) return json(h, 400, { error: "Unknown mode." });
        const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM games WHERE player_id = ? AND created_at > ?")
          .bind(p.id, now() - 3600_000).first();
        if (recent.n >= GAMES_PER_HOUR) return json(h, 429, { error: "That's a lot of games for one hour. Take a break and come back." });
        // Close any game this player left unfinished in this mode.
        await env.DB.prepare("UPDATE games SET status = 'over', ended_at = ?, answer = NULL WHERE player_id = ? AND mode = ? AND status = 'active'")
          .bind(now(), p.id, mode).run();
        const level = MODES[mode].start;
        const r = makeRound(mode, level);
        const id = randomId(16), t = now();
        await env.DB.prepare(`INSERT INTO games (id, player_id, mode, level, lives, answer, ready_at, created_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(id, p.id, mode, level, LIVES, r.answer, t + r.showMs - 400, t).run();
        return json(h, 200, { gameId: id, state: { level, lives: LIVES, score: 0, streak: 0, span: 0 }, round: publicRound(mode, level, r) });
      }

      // Answer the current round: returns the verdict and the next round.
      if (req.method === "POST" && path === "/api/game/answer") {
        const p = await auth(env, req);
        if (!p) return json(h, 401, { error: "Sign-in expired. Reload the page." });
        const g = await env.DB.prepare("SELECT * FROM games WHERE id = ? AND player_id = ?").bind(String(body.gameId || ""), p.id).first();
        if (!g || g.status !== "active" || !g.answer) return json(h, 409, { error: "This game has ended." });
        const t = now();
        if (t < g.ready_at) return json(h, 425, { error: "Answered before the sequence finished." });
        if (t > g.ready_at + ANSWER_TIMEOUT_MS) {
          await env.DB.prepare("UPDATE games SET status = 'over', ended_at = ?, answer = NULL WHERE id = ?").bind(t, g.id).run();
          return json(h, 409, { error: "This game timed out." });
        }

        let ok;
        if (g.mode === "ptr") {
          const want = JSON.parse(g.answer), got = body.answer || {};
          ok = Object.keys(want).every((k) => Number(got[k]) === want[k]);
        } else {
          ok = String(body.answer ?? "").replace(/\D/g, "") === g.answer;
        }

        let { level, lives, score, streak, span, rounds } = g;
        rounds += 1;
        let points = 0;
        if (ok) { streak += 1; points = Math.round(level * 10 * mult(streak)); score += points; span = Math.max(span, level); }
        else { streak = 0; lives -= 1; }
        const over = lives <= 0 || (ok && level >= MODES[g.mode].max);
        const correct = readableAnswer(g.mode, g.answer);

        if (over) {
          await env.DB.prepare(`UPDATE games SET level = ?, lives = ?, score = ?, streak = ?, span = ?, rounds = ?, status = 'over', answer = NULL, ended_at = ? WHERE id = ?`)
            .bind(level, lives, score, streak, span, rounds, t, g.id).run();
          const rank = await rankFor(env, g.mode, p.id);
          return json(h, 200, { ok, correct, points, over: true, state: { level, lives, score, streak, span, rounds }, rank });
        }

        if (ok) level += 1;
        const r = makeRound(g.mode, level);
        await env.DB.prepare(`UPDATE games SET level = ?, lives = ?, score = ?, streak = ?, span = ?, rounds = ?, answer = ?, ready_at = ? WHERE id = ?`)
          .bind(level, lives, score, streak, span, rounds, r.answer, t + r.showMs - 400, g.id).run();
        return json(h, 200, { ok, correct, points, over: false, state: { level, lives, score, streak, span, rounds }, round: publicRound(g.mode, level, r) });
      }

      // End a game early: it counts with the score so far, the same as a game
      // the player walks away from. Ending a game that's already over just
      // returns its final state.
      if (req.method === "POST" && path === "/api/game/end") {
        const p = await auth(env, req);
        if (!p) return json(h, 401, { error: "Sign-in expired. Reload the page." });
        const g = await env.DB.prepare("SELECT * FROM games WHERE id = ? AND player_id = ?").bind(String(body.gameId || ""), p.id).first();
        if (!g) return json(h, 404, { error: "No such game." });
        if (g.status === "active") {
          await env.DB.prepare("UPDATE games SET status = 'over', ended_at = ?, answer = NULL WHERE id = ?").bind(now(), g.id).run();
        }
        const { level, lives, score, streak, span, rounds } = g;
        const rank = span > 0 ? await rankFor(env, g.mode, p.id) : null;
        return json(h, 200, { state: { level, lives, score, streak, span, rounds }, rank });
      }

      // Total leaderboard: each player's best game per mode (the one the mode
      // boards show), added up across modes.
      if (req.method === "GET" && path === "/api/leaderboard" && url.searchParams.get("mode") === "total") {
        const { results } = await env.DB.prepare(`
          WITH best AS (
            SELECT player_id, mode, score,
                   ROW_NUMBER() OVER (PARTITION BY player_id, mode ORDER BY span DESC, score DESC, ended_at ASC) AS rn
            FROM games WHERE status = 'over' AND span > 0
          )
          SELECT p.nickname, b.player_id, SUM(b.score) AS total, COUNT(*) AS modes,
                 SUM(CASE WHEN b.mode = 'fwd' THEN b.score END) AS fwd,
                 SUM(CASE WHEN b.mode = 'bwd' THEN b.score END) AS bwd,
                 SUM(CASE WHEN b.mode = 'ptr' THEN b.score END) AS ptr
          FROM best b JOIN players p ON p.id = b.player_id
          WHERE b.rn = 1
          GROUP BY b.player_id
          ORDER BY total DESC, p.created_at ASC
          LIMIT 20`).all();
        const me = await auth(env, req);
        return json(h, 200, {
          mode: "total",
          entries: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, total: r.total, modes: r.modes, scores: { fwd: r.fwd, bwd: r.bwd, ptr: r.ptr }, you: !!me && me.id === r.player_id })),
        });
      }

      // Leaderboard: each player's best game per mode.
      if (req.method === "GET" && path === "/api/leaderboard") {
        const mode = url.searchParams.get("mode");
        if (!MODES[mode]) return json(h, 400, { error: "Unknown mode." });
        const { results } = await env.DB.prepare(`
          SELECT p.nickname, g.span, g.score, g.ended_at, g.player_id
          FROM games g JOIN players p ON p.id = g.player_id
          WHERE g.mode = ?1 AND g.status = 'over' AND g.span > 0
            AND g.id = (SELECT g2.id FROM games g2
                        WHERE g2.player_id = g.player_id AND g2.mode = ?1 AND g2.status = 'over'
                        ORDER BY g2.span DESC, g2.score DESC, g2.ended_at ASC LIMIT 1)
          ORDER BY g.span DESC, g.score DESC, g.ended_at ASC
          LIMIT 20`).bind(mode).all();
        const me = await auth(env, req);
        return json(h, 200, {
          mode,
          entries: results.map((r, i) => ({ rank: i + 1, nickname: r.nickname, span: r.span, score: r.score, date: new Date(r.ended_at).toISOString().slice(0, 10), you: !!me && me.id === r.player_id })),
        });
      }

      if (path === "" || path === "/api/health") return json(h, 200, { ok: true });
      return json(h, 404, { error: "Not found." });
    } catch (e) {
      console.error(e);
      return json(h, 500, { error: "Something went wrong on the server. Try again." });
    }
  },
};

// Rank of this player's best game in a mode (1-based), or null.
async function rankFor(env, mode, playerId) {
  const best = await env.DB.prepare(`SELECT span, score FROM games WHERE player_id = ? AND mode = ? AND status = 'over' AND span > 0
                                     ORDER BY span DESC, score DESC LIMIT 1`).bind(playerId, mode).first();
  if (!best) return null;
  const ahead = await env.DB.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT player_id, MAX(span * 1000000 + score) AS k FROM games
      WHERE mode = ? AND status = 'over' AND span > 0 GROUP BY player_id
    ) WHERE k > ?`).bind(mode, best.span * 1000000 + best.score).first();
  return ahead.n + 1;
}
