// Projector view: full-screen slides, join screen with QR, hinge question with optional results.
// Works on its own (keyboard / clicker) or alongside teacher.html on another screen or a phone.
// Interactive HTML decks run as the real deck (builds, timers, animations, laser, blank screen),
// driven in step with the live session.
import { configured, onUser, signIn, isTeacher, watch, read } from "./fb.js";
import { $, esc, joinUrl, shortJoinUrl, tally, hingeSlideHtml, cloudHtml, countWords, boardHtml, fmtSecs, normS } from "./ui.js";
import * as L from "./session.js";
import QR from "./qr.js";

const app = $("#app");
let CODE = null, S = null, NOW = null, PRES = {}, VOTES = {}, LESSON = null, ROSTER = {}, offset = 0;
let subs = [];
const deck = { frame: null, lesson: null, ready: false, state: { n: 0, step: 0 }, want: null, expect: null, sync: false, numPending: false };

const msg = (html) => { resetDeck(); app.innerHTML = `<div class="present-msg">${html}</div>`; };

if (!configured) msg("Add your Firebase settings to js/config.js first.");
else onUser((u) => {
  if (!u) { msg(`<p>Projector view</p><button class="btn primary" id="go">Teacher sign-in</button>`); $("#go").onclick = () => signIn(""); return; }
  if (!isTeacher(u)) return msg(`${esc(u.email)} isn't a teacher account.`);
  watch("teacher/current", follow);
});

function follow(code) {
  subs.forEach((f) => f()); subs = [];
  CODE = code; S = NOW = LESSON = null; PRES = {}; VOTES = {};
  if (!code) return msg("No live lesson running.<br><span class='small'>Start one on the teacher page — this window will follow it.</span>");
  resetDeck();
  app.innerHTML = `<div class="stage" id="stage"><div id="deckLayer" class="fill hidden"></div><div id="other" class="fill"></div><div id="ov" class="fill" style="pointer-events:none"></div>
    <div id="devView" class="dev-view ${devOn ? "" : "hidden"}"><div class="dev-label">Student view</div><div class="dev-screen"><iframe title="What students see" src="index.html?preview=1"></iframe></div></div></div>`;
  fitDev();
  subs.push(watch(`sessions/${code}`, async (v) => {
    S = normS(v);
    if (S) L.observe(code, S);
    if (S && (!LESSON || LESSON.id !== S.lessonId)) LESSON = await L.loadLesson(S.lessonId, true);
    render(); schedulePublish();
  }));
  subs.push(watch(`now/${code}`, (v) => { NOW = v; render(); }));
  subs.push(watch(`presence/${code}`, (v) => { PRES = v || {}; renderOverlay(); }));
  subs.push(watch(`votes/${code}`, (v) => { VOTES = v || {}; render(); schedulePublish(); }));
  subs.push(watch("roster", (v) => { ROSTER = v || {}; schedulePublish(); }));
  subs.push(watch(".info/serverTimeOffset", (v) => (offset = +v || 0)));
  const iv = setInterval(() => { if (S && CODE === code) { L.tick(code, S, PRES, offset); paintClock(); } }, 500);
  subs.push(() => clearInterval(iv));
}
/* ---- "Student view": a phone-sized mirror of what devices show (D or the bar) ---- */
let devOn = false;
try { devOn = localStorage.getItem("ll_devview") === "1"; } catch (e) {}
function fitDev() {
  const box = document.querySelector("#devView .dev-screen"), f = box && box.querySelector("iframe");
  if (!f) return;
  const sc = box.clientWidth / 390;
  f.style.transform = `scale(${sc})`;
}
addEventListener("resize", fitDev);
function toggleDev() {
  devOn = !devOn;
  try { localStorage.setItem("ll_devview", devOn ? "1" : "0"); } catch (e) {}
  const el = $("#devView"); if (el) el.classList.toggle("hidden", !devOn);
  fitDev(); hud();
}

let pubT = null;
function schedulePublish() { clearTimeout(pubT); pubT = setTimeout(() => { if (S && LESSON) L.publish(CODE, S, LESSON, VOTES, ROSTER); }, 600); }

let lastMode = null;
function render() {
  const other = $("#other");
  if (!other || !S || !LESSON) return;
  const it = LESSON.order[S.pos];
  const mode = it && it.t === "html" ? "html" : "other";
  $("#deckLayer").classList.toggle("hidden", mode !== "html");
  other.classList.toggle("hidden", mode === "html" && deck.ready);
  if (mode === "html") {
    ensureDeck(LESSON.id);
    if (!deck.ready) other.innerHTML = `<div class="present-msg" style="padding-top:20%">Loading the deck…</div>`;
    deckGoto(it.n, S.step || 0);
    if (lastMode !== "html" && deck.ready) focusDeck();
    paintDeckResults();
  } else {
    if (lastMode === "html") window.focus();
    if (it && it.t === "q" && S.qs) other.innerHTML = standaloneHtml();
    else other.innerHTML = NOW && NOW.pos === S.pos && NOW.img ? `<img src="${NOW.img}" alt="">` : "";
  }
  lastMode = mode;
  renderOverlay();
  hud();
}

/** A question that isn't on a deck slide (PDF lessons): drawn as its own slide. */
function standaloneHtml() {
  const vk = S.qs.ids[0], item = S.qs.items[vk] || {}, q = LESSON.questions[L.baseId(vk)] || {};
  const joined = Object.keys(PRES).length, open = !!(S.open && S.open[vk]);
  if (item.type === "word") {
    const show = S.results || !open;
    return `<div class="hinge-slide"><div class="hs-top"><span class="hs-kicker">One word</span><span class="hs-status ${open ? "live" : ""}">${open ? "Type your word" : "Closed"} · ${Object.keys(VOTES[vk] || {}).length}${joined ? " / " + joined : ""} answered</span></div>
      <h1 class="hs-prompt">${esc(item.prompt)}</h1>${show ? cloudHtml(countWords(VOTES[vk], (S.hidden || {})[vk] || {}), { accept: S.reveal && S.reveal[vk] ? q.accept : null }) : ""}</div>`;
  }
  const counts = tally(VOTES[vk], Object.keys(item.options || {}));
  return hingeSlideHtml({ ...item, round: S.qs.round }, {
    counts, showResults: !!S.results, reveal: S.reveal && S.reveal[vk], open,
    closed: !open && S.closed && S.closed[vk], answered: counts.total, joined,
  });
}

function renderOverlay() {
  const ov = $("#ov");
  if (!ov || !S) return;
  const joined = Object.keys(PRES).length;
  if (S.join) {
    let qr = "";
    try { qr = QR.svg(joinUrl(CODE), 400); } catch (e) { qr = ""; }
    ov.innerHTML = `<div class="join-overlay"><div class="qr">${qr}</div><div>
      <h2>Join the lesson</h2><div class="url">${esc(shortJoinUrl())}</div>
      <div class="big-code">${esc(CODE)}</div>
      <div class="joined">${joined} joined · sign in with your school Google account</div></div></div>`;
    return;
  }
  if (S.board) {
    const { board } = L.computeScores(LESSON, S, VOTES, ROSTER);
    ov.innerHTML = `<div class="board-overlay"><h2>Leaderboard</h2>${boardHtml(board, { limit: 10 })}</div>`;
    return;
  }
  let html = `<span class="corner-code ${lastMode === "html" ? "" : "always"}">${esc(shortJoinUrl())} · ${esc(CODE)}</span>`;
  const it = LESSON && LESSON.order[S.pos];
  if (S.qs && it && it.t === "html") {
    const vks = S.qs.ids, open = !!(S.open && S.open[vks[0]]);
    const done = Object.keys(PRES).filter((u) => vks.every((vk) => VOTES[vk] && VOTES[vk][u])).length;
    html += `<div class="q-status ${open ? "live" : ""}"><span id="pclock"></span><span>${open ? "Answer on your device" : "Closed"} · ${done}${joined ? " / " + joined : ""} done</span></div>`;
    // the deck's own timer on a question slide shows the live countdown (the one students see)
    const tbox = S.timer !== false && S.qs.openedAt ? deckTimerBox() : "";
    if (tbox) html += `<div class="deck-clock" id="dclock" style="${tbox}"></div>`;
    // one-word question on a deck slide: the cloud floats over the slide
    if (S.qs.type === "word") {
      const vk = vks[0], q = LESSON.questions[L.baseId(vk)] || {};
      html += `<div class="cloud-overlay" style="${wordAreaStyle()}">${cloudHtml(countWords(VOTES[vk], (S.hidden || {})[vk] || {}), { accept: S.reveal && S.reveal[vk] ? q.accept : null })}</div>`;
    }
    // card sets / hinge slides whose options we can't find on the slide: a results panel
    if (S.results && S.qs.type !== "word" && !deckResultsDrawn) html += `<div class="res-panel">${resultsRows()}</div>`;
  }
  ov.innerHTML = html;
  paintClock();
}
/** Put the live word cloud exactly over the deck's "words appear here" area, if the slide has one. */
function wordAreaStyle() {
  try {
    const d = deck.frame && deck.frame.contentDocument, a = d && d.querySelector(".slide.active .wq-area");
    if (!a) return "";
    const b = a.getBoundingClientRect(), f = deck.frame.getBoundingClientRect(), st = $("#stage").getBoundingClientRect();
    return `left:${b.left + f.left - st.left}px;top:${b.top + f.top - st.top}px;width:${b.width}px;height:${b.height}px;right:auto;bottom:auto`;
  } catch (e) { return ""; }
}
function paintClock() {
  const left = L.secondsLeft(S, offset);
  const el = document.getElementById("pclock");
  if (el) { el.textContent = left == null ? "" : `⏱ ${fmtSecs(left)}  `; el.classList.toggle("warn", left != null && left <= 5); }
  const dc = document.getElementById("dclock");
  if (dc) { dc.textContent = fmtSecs(left == null ? 0 : left); dc.classList.toggle("warn", left == null || left <= 5); }
  markDeckTimer(!!dc);
}
/** Where the deck's own timer sits on the current slide (so the live countdown can cover it). */
function deckTimerBox() {
  try {
    const d = deck.frame && deck.frame.contentDocument, a = d && d.querySelector(".slide.active .timer");
    if (!a) return "";
    const b = a.getBoundingClientRect(), f = deck.frame.getBoundingClientRect(), st = $("#stage").getBoundingClientRect();
    if (!b.width || !b.height) return "";
    return `left:${b.left + f.left - st.left}px;top:${b.top + f.top - st.top}px;width:${b.width}px;height:${b.height}px;font-size:${Math.round(b.height * 0.55)}px`;
  } catch (e) { return ""; }
}
/** Hide the deck's own (unlinked) timer while the live countdown covers it. */
function markDeckTimer(on) {
  try {
    const d = deck.frame && deck.frame.contentDocument; if (!d) return;
    if (!d.getElementById("ll-timer-style")) {
      const st = d.createElement("style"); st.id = "ll-timer-style";
      st.textContent = "html.ll-live-timer .slide.active .timer{visibility:hidden!important}";
      d.head.appendChild(st);
    }
    d.documentElement.classList.toggle("ll-live-timer", on);
  } catch (e) {}
}
addEventListener("resize", () => { if (S && S.qs && lastMode === "html") renderOverlay(); });
function resultsRows() {
  return S.qs.ids.map((vk) => {
    const q = LESSON.questions[L.baseId(vk)] || {}, item = S.qs.items[vk] || {};
    const v = Object.values(VOTES[vk] || {}), right = v.filter((x) => x.a === q.correct).length;
    const pct = v.length ? Math.round((right / v.length) * 100) : 0;
    return `<div class="rr"><b>${esc(item.card || "")}</b><span class="rt">${esc((item.prompt || "").slice(0, 48))}</span><span class="rb"><i style="width:${pct}%"></i></span><span>${pct}%</span></div>`;
  }).join("");
}

/** AS-style hinge slide: write the live counts into its own tallies, "n of N · x correct", and the verdict. */
function paintAsHinge(sec) {
  const vk = S.qs.ids[0], q = LESSON.questions[L.baseId(vk)] || {}, item = S.qs.items[vk] || {};
  const keys = Object.keys(item.options || {}), c = tally(VOTES[vk], keys);
  const open = !!(S.open && S.open[vk]), joined = Object.keys(PRES).length;
  sec.querySelectorAll(".tags .tag.navy").forEach((t) => (t.textContent = "Answer on your device"));
  sec.querySelectorAll(".hbar .up").forEach((t) => (t.textContent = "Answers in ✋"));
  const showCounts = S.results || !open;
  sec.querySelectorAll(".hopt").forEach((o, i) => { const tc = o.querySelector(".tc"); if (tc) tc.textContent = showCounts ? c[keys[i]] || 0 : "·"; });
  const n = c.total, right = c[q.correct] || 0, pct = n ? Math.round((100 * right) / n) : 0;
  const hres = sec.querySelector(".hres");
  if (hres) hres.textContent = n ? `${n} of ${joined || n} answered · ${right} correct (${pct}%)` : "No answers yet";
  const vd = sec.querySelector(".verdict");
  if (vd) {
    if (!n) { vd.textContent = "Decide"; vd.className = "verdict"; }
    else if (pct >= 80) { vd.textContent = `Move on — ${pct}% correct. Pick up the few on the worksheet.`; vd.className = "verdict go"; }
    else { vd.textContent = `Re-teach before the worksheet — ${pct}% correct`; vd.className = "verdict stop"; }
  }
}

/** Results drawn onto the deck slide itself: a badge on each card / option. */
let deckResultsDrawn = false;
function paintDeckResults() {
  deckResultsDrawn = false;
  if (!deck.ready || !deck.frame) return;
  const d = deck.frame.contentDocument; if (!d) return;
  d.querySelectorAll(".ll-badge").forEach((b) => b.remove());
  const sec = d.querySelector(".slide.active"); if (!sec) return;
  if (S.qs && S.qs.type === "mcq" && sec.classList.contains("hinge") && sec.querySelector(".hopt .tc")) {
    paintAsHinge(sec);   // the deck's own tally + verdict, filled live
    deckResultsDrawn = true;
    return;
  }
  if (!S.results || !S.qs || S.qs.type === "word") return;
  if (!d.getElementById("ll-style")) {
    const st = d.createElement("style"); st.id = "ll-style";
    st.textContent = `.ll-badge{position:absolute;right:14px;top:12px;z-index:5;font:700 24px/1 var(--sans,sans-serif);padding:8px 14px;border-radius:999px;background:#16324F;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18)}
      .ll-badge.ok{background:#1C7A55}.ll-badge.mid{background:#D96A20}.ll-badge.bad{background:#B4372B}.scard,[data-opt]{position:relative}
      .ll-badge.opt{position:static;display:inline-block;margin-left:auto;background:#FFF6E8;color:#D96A20;border:2px solid #D96A20}`;
    d.head.appendChild(st);
  }
  let drew = 0;
  S.qs.ids.forEach((vk) => {
    const q = LESSON.questions[L.baseId(vk)] || {}, item = S.qs.items[vk] || {};
    const v = Object.values(VOTES[vk] || {});
    if (item.card) {
      const card = [...sec.querySelectorAll(".scard")].find((c) => (c.querySelector(".n") || {}).textContent === item.card);
      if (!card) return;
      const right = v.filter((x) => x.a === q.correct).length, pct = v.length ? Math.round((right / v.length) * 100) : 0;
      const b = d.createElement("span"); b.className = "ll-badge " + (pct >= 80 ? "ok" : pct >= 50 ? "mid" : "bad");
      b.textContent = `✓ ${pct}%`; card.appendChild(b); drew++;
    } else {
      const counts = tally(VOTES[vk], Object.keys(item.options || {}));
      sec.querySelectorAll("[data-opt]").forEach((o) => {
        const k = o.getAttribute("data-opt"), n = counts[k] || 0;
        const b = d.createElement("span"); b.className = "ll-badge opt";
        b.textContent = `${n} · ${counts.total ? Math.round((n / counts.total) * 100) : 0}%`; o.appendChild(b); drew++;
      });
    }
  });
  deckResultsDrawn = drew > 0;
}

/* ======================= the real HTML deck ======================= */

function resetDeck() {
  if (deck.frame) deck.frame.remove();
  Object.assign(deck, { frame: null, lesson: null, ready: false, state: { n: 0, step: 0 }, want: null, expect: null });
}

async function ensureDeck(lessonId) {
  if (deck.lesson === lessonId) return;
  resetDeck();
  deck.lesson = lessonId;
  const html = await read(`decks/${lessonId}`);
  if (deck.lesson !== lessonId || !$("#deckLayer")) return;
  const f = document.createElement("iframe");
  f.className = "deckframe";
  // your own deck, so it runs with full access to its frame (timers, sound, fullscreen)
  f.setAttribute("sandbox", "allow-scripts allow-same-origin");
  f.setAttribute("allow", "fullscreen; autoplay");
  f.addEventListener("load", () => { attach(f); deck.ready = true; render(); focusDeck(); }, { once: true });
  f.srcdoc = html || "<p>Deck not found</p>";
  $("#deckLayer").appendChild(f);
  deck.frame = f;
}

function focusDeck() { try { deck.frame && deck.frame.contentWindow.focus(); } catch (e) {} }

function attach(f) {
  const w = f.contentWindow;
  // the deck reports every move as #slide-step — listen to that
  const orig = w.history.replaceState;
  w.history.replaceState = function (a, b, url) {
    const m = /#(\d+)(?:-(\d+))?/.exec(String(url || ""));
    if (m) deckMoved(+m[1] - 1, +(m[2] || 0));
    try { return orig.call(w.history, a, b, url); } catch (e) { return undefined; }
  };
  const NAV = { ArrowRight: "next", ArrowDown: "next", PageDown: "next", " ": "next", Enter: "next", n: "next", N: "next",
    ArrowLeft: "prev", ArrowUp: "prev", PageUp: "prev", Backspace: "prev", p: "prev", P: "prev",
    j: "join", J: "join", f: "fullscreen", F: "fullscreen", s: "board", S: "board", d: "devices", D: "devices" };
  const Q_KEYS = { v: "vote", V: "vote", r: "results", R: "results", a: "reveal", A: "reveal" };
  const overlayOpen = () => !!w.document.querySelector(".ov.show") || !!(w.document.getElementById("blank") || {}).className;
  w.addEventListener("keydown", (e) => {
    if (!e.isTrusted || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { deck.numPending = true; return; }           // deck's "type a slide number" — let it through
    if (deck.numPending && (k === "Enter" || k === "Escape" || k === "Backspace")) { deck.numPending = false; return; }
    if (overlayOpen()) return;                                           // menu / help / black screen: deck handles it
    const a = NAV[k] || (S && S.qs ? Q_KEYS[k] : null);                 // V/R/A belong to the deck except on question slides
    if (!a) return;                                                      // T timer, B black, L laser, G menu… stay in the deck
    e.preventDefault(); e.stopImmediatePropagation();
    act[a]();
  }, true);
  w.addEventListener("click", (e) => {
    if (!e.isTrusted || e.target.closest("button,a,.ov,#ctrl,.timer") || overlayOpen()) return;
    e.preventDefault(); e.stopImmediatePropagation(); act.next();
  }, true);
  w.addEventListener("contextmenu", (e) => {
    if (!e.isTrusted || e.target.closest(".ov")) return;
    e.preventDefault(); e.stopImmediatePropagation(); act.prev();
  }, true);
  w.addEventListener("mousemove", wake);
  // the live-lesson bar replaces the deck's own ‹ › buttons (so hinge questions are never skipped)
  const st = w.document.createElement("style");
  st.textContent = "#ctrl,#toast{display:none!important}";
  w.document.head.appendChild(st);
  deck.state = { n: 0, step: 0 };
}

function key(k) {
  const w = deck.frame.contentWindow;
  deck.sync = true;
  try { w.dispatchEvent(new w.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); } finally { deck.sync = false; }
}
const maxOf = (n) => { const it = LESSON && LESSON.order.find((x) => x.t === "html" && x.n === n); return it ? it.max || 0 : 0; };

function deckGoto(n, st) {
  deck.want = { n, step: st };
  if (!deck.ready) return;
  const cs = deck.state;
  if (cs.n === n && cs.step === st) return;
  if (cs.n === n && st === cs.step + 1) return key("ArrowRight");                         // next build, animated
  if (cs.n === n && st === cs.step - 1) return key("ArrowLeft");
  if (n === cs.n + 1 && st === 0 && cs.step === maxOf(cs.n)) return key("ArrowRight");     // next slide, the deck's own way (auto-start timers)
  if (n === cs.n - 1 && cs.step === 0 && st === maxOf(n)) return key("ArrowLeft");
  const w = deck.frame.contentWindow, h = `#${n + 1}-${st}`;
  deck.expect = { n, step: st };
  if (w.location.hash === h) w.location.hash = "#";
  w.location.hash = h;
}

function deckMoved(n, st) {
  deck.state = { n, step: st };
  clearTimeout(deck.reT); deck.reT = setTimeout(() => { if (S) renderOverlay(); }, 450);   // re-place the live clock once the slide has settled
  if (deck.sync) return;                                                    // we asked for this
  if (deck.expect && deck.expect.n === n && deck.expect.step === st) { deck.expect = null; return; }
  // the teacher moved the deck itself (slide menu, typed number, swipe, R to restart builds) → follow it
  if (!S || !LESSON) return;
  const pos = LESSON.order.findIndex((x) => x.t === "html" && x.n === n);
  if (pos < 0) return;
  if (S.pos === pos && (S.step || 0) === st) return;
  L.jump(CODE, LESSON, pos, st);
}

/* ---- on-screen controls (appear when the mouse moves) + keyboard ---- */
const act = {
  next: () => S && LESSON && L.step(CODE, LESSON, S, 1),
  prev: () => S && LESSON && L.step(CODE, LESSON, S, -1),
  vote: () => S && S.qs && L.toggleVote(CODE, S, PRES),
  results: () => S && S.qs && L.toggleResults(CODE, S),
  reveal: () => S && S.qs && LESSON && L.reveal(CODE, S, LESSON, PRES),
  join: () => S && L.toggleJoin(CODE, S),
  board: () => S && L.toggleBoard(CODE, S),
  devices: () => toggleDev(),
  fullscreen: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {})),
};
L.bindKeys(act);

let hudEl = null, idleT = null;
function hud() {
  if (!S) return;
  if (!hudEl) {
    hudEl = document.createElement("div"); hudEl.className = "hud idle"; document.body.appendChild(hudEl);
    hudEl.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) { act[b.dataset.a](); if (lastMode === "html") focusDeck(); } });
    document.addEventListener("mousemove", wake); document.addEventListener("touchstart", wake);
  }
  const q = S.qs, open = q && S.open && S.open[q.ids[0]];
  const revealed = q && q.ids.every((vk) => S.reveal && S.reveal[vk]);
  hudEl.innerHTML = `
    <button class="btn" data-a="prev">◀</button>
    <button class="btn" data-a="next">▶</button>
    <button class="btn ${S.join ? "on" : ""}" data-a="join">Join</button>
    ${q ? `<button class="btn ${open ? "on" : ""}" data-a="vote">${open ? "Close" : "Open"}</button>
    <button class="btn ${S.results ? "on" : ""}" data-a="results">Results</button>
    <button class="btn ${revealed ? "on" : ""}" data-a="reveal">Answer</button>` : ""}
    ${S.points !== false ? `<button class="btn ${S.board ? "on" : ""}" data-a="board">Leaderboard</button>` : ""}
    <button class="btn ${devOn ? "on" : ""}" data-a="devices">Student view</button>
    <button class="btn" data-a="fullscreen">⛶</button>`;
}
function wake() {
  if (!hudEl) return;
  hudEl.classList.remove("idle"); document.body.classList.add("hud-awake");
  clearTimeout(idleT); idleT = setTimeout(() => { hudEl.classList.add("idle"); document.body.classList.remove("hud-awake"); }, 2500);
}
