-- memory.span leaderboard schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS players (
  id          TEXT PRIMARY KEY,
  nickname    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  token_hash  TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

-- One row per game. The answer to the current round lives here and never
-- leaves the server until the player has answered.
CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  player_id     TEXT NOT NULL REFERENCES players(id),
  mode          TEXT NOT NULL,
  level         INTEGER NOT NULL,
  lives         INTEGER NOT NULL,
  score         INTEGER NOT NULL DEFAULT 0,
  streak        INTEGER NOT NULL DEFAULT 0,
  span          INTEGER NOT NULL DEFAULT 0,
  rounds        INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',   -- active | over
  answer        TEXT,                             -- expected answer for the current round
  ready_at      INTEGER,                          -- earliest time an answer is accepted (ms)
  created_at    INTEGER NOT NULL,
  ended_at      INTEGER
);

CREATE INDEX IF NOT EXISTS games_board ON games (mode, status, span DESC, score DESC);
CREATE INDEX IF NOT EXISTS games_player ON games (player_id, mode, status);
