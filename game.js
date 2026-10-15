// memory.span game logic.
// Set API_URL to your Cloudflare Worker URL after deploying it (see worker/README.md).
// Leave it empty to play offline only: no leaderboard, scores stay in this browser.
const API_URL = "https://memory-span.anand-bbc.workers.dev";

(() => {
  const API = (new URLSearchParams(location.search).get("api") || API_URL || "").replace(/\/+$/, "");
  const MODES = {
    // norm: the usual adult span range from digit-span research. Pointers has none.
    fwd: { name: "Digits", start: 3, max: 14, unit: "digits", show: 900, gap: 200, norm: [5, 8] },
    bwd: { name: "Reverse", start: 2, max: 12, unit: "digits", show: 900, gap: 200, norm: [4, 6] },
    ptr: { name: "Pointers", start: 2, max: 7, unit: "variables", show: 1300, update: 1700, gap: 300 },
  };
  const LETTERS = ["a", "b", "c", "d", "e", "f", "g"];
  const LIVES = 3;
  const $ = (id) => document.getElementById(id);
  const si = $("si"), screenEl = $("screen");
  let mode = "fwd";
  let game = null;        // { engine, state, round, token }
  let timers = [];
  let keyHandler = null;

  // ---------- storage ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  };
  let best = store.get("mspan-best", {});
  let history = store.get("mspan-history", []);
  let soundOn = store.get("mspan-sound", false);
  let player = store.get("mspan-player", null);   // { id, token, nickname }
  let ranked = !!API && store.get("mspan-live", false); // view: true = Live (server, public leaderboard), false = Practice (offline, own stats)

  // ---------- sound ----------
  let actx = null;
  function beep(freq, dur = 0.08, type = "sine", vol = 0.06) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
      o.type = type; o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (_) {}
  }
  const sfx = {
    tick: () => beep(660, 0.05, "triangle", 0.035),
    ok: () => { beep(660, 0.08); setTimeout(() => beep(880, 0.12), 80); },
    no: () => beep(180, 0.22, "sawtooth", 0.04),
    over: () => { beep(440, 0.15); setTimeout(() => beep(330, 0.15), 140); setTimeout(() => beep(220, 0.3), 280); },
  };
  const soundBtn = $("sound");
  function renderSound() { soundBtn.setAttribute("aria-pressed", String(soundOn)); soundBtn.title = soundOn ? "Sound on" : "Sound off"; }
  soundBtn.onclick = () => { soundOn = !soundOn; store.set("mspan-sound", soundOn); renderSound(); if (soundOn) sfx.ok(); };

  // ---------- theme ----------
  const themeBtn = $("theme"), root = document.documentElement;
  function renderTheme() {
    const light = root.dataset.theme === "light";
    themeBtn.textContent = light ? "☾" : "☀\uFE0E";
    themeBtn.setAttribute("aria-label", light ? "Switch to dark mode" : "Switch to light mode");
  }
  themeBtn.onclick = () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    try { localStorage.setItem("mspan-theme", root.dataset.theme); } catch (_) {} // plain string: the <head> script reads it
    renderTheme();
  };
  renderTheme();

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => timers.push(setTimeout(r, ms)));
  const rand = (n) => Math.floor(Math.random() * n);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const view = (html) => { si.innerHTML = html; };
  const setKeys = (fn) => { keyHandler = fn; };
  document.addEventListener("keydown", (e) => { if (keyHandler) keyHandler(e); });
  function flash(ok) { screenEl.classList.remove("flash-ok", "flash-no"); void screenEl.offsetWidth; screenEl.classList.add(ok ? "flash-ok" : "flash-no"); }
  const mult = (streak) => Math.min(3, 1 + 0.25 * Math.max(0, streak - 1));

  // Info icon: a small "i" that opens a popover with the details we keep off the screen.
  const info = (html, label = "More info") =>
    `<details class="hint"><summary aria-label="${esc(label)}" title="${esc(label)}">i</summary><div class="pop">${html}</div></details>`;
  function placePop(d) {
    const pop = d.querySelector(".pop"), r = d.querySelector("summary").getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    pop.style.left = Math.min(innerWidth - pw - 8, Math.max(8, r.left + r.width / 2 - pw / 2)) + "px";
    pop.style.top = (r.bottom + 6 + ph > innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6) + "px";
  }
  const closeInfo = (except) => document.querySelectorAll("details.hint[open]").forEach((d) => { if (d !== except) d.open = false; });
  document.addEventListener("toggle", (e) => { if (e.target.matches?.("details.hint") && e.target.open) { closeInfo(e.target); placePop(e.target); } }, true);
  document.addEventListener("click", (e) => { if (!e.target.closest("details.hint")) closeInfo(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInfo(); });
  addEventListener("scroll", () => closeInfo(), { passive: true });

  // ---------- server ----------
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (player) headers.Authorization = `Bearer ${player.id}:${player.token}`;
    let res;
    try {
      res = await fetch(API + path, { method: opts.body ? "POST" : "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    } catch (_) {
      const e = new Error("Can't reach the leaderboard server."); e.network = true; throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || `Server error ${res.status}`); e.status = res.status; throw e; }
    return data;
  }
  const online = () => !!API; // a leaderboard server exists

  // ---------- nicknames ----------
  const ADJ = ["Brave", "Calm", "Clever", "Swift", "Bright", "Gentle", "Lucky", "Mellow", "Nimble", "Quiet", "Sunny", "Witty", "Bold", "Cosmic", "Curious", "Daring", "Eager", "Fuzzy", "Happy", "Jolly", "Keen", "Lively", "Merry", "Noble", "Plucky", "Quick", "Snappy", "Steady", "Tidy", "Zesty", "Breezy", "Cheery"];
  const ANIMAL = ["Otter", "Panda", "Falcon", "Koala", "Lynx", "Heron", "Badger", "Dolphin", "Fox", "Gecko", "Hedgehog", "Ibis", "Jaguar", "Kiwi", "Lemur", "Marten", "Narwhal", "Owl", "Puffin", "Quokka", "Raven", "Seal", "Tapir", "Walrus", "Yak", "Zebra", "Beaver", "Crane", "Moose", "Robin", "Wombat", "Alpaca"];
  const makeName = () => `${ADJ[rand(ADJ.length)]} ${ANIMAL[rand(ANIMAL.length)]} ${10 + rand(90)}`;

  function renderWho() {
    const el = $("who");
    if (!ranked || !player) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `as <b>${esc(player.nickname)}</b><button class="linkbtn" id="rename" aria-label="Change name" title="Change name">✎</button>`;
    $("rename").onclick = () => { if (!game) nameScreen(true); };
  }

  // First Play (or "Change name"): suggest a name, let the player shuffle or type one.
  function nameScreen(changing = false) {
    clear(); lockModes(true);
    let suggestion = changing ? player.nickname : makeName();
    view(`<span class="eyebrow">${changing ? "Change your name" : "Before you play"}</span>
      <h2>${changing ? "Pick a new name" : "Here's your leaderboard name"}</h2>
      <div class="nick" id="nick">${esc(suggestion)}</div>
      <div class="row"><button class="go ghost" id="shuffle">Shuffle</button><button class="go" id="keep">${changing ? "Use this name" : "Keep this name"}</button></div>
      <form id="own" class="row" style="flex-direction:column;align-items:center">
        <input class="name-input" id="own-name" maxlength="24" autocomplete="off" placeholder="Or type your own" aria-label="Or type your own name (3 to 24 letters, numbers or spaces)">
        <button class="go ghost" type="submit">Use my name</button>
      </form>
      <div class="err" id="err"></div>
      ${changing ? `<button class="linkbtn" id="cancel">Cancel</button>` : ""}`);
    const err = $("err");
    $("shuffle").onclick = () => { suggestion = makeName(); $("nick").textContent = suggestion; err.textContent = ""; };
    const save = async (name) => {
      err.textContent = "Saving…";
      try {
        if (changing) {
          const r = await api("/api/player/name", { body: { nickname: name } });
          player.nickname = r.nickname;
        } else {
          player = await api("/api/player", { body: { nickname: name } });
        }
        store.set("mspan-player", player);
        renderWho(); loadBoard();
        changing ? title() : start(true);
      } catch (e) {
        if (e.status === 409 && !changing && name === suggestion) { suggestion = makeName(); $("nick").textContent = suggestion; err.textContent = "That one was taken, so here's another."; return; }
        if (e.network) { err.innerHTML = `${esc(e.message)} <button class="linkbtn" id="offline">Practice instead</button>`; $("offline").onclick = () => setView(false); return; }
        err.textContent = e.message;
      }
    };
    $("keep").onclick = () => save(suggestion);
    $("own").onsubmit = (e) => { e.preventDefault(); const v = $("own-name").value.trim(); if (v) save(v); };
    if (changing) $("cancel").onclick = () => title();
    else { const back = document.createElement("button"); back.className = "linkbtn"; back.textContent = "Practice instead"; back.onclick = () => setView(false); si.appendChild(back); }
    setKeys(null);
  }

  // ---------- engines ----------
  // Both engines speak the same shape: start() -> {state, round}; answer(a) -> {ok, correct, points, over, state, round, rank}
  function makeDigits(n) {
    const out = [];
    while (out.length < n) { const d = rand(10); if (out.length && d === out[out.length - 1]) continue; out.push(d); }
    return out;
  }
  function makePtr(k) {
    const names = LETTERS.slice(0, k), vals = {}, steps = [];
    names.forEach((n) => { vals[n] = rand(9) + 1; steps.push({ text: `${n} = ${vals[n]}`, init: true }); });
    for (let i = 0; i < k + 1; i++) {
      const t = names[rand(k)];
      if (k > 1 && Math.random() < 0.55) { let s; do { s = names[rand(k)]; } while (s === t); vals[t] = vals[s]; steps.push({ text: `${t} = ${s}` }); }
      else { let v; do { v = rand(9) + 1; } while (v === vals[t]); vals[t] = v; steps.push({ text: `${t} = ${v}` }); }
    }
    return { items: steps, names, vals };
  }
  function localEngine(m) {
    const cfg = MODES[m];
    let st = { level: cfg.start, lives: LIVES, score: 0, streak: 0, span: 0, rounds: 0 }, want = null;
    const deal = () => {
      if (m === "ptr") { const r = makePtr(st.level); want = r.vals; return { level: st.level, items: r.items, names: r.names }; }
      const d = makeDigits(st.level); want = (m === "bwd" ? [...d].reverse() : d).join(""); return { level: st.level, items: d };
    };
    return {
      online: false,
      async start() { return { state: { ...st }, round: deal() }; },
      async answer(a) {
        const ok = m === "ptr" ? Object.keys(want).every((k) => Number(a[k]) === want[k]) : String(a) === want;
        const correct = m === "ptr" ? Object.keys(want).map((k) => `${k}=${want[k]}`).join(" ") : want;
        st.rounds++; let points = 0;
        if (ok) { st.streak++; points = Math.round(st.level * 10 * mult(st.streak)); st.score += points; st.span = Math.max(st.span, st.level); }
        else { st.streak = 0; st.lives--; }
        const over = st.lives <= 0 || (ok && st.level >= cfg.max);
        if (over) return { ok, correct, points, over, state: { ...st } };
        if (ok) st.level++;
        return { ok, correct, points, over, state: { ...st }, round: deal() };
      },
    };
  }
  function remoteEngine(m) {
    let gameId = null;
    return {
      online: true,
      async start() { const r = await api("/api/game/start", { body: { mode: m } }); gameId = r.gameId; return r; },
      async answer(a) { return api("/api/game/answer", { body: { gameId, answer: a } }); },
    };
  }

  // ---------- HUD ----------
  function hud() {
    const s = game?.state;
    $("lives").innerHTML = Array.from({ length: LIVES }, (_, i) => `<span class="life ${i < (s ? s.lives : LIVES) ? "" : "lost"}"></span>`).join("");
    $("hud-level").textContent = s ? s.level : "–";
    $("hud-score").textContent = s ? s.score : 0;
    $("hud-streak").textContent = "×" + (s ? String(+mult(s.streak).toFixed(2)) : 1);
  }
  function lockModes(on) { document.querySelectorAll(".mode, #view-seg button").forEach((b) => (b.disabled = on)); }

  // Practice (offline, your own progress graphs) or Live (server games, public leaderboard).
  function setView(live) {
    ranked = live && online(); store.set("mspan-live", ranked);
    renderView(); title();
  }
  function renderView() {
    $("view-seg").hidden = !online();
    document.querySelectorAll("#view-seg button").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.view === "live") === ranked)));
    $("board-panel").hidden = !ranked;
    document.querySelectorAll(".prog").forEach((p) => (p.hidden = ranked));
    renderWho();
    ranked ? loadBoard() : renderProgress();
  }
  document.querySelectorAll("#view-seg button").forEach((b) => (b.onclick = () => { if (!game) setView(b.dataset.view === "live"); }));
  function clear() { timers.forEach(clearTimeout); timers = []; game = null; hud(); }

  // ---------- screens ----------
  function title(msg = "") {
    clear(); lockModes(false);
    const m = MODES[mode];
    const how = {
      fwd: "Digits flash one at a time. Type them back in the same order.",
      bwd: "Digits flash one at a time. Type them back in reverse: see 3 8 1, type 183.",
      ptr: "Each variable gets a value, then some change: a = 4 sets a value, b = a copies a's value at that moment. At the end, give every final value.",
    }[mode];
    const short = {
      fwd: "Remember the digits. Type them in order.",
      bwd: "Remember the digits. Type them backwards.",
      ptr: "Track the variables. Give each final value.",
    }[mode];
    view(`<div class="intro"><h2 class="title">${esc(m.name)}${info(`<p>${how}</p>
        <p>Each right answer adds one item. A miss costs a life; you have ${LIVES}. Answers in a row multiply your points.</p>
        <p>Your <b>span</b> is the longest sequence you get right.</p>
        <p>${ranked ? "<b>Live</b> games go on the public leaderboard." : "<b>Practice</b> is offline: nothing is sent. The graphs under each mode track your progress."}</p>
        <p>Press Enter to start.</p>`, "How to play")}</h2>
      <p>${short}</p></div>
      ${msg ? `<p class="err">${esc(msg)}</p>` : ""}
      <div class="row"><button class="go" id="go">${ranked ? "Play live" : "Practice"}</button></div>`);
    $("go").onclick = () => start(ranked);
    setKeys((e) => { if (e.key === "Enter") { e.preventDefault(); start(ranked); } });
  }

  // Live: rounds come from the server and the game goes on the leaderboard.
  // Practice: rounds are made here and nothing is sent.
  async function start(live) {
    live = live && online();
    if (live && !player) return nameScreen();
    setKeys(null);
    view(`<span class="eyebrow">Starting…</span>`);
    const engine = live ? remoteEngine(mode) : localEngine(mode);
    let first;
    try { first = await engine.start(); }
    catch (e) {
      if (e.status === 401) { player = null; store.set("mspan-player", null); renderWho(); return nameScreen(); }
      return title(e.network ? `${e.message} Try again, or switch to Practice.` : e.message);
    }
    game = { engine, state: first.state, round: first.round };
    lockModes(true); hud(); play();
  }

  async function play() {
    setKeys(null);
    const m = MODES[mode], token = (game.token = Symbol());
    const isPtr = mode === "ptr", r = game.round, items = r.items;
    view(`<span class="eyebrow">Level ${r.level} · ${r.level} ${m.unit}${game.engine.online ? "" : " · practice"}</span>
      <div class="stim ${isPtr ? "code" : ""}" id="stim">&nbsp;</div>
      <div class="dots">${items.map(() => `<span class="dot"></span>`).join("")}</div>`);
    const stim = $("stim"), dots = si.querySelectorAll(".dot");
    await sleep(650); if (game?.token !== token) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      stim.textContent = isPtr ? it.text : it;
      stim.classList.remove("pop"); void stim.offsetWidth; stim.classList.add("pop");
      dots[i].classList.add("on"); sfx.tick();
      await sleep(isPtr ? (it.init ? m.show : m.update) : m.show); if (game?.token !== token) return;
      stim.innerHTML = "&nbsp;";
      await sleep(m.gap); if (game?.token !== token) return;
    }
    isPtr ? askPtr(r) : askDigits(r);
  }

  function askDigits(r) {
    const rev = mode === "bwd";
    let typed = "";
    view(`<span class="eyebrow">${rev ? "Type it backwards" : "Type it in order"}</span>
      <div class="typed" id="typed"><span class="caret">&nbsp;</span></div>
      <div class="pad" id="pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button class="key" data-k="${d}">${d}</button>`).join("")}
        <button class="key wide" data-k="del" aria-label="Delete">⌫</button>
        <button class="key" data-k="0">0</button>
        <button class="key ok wide" data-k="ok">Enter</button>
      </div>`);
    const out = $("typed");
    const render = () => { out.innerHTML = esc(typed) + `<span class="caret">&nbsp;</span>`; };
    const press = (k) => {
      if (k === "del") typed = typed.slice(0, -1);
      else if (k === "ok") { if (typed.length) submit(typed, `you typed <span class="mono">${esc(typed)}</span>`); return; }
      else if (typed.length < 16) typed += k;
      render();
    };
    $("pad").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) press(b.dataset.k); };
    setKeys((e) => {
      if (/^[0-9]$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); press("del"); }
      else if (e.key === "Enter") { e.preventDefault(); press("ok"); }
    });
  }

  function askPtr(r) {
    view(`<span class="eyebrow">Final values</span>
      <form id="f" style="display:grid;gap:14px;justify-items:center;width:100%">
        <div class="vars">${r.names.map((n) => `<label for="v-${n}">${n}<input id="v-${n}" inputmode="numeric" maxlength="2" autocomplete="off"></label>`).join("")}</div>
        <button class="go" type="submit">Check</button>
      </form>`);
    const inputs = r.names.map((n) => $("v-" + n));
    inputs[0].focus();
    inputs.forEach((inp, i) => inp.addEventListener("input", () => { if (inp.value.length >= 1 && inputs[i + 1]) inputs[i + 1].focus(); }));
    setKeys(null);
    $("f").onsubmit = (e) => {
      e.preventDefault();
      const ans = {}; r.names.forEach((n) => (ans[n] = $("v-" + n).value.trim()));
      const typed = r.names.map((n) => `${n}=${ans[n] || "?"}`).join(" ");
      const seq = r.items.map((s) => s.text).join("  →  ");
      submit(ans, `you typed <span class="mono">${esc(typed)}</span><br><span class="mono small">${esc(seq)}</span>`);
    };
  }

  async function submit(answer, typedHtml) {
    setKeys(null);
    view(`<span class="eyebrow">Checking…</span>`);
    let res;
    try { res = await game.engine.answer(answer); }
    catch (e) { return title(e.message + " This game couldn't be saved."); }
    result(res, typedHtml);
  }

  function result(res, typedHtml) {
    const { ok, correct, points, over } = res;
    game.state = res.state; game.round = res.round; game.rank = res.rank;
    ok ? sfx.ok() : sfx.no(); flash(ok); hud();
    const s = res.state;
    view(`<div class="verdict ${ok ? "ok" : "no"}">${ok ? "Correct" : "Missed"}</div>
      ${ok ? `<div class="points">+${points}</div>` : `<p>${s.lives} ${s.lives === 1 ? "life" : "lives"} left</p>`}
      <p class="small">Answer <span class="mono">${esc(correct)}</span> · ${typedHtml}</p>
      <div class="row"><button class="go" id="next">${over ? "See results" : ok ? "Level " + s.level : "Try level " + s.level + " again"}</button></div>`);
    const next = () => (over ? gameOver() : play());
    $("next").onclick = next;
    setKeys((e) => { if (e.key === "Enter") { e.preventDefault(); next(); } });
  }

  function gameOver() {
    sfx.over();
    const m = MODES[mode], g = game.state, rank = game.rank, counted = game.engine.online;
    const prev = best[mode];
    const newSpan = !prev || g.span > prev.span;
    const newScore = !prev || g.score > prev.score;
    best[mode] = { span: Math.max(g.span, prev?.span || 0), score: Math.max(g.score, prev?.score || 0) };
    store.set("mspan-best", best);
    history.unshift({ date: dayKey(new Date()), mode, span: g.span, score: g.score, ranked: counted });
    history = history.slice(0, 3000); store.set("mspan-history", history); // a month of heavy play across three modes
    renderBest(); counted ? loadBoard() : renderProgress();
    clear(); lockModes(false);
    view(`<span class="eyebrow">${esc(m.name)}${counted ? "" : " · practice"} · game over</span>
      ${(newScore || newSpan) && g.score > 0 ? `<span class="badge">${newSpan ? "New best span" : "New high score"}</span>` : ""}
      <div class="big">${g.score}</div>
      <div class="results">
        <div><span class="k">Span ${info(`<p>Span is the longest sequence you got right.</p><p>${g.span ? `You held ${g.span} ${m.unit}. ` : ""}${spanNote(mode, g.span)}</p>`, "About your span")}</span><span class="v">${g.span || "–"}</span></div>
        <div><span class="k">${counted ? "Rank" : "Rounds"}</span><span class="v">${counted ? (rank ? "#" + rank : "–") : g.rounds}</span></div>
        <div><span class="k">Best span</span><span class="v">${best[mode].span || "–"}</span></div>
      </div>
      <div class="row"><button class="go" id="again">${counted ? "Play again" : "Practice again"}</button><button class="go ghost" id="copy">Copy result</button></div>`);
    $("again").onclick = () => start(counted);
    $("copy").onclick = async (e) => {
      const text = `memory.span · ${m.name}: span ${g.span}, ${g.score} points${counted && rank ? `, rank #${rank}` : ""}`;
      try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied"; }
      catch (_) { e.target.textContent = text; }
    };
    setKeys((e) => { if (e.key === "Enter") { e.preventDefault(); start(counted); } });
  }

  function spanNote(m, s) {
    if (!s) return "Try again when you're settled; the first level is short.";
    if (m === "fwd") return s >= 8 ? "That's above the usual range." : s >= 5 ? "That's in the usual adult range of 5 to 8." : "That's below the usual range today; tiredness costs a digit or two.";
    if (m === "bwd") return s >= 7 ? "That's above the usual range." : s >= 4 ? "That's in the usual adult range of 4 to 6." : "That's below the usual range today; reversing is hard when tired.";
    return "Pointers has no published norms; beat your own best.";
  }

  // ---------- panels ----------
  function renderBest() {
    for (const k of Object.keys(MODES)) {
      const b = best[k];
      $("pb-" + k).textContent = b ? `Best span ${b.span}` : "Best span –";
    }
  }

  // Progress under each mode card: one bar per day for the last 30 days,
  // each bar the best span that day. Days without a game stay empty.
  const DAYS = 30;
  const dayKey = (d) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
  const dayLabel = (d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const lastDays = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (n - 1 - i)); return d; });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);

  function renderProgress() {
    const days = lastDays(DAYS), keys = days.map(dayKey);
    for (const k of Object.keys(MODES)) {
      const el = $("prog-" + k);
      const all = history.filter((r) => r.mode === k);
      if (!all.length) { el.innerHTML = `<p class="empty">Finish a game to start your graph.</p>`; continue; }
      const byDay = new Map();
      for (const r of all) {
        if (r.date < keys[0]) continue;
        const d = byDay.get(r.date) || { best: 0, n: 0 };
        d.best = Math.max(d.best, r.span); d.n++; byDay.set(r.date, d);
      }
      const daily = keys.map((key) => byDay.get(key) || null);
      const played = daily.filter(Boolean);
      const week = (from, to) => daily.slice(from, to).filter(Boolean).map((d) => d.best);
      const thisWeek = week(DAYS - 7, DAYS), lastWeek = week(DAYS - 14, DAYS - 7);
      const delta = thisWeek.length && lastWeek.length ? mean(thisWeek) - mean(lastWeek) : null;
      const flat = delta == null || Math.abs(delta) < 0.05;
      const trend = delta == null ? "–" : flat ? "±0" : `${delta > 0 ? "▲" : "▼"}${Math.abs(delta).toFixed(1)}`;
      el.innerHTML = `<div class="stats">
          <div><span class="k">Best</span><span class="v">${played.length ? Math.max(...played.map((d) => d.best)) : "–"}</span></div>
          <div class="days"><span class="k">Days</span><span class="v">${played.length}</span></div>
          <div><span class="k">Week</span><span class="v ${flat ? "" : delta > 0 ? "up" : "down"}">${trend}</span></div>
          ${info(`<p>Each bar is your best span that day, over the last ${DAYS} days. You played on ${played.length} of them; empty days are days you didn't play.</p>
            <p><b>Best</b>: best span in ${DAYS} days.<br><b>Days</b>: days you played.<br><b>Week</b>: your average daily best this week compared with last week.</p>
            ${MODES[k].norm ? `<p>The shaded band is the usual adult range, ${MODES[k].norm.join(" to ")}. It's a rough guide from research, not a test.</p>` : ""}`, `${MODES[k].name} progress`)}
        </div>`;
      if (!played.length) { el.insertAdjacentHTML("beforeend", `<p class="empty">No games in the last ${DAYS} days.</p>`); continue; }
      drawChart(el, days, daily, MODES[k].norm);
    }
  }

  function drawChart(el, allDays, allDaily, norm) {
    const cs = getComputedStyle(el);
    const w = Math.max(60, el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const h = 80, padL = 14, padT = 12, axisH = 14, base = h - axisH;
    const n = Math.min(allDays.length, Math.max(7, Math.floor((w - padL) / 4))); // at least 4px per day
    const days = allDays.slice(-n), daily = allDaily.slice(-n);
    const top = Math.max(1, norm ? norm[1] : 0, ...daily.filter(Boolean).map((d) => d.best));
    const slot = (w - padL) / n, bw = Math.min(24, Math.max(1.5, slot - 2));
    const X = (i) => padL + i * slot + (slot - bw) / 2;
    const Y = (v) => base - (v * (base - padT)) / top;
    const bar = (i, v) => {
      const x = X(i), y = Math.min(Y(v), base - 2), r = Math.min(2, bw / 2, base - y); // 4px-style rounded top, square base
      return `<path class="bar" d="M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + bw - r}Q${x + bw},${y} ${x + bw},${y + r}V${base}Z"/>`;
    };
    el.insertAdjacentHTML("beforeend", `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"
        aria-label="Best span per day, last ${n} days: ${daily.map((d, i) => d && `${dayLabel(days[i])} ${d.best}`).filter(Boolean).join(", ")}">
        <rect class="col" y="${padT - 4}" width="${slot}" height="${base - padT + 4}" visibility="hidden"/>
        ${norm ? `<rect class="norm" x="${padL}" y="${Y(norm[1])}" width="${w - padL}" height="${Y(norm[0]) - Y(norm[1])}"/>
          <line class="norm-edge" x1="${padL}" x2="${w}" y1="${Y(norm[1])}" y2="${Y(norm[1])}"/><line class="norm-edge" x1="${padL}" x2="${w}" y1="${Y(norm[0])}" y2="${Y(norm[0])}"/>
          <text class="tick" x="${padL - 4}" y="${Y(norm[0])}">${norm[0]}</text><text class="tick" x="${padL - 4}" y="${Y(norm[1])}">${norm[1]}</text>` : ""}
        ${!norm || top - norm[1] >= 2 ? `<line class="grid" x1="${padL}" x2="${w}" y1="${Y(top)}" y2="${Y(top)}"/><text class="tick" x="${padL - 4}" y="${Y(top)}">${top}</text>` : ""}
        ${daily.map((d, i) => (d ? bar(i, d.best) : "")).join("")}
        <line class="axis" x1="${padL}" x2="${w}" y1="${base}" y2="${base}"/><text class="tick" x="${padL - 4}" y="${base}">0</text>
        ${norm // with a band, its key takes the left of the date row
          ? `<rect class="norm-key" x="${padL}" y="${h - 9}" width="7" height="7" rx="1.5"/><text class="date" x="${padL + 10}" y="${h - 2}">${w >= 150 ? "adults " : ""}${norm.join("–")}</text>`
          : `<text class="date" x="${padL}" y="${h - 2}">${w < 150 ? `${n}d` : dayLabel(days[0])}</text>`}
        <text class="date" x="${w}" y="${h - 2}" text-anchor="end">Today</text>
      </svg>`);

    const svg = el.querySelector("svg"), col = svg.querySelector(".col");
    const show = (e) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - padL) / slot)));
      col.setAttribute("x", padL + i * slot); col.setAttribute("visibility", "visible");
      const d = daily[i];
      tip.innerHTML = `<span class="d">${dayLabel(days[i])}</span><br>${d ? `Best span <b>${d.best}</b> · ${d.n} ${d.n === 1 ? "game" : "games"}` : "No games"}`;
      tip.hidden = false;
      const tw = tip.offsetWidth, th = tip.offsetHeight, cx = r.left + padL + (i + 0.5) * slot;
      tip.style.left = Math.min(innerWidth - tw - 8, Math.max(8, cx - tw / 2)) + "px";
      tip.style.top = Math.max(8, r.top + (d ? Y(d.best) : base) - th - 10) + "px";
    };
    const hide = () => { tip.hidden = true; col.setAttribute("visibility", "hidden"); };
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", hide);
  }
  let resizeFrame = 0;
  addEventListener("resize", () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { if (!ranked) renderProgress(); }); });
  addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });
  let boardMode = "fwd";
  async function loadBoard() {
    const body = $("board");
    if (!online()) { body.innerHTML = `<tr><td colspan="5" style="color:var(--dim)">The leaderboard isn't connected yet. Games are saved in this browser only.</td></tr>`; return; }
    body.innerHTML = `<tr><td colspan="5" style="color:var(--dim)">Loading…</td></tr>`;
    const want = boardMode, total = want === "total";
    $("board-head").innerHTML = total
      ? `<tr><th>#</th><th>Player</th><th>Total</th><th>Modes</th></tr>`
      : `<tr><th>#</th><th>Player</th><th>Span</th><th>Score</th><th>Date</th></tr>`;
    try {
      const r = await api(`/api/leaderboard?mode=${want}`);
      if (want !== boardMode) return; // another tab was picked while this loaded
      const who = (x) => `<td class="num">${x.rank}</td><td>${esc(x.nickname)}${x.you ? " (you)" : ""}</td>`;
      const breakdown = (x) => Object.keys(MODES).map((k) => `${MODES[k].name} ${x.scores[k] ?? "–"}`).join(" · ");
      body.innerHTML = r.entries.length
        ? r.entries.map((x) => total
          ? `<tr class="${x.you ? "you" : ""}" title="${esc(breakdown(x))}">${who(x)}<td class="num">${x.total}</td><td class="num">${x.modes}/3</td></tr>`
          : `<tr class="${x.you ? "you" : ""}">${who(x)}<td class="num">${x.span}</td><td class="num">${x.score}</td><td class="num">${x.date}</td></tr>`).join("")
        : `<tr><td colspan="5" style="color:var(--dim)">No scores yet${total ? "" : ` in ${esc(MODES[want].name)}`}. Be the first.</td></tr>`;
    } catch (e) {
      if (want !== boardMode) return;
      body.innerHTML = `<tr><td colspan="5" style="color:var(--dim)">${esc(e.message)}</td></tr>`;
    }
  }
  document.querySelectorAll("#board-tabs button").forEach((b) => (b.onclick = () => {
    boardMode = b.dataset.mode;
    document.querySelectorAll("#board-tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    loadBoard();
  }));

  document.querySelectorAll(".mode").forEach((b) => (b.onclick = () => {
    if (game) return;
    mode = b.dataset.mode;
    document.querySelectorAll(".mode").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    boardMode = mode;
    document.querySelectorAll("#board-tabs button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.mode === mode)));
    if (ranked) loadBoard(); title();
  }));

  renderSound(); renderBest(); renderView();
  title();
})();
