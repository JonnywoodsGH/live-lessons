// Projector view: full-screen slides, join screen with QR, hinge question with optional results.
// Works on its own (keyboard / clicker) or alongside teacher.html on another screen or a phone.
import { configured, onUser, signIn, isTeacher, watch } from "./fb.js";
import { $, esc, joinUrl, shortJoinUrl, optionLetters, tally, hingeSlideHtml } from "./ui.js";
import * as L from "./session.js";
import QR from "./qr.js";

const app = $("#app");
let CODE = null, S = null, NOW = null, PRES = {}, VOTES = {}, LESSON = null;
let subs = [], voteSub = null, voteKey = null;

const msg = (html) => (app.innerHTML = `<div class="present-msg">${html}</div>`);

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
  app.innerHTML = `<div class="stage" id="stage"></div>`;
  subs.push(watch(`sessions/${code}`, async (v) => {
    S = v;
    if (S && (!LESSON || LESSON.id !== S.lessonId)) LESSON = await L.loadLesson(S.lessonId);
    syncVotes(); render();
  }));
  subs.push(watch(`now/${code}`, (v) => { NOW = v; render(); }));
  subs.push(watch(`presence/${code}`, (v) => { PRES = v || {}; render(); }));
}

function syncVotes() {
  const key = S && S.q ? S.q.key : null;
  if (key === voteKey) return;
  if (voteSub) voteSub();
  voteSub = null; voteKey = key; VOTES = {};
  if (key) voteSub = watch(`votes/${CODE}/${key}`, (v) => { VOTES = v || {}; render(); });
}

function render() {
  const stage = $("#stage");
  if (!stage || !S) return;
  const joined = Object.keys(PRES).length;
  let html = "";
  if (S.kind === "hinge" && S.q) {
    const letters = optionLetters(S.q), counts = tally(VOTES, letters);
    html = hingeSlideHtml(S.q, {
      counts, showResults: !!S.results, reveal: S.reveal, open: S.q.open,
      closed: !S.q.open && S.opened && S.opened[S.q.key], answered: counts.total, joined,
    });
  } else {
    html = NOW && NOW.pos === S.pos && NOW.img ? `<img src="${NOW.img}" alt="">` : "";
  }
  if (S.join) {
    let qr = "";
    try { qr = QR.svg(joinUrl(CODE), 400); } catch (e) { qr = ""; }
    html += `<div class="join-overlay"><div class="qr">${qr}</div><div>
      <h2>Join the lesson</h2><div class="url">${esc(shortJoinUrl())}</div>
      <div class="big-code">${esc(CODE)}</div>
      <div class="joined">${joined} joined · sign in with your school Google account</div></div></div>`;
  } else {
    html += `<span class="corner-code">${esc(shortJoinUrl())} · ${esc(CODE)}</span>`;
  }
  stage.innerHTML = html;
  hud();
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
    hudEl.addEventListener("click", (e) => { const b = e.target.closest("[data-a]"); if (b) act[b.dataset.a](); });
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
  hudEl.classList.remove("idle");
  clearTimeout(idleT); idleT = setTimeout(() => hudEl.classList.add("idle"), 2500);
}
