// Student notes: a private notepad during the lesson, one note per slide, emailed to the student when
// the lesson ends (grouped by slide, each with a link to that slide in a self-paced review copy).
//  • Saved as they type to notes/<code>/<uid> — only that student can read it (not even the teacher).
//  • When the lesson ends, the student's page sends the notes to NOTES_EMAIL_URL (a Google Apps Script
//    running as the teacher, see setup.html). The script checks the student's sign-in with Google and
//    only ever emails that student's own school address. The saved copy is then deleted.
import { auth, r, read, set, remove, serverTimestamp } from "./fb.js";
import { esc, joinUrl } from "./ui.js";
import { NOTES_EMAIL_URL } from "./config.js";

const MAX = 2000;          // per slide
const MAX_ALL = 8000;      // the whole email
// N: { code, sid, user, notes:{pos:text}, titles:{pos:title}, cur, slide, slideTitle, loaded, open, saveT, saving,
//      state: ""|"sending"|"sent"|"failed"|"none", err, title, review }
let N = null;

const lsKey = (c) => "ll_notes2_" + c;
const lsGet = (c) => { try { return JSON.parse(localStorage.getItem(lsKey(c)) || "null"); } catch (e) { return null; } };
const lsSet = (c, v) => { try { v ? localStorage.setItem(lsKey(c), JSON.stringify(v)) : localStorage.removeItem(lsKey(c)); } catch (e) {} };
const sentKey = (c) => "ll_notes_sent_" + c;
const wasSent = (c) => { try { return localStorage.getItem(sentKey(c)) === "1"; } catch (e) { return false; } };
const filled = () => Object.keys(N.notes).filter((p) => N.notes[p] && N.notes[p].trim()).map(Number).sort((a, b) => a - b);
const label = (p) => `Slide ${p + 1}${N.titles[p] ? " · " + N.titles[p] : ""}`;

/** Start notes for a lesson (call on join). */
export async function startNotes(code, user, title, sid) {
  sid = sid || code;   // the session ID is unique even if a join code is used again later
  const local = lsGet(sid) || {};
  N = { code, sid, user, notes: local.s || {}, titles: local.h || {}, cur: null, slide: 0, slideTitle: "", loaded: false, open: false,
    saveT: null, saving: false, state: wasSent(sid) ? "sent" : "", err: "", title: title || "", review: null };
  try {
    const v = await read(`notes/${code}/${user.uid}`);
    if (N && N.code === code && v && v.s) {
      Object.entries(v.s).forEach(([k, t]) => { const p = +k.slice(1); if (!N.notes[p] || t.length > N.notes[p].length) N.notes[p] = t; });
      Object.entries(v.h || {}).forEach(([k, t]) => { N.titles[+k.slice(1)] = N.titles[+k.slice(1)] || t; });
    }
  } catch (e) {}
  if (N && N.code === code) { N.loaded = true; paintDock(); }
}
export function stopNotes() { if (N) { clearTimeout(N.saveT); flush(); } N = null; }
export function setNotesTitle(t) { if (N && t) N.title = t; }
export function setReview(code) { if (N) N.review = code || null; }

/** The teacher moved to another slide. The notepad follows — unless the student is typing right now. */
export function setSlide(pos, title) {
  if (!N || pos == null || pos < 0) return;
  N.slide = pos; N.slideTitle = title || "";
  if (title && !N.titles[pos]) N.titles[pos] = title;
  const ta = document.getElementById("notesText");
  const typing = ta && document.activeElement === ta;
  if (N.cur == null || (!typing && N.cur !== pos)) { N.cur = pos; if (ta) fillSheet(); }
  else if (ta) hint();
}

/** Header button. */
export function notesButton() {
  if (!N) return "";
  const n = N.loaded ? filled().length : 0;
  return `<button class="pill notes-pill ${N.open ? "on" : ""}" id="notesBtn" type="button" title="Your notes, emailed to you when the lesson ends">✎ Notes${n ? ` · ${n}` : ""}</button>`;
}

/** The notepad itself lives outside the repainted page so typing is never interrupted. */
export function paintDock() {
  const dock = document.getElementById("notesDock");
  if (!dock || !N) return;
  dock.className = "notes-dock" + (N.open ? " open" : "");
  if (!N.open) { dock.innerHTML = ""; return; }
  if (!dock.querySelector("textarea")) {
    dock.innerHTML = `<div class="notes-sheet">
      <div class="row"><b id="notesFor"></b><span class="small muted" id="notesStatus"></span><span class="spacer"></span><button class="btn ghost small" id="notesClose" type="button">Close</button></div>
      <button class="btn small accent hidden" id="notesFollow" type="button"></button>
      <textarea id="notesText" maxlength="${MAX}" placeholder="Short notes on this slide: key words, things to remember, questions to ask…"></textarea>
      <div id="notesEarlier"></div>
      <p class="small muted" style="margin:0">Only you can see these. They're emailed to <b>${esc(N.user.email)}</b> when the lesson ends, each with a link back to its slide.</p>
    </div>`;
    const ta = dock.querySelector("textarea");
    ta.oninput = () => {
      N.notes[N.cur] = ta.value.slice(0, MAX);
      if (N.cur === N.slide && N.slideTitle) N.titles[N.cur] = N.slideTitle;
      lsSet(N.sid, { s: N.notes, h: N.titles });
      if (N.state === "sent") N.state = "";
      schedule(); status(); earlier();
      const b = document.getElementById("notesBtn"); if (b) b.outerHTML = notesButton();
    };
    ta.onblur = () => setTimeout(() => { if (N && document.activeElement !== ta && N.cur !== N.slide) setSlide(N.slide, N.slideTitle); }, 150);
    dock.querySelector("#notesClose").onclick = () => toggleNotes(false);
    dock.querySelector("#notesFollow").onclick = () => { N.cur = N.slide; fillSheet(); ta.focus(); };
    dock.addEventListener("click", (e) => {
      const p = e.target.closest("[data-note]"); if (!p) return;
      N.cur = +p.dataset.note; fillSheet(); ta.focus();
    });
    if (N.cur == null) N.cur = N.slide;
    fillSheet();
    setTimeout(() => ta.focus(), 50);
  }
  status();
}
function fillSheet() {
  const ta = document.getElementById("notesText"); if (!ta || !N) return;
  ta.value = N.notes[N.cur] || "";
  document.getElementById("notesFor").textContent = "Notes · " + label(N.cur);
  hint(); earlier(); status();
}
function hint() {
  const b = document.getElementById("notesFollow"); if (!b || !N) return;
  const show = N.cur !== N.slide;
  b.classList.toggle("hidden", !show);
  if (show) b.textContent = `Your teacher is on slide ${N.slide + 1}. Write notes for that slide →`;
}
function earlier() {
  const el = document.getElementById("notesEarlier"); if (!el || !N) return;
  const ps = filled().filter((p) => p !== N.cur);
  el.innerHTML = ps.length ? `<details class="notes-earlier"><summary class="small">Your other notes (${ps.length})</summary>${ps.map((p) =>
    `<button type="button" class="notes-item" data-note="${p}"><b>${esc(label(p))}</b><span>${esc(N.notes[p].slice(0, 90))}${N.notes[p].length > 90 ? "…" : ""}</span></button>`).join("")}</details>` : "";
}
function status() {
  const el = document.getElementById("notesStatus"); if (!el || !N) return;
  el.textContent = N.saving ? "Saving…" : filled().length ? "Saved" : "";
}
export function toggleNotes(on) {
  if (!N) return;
  N.open = on == null ? !N.open : on;
  paintDock();
  const b = document.getElementById("notesBtn"); if (b) b.classList.toggle("on", N.open);
}
function schedule() { clearTimeout(N.saveT); N.saveT = setTimeout(flush, 800); }
async function flush() {
  const n = N; if (!n || !n.loaded) return;
  n.saving = true; status();
  const s = {}, h = {};
  Object.keys(n.notes).forEach((p) => { if (n.notes[p] && n.notes[p].trim()) { s["p" + p] = n.notes[p]; if (n.titles[p]) h["p" + p] = String(n.titles[p]).slice(0, 120); } });
  try {
    if (Object.keys(s).length) await set(r(`notes/${n.code}/${n.user.uid}`), { s, h, t: serverTimestamp() });
    else await remove(r(`notes/${n.code}/${n.user.uid}`));
  } catch (e) {}
  n.saving = false; status();
}

/** Each note with its slide, and a link to that slide in the review copy (if the teacher made one). */
function entries(n) {
  let left = MAX_ALL;
  return Object.keys(n.notes).map(Number).sort((a, b) => a - b).filter((p) => n.notes[p] && n.notes[p].trim()).map((p) => {
    const text = n.notes[p].trim().slice(0, Math.max(0, left)); left -= text.length;
    return { slide: p + 1, title: String(n.titles[p] || "").slice(0, 120), text, link: n.review ? `${joinUrl(n.review)}&s=${p + 1}` : "" };
  }).filter((e) => e.text);
}
function plain(n) { return entries(n).map((e) => `Slide ${e.slide}${e.title ? " · " + e.title : ""}\n${e.text}`).join("\n\n"); }

/** The lesson has ended: email the notes (once). onChange repaints the "ended" card. */
export async function sendNotesAtEnd(onChange) {
  const n = N; if (!n) return;
  if (!n.loaded) { setTimeout(() => sendNotesAtEnd(onChange), 300); return; }
  if (n.state) return;                       // already sending, sent, failed or nothing to send
  clearTimeout(n.saveT);
  const list = entries(n);
  if (!list.length) { n.state = "none"; return; }
  if (!NOTES_EMAIL_URL) { n.state = "failed"; n.err = "Email isn't set up yet. Copy your notes below."; onChange(); return; }
  n.state = "sending"; onChange();
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(NOTES_EMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // plain text: no CORS pre-flight for Apps Script
      body: JSON.stringify({ idToken, entries: list, review: n.review ? joinUrl(n.review) : "", title: n.title, code: n.code,
        date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!out.ok) throw new Error(out.error || "not sent");
    n.state = "sent";
    try { localStorage.setItem(sentKey(n.sid), "1"); } catch (e) {}
    lsSet(n.sid, null);
    remove(r(`notes/${n.code}/${n.user.uid}`)).catch(() => {});   // emailed — don't keep a copy
  } catch (e) {
    n.state = "failed"; n.err = "Couldn't email your notes. Copy them below so you don't lose them.";
  }
  onChange();
}

/** Line for the "lesson has ended" card. */
export function endedNotesHtml() {
  if (!N || N.state === "none" || (!entries(N).length && N.state !== "sent")) return "";
  const rev = N.review ? `<p class="small"><a href="${esc(joinUrl(N.review))}">Review this lesson →</a></p>` : "";
  if (N.state === "sent") return `<p class="banner ok">✉ Your notes have been emailed to <b>${esc(N.user.email)}</b>.</p>${rev}`;
  if (N.state === "failed") return `<div class="banner bad">${esc(N.err)}</div>
    <textarea class="notes-copy" readonly>${esc(plain(N))}</textarea><button class="btn" id="notesCopy" type="button">Copy my notes</button>${rev}`;
  return `<p class="banner info">Emailing your notes…</p>`;
}
export function wireEnded() {
  const b = document.getElementById("notesCopy");
  if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(plain(N)); b.textContent = "Copied ✓"; } catch (e) { const t = document.querySelector(".notes-copy"); if (t) { t.select(); document.execCommand("copy"); b.textContent = "Copied ✓"; } } };
}
