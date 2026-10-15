# Roadmap

Ideas that are planned but waiting on something.

## Compare with other players

**Waiting for:** about 30 Live players in each mode. With fewer, a percentile means little, so the game shows nothing until then.

**What it shows:** one line on each mode's progress panel, for example "Your best span 7 beats 68% of players".

**How it would work:**

- New Worker endpoint `GET /api/distribution?mode=fwd`. It returns how many players reached each best span, for example `{ "players": 42, "spans": { "4": 3, "5": 9, "6": 14, "7": 10, "8": 6 } }`. It counts each player's best game per mode, the same game the leaderboard uses.
- The browser works out the percentile from that data, for Practice games too. Practice still sends no scores: the request only reads the distribution.
- If the request fails or the mode has fewer than 30 players, the line doesn't appear.
- Cache the response for an hour (`Cache-Control`) so it costs the Worker almost nothing.

**Done when:** the endpoint is deployed, the line appears once a mode passes the threshold, and the info popover explains that it compares against Live players only.

## Compare with your age group

**Waiting for:** the player comparison above. This is a filter on that comparison, so it needs the comparison first, and then about 30 Live players in an age group before that group's line appears.

**What it shows:** a second line under the overall comparison, for example "Among players aged 25–34, you beat 61%".

**How it would work:**

- **Optional.** A Live player can add an age bracket on the change-name screen (the ✎ next to their nickname). Nothing asks for it before playing, and leaving it blank changes nothing.
- **Brackets only:** 18–24, 25–34, 35–44, 45–54, 55–64, 65+, or "Prefer not to say". The game never asks for a birth date. Anyone who indicates they're under 18 isn't stored, and the game says why.
- **Consent:** one plain line next to the choice: what it's used for (the age-group comparison) and that it can be removed at any time. A short privacy note covers it in the README and in the info popover.
- **Stored apart from the nickname:** a separate `player_age` table keyed by player id. The leaderboard never shows it, and the distribution endpoint only returns counts per bracket, never per player.
- **Delete:** a "Remove my age" button deletes the row. A later "delete my data" option should cover the whole player record too.
- **Not collected:** gender and profession, unless a clear use comes up that's worth the extra privacy load.

**Not a research dataset.** The data is self-reported and self-selected, and it's collected without ethics approval, so it supports in-game comparisons only. Research use needs a partner study with its own approval and protocol.

**Done when:** players can set and remove a bracket, the comparison shows for brackets with enough players, and the privacy note is published.
