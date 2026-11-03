// Student notes: a private notepad during the lesson, emailed to the student when the lesson ends.
//  • Saved as they type to notes/<code>/<uid> — only that student can read it (not even the teacher).
//  • When the lesson ends, the student's page sends the notes to NOTES_EMAIL_URL (a Google Apps Script
//    running as the teacher, see setup.html). The script checks the student's sign-in with Google and
//    only ever emails that student's own school address. The saved copy is then deleted.
import { auth, r, read, set, remove, serverTimestamp } from "./fb.js";
import { esc } from "./ui.js";
import { NOTES_EMAIL_URL } from "./config.js";

const MAX = 5000;
let N = null;   // { code, user, text, loaded, open, saveT, saving, state: ""|"sending"|"sent"|"failed"|"none", err, title }

const lsKey = (c) => "ll_notes_" + c;
const lsGet = (c) => { try { return localStorage.getItem(lsKey(c)) || ""; } catch (e) { return ""; } };
const lsSet = (c, v) => { try { v ? localStorage.setItem(lsKey(c), v) : localStorage.removeItem(lsKey(c)); } catch (e) {} };
const sentKey = (c) => "ll_notes_sent_" + c;
const wasSent = (c) => { try { return localStorage.getItem(sentKey(c)) === "1"; } catch (e) { return false; } };

/** Start notes for a lesson (call on join). */
export async function startNotes(code, user, title, sid) {
  sid = sid || code;   // the session ID is unique even if a join code is used again later
  N = { code, sid, user, text: lsGet(sid), loaded: false, open: false, saveT: null, saving: false, state: wasSent(sid) ? "sent" : "", err: "", title: title || "" };
  try {
    const v = await read(`notes/${code}/${user.uid}`);
    if (N && N.code === code && v && typeof v.x === "string" && v.x.length >= N.text.length) N.text = v.x;
  } catch (e) {}
  if (N && N.code === code) { N.loaded = true; paintDock(); }
}
export function stopNotes() { if (N) { clearTimeout(N.saveT); flush(); } N = null; }
export function setNotesTitle(t) { if (N && t) N.title = t; }

/** Header button. */
export function notesButton() {
  if (!N) return "";
  const has = N.text.trim().length > 0;
  return `<button class="pill notes-pill ${N.open ? "on" : ""}" id="notesBtn" type="button" title="Your notes — emailed to you when the lesson ends">✎ Notes${has ? " ·" : ""}</button>`;
}

/** The notepad itself lives outside the repainted page so typing is never interrupted. */
export function paintDock() {
  const dock = document.getElementById("notesDock");
  if (!dock || !N) return;
  dock.className = "notes-dock" + (N.open ? " open" : "");
  if (!N.open) { dock.innerHTML = ""; return; }
  if (!dock.querySelector("textarea")) {
    dock.innerHTML = `<div class="notes-sheet">
      <div class="row"><b>Your notes</b><span class="small muted" id="notesStatus"></span><span class="spacer"></span><button class="btn ghost small" id="notesClose" type="button">Close</button></div>
      <textarea id="notesText" maxlength="${MAX}" placeholder="Short notes for yourself — key words, things to remember, questions to ask…"></textarea>
      <p class="small muted" style="margin:0">Only you can see these. They're emailed to <b>${esc(N.user.email)}</b> when the lesson ends.</p>
    </div>`;
    const ta = dock.querySelector("textarea");
    ta.value = N.text;
    ta.oninput = () => { N.text = ta.value.slice(0, MAX); lsSet(N.sid, N.text); N.state = N.state === "sent" ? "" : N.state; schedule(); status(); };
    dock.querySelector("#notesClose").onclick = () => toggleNotes(false);
    setTimeout(() => ta.focus(), 50);
  }
  status();
}
function status() {
  const el = document.getElementById("notesStatus"); if (!el || !N) return;
  el.textContent = N.saving ? "Saving…" : N.text ? "Saved" : "";
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
  try {
    if (n.text.trim()) await set(r(`notes/${n.code}/${n.user.uid}`), { x: n.text, t: serverTimestamp() });
    else await remove(r(`notes/${n.code}/${n.user.uid}`));
  } catch (e) {}
  n.saving = false; status();
}

/** The lesson has ended: email the notes (once). onChange repaints the "ended" card. */
export async function sendNotesAtEnd(onChange) {
  const n = N; if (!n) return;
  if (!n.loaded) { setTimeout(() => sendNotesAtEnd(onChange), 300); return; }
  if (n.state) return;                       // already sending, sent, failed or nothing to send
  clearTimeout(n.saveT);
  if (!n.text.trim()) { n.state = "none"; return; }
  if (!NOTES_EMAIL_URL) { n.state = "failed"; n.err = "Email isn't set up yet — copy your notes below."; onChange(); return; }
  n.state = "sending"; onChange();
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch(NOTES_EMAIL_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // plain text: no CORS pre-flight for Apps Script
      body: JSON.stringify({ idToken, notes: n.text, title: n.title, code: n.code, date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!out.ok) throw new Error(out.error || "not sent");
    n.state = "sent";
    try { localStorage.setItem(sentKey(n.sid), "1"); } catch (e) {}
    lsSet(n.sid, "");
    remove(r(`notes/${n.code}/${n.user.uid}`)).catch(() => {});   // emailed — don't keep a copy
  } catch (e) {
    n.state = "failed"; n.err = "Couldn't email your notes — copy them below so you don't lose them.";
  }
  onChange();
}

/** Line for the "lesson has ended" card. */
export function endedNotesHtml() {
  if (!N || N.state === "none" || (!N.text.trim() && N.state !== "sent")) return "";
  if (N.state === "sent") return `<p class="banner ok">✉ Your notes have been emailed to <b>${esc(N.user.email)}</b>.</p>`;
  if (N.state === "failed") return `<div class="banner bad">${esc(N.err)}</div>
    <textarea class="notes-copy" readonly>${esc(N.text)}</textarea><button class="btn" id="notesCopy" type="button">Copy my notes</button>`;
  return `<p class="banner info">Emailing your notes…</p>`;
}
export function wireEnded() {
  const b = document.getElementById("notesCopy");
  if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(N.text); b.textContent = "Copied ✓"; } catch (e) { const t = document.querySelector(".notes-copy"); if (t) { t.select(); document.execCommand("copy"); b.textContent = "Copied ✓"; } } };
}
