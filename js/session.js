// Running a live lesson: the teacher-side actions, shared by teacher.html and present.html.
import { r, read, update, set, serverTimestamp } from "./fb.js";
import { ymd } from "./ui.js";
import { prepSection } from "./deckview.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/L/O/0/1

const lessonCache = {};
const slideCache = {};

export async function loadLesson(lessonId) {
  if (!lessonCache[lessonId]) {
    const l = await read(`lessons/${lessonId}`);
    if (l) {
      // the database may hand lists back as {0: …, 1: …}
      const o = l.order || [];
      l.order = Array.isArray(o) ? o.filter(Boolean) : Object.keys(o).sort((a, b) => a - b).map((k) => o[k]);
      l.hinges = l.hinges || {};
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
export const slideHtml = slideImg; // HTML decks store each slide's <section> at the same path
export function preload(lessonId, n) { if (n >= 0) slideImg(lessonId, n).catch(() => {}); }

const shellCache = {};
export function deckShell(lessonId) {
  if (!shellCache[lessonId]) shellCache[lessonId] = read(`shells/${lessonId}`);
  return shellCache[lessonId];
}
const prepCache = {};
async function prepped(lessonId, n) {
  const k = lessonId + "/" + n;
  if (!prepCache[k]) prepCache[k] = slideHtml(lessonId, n).then((h) => prepSection(h || ""));
  return prepCache[k];
}
export const maxStep = (item) => (item && item.t === "html" ? item.max || 0 : 0);

/** Public (student-safe) copy of a hinge question: no answer, no misconception tags. */
function publicQ(h, round = 1) {
  const options = {};
  Object.keys(h.options || {}).forEach((k) => { if (h.options[k] !== "" && h.options[k] != null) options[k] = String(h.options[k]); });
  return {
    id: h.id, key: round > 1 ? `${h.id}~${round}` : h.id, round,
    prompt: h.prompt || "", code: h.code || "", options, confidence: h.confidence !== false, open: false,
  };
}

export async function startSession(lessonId, cls, ownerEmail) {
  const lesson = await loadLesson(lessonId);
  if (!lesson) throw new Error("Lesson not found: " + lessonId);
  let code = "";
  for (let tries = 0; tries < 20; tries++) {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    if (!(await read(`sessions/${code}/lessonId`))) break;
  }
  const sessionId = `S-${ymd()}-${cls}-HQ-${code}`;
  await set(r(`sessions/${code}`), {
    code, sessionId, lessonId, lessonTitle: lesson.title || lessonId, cls, owner: ownerEmail,
    active: true, startedAt: serverTimestamp(), total: lesson.order.length, pos: -1, join: true,
  });
  await set(r("teacher/current"), code);
  await goTo(code, lesson, 0);
  return code;
}

// what students are seeing now (kept up to date by the pages' session watchers via observe())
let live = { code: null, pos: -1 };
export function observe(code, s) { if (s) live = { code, pos: s.pos }; }
export async function goTo(code, lesson, pos, st = 0) {
  pos = Math.max(0, Math.min(lesson.order.length - 1, pos));
  const item = lesson.order[pos];
  st = Math.max(0, Math.min(maxStep(item), st || 0));
  const samePos = live.code === code && live.pos === pos;
  const u = {};
  u[`sessions/${code}/pos`] = pos;
  u[`sessions/${code}/step`] = st;
  if (!samePos) {
    u[`sessions/${code}/results`] = false;
    u[`sessions/${code}/reveal`] = null;
  }
  if (item.t === "hinge") {
    if (!samePos) {
      const h = lesson.hinges[item.id];
      u[`sessions/${code}/kind`] = "hinge";
      u[`sessions/${code}/q`] = publicQ(h, 1);
      u[`now/${code}`] = { pos, img: null };
    }
  } else if (item.t === "html") {
    const p = await prepped(lesson.id, item.n);
    // builds up to this step are sent; later ones stay scrambled on students' devices
    const rev = {};
    Object.keys(p.rev).forEach((k) => { if (+k.slice(1) <= st) rev[k] = p.rev[k]; });
    if (samePos) {
      u[`now/${code}/step`] = st;
      Object.keys(rev).forEach((k) => (u[`now/${code}/rev/${k}`] = rev[k]));
    } else {
      u[`sessions/${code}/kind`] = "html";
      u[`sessions/${code}/q`] = null;
      u[`now/${code}`] = { pos, step: st, deck: lesson.id, html: p.base, rev };
    }
  } else {
    const img = await slideImg(lesson.id, item.n);
    u[`sessions/${code}/kind`] = "img";
    u[`sessions/${code}/q`] = null;
    u[`now/${code}`] = { pos, img: img || null };
  }
  await update(r("/"), u);
  live = { code, pos };
  // warm the cache for the neighbours
  [pos + 1, pos - 1].forEach((q) => {
    const it = lesson.order[q];
    if (it && it.t === "img") preload(lesson.id, it.n);
    if (it && it.t === "html") prepped(lesson.id, it.n).catch(() => {});
  });
}

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

export async function openVote(code, s) {
  if (!s.q) return;
  const u = {};
  u[`sessions/${code}/q/open`] = true;
  u[`sessions/${code}/reveal`] = null;
  if (!(s.opened && s.opened[s.q.key])) u[`sessions/${code}/opened/${s.q.key}`] = serverTimestamp();
  await update(r("/"), u);
}

export async function closeVote(code, s, presence) {
  if (!s.q) return;
  const u = {};
  u[`sessions/${code}/q/open`] = false;
  u[`sessions/${code}/closed/${s.q.key}`] = serverTimestamp();
  // who was in the room when it closed → lets the CSV include non-responders
  const present = {};
  Object.keys(presence || {}).forEach((uid) => (present[uid] = true));
  u[`sessions/${code}/present/${s.q.key}`] = Object.keys(present).length ? present : null;
  await update(r("/"), u);
}

export async function toggleVote(code, s, presence) {
  return s.q && s.q.open ? closeVote(code, s, presence) : openVote(code, s);
}

export async function reveal(code, s, lesson, presence) {
  if (!s.q) return;
  if (s.q.open) await closeVote(code, s, presence);
  const h = lesson.hinges[s.q.id];
  await update(r(`sessions/${code}`), { reveal: s.reveal ? null : h.correct || null });
}

export async function toggleResults(code, s) { await update(r(`sessions/${code}`), { results: !s.results }); }
export async function toggleJoin(code, s) { await update(r(`sessions/${code}`), { join: !s.join }); }

/** Ask the same hinge again (after re-teaching) — a new round, so round 1 is kept for the research data. */
export async function reAsk(code, s, lesson) {
  if (!s.q) return;
  const h = lesson.hinges[s.q.id];
  const q = publicQ(h, (s.q.round || 1) + 1);
  q.open = true;
  const u = {};
  u[`sessions/${code}/q`] = q;
  u[`sessions/${code}/results`] = false;
  u[`sessions/${code}/reveal`] = null;
  u[`sessions/${code}/opened/${q.key}`] = serverTimestamp();
  await update(r("/"), u);
}

export async function endSession(code) {
  const u = {};
  u[`sessions/${code}/active`] = false;
  u[`sessions/${code}/endedAt`] = serverTimestamp();
  u["teacher/current"] = null;
  await update(r("/"), u);
}

/** Keyboard shortcuts for teacher + projector. handlers: {next, prev, vote, results, reveal, join, fullscreen} */
export function bindKeys(h) {
  document.addEventListener("keydown", (e) => {
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    const map = {
      ArrowRight: "next", PageDown: "next", " ": "next", ArrowDown: "next",
      ArrowLeft: "prev", PageUp: "prev", ArrowUp: "prev",
      v: "vote", V: "vote", r: "results", R: "results", a: "reveal", A: "reveal",
      j: "join", J: "join", f: "fullscreen", F: "fullscreen",
    };
    const act = map[k];
    if (act && h[act]) { e.preventDefault(); h[act](); }
  });
}
