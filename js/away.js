// "Left the lesson page" during a live lesson (switched tab or app, or locked the screen).
//  • Students are told up front that the teacher can see this.
//  • Each absence of 10 seconds or more is added to away/<code>/<uid> {w: total seconds, k: times, a: away since}.
//    Only the teacher can read it; the student writes their own.
//  • When the student comes back, they see a nudge saying how long they were away.
// A browser can't see a second window beside the lesson or another device, and a screen that locks
// by itself counts as away, so this is a prompt for a conversation, not proof.
import { r, read, set, serverTimestamp } from "./fb.js";

export const AWAY_MIN = 10;   // seconds before an absence counts
let A = null;                 // { code, uid, w, k, hiddenAt, onNudge }

export async function startAway(code, uid, onNudge, serverNow) {
  stopAway();
  A = { code, uid, w: 0, k: 0, hiddenAt: null, onNudge };
  try {
    const v = await read(`away/${code}/${uid}`);
    if (!A || A.code !== code) return;
    if (v) {
      A.w = +v.w || 0; A.k = +v.k || 0;
      // the page was closed while away (phones often do this): count that absence now
      if (v.a) { const secs = Math.round((serverNow() - v.a) / 1000); if (secs >= AWAY_MIN && secs < 4 * 3600) { A.w += secs; A.k++; onNudge(secs); } }
      if (v.a || A.w !== (+v.w || 0)) save();
    }
  } catch (e) {}
  document.addEventListener("visibilitychange", onVis);
  if (document.hidden) onVis();
}
export function stopAway() {
  if (!A) return;
  document.removeEventListener("visibilitychange", onVis);
  A = null;
}
function save(away) {
  const v = { w: Math.min(86400, A.w), k: Math.min(10000, A.k) };
  if (away) v.a = serverTimestamp();
  set(r(`away/${A.code}/${A.uid}`), v).catch(() => {});
}
function onVis() {
  if (!A) return;
  if (document.hidden) {
    if (A.hiddenAt == null) { A.hiddenAt = Date.now(); save(true); }
    return;
  }
  if (A.hiddenAt == null) return;
  const secs = Math.round((Date.now() - A.hiddenAt) / 1000);
  A.hiddenAt = null;
  if (secs >= AWAY_MIN) { A.w += secs; A.k++; A.onNudge(secs); }
  save(false);
}

/** "45 seconds" / "2 min 5 s" */
export function awayText(secs) {
  if (secs < 60) return `${secs} second${secs === 1 ? "" : "s"}`;
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m} min${s ? ` ${s} s` : ""}`;
}
