// CSV export of every answer — columns follow the AfL Platform's Responses tab where they overlap,
// so the data sets can sit side by side (same lesson IDs, item IDs and misconception IDs).
import { read } from "./fb.js";
import { loadLesson, baseId } from "./session.js";
import { isRight, answerText, letters } from "./qtypes.js";

const ACTIVITY = {
  word: ["one word", "word cloud"], card: ["whole-class check", "whole-class response"], mcq: ["hinge", "hinge question"],
  multi: ["more than one answer", "hinge question (select all)"], tile: ["select the right tile", "hinge question (tiles)"], fill: ["fill in the blanks", "retrieval (cloze)"],
};

const COLS = ["response_id", "timestamp", "session_id", "mode", "join_code", "date", "class", "lesson_id", "item_id", "question_type",
  "round", "student_name", "student_email", "answer", "correct", "misconception_id", "confidence", "time_taken_s", "points",
  "activity", "afl_strategy", "time_away_s"];

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const iso = (ms) => (ms ? new Date(ms).toISOString() : "");
const dateOnly = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

export async function rowsForSession(s, roster, lessonCache = {}) {
  const lesson = lessonCache[s.lessonId] || (lessonCache[s.lessonId] = await loadLesson(s.lessonId)) || { questions: {}, order: [] };
  const votes = (await read(`votes/${s.code}`)) || {};
  const progress = s.mode === "self" ? (await read(`progress/${s.code}`)) || {} : {};
  // live lessons: the student's total time away from the lesson page (whole lesson, same on each of their rows)
  const away = s.mode !== "self" ? (await read(`away/${s.code}`).catch(() => null)) || {} : {};
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
        ans = answerText(q, v);
        const ok = isRight(q, v);
        if (ok != null) correct = ok ? "TRUE" : "FALSE";
        if (ok === false && q.misconceptions) {
          // the misconception of each wrong option chosen (for "more than one answer", every wrongly ticked one)
          const wrong = q.type === "multi" ? letters(v.a).split("").filter((k) => !letters(q.correct).includes(k)) : [v.a];
          mc = [...new Set(wrong.map((k) => q.misconceptions[k]).filter(Boolean))].join(";");
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
        activity: (ACTIVITY[kind] || ACTIVITY.mcq)[0], afl_strategy: (ACTIVITY[kind] || ACTIVITY.mcq)[1],
        time_away_s: s.mode !== "self" ? (away[uid] && +away[uid].w) || 0 : "",
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
