# memory.span

A small browser game that finds how many things you can hold in your head at once.

**Play:** https://and.github.io/memory/

## Modes

| Mode | What you do | Typical adult span |
| --- | --- | --- |
| Digits | Digits flash one at a time; type them back in order | 5 to 8 |
| Reverse | Same, but type them backwards | 4 to 6 |
| Pointers | Variables get values and copies (`a = 4`, `b = a`); give every final value | No published norms |

Each correct round adds one item. A miss costs a life; three lives per game. Correct answers in a row build a streak that multiplies your points. The highest level you clear is your span for that mode.

Pointers mode was made for this game. It is the closest to tracing pointers in a linked-list loop, which is why it exists.

## Notes

- Everything runs in the browser. Scores and history are saved in `localStorage` only.
- Digit span is modelled on the standard clinical task (one digit per second, adding one each level), but this is a game, not a clinical test. Scores vary by about one level from day to day.
- One file, no build step: `index.html`.

## Run locally

Open `index.html` in a browser, or serve the folder:

```
python3 -m http.server 8000
```
