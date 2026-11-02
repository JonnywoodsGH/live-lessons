// Projector view: full-screen slides, join screen with QR, hinge question with optional results.
// Works on its own (keyboard / clicker) or alongside teacher.html on another screen or a phone.
// Interactive HTML decks run as the real deck (builds, timers, animations, laser, blank screen),
// driven in step with the live session.
import { configured, onUser, signIn, isTeacher, watch, read } from "./fb.js";
import { $, esc, joinUrl, shortJoinUrl, optionLetters, tally, hingeSlideHtml } from "./ui.js";
import * as L from "./session.js";
import QR from "./qr.js";

const app = $("#app");
let CODE = null, S = null, NOW = null, PRES = {}, VOTES = {}, LESSON = null;
let subs = [], voteSub = null, voteKey = null;
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
  if (voteSub) voteSub(); voteSub = null; voteKey = null;
  CODE = code; S = NOW = LESSON = null; PRES = {}; VOTES = {};
  if (!code) return msg("No live lesson running.<br><span class='small'>Start one on the teacher page — this window will follow it.</span>");
  resetDeck();
  app.innerHTML = `<div class="stage" id="stage"><div id="deckLayer" class="fill hidden"></div><div id="other" class="fill"></div><div id="ov" class="fill" style="pointer-events:none"></div></div>`;
  subs.push(watch(`sessions/${code}`, async (v) => {
    S = v;
    if (S) L.observe(code, S);
    if (S && (!LESSON || LESSON.id !== S.lessonId)) LESSON = await L.loadLesson(S.lessonId);
    syncVotes(); render();
  }));
  subs.push(watch(`now/${code}`, (v) => { NOW = v; render(); }));
  subs.push(watch(`presence/${code}`, (v) => { PRES = v || {}; renderOverlay(); }));
}

function syncVotes() {
  const key = S && S.q ? S.q.key : null;
  if (key === voteKey) return;
  if (voteSub) voteSub();
  voteSub = null; voteKey = key; VOTES = {};
  if (key) voteSub = watch(`votes/${CODE}/${key}`, (v) => { VOTES = v || {}; render(); });
}

let lastMode = null;
function render() {
  const other = $("#other");
  if (!other || !S || !LESSON) return;
  const it = LESSON.order[S.pos];
  const joined = Object.keys(PRES).length;
  const mode = it && it.t === "html" ? "html" : "other";
  $("#deckLayer").classList.toggle("hidden", mode !== "html");
  other.classList.toggle("hidden", mode === "html" && deck.ready);
  if (mode === "html") {
    ensureDeck(LESSON.id);
    if (!deck.ready) other.innerHTML = `<div class="present-msg" style="padding-top:20%">Loading the deck…</div>`;
    deckGoto(it.n, S.step || 0);
    if (lastMode !== "html" && deck.ready) focusDeck();
  } else {
    if (lastMode === "html") window.focus();
    if (S.kind === "hinge" && S.q) {
      const letters = optionLetters(S.q), counts = tally(VOTES, letters);
      other.innerHTML = hingeSlideHtml(S.q, {
        counts, showResults: !!S.results, reveal: S.reveal, open: S.q.open,
        closed: !S.q.open && S.opened && S.opened[S.q.key], answered: counts.total, joined,
      });
    } else {
      other.innerHTML = NOW && NOW.pos === S.pos && NOW.img ? `<img src="${NOW.img}" alt="">` : "";
    }
  }
  lastMode = mode;
  renderOverlay();
  hud();
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
  } else {
    // on deck slides the join code shows only while the mouse moves (it would cover the deck's footer)
    ov.innerHTML = `<span class="corner-code ${lastMode === "html" ? "" : "always"}">${esc(shortJoinUrl())} · ${esc(CODE)}</span>`;
  }
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
    j: "join", J: "join", f: "fullscreen", F: "fullscreen" };
  const overlayOpen = () => !!w.document.querySelector(".ov.show") || !!(w.document.getElementById("blank") || {}).className;
  w.addEventListener("keydown", (e) => {
    if (!e.isTrusted || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { deck.numPending = true; return; }           // deck's "type a slide number" — let it through
    if (deck.numPending && (k === "Enter" || k === "Escape" || k === "Backspace")) { deck.numPending = false; return; }
    if (overlayOpen()) return;                                           // menu / help / black screen: deck handles it
    const a = NAV[k];
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
  vote: () => S && S.q && L.toggleVote(CODE, S, PRES),
  results: () => S && S.q && L.toggleResults(CODE, S),
  reveal: () => S && S.q && LESSON && L.reveal(CODE, S, LESSON, PRES),
  join: () => S && L.toggleJoin(CODE, S),
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
  const q = S.kind === "hinge" && S.q;
  hudEl.innerHTML = `
    <button class="btn" data-a="prev">◀</button>
    <button class="btn" data-a="next">▶</button>
    <button class="btn ${S.join ? "on" : ""}" data-a="join">Join</button>
    ${q ? `<button class="btn ${S.q.open ? "on" : ""}" data-a="vote">${S.q.open ? "Close vote" : "Open vote"}</button>
    <button class="btn ${S.results ? "on" : ""}" data-a="results">Results</button>
    <button class="btn ${S.reveal ? "on" : ""}" data-a="reveal">Answer</button>` : ""}
    <button class="btn" data-a="fullscreen">⛶</button>`;
}
function wake() {
  if (!hudEl) return;
  hudEl.classList.remove("idle"); document.body.classList.add("hud-awake");
  clearTimeout(idleT); idleT = setTimeout(() => { hudEl.classList.add("idle"); document.body.classList.remove("hud-awake"); }, 2500);
}
