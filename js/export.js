// CSV export of every answer — columns follow the AfL Platform's Responses tab where they overlap,
// so the data sets can sit side by side (same lesson IDs, item IDs and misconception IDs).
import { read } from "./fb.js";
import { loadLesson, baseId } from "./session.js";
import { normWord } from "./ui.js";

const COLS = ["response_id", "timestamp", "session_id", "mode", "join_code", "date", "class", "lesson_id", "item_id", "question_type",
  "round", "student_name", "student_email", "answer", "correct", "misconception_id", "confidence", "time_taken_s", "points",
  "activity", "afl_strategy"];

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const iso = (ms) => (ms ? new Date(ms).toISOString() : "");
const dateOnly = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export async function rowsForSession(s, roster, lessonCache = {}) {
  const lesson = lessonCache[s.lessonId] || (lessonCache[s.lessonId] = await loadLesson(s.lessonId)) || { questions: {}, order: [] };
  const votes = (await read(`votes/${s.code}`)) || {};
  const progress = s.mode === "self" ? (await read(`progress/${s.code}`)) || {} : {};
  const setOf = {};
  (lesson.order || []).forEach((it) => { if (it.q) (it.q.ids || []).forEach((id) => (setOf[id] = it.q.type)); });
  const rows = [];
  const keys = new Set([...Object.keys(votes), ...Object.keys(s.present || {})]);
  [...keys].sort().forEach((vk) => {
    const id = baseId(vk), round = +(String(vk).split("~")[1] || 1);
    const q = (lesson.questions || {})[id] || {};
    const kind = setOf[id] === "set" ? "card" : q.type || "mcq";
    const kv = votes[vk] || {};
    const uids = new Set([...Object.keys(kv), ...Object.keys((s.present || {})[vk] || {})]);
    uids.forEach((uid) => {
      const v = kv[uid], who = roster[uid] || {};
      let ans = "", correct = "", mc = "";
      if (v) {
        if (q.type === "word") {
          ans = v.w || "";
          if (q.accept && q.accept.length) correct = q.accept.map(normWord).includes(normWord(ans)) ? "TRUE" : "FALSE";
        } else {
          ans = v.a || "";
          if (q.correct) { correct = ans === q.correct ? "TRUE" : "FALSE"; if (ans !== q.correct) mc = (q.misconceptions || {})[ans] || ""; }
        }
      }
      const start = s.mode === "self" ? progress[uid] && progress[uid].seen && progress[uid].seen[vk] : (s.opened || {})[vk];
      const secs = v && start && v.t ? Math.max(0, Math.round((v.t - start) / 1000)) : "";
      const pts = v && correct === "TRUE" && s.points !== false ? Math.round(500 + 500 * Math.max(0, 1 - (secs * 1000) / ((q.time || 30) * 1000))) : v ? 0 : "";
      rows.push({
        response_id: `${s.sessionId}-${vk}-${uid}`, timestamp: v ? iso(v.t) : "", session_id: s.sessionId, mode: s.mode || "live",
        join_code: s.code, date: dateOnly(s.startedAt), class: s.cls, lesson_id: s.lessonId, item_id: `${s.lessonId}-${id}`,
        question_type: kind, round, student_name: who.n || "", student_email: who.e || "",
        answer: ans || "(no answer)", correct, misconception_id: mc, confidence: v && v.c ? v.c : "", time_taken_s: secs, points: pts,
        activity: kind === "word" ? "one word" : kind === "card" ? "whole-class check" : "hinge",
        afl_strategy: kind === "word" ? "word cloud" : kind === "card" ? "whole-class response" : "hinge question",
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
