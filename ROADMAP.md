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
