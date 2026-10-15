# Leaderboard server

A Cloudflare Worker with a D1 database. It creates every round and checks every answer, so a score only exists if each round was really answered. The game page works without it (offline, no leaderboard).

## Deploy (about 10 minutes, free tier)

Run these from this `worker` folder. You need Node.js.

1. **Sign in to Cloudflare.** This opens your browser once.

   ```
   npx wrangler login
   ```

2. **Create the database.**

   ```
   npx wrangler d1 create memory-span
   ```

   Copy the `database_id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_YOUR_DATABASE_ID`.

3. **Create the tables.**

   ```
   npx wrangler d1 execute memory-span --remote --file=schema.sql
   ```

   A database created before October 2026 also needs `migrations/0001_name_key.sql` run the same way, once, before deploying this version.

4. **Deploy the Worker.**

   ```
   npx wrangler deploy
   ```

   It prints a URL like `https://memory-span.<your-subdomain>.workers.dev`.

5. **Point the game at it.** In `../game.js`, set the first line's `API_URL` to that URL, then commit and push.

6. **Check it.** Open `https://memory-span.<your-subdomain>.workers.dev/api/health`. It should say `{"ok":true}`.

## How it works

| Endpoint | What it does |
| --- | --- |
| `POST /api/player` | Registers a nickname, returns an id and secret token the browser keeps |
| `POST /api/player/name` | Changes the nickname |
| `POST /api/game/start` | Starts a game and returns the first round |
| `POST /api/game/answer` | Checks the answer and returns the next round, or the final result and rank |
| `POST /api/game/end` | Ends a game early; it counts with the score so far |
| `GET /api/leaderboard?mode=fwd` | Top 20, each player's best game in that mode |
| `GET /api/leaderboard?mode=total` | Top 20 by total: each player's best game in every mode, added up |

Protections:

- The expected answer stays on the server; the browser only sees the sequence it has to show.
- An answer sent before the sequence could have finished showing is refused.
- Nicknames are unique and filtered for offensive words.
- At most 60 games per player per hour.
- Only pages listed in `ALLOWED_ORIGINS` in `wrangler.toml` can call it from a browser.

What it can't stop: a bot that watches the screen and types the digits back. Any memory game shown in a browser has that limit.

## Test locally

```
npx wrangler d1 execute memory-span --local --file=schema.sql
npx wrangler dev
```

Then serve the game folder with `python3 -m http.server 8000` and open `http://localhost:8000/?api=http://localhost:8787`.
