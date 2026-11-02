// CSV export of hinge responses — columns follow the AfL Platform's Responses tab where they overlap,
// so the two data sets can sit side by side (same lesson IDs, item IDs and misconception IDs).
import { read } from "./fb.js";

const COLS = ["response_id", "timestamp", "session_id", "join_code", "date", "class", "lesson_id", "item_id", "round",
  "student_name", "student_email", "answer", "correct", "misconception_id", "confidence", "time_taken_s",
  "activity", "afl_strategy"];

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const iso = (ms) => (ms ? new Date(ms).toISOString() : "");
const dateOnly = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export async function rowsForSession(s, roster, lessonCache = {}) {
  const lesson = lessonCache[s.lessonId] || (lessonCache[s.lessonId] = await read(`lessons/${s.lessonId}`)) || { hinges: {} };
  const votes = (await read(`votes/${s.code}`)) || {};
  const rows = [];
  const keys = new Set([...Object.keys(votes), ...Object.keys(s.present || {})]);
  [...keys].sort().forEach((key) => {
    const [hid, roundStr] = key.split("~");
    const round = +(roundStr || 1);
    const h = (lesson.hinges || {})[hid] || {};
    const openedAt = (s.opened || {})[key];
    const kv = votes[key] || {};
    const uids = new Set([...Object.keys(kv), ...Object.keys((s.present || {})[key] || {})]);
    uids.forEach((uid) => {
      const v = kv[uid];
      const who = roster[uid] || {};
      const ans = v ? v.a : "";
      const correct = v ? (h.correct ? (ans === h.correct ? "TRUE" : "FALSE") : "") : "";
      const mc = v && h.correct && ans !== h.correct ? ((h.misconceptions || {})[ans] || "") : "";
      rows.push({
        response_id: `${s.sessionId}-${key}-${uid}`,
        timestamp: v ? iso(v.t) : "",
        session_id: s.sessionId, join_code: s.code, date: dateOnly(s.startedAt), class: s.cls, lesson_id: s.lessonId,
        item_id: `${s.lessonId}-${hid}`, round,
        student_name: who.n || "", student_email: who.e || "",
        answer: ans || "(no answer)", correct, misconception_id: mc, confidence: v && v.c ? v.c : "",
        time_taken_s: v && openedAt && v.t ? Math.max(0, Math.round((v.t - openedAt) / 1000)) : "",
        activity: "hinge", afl_strategy: "hinge question",
      });
    });
  });
  return rows;
}

export function toCsv(rows) {
  return [COLS.join(","), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(","))].join("\n");
}

export function download(filename, text) {
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
