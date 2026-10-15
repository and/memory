-- Lookalike nicknames: "Brave Fox", "Brave_F0x" and "bravefox" share one key,
-- so only one of them can exist. Must match nameKey() in src/index.js.
-- Run once on a database created before this file:
--   npx wrangler d1 execute memory-span --remote --file=migrations/0001_name_key.sql
ALTER TABLE players ADD COLUMN name_key TEXT;
UPDATE players SET name_key = replace(replace(replace(replace(replace(replace(lower(nickname), ' ', ''), '-', ''), '_', ''), '0', 'o'), '1', 'l'), 'i', 'l');
CREATE UNIQUE INDEX IF NOT EXISTS players_name_key ON players (name_key);
