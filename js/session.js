// Running a lesson (teacher side), shared by teacher.html and present.html.
//  • live (teacher-paced): everyone follows; questions open on arrival with a countdown
//  • self (student-paced): an assignment students work through on their own
import { r, read, update, set, serverTimestamp } from "./fb.js";
import { ymd, countWords, encodeKey } from "./ui.js";
import { prepSection } from "./deckview.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1
const lessonCache = {}, slideCache = {}, shellCache = {}, prepCache = {};

/* ---------------- lessons ---------------- */
export async function loadLesson(lessonId, fresh) {
  if (fresh || !lessonCache[lessonId]) {
    const l = await read(`lessons/${lessonId}`);
    if (l) {
      const o = l.order || [];
      l.order = Array.isArray(o) ? o.filter(Boolean) : Object.keys(o).sort((a, b) => a - b).map((k) => o[k]);
      l.questions = l.questions || {};
      // lessons uploaded before questions came from the deck: {hinges} + {t:'hinge'}
      if (l.hinges) Object.values(l.hinges).forEach((h) => { if (!l.questions[h.id]) l.questions[h.id] = { ...h, type: "mcq", explain: h.teacher_note || "" }; });
      l.order.forEach((it) => {
        if (it.t === "hinge") it.t = "q";
        if (it.q && !Array.isArray(it.q.ids)) it.q.ids = Object.values(it.q.ids || {});
      });
      Object.values(l.questions).forEach((q) => { if (q.ansIdx && !Array.isArray(q.ansIdx)) q.ansIdx = Object.values(q.ansIdx); if (q.accept && !Array.isArray(q.accept)) q.accept = Object.values(q.accept); });
    }
    lessonCache[lessonId] = l;
  }
  return lessonCache[lessonId];
}
export async function slideImg(lessonId, n) {
  const k = lessonId + "/" + n;
  if (!slideCache[k]) slideCache[k] = read(`slides/${lessonId}/${n}`);
  return slideCache[k];
}
export const slideHtml = slideImg;
export function preload(lessonId, n) { if (n >= 0) slideImg(lessonId, n).catch(() => {}); }
export function deckShell(lessonId) {
  if (!shellCache[lessonId]) shellCache[lessonId] = read(`shells/${lessonId}`);
  return shellCache[lessonId];
}
async function prepped(lessonId, n) {
  const k = lessonId + "/" + n;
  if (!prepCache[k]) prepCache[k] = slideHtml(lessonId, n).then((h) => prepSection(h || ""));
  return prepCache[k];
}
export const maxStep = (item) => (item && item.t === "html" ? item.max || 0 : 0);

/** The question set attached to an order item: {type, ids, time} or null. */
export function qsOf(lesson, item) {
  if (!item) return null;
  if (item.t === "q") { const q = lesson.questions[item.id]; return q ? { type: q.type, ids: [q.id], time: q.time || 30 } : null; }
  return item.q || null;
}
const vkey = (id, round) => (round > 1 ? `${id}~${round}` : id);
export const baseId = (vk) => String(vk).split("~")[0];

/** Student-safe copy of a question: no answer, no misconception tags. */
function publicItem(q, round) {
  const p = { id: vkey(q.id, round), base: q.id, type: q.type, prompt: q.prompt || "" };
  if (q.code) p.code = q.code;
  if (q.mono) p.mono = true;
  if (q.fig) p.fig = true;
  if (q.card) p.card = q.card;
  if (q.type === "mcq") {
    p.options = {};
    Object.keys(q.options || {}).forEach((k) => { if (q.options[k] !== "" && q.options[k] != null) p.options[k] = String(q.options[k]); });
    p.confidence = q.confidence === true;
  }
  return p;
}
/** What a student may see after answering (instant feedback) or after the reveal. */
async function keyFor(lesson, q) {
  const k = { c: q.correct || "", x: q.explain || "" };
  if (q.why && Object.keys(q.why).length) k.w = q.why;   // why each wrong option is wrong (AS-style hinge)
  if (q.accept && q.accept.length) k.acc = q.accept;
  const it = lesson.order.find((o) => o.t === "html" && o.q && o.q.ids.includes(q.id));
  if (it && q.ansIdx && q.ansIdx.length) {
    const p = await prepped(lesson.id, it.n);
    const rev = {};
    Object.values(p.rev).forEach((m) => Object.keys(m).forEach((i) => { if (q.ansIdx.includes(+i.slice(1))) rev[i] = m[i]; }));
    if (Object.keys(rev).length) k.rev = rev;
  }
  return k;
}
function makeQs(lesson, def, pos, round) {
  const items = {}, ids = [];
  def.ids.forEach((id) => { const q = lesson.questions[id]; if (q) { const p = publicItem(q, round); items[p.id] = p; ids.push(p.id); } });
  const qs = { key: `p${pos}${round > 1 ? "~" + round : ""}`, type: def.type, round, ids, items, time: def.time || 30 };
  if (def.title) qs.title = def.title;
  return qs;
}

/* ---------------- live session ---------------- */
// the latest session the page has seen (pages call observe() from their session watcher)
let live = { code: null, pos: -1, s: null };
export function observe(code, s) { if (s) live = { code, pos: s.pos, s }; }

function newCode() { return Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(""); }
async function freeCode() {
  let code = "";
  for (let tries = 0; tries < 20; tries++) { code = newCode(); if (!(await read(`sessions/${code}/lessonId`))) break; }
  return code;
}

/** opts: {feedback:'instant'|'reveal', points, timer, auto} */
export async function startSession(lessonId, cls, ownerEmail, opts = {}) {
  const lesson = await loadLesson(lessonId, true);
  if (!lesson) throw new Error("Lesson not found: " + lessonId);
  const code = await freeCode();
  await set(r(`sessions/${code}`), {
    code, mode: "live", sessionId: `S-${ymd()}-${cls}-LV-${code}`, lessonId, lessonTitle: lesson.title || lessonId, cls, owner: ownerEmail,
    active: true, startedAt: serverTimestamp(), total: lesson.order.length, pos: -1, step: 0, join: true,
    feedback: opts.feedback || "reveal", points: opts.points !== false, timer: opts.timer !== false, auto: opts.auto !== false,
  });
  await set(r("teacher/current"), code);
  live = { code, pos: -1, s: null };
  await goTo(code, lesson, 0);
  return code;
}

export async function goTo(code, lesson, pos, st = 0) {
  pos = Math.max(0, Math.min(lesson.order.length - 1, pos));
  const item = lesson.order[pos];
  st = Math.max(0, Math.min(maxStep(item), st || 0));
  const s = live.code === code ? live.s : null;
  const samePos = live.code === code && live.pos === pos;
  const u = {};
  const S = `sessions/${code}`;
  u[`${S}/pos`] = pos;
  u[`${S}/step`] = st;
  const def = qsOf(lesson, item);

  if (!samePos) {
    u[`${S}/kind`] = item.t === "html" ? "html" : item.t === "q" ? "q" : "img";
    u[`${S}/results`] = false;
    u[`${S}/open`] = null;
    if (s && s.open && s.qs) closeInto(u, code, s, null);  // leaving a question closes it
    if (def) {
      const qs = makeQs(lesson, def, pos, 1);
      u[`${S}/qs`] = qs;
      for (const vk of qs.ids) u[`keys/${code}/${vk}`] = await keyFor(lesson, lesson.questions[baseId(vk)]);
      if (!s || s.auto !== false) openInto(u, code, s, qs);
    } else u[`${S}/qs`] = null;
  }

  if (item.t === "q") {
    if (!samePos) u[`now/${code}`] = { pos, img: null };
  } else if (item.t === "html") {
    const p = await prepped(lesson.id, item.n);
    // builds up to this step go to students; later ones stay scrambled on their devices.
    const rev = {};
    Object.keys(p.rev).forEach((k) => { if (+k.slice(1) <= st) rev[k] = p.rev[k]; });
    if (samePos) {
      u[`now/${code}/step`] = st;
      Object.keys(rev).forEach((k) => (u[`now/${code}/rev/${k}`] = rev[k]));
    } else {
      u[`now/${code}`] = { pos, step: st, deck: lesson.id, html: p.base, rev };
    }
    // the first ANSWER build on the projector closes voting; each answer build reveals its question on devices
    // (other builds — e.g. the hinge timer or "whiteboards up" — leave voting open)
    if (def && st > 0) {
      const ids = samePos && s && s.qs ? s.qs.ids : def.ids;
      const steps = ids.map((vk) => (lesson.questions[baseId(vk)] || {}).ansStep || 0).filter((x) => x > 0);
      const first = steps.length ? Math.min(...steps) : 1;
      if (st >= first && samePos && s && s.open) closeInto(u, code, s, null);
      ids.forEach((vk) => {
        const q = lesson.questions[baseId(vk)];
        if (q && q.ansStep && q.ansStep <= st) u[`${S}/reveal/${vk}`] = q.type === "word" ? "*" : q.correct || "*";
      });
    }
  } else {
    const img = await slideImg(lesson.id, item.n);
    u[`now/${code}`] = { pos, img: img || null };
  }
  await update(r("/"), u);
  live = { code, pos, s: live.code === code ? live.s : null };
  [pos + 1, pos - 1].forEach((q) => {
    const it = lesson.order[q];
    if (it && it.t === "img") preload(lesson.id, it.n);
    if (it && it.t === "html") prepped(lesson.id, it.n).catch(() => {});
  });
}

function openInto(u, code, s, qs) {
  const S = `sessions/${code}`;
  const open = {};
  qs.ids.forEach((vk) => { open[vk] = true; if (!(s && s.opened && s.opened[vk])) u[`${S}/opened/${vk}`] = serverTimestamp(); });
  u[`${S}/open`] = open;
  // (a multi-path update can't contain both a path and one inside it)
  if (u[`${S}/qs`]) u[`${S}/qs`].openedAt = serverTimestamp(); else u[`${S}/qs/openedAt`] = serverTimestamp();
}
function closeInto(u, code, s, presence) {
  const S = `sessions/${code}`;
  u[`${S}/open`] = null;
  const present = {};
  Object.keys(presence || {}).forEach((uid) => (present[uid] = true));
  (s.qs ? s.qs.ids : []).forEach((vk) => {
    u[`${S}/closed/${vk}`] = serverTimestamp();
    if (Object.keys(present).length) u[`${S}/present/${vk}`] = present;
  });
}

export async function openVote(code, s) {
  if (!s.qs) return;
  const u = {}; openInto(u, code, s, s.qs);
  await update(r("/"), u);
}
export async function closeVote(code, s, presence) {
  if (!s.qs || !s.open) return;
  const u = {}; closeInto(u, code, s, presence);
  await update(r("/"), u);
}
export const toggleVote = (code, s, presence) => (s.qs && s.open ? closeVote(code, s, presence) : openVote(code, s));

export async function reveal(code, s, lesson, presence) {
  if (!s.qs) return;
  const u = {};
  if (s.open) closeInto(u, code, s, presence);
  const all = s.qs.ids.every((vk) => s.reveal && s.reveal[vk]);
  s.qs.ids.forEach((vk) => {
    const q = lesson.questions[baseId(vk)];
    u[`sessions/${code}/reveal/${vk}`] = all ? null : q && q.type === "word" ? "*" : (q && q.correct) || "*";
  });
  await update(r("/"), u);
}
export async function toggleResults(code, s) { await update(r(`sessions/${code}`), { results: !s.results }); }
export async function toggleJoin(code, s) { await update(r(`sessions/${code}`), { join: !s.join, board: false }); }
export async function toggleBoard(code, s) { await update(r(`sessions/${code}`), { board: !s.board, join: false }); }
export async function setOption(code, key, value) { await update(r(`sessions/${code}`), { [key]: value }); }

/** Ask the same question(s) again after re-teaching — a new round, round 1 kept for the research data. */
export async function reAsk(code, s, lesson) {
  if (!s.qs) return;
  const def = { type: s.qs.type, ids: s.qs.ids.map(baseId), time: s.qs.time, title: s.qs.title };
  const qs = makeQs(lesson, def, s.pos, (s.qs.round || 1) + 1);
  const u = {};
  u[`sessions/${code}/qs`] = qs;
  u[`sessions/${code}/results`] = false;
  for (const vk of qs.ids) u[`keys/${code}/${vk}`] = await keyFor(lesson, lesson.questions[baseId(vk)]);
  openInto(u, code, s, qs);
  await update(r("/"), u);
}

/** Close voting when the countdown runs out (called every second by the teacher page and projector). */
export function tick(code, s, presence, offset = 0) {
  if (!s || !s.qs || !s.open || s.timer === false || !s.qs.openedAt) return;
  if (Date.now() + offset >= s.qs.openedAt + (s.qs.time || 30) * 1000 + 400) closeVote(code, s, presence).catch(() => {});
}
export function secondsLeft(s, offset = 0) {
  if (!s || !s.qs || !s.open || s.timer === false || !s.qs.openedAt) return null;
  return Math.max(0, Math.ceil((s.qs.openedAt + (s.qs.time || 30) * 1000 - Date.now() - offset) / 1000));
}

export async function hideWord(code, vk, k, hidden) { await set(r(`sessions/${code}/hidden/${vk}/${encodeKey(k)}`), hidden ? true : null); }

export async function endSession(code) {
  const u = {};
  u[`sessions/${code}/active`] = false;
  u[`sessions/${code}/endedAt`] = serverTimestamp();
  u[`sessions/${code}/open`] = null;
  u["teacher/current"] = null;
  await update(r("/"), u);
}

/* ---------------- scores, leaderboard, word clouds ---------------- */
/** Points: 500–1000 for a correct answer, more for a faster one; word answers score if they match the accepted list. */
export function computeScores(lesson, s, votes, roster, progress) {
  const by = {};
  if (!s) return { by, board: [] };
  Object.keys(votes || {}).forEach((vk) => {
    const q = lesson.questions[baseId(vk)];
    if (!q) return;
    Object.entries(votes[vk] || {}).forEach(([uid, v]) => {
      const me = (by[uid] = by[uid] || { p: 0, right: 0, done: 0 });
      me.done++;
      const ok = q.type === "word"
        ? (q.accept || []).map((a) => a.toLowerCase()).includes(String(v.w || "").trim().toLowerCase())
        : !!q.correct && v.a === q.correct;
      if (!ok) return;
      me.right++;
      if (s.points === false) return;
      const start = s.mode === "self" ? progress && progress[uid] && progress[uid].seen && progress[uid].seen[vk] : s.opened && s.opened[vk];
      const limit = (q.time || 30) * 1000;
      const frac = start && v.t ? Math.max(0, 1 - (v.t - start) / limit) : 0;
      me.p += Math.round(500 + 500 * frac);
    });
  });
  const board = Object.entries(by).map(([uid, x]) => ({ uid, n: (roster[uid] && roster[uid].n) || "Student", p: x.p, right: x.right, done: x.done }))
    .sort((a, b) => b.p - a.p || b.right - a.right || a.n.localeCompare(b.n));
  board.forEach((x, i) => (x.r = i + 1));
  return { by, board };
}

let lastPub = "";
/** Teacher page / projector publish scores + word clouds so students can see them (only when changed). */
export async function publish(code, s, lesson, votes, roster, progress) {
  if (!s || !lesson) return;
  const { board } = computeScores(lesson, s, votes, roster, progress);
  const scores = {};
  board.forEach((x) => (scores[x.uid] = { p: x.p, r: x.r }));
  const top = board.slice(0, 10).map((x) => ({ n: x.n, p: x.p }));
  const clouds = {};
  Object.keys(votes || {}).forEach((vk) => {
    const q = lesson.questions[baseId(vk)];
    if (q && q.type === "word") clouds[vk] = countWords(votes[vk], (s.hidden || {})[vk] || {}).slice(0, 60).map((x) => ({ w: x.w, k: x.k, n: x.n }));
  });
  const payload = JSON.stringify({ scores, top, clouds });
  if (payload === lastPub) return;
  lastPub = payload;
  const u = {};
  u[`sessions/${code}/scores`] = Object.keys(scores).length ? scores : null;
  u[`sessions/${code}/top`] = top.length ? top : null;
  u[`sessions/${code}/cloud`] = Object.keys(clouds).length ? clouds : null;
  await update(r("/"), u).catch(() => { lastPub = ""; });
}

/* ---------------- student-paced assignments ---------------- */
/** Copies a student-safe version of the lesson for this assignment (answers only unlock after answering). */
export async function startAssignment(lessonId, cls, ownerEmail, opts = {}, onProgress = () => {}) {
  const lesson = await loadLesson(lessonId, true);
  if (!lesson) throw new Error("Lesson not found: " + lessonId);
  const code = await freeCode();
  const order = lesson.order.map((it) => {
    const o = { t: it.t };
    if (it.t !== "q") o.n = it.n;
    if (it.t === "html") { o.max = it.max || 0; o.title = it.title || ""; }
    const def = qsOf(lesson, it);
    if (def) { o.q = { type: def.type, ids: def.ids, time: def.time || 30 }; if (def.title) o.q.title = def.title; }
    return o;
  });
  const items = {};
  Object.values(lesson.questions).forEach((q) => (items[q.id] = publicItem(q, 1)));
  await set(r(`sessions/${code}`), {
    code, mode: "self", sessionId: `S-${ymd()}-${cls}-SP-${code}`, lessonId, lessonTitle: lesson.title || lessonId, cls, owner: ownerEmail,
    active: true, startedAt: serverTimestamp(), total: order.length, order, items,
    feedback: "instant", points: opts.points !== false, due: opts.due || null, shell: lesson.kind === "html" ? lessonId : null,
  });
  for (let i = 0; i < order.length; i++) {
    const it = order[i];
    onProgress(`Preparing slide ${i + 1} of ${order.length}…`, (i + 1) / order.length);
    if (it.t === "q") continue;
    if (it.t === "img") { await set(r(`selfpack/${code}/${i}`), (await slideImg(lessonId, it.n)) || ""); continue; }
    const real = (await slideHtml(lessonId, it.n)) || "";
    await set(r(`selfpack/${code}/${i}`), it.q ? (await prepped(lessonId, it.n)).base : real);
  }
  const u = {};
  for (const q of Object.values(lesson.questions)) u[`keys/${code}/${q.id}`] = await keyFor(lesson, q);
  if (Object.keys(u).length) await update(r("/"), u);
  return code;
}
export async function closeAssignment(code, active) {
  await update(r(`sessions/${code}`), { active: !!active, endedAt: active ? null : serverTimestamp() });
}

/* ---------------- navigation ---------------- */
/** Next/previous that never loses a press, even when a clicker is tapped quickly several times.
 *  On an HTML deck slide, "next" first reveals the slide's builds one by one. */
let navTarget = null, navChain = Promise.resolve();
function nextOf(lesson, pos, st) {
  const it = lesson.order[pos];
  if (st < maxStep(it)) return [pos, st + 1];
  if (pos < lesson.order.length - 1) return [pos + 1, 0];
  return null;
}
function prevOf(lesson, pos, st) {
  if (st > 0) return [pos, st - 1];
  if (pos > 0) return [pos - 1, maxStep(lesson.order[pos - 1])];
  return null;
}
function queue(code, lesson, target) {
  navTarget = target;
  navChain = navChain.then(() => goTo(code, lesson, target[0], target[1])).catch((e) => console.warn(e))
    .then(() => { if (navTarget === target) navTarget = null; });
  return navChain;
}
export function step(code, lesson, s, delta) {
  if (!s || !lesson) return;
  const base = navTarget || [s.pos, s.step || 0];
  const target = delta > 0 ? nextOf(lesson, base[0], base[1]) : prevOf(lesson, base[0], base[1]);
  if (!target) return;
  return queue(code, lesson, target);
}
export function jump(code, lesson, pos, st = 0) { return queue(code, lesson, [pos, st]); }

/** Keyboard shortcuts for teacher + projector. */
export function bindKeys(h) {
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map = {
      ArrowRight: "next", PageDown: "next", " ": "next", ArrowDown: "next",
      ArrowLeft: "prev", PageUp: "prev", ArrowUp: "prev",
      v: "vote", V: "vote", r: "results", R: "results", a: "reveal", A: "reveal",
      j: "join", J: "join", f: "fullscreen", F: "fullscreen", s: "board", S: "board",
    };
    const act = map[e.key];
    if (act && h[act]) { e.preventDefault(); h[act](); }
  });
}
