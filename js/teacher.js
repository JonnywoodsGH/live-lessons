// Teacher page: lessons, starting a live session, controlling it, private live results, CSV export.
import { configured, onUser, signIn, logOut, isTeacher, watch, read } from "./fb.js";
import { DEFAULT_CLASS } from "./config.js";
import { $, esc, toast, joinUrl, optionLetters, tally, hingeSlideHtml, fmtTime } from "./ui.js";
import * as L from "./session.js";
import { uploadLesson, deleteLesson } from "./upload.js";
import { rowsForSession, toCsv, download } from "./export.js";
import { deckView } from "./deckview.js";

const app = $("#app");
const CONF_SHORT = ["", "guess", "unsure", "fairly sure", "certain"];
let user = null;
let subs = [];
const off = () => { subs.forEach((f) => f()); subs = []; };

// live state for the session view
let CODE = null, S = null, LESSON = null, PRES = {}, ROSTER = {}, VOTES = {}, voteSub = null, voteKey = null;
let thumbs = {};

function centre(html) { app.innerHTML = `<div class="center"><div class="card stack">${html}</div></div>`; }

if (!configured) {
  centre(`<h2>Almost there</h2><p class="muted">Add your Firebase settings to <code>js/config.js</code>, then open <a href="setup.html">setup.html</a> to get the database rules.</p>`);
} else {
  onUser(async (u) => {
    user = u; off();
    if (!u) return showSignIn();
    if (!isTeacher(u)) return centre(`<h2>Teacher page</h2><p class="muted">${esc(u.email)} isn't listed as a teacher in <code>js/config.js</code>.</p><button class="btn" id="out">Sign out</button>`), ($("#out").onclick = logOut);
    subs.push(watch("teacher/current", (c) => { c ? openSession(c) : showHome(); },
      (e) => centre(`<h2>No access to the database</h2><p class="muted">${esc(e.message)}</p><p class="small">Have the database rules from <a href="setup.html">setup.html</a> been published?</p>`)));
  });
}

function showSignIn(msg) {
  centre(`<div class="kicker">Live lessons</div><h2>Teacher sign-in</h2>${msg ? `<div class="banner bad">${esc(msg)}</div>` : ""}<button class="btn primary" id="go" style="width:100%">Sign in with Google</button>`);
  $("#go").onclick = async () => { try { await signIn(""); } catch (e) { showSignIn(e.message); } };
}

function topBar(inner = "") {
  return `<header class="t-top"><span class="brand">Live lessons</span>${inner}<span class="spacer"></span>
    <span class="small muted">${esc(user.email)}</span><button class="btn ghost small" id="signout">Sign out</button></header>`;
}
function wireTop() { const b = $("#signout"); if (b) b.onclick = logOut; }

/* ======================= HOME ======================= */
async function showHome() {
  leaveSession();
  app.innerHTML = topBar() + `<main class="t-main"><div class="t-home">
    <section class="card stack" id="startCard"><div class="kicker">Start</div><h2>Start a live lesson</h2><p class="muted small">Loading lessons…</p></section>
    <section class="card stack" id="addCard"></section>
    <section class="card stack" id="lessonsCard"><div class="kicker">Library</div><h2>Your lessons</h2></section>
    <section class="card stack" id="pastCard"><div class="kicker">Data</div><h2>Past sessions</h2></section>
  </div></main>`;
  wireTop();
  renderAdd();
  const [lessons, sessions] = await Promise.all([read("lessons").catch(() => null), read("sessions").catch(() => null)]);
  renderStart(lessons || {});
  renderLessons(lessons || {});
  renderPast(sessions || {});
}

function renderStart(lessons) {
  const ids = Object.keys(lessons).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const el = $("#startCard");
  if (!ids.length) { el.innerHTML = `<div class="kicker">Start</div><h2>Start a live lesson</h2><p class="muted">Add a lesson first (slides + hinge questions).</p>`; return; }
  el.innerHTML = `<div class="kicker">Start</div><h2>Start a live lesson</h2>
    <label class="field"><span>Lesson</span><select id="lessonSel">${ids.map((id) =>
      `<option value="${esc(id)}">${esc(id)} — ${esc(lessons[id].title)} (${lessons[id].slideCount} slides, ${Object.keys(lessons[id].hinges || {}).length} hinge)</option>`).join("")}</select></label>
    <label class="field"><span>Class</span><input type="text" id="cls" value="${esc(DEFAULT_CLASS)}"></label>
    <button class="btn primary" id="startBtn">Start — students join with a code</button>`;
  $("#startBtn").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Starting…";
    try { await L.startSession($("#lessonSel").value, ($("#cls").value || DEFAULT_CLASS).trim().replace(/[^A-Za-z0-9-]/g, ""), user.email); }
    catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Start"; }
  };
}

function renderAdd() {
  const el = $("#addCard");
  el.innerHTML = `<div class="kicker">Add</div><h2>Add or update a lesson</h2>
    <label class="field"><span>Lesson ID</span><input type="text" id="lid" placeholder="Y9-W8-L1"></label>
    <label class="field"><span>Title</span><input type="text" id="ltitle" placeholder="Methods of error detection"></label>
    <label class="field"><span>Slides — an interactive deck (.html), one PDF, or all the slide images</span><input type="file" id="lfiles" accept=".html,.htm,text/html,.pdf,application/pdf,image/*" multiple></label>
    <label class="field"><span>Hinge questions file (optional, .json)</span><input type="file" id="lhinge" accept=".json,application/json"></label>
    <div class="progress hidden" id="lprog"><div></div></div><p class="small muted" id="lmsg"></p>
    <button class="btn accent" id="lgo">Upload lesson</button>
    <p class="small muted">Using the same ID again replaces that lesson. Slides and answers are stored in your private database, not on the website.</p>`;
  $("#lhinge").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const d = JSON.parse(await f.text()); if (d.lesson_id && !$("#lid").value) $("#lid").value = d.lesson_id; if (d.title && !$("#ltitle").value) $("#ltitle").value = d.title; } catch (err) {}
  };
  $("#lgo").onclick = async (e) => {
    const btn = e.target, prog = $("#lprog"), bar = prog.firstElementChild, msg = $("#lmsg");
    btn.disabled = true; prog.classList.remove("hidden");
    try {
      const hf = $("#lhinge").files[0];
      const res = await uploadLesson({
        id: $("#lid").value, title: $("#ltitle").value, slideFiles: $("#lfiles").files, hingeText: hf ? await hf.text() : "",
        onProgress: (m, p) => { msg.textContent = m; bar.style.width = Math.round(p * 100) + "%"; },
      });
      toast(`Saved ${res.id}: ${res.slides} slides, ${res.hinges} hinge questions (${Math.round(res.kb / 1024 * 10) / 10} MB)`, 4000);
      showHome();
    } catch (err) { msg.textContent = err.message; msg.style.color = "var(--bad)"; btn.disabled = false; }
  };
}

function renderLessons(lessons) {
  const el = $("#lessonsCard");
  const ids = Object.keys(lessons).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const totalKB = ids.reduce((s, id) => s + (lessons[id].sizeKB || 0), 0);
  el.innerHTML = `<div class="kicker">Library</div><h2>Your lessons</h2>
    ${ids.length ? `<div class="list">${ids.map((id) => `<div><b>${esc(id)}</b><span class="muted small">${esc(lessons[id].title)} · ${lessons[id].slideCount} slides · ${Object.keys(lessons[id].hinges || {}).length} hinge</span><span class="spacer"></span>
      <button class="btn ghost danger small" data-del="${esc(id)}">Delete</button></div>`).join("")}</div>
      <p class="small muted">Using ${(totalKB / 1024).toFixed(1)} MB of the free 1 GB.</p>` : `<p class="muted">None yet.</p>`}`;
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.del}? Past session data is kept.`)) return;
    await deleteLesson(b.dataset.del); toast("Deleted"); showHome();
  }));
}

function renderPast(sessions) {
  const el = $("#pastCard");
  const list = Object.values(sessions).filter((s) => s && s.code).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  el.innerHTML = `<div class="kicker">Data</div><h2>Past sessions</h2>
    ${list.length ? `<button class="btn" id="expAll">Export all sessions (CSV)</button>
    <div class="list">${list.slice(0, 30).map((s) => `<div><b>${esc(s.lessonId)}</b><span class="small muted">${esc(fmtTime(s.startedAt))} · ${esc(s.cls)} · ${esc(s.code)}${s.active ? " · running" : ""}</span><span class="spacer"></span>
      ${s.active ? `<button class="btn small" data-resume="${esc(s.code)}">Resume</button>` : ""}<button class="btn ghost small" data-exp="${esc(s.code)}">CSV</button></div>`).join("")}</div>` : `<p class="muted">Sessions appear here after your first live lesson.</p>`}`;
  const exp = async (arr, name) => {
    try {
      const roster = (await read("roster")) || {}, cache = {};
      let rows = [];
      for (const s of arr) rows = rows.concat(await rowsForSession(s, roster, cache));
      download(name, toCsv(rows)); toast(`${rows.length} rows exported`);
    } catch (e) { toast("Export failed: " + e.message); }
  };
  if ($("#expAll")) $("#expAll").onclick = () => exp(list, `hinge-responses-all-${new Date().toISOString().slice(0, 10)}.csv`);
  el.querySelectorAll("[data-exp]").forEach((b) => (b.onclick = () => { const s = sessions[b.dataset.exp]; exp([s], `${s.sessionId}.csv`); }));
  el.querySelectorAll("[data-resume]").forEach((b) => (b.onclick = async () => { const { set, r } = await import("./fb.js"); await set(r("teacher/current"), b.dataset.resume); }));
}

/* ======================= LIVE SESSION ======================= */
function leaveSession() {
  if (!CODE) return;
  sessionSubs.forEach((f) => f()); sessionSubs = [];
  if (voteSub) voteSub(); voteSub = null; voteKey = null;
  CODE = S = LESSON = null; PRES = {}; VOTES = {}; thumbs = {}; if (tDeck) tDeck.destroy(); tDeck = null; tDeckLesson = null; tDeckP = null;
}
let sessionSubs = [];

async function openSession(code) {
  if (CODE === code) return;
  leaveSession();
  CODE = code;
  centre(`<p class="muted">Opening ${esc(code)}…</p>`);
  const s0 = await read(`sessions/${code}`);
  if (!s0 || !s0.active) { const { set, r } = await import("./fb.js"); await set(r("teacher/current"), null); return; }
  LESSON = await L.loadLesson(s0.lessonId);
  if (!LESSON) { toast("That lesson has been deleted."); return; }
  buildSessionView();
  sessionSubs.push(watch(`sessions/${code}`, (v) => { S = v; if (!S) return; L.observe(code, S); syncVotes(); renderSession(); }));
  sessionSubs.push(watch(`presence/${code}`, (v) => { PRES = v || {}; renderSide(); renderStage(); renderTopCounts(); }));
  sessionSubs.push(watch("roster", (v) => { ROSTER = v || {}; renderSide(); }));
  loadThumbs();
}

function syncVotes() {
  const key = S && S.q ? S.q.key : null;
  if (key === voteKey) return;
  if (voteSub) voteSub();
  voteSub = null; voteKey = key; VOTES = {};
  if (key) voteSub = watch(`votes/${CODE}/${key}`, (v) => { VOTES = v || {}; renderSide(); renderStage(); });
}

function buildSessionView() {
  app.innerHTML = topBar(`<span class="pill">${esc(LESSON.id)}</span><span class="small muted">${esc(LESSON.title)}</span>`) + `
  <main class="t-main">
    <div class="card row" style="margin-bottom:16px">
      <div><div class="small muted">Join code</div><div class="code-big">${esc(CODE)}</div></div>
      <div class="small muted" style="max-width:260px">Students go to <b>${esc(joinUrl(CODE).replace(/^https?:\/\//, "").replace(/\?.*/, ""))}</b> and type the code, or scan the QR on the join screen.</div>
      <span class="spacer"></span>
      <span class="pill" id="joinedPill">0 joined</span>
      <a class="btn" href="present.html" target="ll_projector" id="projBtn">Open projector view ↗</a>
      <button class="btn" id="joinBtn">Join screen <kbd>J</kbd></button>
      <button class="btn danger" id="endBtn">End lesson</button>
    </div>
    <div class="t-grid">
      <section class="stack">
        <div class="stage" id="stage"><div id="stageDeck" class="fill hidden"></div><div id="stageOther" class="fill"></div></div>
        <div class="row"><button class="btn" id="prevBtn">◀ Prev</button><span class="spacer"></span><span id="posLbl" class="muted"></span><span class="spacer"></span><button class="btn primary" id="nextBtn">Next ▶</button></div>
        <div class="strip" id="strip"></div>
        <p class="small muted">Keys: ← → move · V open/close voting · R results on the board · A reveal answer · J join screen. A clicker that sends Page Up/Down also works.</p>
      </section>
      <aside class="stack" id="side"></aside>
    </div>
  </main>`;
  wireTop();
  $("#prevBtn").onclick = () => act.prev();
  $("#nextBtn").onclick = () => act.next();
  $("#joinBtn").onclick = () => act.join();
  $("#endBtn").onclick = async () => { if (confirm("End the lesson for everyone?")) { await L.endSession(CODE); toast("Lesson ended"); } };
  buildStrip();
}

const act = {
  next: () => S && L.step(CODE, LESSON, S, 1),
  prev: () => S && L.step(CODE, LESSON, S, -1),
  vote: () => S && S.q && L.toggleVote(CODE, S, PRES),
  results: () => S && S.q && L.toggleResults(CODE, S),
  reveal: () => S && S.q && L.reveal(CODE, S, LESSON, PRES),
  join: () => S && L.toggleJoin(CODE, S),
};
L.bindKeys(act);

function buildStrip() {
  const el = $("#strip");
  el.innerHTML = LESSON.order.map((it, i) => it.t === "hinge"
    ? `<button class="h" data-pos="${i}" title="Hinge ${esc(it.id)}"><span class="n">${i + 1}</span>Hinge ${esc(it.id)}</button>`
    : it.t === "html"
      ? `<button class="t" data-pos="${i}" title="${esc(it.title)}"><span class="n">${i + 1}</span><span class="tt">${esc(it.title)}</span>${it.max ? `<span class="bld">${it.max} build${it.max > 1 ? "s" : ""}</span>` : ""}</button>`
      : `<button data-pos="${i}"><span class="n">${i + 1}</span><img alt="" data-n="${it.n}"></button>`).join("");
  el.querySelectorAll("button").forEach((b) => (b.onclick = () => L.jump(CODE, LESSON, +b.dataset.pos)));
}
async function loadThumbs() {
  const lessonId = LESSON.id;
  for (const it of LESSON.order) {
    if (it.t !== "img" || !LESSON || LESSON.id !== lessonId) continue;
    const src = await L.slideImg(lessonId, it.n).catch(() => null);
    thumbs[it.n] = src;
    const img = document.querySelector(`#strip img[data-n="${it.n}"]`);
    if (img && src) img.src = src;
    if (S && LESSON.order[S.pos] && LESSON.order[S.pos].n === it.n) renderStage();
  }
}

function renderTopCounts() { const p = $("#joinedPill"); if (p) p.textContent = `${Object.keys(PRES).length} joined`; }

function renderSession() {
  if (!S || !$("#stage")) return;
  if (!S.active) return; // teacher/current is cleared → home
  const itNow = LESSON.order[S.pos], mx = L.maxStep(itNow);
  $("#posLbl").textContent = `Slide ${S.pos + 1} of ${S.total}${mx ? ` · build ${S.step || 0} of ${mx}` : ""}`;
  $("#prevBtn").disabled = S.pos <= 0 && !(S.step > 0);
  $("#nextBtn").disabled = S.pos >= S.total - 1 && (S.step || 0) >= mx;
  $("#joinBtn").classList.toggle("on", !!S.join);
  document.querySelectorAll("#strip button").forEach((b) => b.classList.toggle("cur", +b.dataset.pos === S.pos));
  const cur = document.querySelector("#strip button.cur");
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  renderTopCounts(); renderStage(); renderSide();
}

let tDeck = null, tDeckLesson = null, tDeckP = null;
function teacherDeck() {
  if (tDeckP && tDeckLesson === LESSON.id) return tDeckP;
  tDeckLesson = LESSON.id;
  tDeckP = L.deckShell(LESSON.id).then((shell) => {
    if (tDeck) tDeck.destroy();
    tDeck = deckView($("#stageDeck"), shell || {});
    return tDeck;
  });
  return tDeckP;
}
function renderStage() {
  const el = $("#stageOther"); if (!el || !S) return;
  const it = LESSON.order[S.pos];
  if (!it) return;
  const deckHost = $("#stageDeck");
  deckHost.classList.toggle("hidden", it.t !== "html");
  el.classList.toggle("hidden", it.t === "html");
  if (it.t === "html") {
    const pos = S.pos, st = S.step || 0;
    Promise.all([teacherDeck(), L.slideHtml(LESSON.id, it.n)]).then(([v, html]) => {
      if (S && S.pos === pos) v.show(html || "", S.step || 0, null);
    });
    return;
  }
  if (it.t === "hinge" && S.q) {
    const letters = optionLetters(S.q), counts = tally(VOTES, letters);
    el.innerHTML = hingeSlideHtml(S.q, { counts, showResults: true, reveal: S.reveal, open: S.q.open, closed: !S.q.open && S.opened && S.opened[S.q.key], answered: counts.total, joined: Object.keys(PRES).length });
  } else {
    const src = thumbs[it.n];
    el.innerHTML = src ? `<img src="${src}" alt="">` : `<div class="hinge-slide"><p class="muted">Loading slide…</p></div>`;
    if (!src) L.slideImg(LESSON.id, it.n).then((s) => { thumbs[it.n] = s; renderStage(); });
  }
}

function name(uid) { return (ROSTER[uid] && ROSTER[uid].n) || (PRES[uid] && PRES[uid].n) || "Student"; }

function renderSide() {
  const el = $("#side"); if (!el || !S) return;
  const here = Object.keys(PRES);
  if (!(S.kind === "hinge" && S.q)) {
    const next = LESSON.order.slice(S.pos + 1).findIndex((x) => x.t === "hinge");
    el.innerHTML = `<div class="card stack"><div class="kicker">In the room</div><h3>${here.length} student${here.length === 1 ? "" : "s"} joined</h3>
      <div class="names">${here.map((u) => `<span>${esc(name(u))}</span>`).join("") || `<span class="muted">Nobody yet — show the join screen (J).</span>`}</div></div>
      <div class="card small muted">${next >= 0 ? `Next hinge question in ${next + 1} slide${next ? "s" : ""}.` : "No more hinge questions in this lesson."}</div>
      <div class="card"><button class="btn" id="expNow" style="width:100%">Export this session (CSV)</button></div>`;
    $("#expNow").onclick = exportNow;
    return;
  }
  const q = S.q, h = LESSON.hinges[q.id] || {}, letters = optionLetters(q), c = tally(VOTES, letters);
  const opened = S.opened && S.opened[q.key];
  const notAnswered = here.filter((u) => !VOTES[u]);
  const confWrong = h.correct ? Object.entries(VOTES).filter(([, v]) => v.a !== h.correct && (v.c || 0) >= 3).map(([u, v]) => `${name(u)} (${v.a}, ${CONF_SHORT[v.c]})`) : [];
  const pctRight = c.total && h.correct ? Math.round(((c[h.correct] || 0) / c.total) * 100) : null;
  const max = Math.max(1, ...letters.map((l) => c[l] || 0));
  el.innerHTML = `
    <div class="card stack">
      <div class="row"><div class="kicker">Hinge ${esc(q.id)}${q.round > 1 ? " · round " + q.round : ""}</div><span class="spacer"></span>${q.open ? `<span class="pill live">Voting open</span>` : opened ? `<span class="pill">Closed</span>` : ""}</div>
      <div class="row">
        <button class="btn ${q.open ? "" : "ok"}" id="voteBtn" style="flex:1">${q.open ? "Close voting" : opened ? "Re-open voting" : "Open voting"} <kbd>V</kbd></button>
        <button class="btn ${S.results ? "on" : ""}" id="resBtn" ${opened ? "" : "disabled"}>Results on board <kbd>R</kbd></button>
      </div>
      <div class="row">
        <button class="btn ${S.reveal ? "on" : ""}" id="revBtn" style="flex:1" ${opened && h.correct ? "" : "disabled"}>${S.reveal ? "Hide answer" : "Reveal answer"} <kbd>A</kbd></button>
        <button class="btn" id="againBtn" ${opened && !q.open ? "" : "disabled"} title="After re-teaching: ask again as a new round">Ask again</button>
      </div>
      <h3>${c.total} / ${here.length} answered${pctRight != null ? ` · <span style="color:${pctRight >= 80 ? "var(--ok)" : "var(--bad)"}">${pctRight}% correct</span>` : ""}</h3>
      <div class="bars">${letters.map((l) => {
        const n = c[l] || 0, mc = l !== h.correct ? (h.misconceptions || {})[l] : "";
        return `<div class="bar ${l === h.correct ? "correct" : ""}"><span class="l">${l}</span><span class="track"><span class="fill" style="width:${(n / max) * 100}%"></span></span><span class="num">${n}${c.total ? ` · ${Math.round((n / c.total) * 100)}%` : ""}</span>
          ${mc || (h.notes || {})[l] ? `<span class="mc">${esc(mc)}${(h.notes || {})[l] ? " — " + esc(h.notes[l]) : ""}</span>` : l === h.correct ? `<span class="mc">correct answer</span>` : ""}</div>`;
      }).join("")}</div>
      ${pctRight != null ? `<div class="note">${pctRight >= 80 ? "Most of the class has it: move on, and pick up the few who don't." : "Fewer than 80% correct: re-teach using the biggest wrong option, then press <b>Ask again</b>."}</div>` : ""}
      ${h.teacher_note ? `<div class="small muted">${esc(h.teacher_note)}</div>` : ""}
    </div>
    ${notAnswered.length && opened ? `<div class="card stack"><div class="kicker">Not answered yet (${notAnswered.length})</div><div class="names">${notAnswered.map((u) => `<span>${esc(name(u))}</span>`).join("")}</div></div>` : ""}
    ${confWrong.length && !q.open ? `<div class="card stack"><div class="kicker">Confident but wrong (${confWrong.length})</div><div class="names">${confWrong.map((s) => `<span>${esc(s)}</span>`).join("")}</div></div>` : ""}
    <div class="card"><button class="btn" id="expNow" style="width:100%">Export this session (CSV)</button></div>`;
  $("#voteBtn").onclick = act.vote;
  $("#resBtn").onclick = act.results;
  $("#revBtn").onclick = act.reveal;
  $("#againBtn").onclick = () => L.reAsk(CODE, S, LESSON);
  $("#expNow").onclick = exportNow;
}

async function exportNow() {
  try {
    const s = await read(`sessions/${CODE}`);
    const rows = await rowsForSession(s, (await read("roster")) || {});
    download(`${s.sessionId}.csv`, toCsv(rows)); toast(`${rows.length} rows exported`);
  } catch (e) { toast("Export failed: " + e.message); }
}
