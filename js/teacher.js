// Teacher page: lessons, live (teacher-paced) sessions, student-paced assignments, private results, CSV export.
import { configured, onUser, signIn, logOut, isTeacher, watch, read, set, r } from "./fb.js";
import { DEFAULT_CLASS } from "./config.js";
import { $, esc, toast, joinUrl, tally, hingeSlideHtml, fmtTime, cloudHtml, countWords, boardHtml, fmtSecs, encodeKey, normS } from "./ui.js";
import * as L from "./session.js";
import { uploadLesson, deleteLesson } from "./upload.js";
import { rowsForSession, toCsv, download } from "./export.js";
import { deckView } from "./deckview.js";

const app = $("#app");
const CONF_SHORT = ["", "guess", "unsure", "fairly sure", "certain"];
let user = null, subs = [], offset = 0;
const off = () => { subs.forEach((f) => f()); subs = []; };

// live state
let CODE = null, S = null, LESSON = null, PRES = {}, ROSTER = {}, VOTES = {}, PROG = {};
let thumbs = {}, sessionSubs = [], selfCode = null;

function centre(html) { app.innerHTML = `<div class="center"><div class="card stack">${html}</div></div>`; }

if (!configured) {
  centre(`<h2>Almost there</h2><p class="muted">Add your Firebase settings to <code>js/config.js</code>, then open <a href="setup.html">setup.html</a> to get the database rules.</p>`);
} else {
  onUser(async (u) => {
    user = u; off();
    if (!u) return showSignIn();
    if (!isTeacher(u)) return centre(`<h2>Teacher page</h2><p class="muted">${esc(u.email)} isn't listed as a teacher in <code>js/config.js</code>.</p><button class="btn" id="out">Sign out</button>`), ($("#out").onclick = logOut);
    subs.push(watch(".info/serverTimeOffset", (v) => (offset = +v || 0)));
    subs.push(watch("teacher/current", (c) => { if (c) openSession(c); else if (!selfCode) showHome(); },
      (e) => centre(`<h2>No access to the database</h2><p class="muted">${esc(e.message)}</p><p class="small">Have the database rules from <a href="setup.html">setup.html</a> been published?</p>`)));
  });
}

function showSignIn(msg) {
  centre(`<div class="kicker">Live lessons</div><h2>Teacher sign-in</h2>${msg ? `<div class="banner bad">${esc(msg)}</div>` : ""}<button class="btn primary" id="go" style="width:100%">Sign in with Google</button>`);
  $("#go").onclick = async () => { try { await signIn(""); } catch (e) { showSignIn(e.message); } };
}
function topBar(inner = "") {
  return `<header class="t-top"><a class="brand" href="teacher.html" style="text-decoration:none">Live lessons</a>${inner}<span class="spacer"></span>
    <span class="small muted">${esc(user.email)}</span><button class="btn ghost small" id="signout">Sign out</button></header>`;
}
function wireTop() { const b = $("#signout"); if (b) b.onclick = logOut; }

const qCount = (l) => {
  const qs = Object.values(l.questions || l.hinges || {});
  const sets = (Array.isArray(l.order) ? l.order : Object.values(l.order || {})).filter((o) => o && o.q && o.q.type === "set").length;
  const words = qs.filter((q) => q.type === "word").length;
  const parts = [];
  if (sets) parts.push(`${sets} card set${sets > 1 ? "s" : ""}`);
  const hinge = qs.filter((q) => q.type !== "word" && !q.card).length;
  if (hinge) parts.push(`${hinge} hinge`);
  if (words) parts.push(`${words} one-word`);
  return parts.length ? `${qs.length} questions (${parts.join(", ")})` : "no questions";
};

/* ======================= HOME ======================= */
async function showHome() {
  leaveSession();
  selfCode = null;
  app.innerHTML = topBar() + `<main class="t-main"><div class="t-home">
    <section class="card stack" id="startCard"><div class="kicker">Start</div><h2>Start a lesson</h2><p class="muted small">Loading lessons…</p></section>
    <section class="card stack" id="addCard"></section>
    <section class="card stack" id="assignCard"><div class="kicker">Student-paced</div><h2>Assignments</h2></section>
    <section class="card stack" id="lessonsCard"><div class="kicker">Library</div><h2>Your lessons</h2></section>
    <section class="card stack" id="pastCard"><div class="kicker">Data</div><h2>Past sessions</h2></section>
  </div></main>`;
  wireTop();
  renderAdd();
  const [lessons, sessions] = await Promise.all([read("lessons").catch(() => null), read("sessions").catch(() => null)]);
  renderStart(lessons || {});
  renderLessons(lessons || {});
  renderAssignments(sessions || {});
  renderPast(sessions || {});
}

function renderStart(lessons) {
  const ids = Object.keys(lessons).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const el = $("#startCard");
  if (!ids.length) { el.innerHTML = `<div class="kicker">Start</div><h2>Start a lesson</h2><p class="muted">Add a lesson first.</p>`; return; }
  el.innerHTML = `<div class="kicker">Start</div><h2>Start a lesson</h2>
    <label class="field"><span>Lesson</span><select id="lessonSel">${ids.map((id) =>
      `<option value="${esc(id)}">${esc(id)} — ${esc(lessons[id].title)} (${lessons[id].slideCount} slides · ${qCount(lessons[id])})</option>`).join("")}</select></label>
    <label class="field"><span>Class</span><input type="text" id="cls" value="${esc(DEFAULT_CLASS)}"></label>
    <div class="opts">
      <label><span>Students see if they're right</span><select id="optFb"><option value="reveal">when I reveal the answer (hinge style)</option><option value="instant">straight after answering</option></select></label>
      <label class="chk"><input type="checkbox" id="optPts" checked> Points and leaderboard</label>
      <label class="chk"><input type="checkbox" id="optTimer" checked> Countdown timer on questions</label>
      <label class="chk"><input type="checkbox" id="optAuto" checked> Open questions as soon as I reach them</label>
    </div>
    <div class="row"><button class="btn primary" id="startBtn">Start live lesson</button><button class="btn" id="assignBtn">Assign student-paced…</button></div>
    <div id="assignForm" class="hidden stack">
      <label class="field"><span>Due (optional, shown to students)</span><input type="text" id="due" placeholder="e.g. Friday 6 Nov"></label>
      <p class="small muted">Students work through the slides and questions on their own and see if they're right straight away. Answers only unlock after they answer.</p>
      <div class="progress hidden" id="aprog"><div></div></div>
      <button class="btn accent" id="assignGo">Create assignment</button>
    </div>`;
  const cls = () => ($("#cls").value || DEFAULT_CLASS).trim().replace(/[^A-Za-z0-9-]/g, "");
  $("#startBtn").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Starting…";
    try {
      await L.startSession($("#lessonSel").value, cls(), user.email, {
        feedback: $("#optFb").value, points: $("#optPts").checked, timer: $("#optTimer").checked, auto: $("#optAuto").checked,
      });
    } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Start live lesson"; }
  };
  $("#assignBtn").onclick = () => $("#assignForm").classList.toggle("hidden");
  $("#assignGo").onclick = async (e) => {
    e.target.disabled = true;
    const prog = $("#aprog"), bar = prog.firstElementChild; prog.classList.remove("hidden");
    try {
      const code = await L.startAssignment($("#lessonSel").value, cls(), user.email, { points: $("#optPts").checked, due: $("#due").value.trim() || null },
        (m, p) => (bar.style.width = Math.round(p * 100) + "%"));
      showAssignment(code);
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

function renderAdd() {
  const el = $("#addCard");
  el.innerHTML = `<div class="kicker">Add</div><h2>Add or update a lesson</h2>
    <label class="field"><span>Lesson ID</span><input type="text" id="lid" placeholder="Y9-W12-L1"></label>
    <label class="field"><span>Title</span><input type="text" id="ltitle" placeholder="Pseudocode"></label>
    <label class="field"><span>Slides — an interactive deck (.html), one PDF, or all the slide images</span><input type="file" id="lfiles" accept=".html,.htm,text/html,.pdf,application/pdf,image/*" multiple></label>
    <label class="field"><span>Extra questions file (optional .json — for PDF lessons)</span><input type="file" id="lhinge" accept=".json,application/json"></label>
    <div class="progress hidden" id="lprog"><div></div></div><p class="small muted" id="lmsg"></p>
    <button class="btn accent" id="lgo">Upload lesson</button>
    <p class="small muted">Questions in interactive decks are found automatically: fingers-up card slides, hinge slides and one-word slides. Same ID again replaces the lesson.</p>`;
  $("#lfiles").onchange = (e) => {
    const f = [...e.target.files].find((x) => /\.html?$/i.test(x.name));
    if (f && !$("#lid").value) { const m = /Y9_W(\d+)(?:_L(\d))?/i.exec(f.name); if (m) $("#lid").value = `Y9-W${m[1]}-L${m[2] || 1}`; }
    if (f && !$("#ltitle").value) $("#ltitle").value = f.name.replace(/\.html?$/i, "").replace(/^Y9_W\d+(_L\d)?_/i, "").replace(/\s*\(Interactive\)/i, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  };
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
      toast(`Saved ${res.id}: ${res.slides} slides, ${res.questions} questions found (${Math.round(res.kb / 1024 * 10) / 10} MB)`, 5000);
      showHome();
    } catch (err) { msg.textContent = err.message; msg.style.color = "var(--bad)"; btn.disabled = false; }
  };
}

function renderLessons(lessons) {
  const el = $("#lessonsCard");
  const ids = Object.keys(lessons).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const totalKB = ids.reduce((s, id) => s + (lessons[id].sizeKB || 0), 0);
  el.innerHTML = `<div class="kicker">Library</div><h2>Your lessons</h2>
    ${ids.length ? `<div class="list">${ids.map((id) => `<div><div><b>${esc(id)}</b> <span class="muted small">${esc(lessons[id].title)}</span><div class="small muted">${lessons[id].slideCount} slides · ${qCount(lessons[id])}</div></div><span class="spacer"></span>
      <button class="btn ghost danger small" data-del="${esc(id)}">Delete</button></div>`).join("")}</div>
      <p class="small muted">Using ${(totalKB / 1024).toFixed(1)} MB of the free 1 GB.</p>` : `<p class="muted">None yet.</p>`}`;
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.del}? Past session data is kept.`)) return;
    await deleteLesson(b.dataset.del); toast("Deleted"); showHome();
  }));
}

function renderAssignments(sessions) {
  const el = $("#assignCard");
  const list = Object.values(sessions).filter((s) => s && s.mode === "self").sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  el.innerHTML = `<div class="kicker">Student-paced</div><h2>Assignments</h2>
    ${list.length ? `<div class="list">${list.slice(0, 12).map((s) => `<div><b>${esc(s.lessonId)}</b><span class="small muted">${esc(s.code)} · ${esc(fmtTime(s.startedAt))}${s.due ? " · due " + esc(s.due) : ""} · ${s.active ? "open" : "closed"}</span><span class="spacer"></span>
      <button class="btn small" data-open="${esc(s.code)}">Open</button></div>`).join("")}</div>` : `<p class="muted small">None yet — use “Assign student-paced…” above.</p>`}`;
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => showAssignment(b.dataset.open)));
}

async function exportSessions(arr, name) {
  try {
    const roster = (await read("roster")) || {}, cache = {};
    let rows = [];
    for (const s of arr) rows = rows.concat(await rowsForSession(s, roster, cache));
    download(name, toCsv(rows)); toast(`${rows.length} rows exported`);
  } catch (e) { toast("Export failed: " + e.message); }
}

function renderPast(sessions) {
  const el = $("#pastCard");
  const list = Object.values(sessions).filter((s) => s && s.code).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  el.innerHTML = `<div class="kicker">Data</div><h2>Past sessions</h2>
    ${list.length ? `<button class="btn" id="expAll">Export everything (CSV)</button>
    <div class="list">${list.slice(0, 30).map((s) => `<div><b>${esc(s.lessonId)}</b><span class="small muted">${esc(fmtTime(s.startedAt))} · ${s.mode === "self" ? "student-paced" : "live"} · ${esc(s.code)}${s.active ? " · open" : ""}</span><span class="spacer"></span>
      ${s.active && s.mode !== "self" ? `<button class="btn small" data-resume="${esc(s.code)}">Resume</button>` : ""}<button class="btn ghost small" data-exp="${esc(s.code)}">CSV</button></div>`).join("")}</div>` : `<p class="muted">Sessions appear here after your first lesson.</p>`}`;
  if ($("#expAll")) $("#expAll").onclick = () => exportSessions(list, `responses-all-${new Date().toISOString().slice(0, 10)}.csv`);
  el.querySelectorAll("[data-exp]").forEach((b) => (b.onclick = () => { const s = sessions[b.dataset.exp]; exportSessions([s], `${s.sessionId}.csv`); }));
  el.querySelectorAll("[data-resume]").forEach((b) => (b.onclick = () => set(r("teacher/current"), b.dataset.resume)));
}

/* ======================= LIVE SESSION ======================= */
function leaveSession() {
  sessionSubs.forEach((f) => f()); sessionSubs = [];
  CODE = S = LESSON = null; PRES = {}; VOTES = {}; PROG = {}; thumbs = {};
  if (tDeck) tDeck.destroy(); tDeck = null; tDeckLesson = null; tDeckP = null;
}

let pubT = null;
function schedulePublish() {
  clearTimeout(pubT);
  pubT = setTimeout(() => { if (S && LESSON) L.publish(CODE, S, LESSON, VOTES, ROSTER, PROG); }, 400);
}

async function openSession(code) {
  if (CODE === code && !selfCode) return;
  leaveSession();
  selfCode = null;
  CODE = code;
  centre(`<p class="muted">Opening ${esc(code)}…</p>`);
  const s0 = await read(`sessions/${code}`);
  if (!s0 || !s0.active) { await set(r("teacher/current"), null); return; }
  LESSON = await L.loadLesson(s0.lessonId, true);
  if (!LESSON) { toast("That lesson has been deleted."); return; }
  buildSessionView();
  sessionSubs.push(watch(`sessions/${code}`, (v) => { S = normS(v); if (!S) return; L.observe(code, S); renderSession(); }));
  sessionSubs.push(watch(`presence/${code}`, (v) => { PRES = v || {}; renderSide(); renderStage(); renderTopCounts(); }));
  sessionSubs.push(watch("roster", (v) => { ROSTER = v || {}; renderSide(); schedulePublish(); }));
  sessionSubs.push(watch(`votes/${code}`, (v) => { VOTES = v || {}; renderSide(); renderStage(); schedulePublish(); }));
  const iv = setInterval(() => { if (S && CODE === code) { L.tick(code, S, PRES, offset); updateClock(); } }, 1000);
  sessionSubs.push(() => clearInterval(iv));
  loadThumbs();
}

function buildSessionView() {
  app.innerHTML = topBar(`<span class="pill">${esc(LESSON.id)}</span><span class="small muted">${esc(LESSON.title)}</span>`) + `
  <main class="t-main">
    <div class="card row" style="margin-bottom:16px">
      <div><div class="small muted">Join code</div><div class="code-big">${esc(CODE)}</div></div>
      <div class="small muted" style="max-width:260px">Students go to <b>${esc(joinUrl(CODE).replace(/^https?:\/\//, "").replace(/\?.*/, ""))}</b> and type the code, or scan the QR on the join screen.</div>
      <span class="spacer"></span>
      <span class="pill" id="joinedPill">0 joined</span>
      <a class="btn" href="present.html" target="ll_projector">Open projector view ↗</a>
      <a class="btn" href="index.html?preview=1" target="ll_student" title="What students' devices show — for a second screen">Student view ↗</a>
      <button class="btn" id="joinBtn">Join screen <kbd>J</kbd></button>
      <button class="btn" id="boardBtn">Leaderboard <kbd>S</kbd></button>
      <button class="btn danger" id="endBtn">End lesson</button>
    </div>
    <div class="t-grid">
      <section class="stack">
        <div class="stage" id="stage"><div id="stageDeck" class="fill hidden"></div><div id="stageOther" class="fill"></div></div>
        <div class="row"><button class="btn" id="prevBtn">◀ Prev</button><span class="spacer"></span><span id="posLbl" class="muted"></span><span class="spacer"></span><button class="btn primary" id="nextBtn">Next ▶</button></div>
        <div class="strip" id="strip"></div>
        <p class="small muted">Keys: ← → move · V open/close a question · R results on the board · A reveal the answer · S leaderboard · J join screen · D student view (projector). A clicker that sends Page Up/Down also works.</p>
      </section>
      <aside class="stack" id="side"></aside>
    </div>
  </main>`;
  wireTop();
  $("#prevBtn").onclick = () => act.prev();
  $("#nextBtn").onclick = () => act.next();
  $("#joinBtn").onclick = () => act.join();
  $("#boardBtn").onclick = () => act.board();
  $("#endBtn").onclick = async () => { if (confirm("End the lesson for everyone?")) { await L.endSession(CODE); toast("Lesson ended"); } };
  buildStrip();
}

const act = {
  next: () => S && LESSON && L.step(CODE, LESSON, S, 1),
  prev: () => S && LESSON && L.step(CODE, LESSON, S, -1),
  vote: () => S && S.qs && L.toggleVote(CODE, S, PRES),
  results: () => S && S.qs && L.toggleResults(CODE, S),
  reveal: () => S && S.qs && L.reveal(CODE, S, LESSON, PRES),
  join: () => S && L.toggleJoin(CODE, S),
  board: () => S && L.toggleBoard(CODE, S),
};
L.bindKeys({ ...act, next: () => !selfCode && act.next(), prev: () => !selfCode && act.prev() });

function buildStrip() {
  const el = $("#strip");
  el.innerHTML = LESSON.order.map((it, i) => {
    const q = L.qsOf(LESSON, it);
    const badge = q ? `<span class="qb">${q.type === "set" ? q.ids.length + " Qs" : q.type === "word" ? "word" : "Q"}</span>` : "";
    if (it.t === "q") return `<button class="h" data-pos="${i}"><span class="n">${i + 1}</span>Question${badge}</button>`;
    if (it.t === "html") return `<button class="t" data-pos="${i}" title="${esc(it.title)}"><span class="n">${i + 1}</span><span class="tt">${esc(it.title)}</span>${badge}</button>`;
    return `<button data-pos="${i}"><span class="n">${i + 1}</span><img alt="" data-n="${it.n}">${badge}</button>`;
  }).join("");
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
  }
}
function renderTopCounts() { const p = $("#joinedPill"); if (p) p.textContent = `${Object.keys(PRES).length} joined`; }

function renderSession() {
  if (!S || !$("#stage") || !S.active) return;
  const itNow = LESSON.order[S.pos], mx = L.maxStep(itNow);
  $("#posLbl").textContent = `Slide ${S.pos + 1} of ${S.total}${mx ? ` · build ${S.step || 0} of ${mx}` : ""}`;
  $("#prevBtn").disabled = S.pos <= 0 && !(S.step > 0);
  $("#nextBtn").disabled = S.pos >= S.total - 1 && (S.step || 0) >= mx;
  $("#joinBtn").classList.toggle("on", !!S.join);
  $("#boardBtn").classList.toggle("on", !!S.board);
  document.querySelectorAll("#strip button").forEach((b) => b.classList.toggle("cur", +b.dataset.pos === S.pos));
  const cur = document.querySelector("#strip button.cur");
  if (cur) cur.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  renderTopCounts(); renderStage(); renderSide();
}

let tDeck = null, tDeckLesson = null, tDeckP = null;
function teacherDeck() {
  if (tDeckP && tDeckLesson === LESSON.id) return tDeckP;
  tDeckLesson = LESSON.id;
  tDeckP = L.deckShell(LESSON.id).then((shell) => { if (tDeck) tDeck.destroy(); tDeck = deckView($("#stageDeck"), shell || {}); return tDeck; });
  return tDeckP;
}
function renderStage() {
  const el = $("#stageOther"); if (!el || !S || !LESSON) return;
  const it = LESSON.order[S.pos];
  if (!it) return;
  $("#stageDeck").classList.toggle("hidden", it.t !== "html");
  el.classList.toggle("hidden", it.t === "html");
  if (it.t === "html") {
    const pos = S.pos;
    Promise.all([teacherDeck(), L.slideHtml(LESSON.id, it.n)]).then(([v, html]) => { if (S && S.pos === pos) v.show(html || "", S.step || 0, null); });
    return;
  }
  if (it.t === "q" && S.qs) {
    const vk = S.qs.ids[0], item = S.qs.items[vk], q = LESSON.questions[L.baseId(vk)] || {};
    if (item && item.type === "word") { el.innerHTML = `<div class="hinge-slide"><div class="hs-top"><span class="hs-kicker">One word</span></div><h1 class="hs-prompt">${esc(item.prompt)}</h1>${cloudHtml(countWords(VOTES[vk], (S.hidden || {})[vk] || {}), { accept: q.accept })}</div>`; return; }
    const counts = tally(VOTES[vk], Object.keys((item && item.options) || {}));
    el.innerHTML = hingeSlideHtml({ ...item, round: S.qs.round }, { counts, showResults: true, reveal: S.reveal && S.reveal[vk], open: !!(S.open && S.open[vk]), closed: !(S.open && S.open[vk]) && S.closed && S.closed[vk], answered: counts.total, joined: Object.keys(PRES).length });
    return;
  }
  const src = thumbs[it.n];
  el.innerHTML = src ? `<img src="${src}" alt="">` : `<div class="hinge-slide"><p class="muted">Loading slide…</p></div>`;
  if (!src) L.slideImg(LESSON.id, it.n).then((s) => { thumbs[it.n] = s; renderStage(); });
}

const name = (uid) => (ROSTER[uid] && ROSTER[uid].n) || (PRES[uid] && PRES[uid].n) || "Student";
function updateClock() {
  const el = $("#qclock"); if (!el) return;
  const left = L.secondsLeft(S, offset);
  el.textContent = left == null ? "" : `⏱ ${fmtSecs(left)}`;
}

/** Results for the current question set — shared by the live panel. */
function questionPanel() {
  const qs = S.qs, here = Object.keys(PRES);
  const open = !!(S.open && S.open[qs.ids[0]]);
  const opened = S.opened && S.opened[qs.ids[0]];
  const answeredBy = new Set();
  qs.ids.forEach((vk) => Object.keys(VOTES[vk] || {}).forEach((u) => answeredBy.add(u)));
  const fully = here.filter((u) => qs.ids.every((vk) => VOTES[vk] && VOTES[vk][u]));
  const notDone = here.filter((u) => !fully.includes(u));
  const label = qs.type === "set" ? `Card set · ${qs.ids.length} questions` : qs.type === "word" ? "One word" : "Hinge question";
  let body = "";
  if (qs.type === "set") {
    body = `<table class="cards"><thead><tr><th></th><th>Card</th><th>Correct</th><th>Most common wrong</th></tr></thead><tbody>${qs.ids.map((vk) => {
      const q = LESSON.questions[L.baseId(vk)] || {}, item = qs.items[vk] || {};
      const v = Object.values(VOTES[vk] || {}), n = v.length;
      const right = v.filter((x) => x.a === q.correct).length;
      const wrong = {}; v.forEach((x) => { if (x.a !== q.correct) wrong[x.a] = (wrong[x.a] || 0) + 1; });
      const top = Object.entries(wrong).sort((a, b) => b[1] - a[1])[0];
      const pct = n ? Math.round((right / n) * 100) : null;
      return `<tr><td><b>${esc(item.card || "")}</b></td><td class="${item.mono ? "mono" : ""}">${esc((item.prompt || "").slice(0, 60))}</td>
        <td><span class="pctb ${pct == null ? "" : pct >= 80 ? "ok" : pct >= 50 ? "mid" : "bad"}">${pct == null ? "–" : pct + "%"}</span> <span class="muted small">${right}/${n}</span></td>
        <td class="small">${top ? `${esc(top[0])} · ${esc((q.options || {})[top[0]] || "")} (${top[1]})` : ""}</td></tr>`;
    }).join("")}</tbody></table>`;
  } else if (qs.type === "word") {
    const vk = qs.ids[0], q = LESSON.questions[L.baseId(vk)] || {};
    const hidden = (S.hidden || {})[vk] || {};
    const all = countWords(VOTES[vk], {});
    body = `<div class="small muted">Tap a word to hide it from the board (tap again to show).</div>
      <div class="cloud-mod">${all.map((x) => `<button class="wtag ${hidden[encodeKey(x.k)] ? "off" : ""}" data-k="${esc(x.k)}">${esc(x.w)} <b>${x.n}</b></button>`).join("") || `<span class="muted">No words yet</span>`}</div>
      ${q.accept && q.accept.length ? `<div class="small muted">Accepted: ${esc(q.accept.join(" / "))}</div>` : ""}`;
  } else {
    const vk = qs.ids[0], q = LESSON.questions[L.baseId(vk)] || {}, item = qs.items[vk] || {};
    const letters = Object.keys(item.options || {}), c = tally(VOTES[vk], letters);
    const max = Math.max(1, ...letters.map((l) => c[l] || 0));
    const pctRight = c.total && q.correct ? Math.round(((c[q.correct] || 0) / c.total) * 100) : null;
    const confWrong = q.correct ? Object.entries(VOTES[vk] || {}).filter(([, v]) => v.a !== q.correct && (v.c || 0) >= 3).map(([u, v]) => `${name(u)} (${v.a}, ${CONF_SHORT[v.c]})`) : [];
    body = `<div class="bars">${letters.map((l) => {
      const n = c[l] || 0, mc = l !== q.correct ? (q.misconceptions || {})[l] : "";
      return `<div class="bar ${l === q.correct ? "correct" : ""}"><span class="l">${esc(l)}</span><span class="track"><span class="fill" style="width:${(n / max) * 100}%"></span></span><span class="num">${n}${c.total ? ` · ${Math.round((n / c.total) * 100)}%` : ""}</span>
        ${mc || (q.notes || {})[l] ? `<span class="mc">${esc(mc || "")}${(q.notes || {})[l] ? " — " + esc(q.notes[l]) : ""}</span>` : l === q.correct ? `<span class="mc">correct answer</span>` : ""}</div>`;
    }).join("")}</div>
    ${pctRight != null && !open ? `<div class="note">${pctRight >= 80 ? "Most of the class has it: move on, and pick up the few who don't." : "Fewer than 80% correct: re-teach using the biggest wrong option, then press <b>Ask again</b>."}</div>` : ""}
    ${confWrong.length && !open ? `<div class="small"><b>Confident but wrong:</b> ${confWrong.map(esc).join(", ")}</div>` : ""}`;
  }
  const revAll = qs.ids.every((vk) => S.reveal && S.reveal[vk]);
  return `<div class="card stack">
      <div class="row"><div class="kicker">${label}${qs.round > 1 ? " · round " + qs.round : ""}</div><span class="spacer"></span><span class="pill" id="qclock"></span>${open ? `<span class="pill live">Open</span>` : opened ? `<span class="pill">Closed</span>` : ""}</div>
      ${qs.title ? `<div class="small"><b>${esc(qs.title)}</b></div>` : ""}
      <div class="row">
        <button class="btn ${open ? "" : "ok"}" id="voteBtn" style="flex:1">${open ? "Close now" : opened ? "Re-open" : "Open"} <kbd>V</kbd></button>
        <button class="btn ${S.results ? "on" : ""}" id="resBtn">Results on board <kbd>R</kbd></button>
      </div>
      <div class="row">
        <button class="btn ${revAll ? "on" : ""}" id="revBtn" style="flex:1" ${opened ? "" : "disabled"}>${revAll ? "Hide answers" : "Reveal answers"} <kbd>A</kbd></button>
        <button class="btn" id="againBtn" ${opened && !open ? "" : "disabled"} title="After re-teaching: ask again as a new round">Ask again</button>
      </div>
      <h3>${fully.length} / ${here.length} finished${answeredBy.size > fully.length ? ` <span class="small muted">(${answeredBy.size} started)</span>` : ""}</h3>
      ${body}
    </div>
    ${notDone.length && opened ? `<div class="card stack"><div class="kicker">Still answering (${notDone.length})</div><div class="names">${notDone.map((u) => `<span>${esc(name(u))}</span>`).join("")}</div></div>` : ""}`;
}

function renderSide() {
  const el = $("#side"); if (!el || !S || !LESSON) return;
  const here = Object.keys(PRES);
  let html = "";
  if (S.qs) html += questionPanel();
  else {
    const next = LESSON.order.slice(S.pos + 1).findIndex((x) => L.qsOf(LESSON, x));
    html += `<div class="card stack"><div class="kicker">In the room</div><h3>${here.length} student${here.length === 1 ? "" : "s"} joined</h3>
      <div class="names">${here.map((u) => `<span>${esc(name(u))}</span>`).join("") || `<span class="muted">Nobody yet — show the join screen (J).</span>`}</div></div>
      <div class="card small muted">${next >= 0 ? `Next question in ${next + 1} slide${next ? "s" : ""}.` : "No more questions in this lesson."}</div>`;
  }
  if (S.points !== false) {
    const { board } = L.computeScores(LESSON, S, VOTES, ROSTER);
    html += `<div class="card stack"><div class="row"><div class="kicker">Leaderboard</div><span class="spacer"></span><button class="btn small ${S.board ? "on" : ""}" id="boardBtn2">${S.board ? "Hide from board" : "Show on board"}</button></div>${boardHtml(board, { limit: 5 })}</div>`;
  }
  html += `<div class="card stack small">
      <div class="row"><span>Feedback:</span><select id="fbSel"><option value="reveal" ${S.feedback !== "instant" ? "selected" : ""}>when I reveal</option><option value="instant" ${S.feedback === "instant" ? "selected" : ""}>straight away</option></select>
      <label class="chk"><input type="checkbox" id="tmChk" ${S.timer !== false ? "checked" : ""}> timer</label>
      <label class="chk"><input type="checkbox" id="auChk" ${S.auto !== false ? "checked" : ""}> auto-open</label></div>
      <button class="btn" id="expNow">Export this session (CSV)</button></div>`;
  el.innerHTML = html;
  const b = (id, f) => { const x = $("#" + id); if (x) x.onclick = f; };
  b("voteBtn", act.vote); b("resBtn", act.results); b("revBtn", act.reveal);
  b("againBtn", () => L.reAsk(CODE, S, LESSON)); b("boardBtn2", act.board);
  b("expNow", async () => { const s = await read(`sessions/${CODE}`); exportSessions([s], `${s.sessionId}.csv`); });
  el.querySelectorAll(".wtag").forEach((t) => (t.onclick = () => {
    const vk = S.qs.ids[0], k = t.dataset.k, hidden = (S.hidden || {})[vk] || {};
    L.hideWord(CODE, vk, k, !hidden[encodeKey(k)]).then(schedulePublish);
  }));
  $("#fbSel").onchange = (e) => L.setOption(CODE, "feedback", e.target.value);
  $("#tmChk").onchange = (e) => L.setOption(CODE, "timer", e.target.checked);
  $("#auChk").onchange = (e) => L.setOption(CODE, "auto", e.target.checked);
  updateClock();
}

/* ======================= STUDENT-PACED DASHBOARD ======================= */
async function showAssignment(code) {
  leaveSession();
  selfCode = code; CODE = code;
  centre(`<p class="muted">Opening ${esc(code)}…</p>`);
  const s0 = await read(`sessions/${code}`);
  LESSON = await L.loadLesson(s0.lessonId, true);
  app.innerHTML = topBar(`<span class="pill">${esc(s0.lessonId)}</span><span class="small muted">Student-paced · ${esc(s0.lessonTitle)}</span>`) + `
  <main class="t-main stack">
    <div class="card row">
      <div><div class="small muted">Code</div><div class="code-big">${esc(code)}</div></div>
      <div class="small muted" style="max-width:320px">Share the link <b>${esc(joinUrl(code))}</b> (e.g. on Canvas) — students sign in and work through it at their own pace.</div>
      <span class="spacer"></span>
      <button class="btn" id="openClose"></button>
      <button class="btn" id="aExp">Export (CSV)</button>
      <button class="btn ghost" id="back">← Back</button>
    </div>
    <div class="t-grid"><section class="card stack" id="aStudents"></section><aside class="stack" id="aSide"></aside></div>
  </main>`;
  wireTop();
  $("#back").onclick = () => showHome();
  $("#aExp").onclick = async () => { const s = await read(`sessions/${code}`); exportSessions([s], `${s.sessionId}.csv`); };
  sessionSubs.push(watch(`sessions/${code}`, (v) => { S = normS(v); renderAssignment(); }));
  sessionSubs.push(watch(`votes/${code}`, (v) => { VOTES = v || {}; renderAssignment(); schedulePublish(); }));
  sessionSubs.push(watch(`progress/${code}`, (v) => { PROG = v || {}; renderAssignment(); schedulePublish(); }));
  sessionSubs.push(watch("roster", (v) => { ROSTER = v || {}; renderAssignment(); }));
}

function renderAssignment() {
  if (!S || !LESSON || !$("#aStudents")) return;
  const oc = $("#openClose");
  oc.textContent = S.active ? "Close assignment" : "Re-open assignment";
  oc.onclick = () => L.closeAssignment(CODE, !S.active);
  const total = S.total || 1;
  const qids = Object.keys(LESSON.questions);
  const { by, board } = L.computeScores(LESSON, S, VOTES, ROSTER, PROG);
  const uids = new Set([...Object.keys(PROG), ...Object.keys(by)]);
  const rows = [...uids].map((u) => {
    const p = PROG[u] || {}, sc = by[u] || { p: 0, right: 0, done: 0 };
    return { u, n: name(u), pos: p.done ? total : (p.pos || 0) + 1, fin: !!p.done, t: p.t, p: sc.p, right: sc.right, answered: sc.done };
  }).sort((a, b) => a.n.localeCompare(b.n));
  $("#aStudents").innerHTML = `<div class="kicker">Students (${rows.length})</div>
    <table class="cards"><thead><tr><th>Student</th><th>Progress</th><th>Answered</th><th>Correct</th>${S.points !== false ? "<th>Points</th>" : ""}<th>Last active</th></tr></thead><tbody>
    ${rows.map((x) => `<tr><td>${esc(x.n)}</td><td><div class="progress" style="width:120px;display:inline-block;vertical-align:middle"><div style="width:${Math.round(((x.fin ? total : x.pos) / total) * 100)}%"></div></div> <span class="small muted">${x.fin ? "finished" : x.pos + "/" + total}</span></td>
      <td>${x.answered}/${qids.length}</td><td>${x.answered ? Math.round((x.right / x.answered) * 100) + "%" : "–"}</td>${S.points !== false ? `<td>${x.p}</td>` : ""}<td class="small muted">${x.t ? esc(fmtTime(x.t)) : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Nobody has started yet.</td></tr>`}
    </tbody></table>`;
  const qrows = qids.map((id) => {
    const q = LESSON.questions[id], v = Object.values(VOTES[id] || {});
    const right = q.type === "word" ? v.filter((x) => (q.accept || []).map((a) => a.toLowerCase()).includes(String(x.w || "").toLowerCase())).length : v.filter((x) => x.a === q.correct).length;
    const pct = v.length ? Math.round((right / v.length) * 100) : null;
    return `<tr><td class="small"><b>${esc(id)}</b></td><td class="small ${q.mono ? "mono" : ""}">${esc((q.prompt || "").slice(0, 50))}</td><td><span class="pctb ${pct == null ? "" : pct >= 80 ? "ok" : pct >= 50 ? "mid" : "bad"}">${pct == null ? "–" : pct + "%"}</span> <span class="small muted">${v.length}</span></td></tr>`;
  }).join("");
  $("#aSide").innerHTML = `${S.points !== false ? `<div class="card stack"><div class="kicker">Leaderboard</div>${boardHtml(board, { limit: 10 })}</div>` : ""}
    <div class="card stack"><div class="kicker">Questions</div><table class="cards"><tbody>${qrows}</tbody></table></div>`;
}
