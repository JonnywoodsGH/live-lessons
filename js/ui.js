// Small shared helpers: escaping, toasts, hinge-question rendering, join links.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "1", "2", "3", "4", "5", "6"];
import { TYPE_NAME, fillParts, blankMarks, splitFill, normText } from "./qtypes.js";

export function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function joinUrl(code) {
  const u = new URL("./", location.href);
  u.search = "?c=" + code;
  return u.href;
}
export const shortJoinUrl = () => new URL("./", location.href).href.replace(/^https?:\/\//, "").replace(/\/$/, "");

export const isCodeLike = (t) => /^[01\s]+$|^(?=.*\d)[0-9A-F\s]{2,}$/.test(String(t || "").trim());
export function optionLetters(q) { return LETTERS.filter((l) => q && q.options && q.options[l] != null && q.options[l] !== ""); }

/** Count votes {uid: {a}} → {A: n, …, total} */
export function tally(votes, letters) {
  const t = { total: 0 };
  letters.forEach((l) => (t[l] = 0));
  // "more than one answer" votes hold several letters ("AC"): each ticked option counts
  Object.values(votes || {}).forEach((v) => {
    const ks = v && v.a ? (String(v.a).length > 1 ? String(v.a).split("") : [v.a]).filter((k) => t[k] != null) : [];
    if (!ks.length) return;
    ks.forEach((k) => t[k]++); t.total++;
  });
  return t;
}

/**
 * The hinge question as a slide (projector + teacher preview).
 * opts: {counts, showResults, reveal, answered, joined, open}
 */
export function hingeSlideHtml(q, opts = {}) {
  const letters = optionLetters(q);
  const counts = opts.counts || { total: 0 };
  const max = Math.max(1, ...letters.map((l) => counts[l] || 0));
  const status = opts.reveal ? "Answer" : opts.open ? "Voting open" : opts.closed ? "Voting closed" : "Get ready";
  return `
  <div class="hinge-slide ${opts.reveal ? "is-reveal" : ""} ${opts.showResults ? "has-results" : ""}">
    <div class="hs-top">
      <span class="hs-kicker">${esc(TYPE_NAME[q.type] || TYPE_NAME.mcq)}${q.round > 1 ? " · round " + q.round : ""}</span>
      <span class="hs-status ${opts.open ? "live" : ""}">${esc(status)}${opts.open || opts.closed ? ` · ${opts.answered || 0}${opts.joined ? " / " + opts.joined : ""} answered` : ""}</span>
    </div>
    <h1 class="hs-prompt">${esc(q.prompt)}</h1>
    ${q.code ? `<div class="hs-code">${esc(q.code)}</div>` : ""}
    ${q.type === "multi" ? `<div class="hs-hint">Tick every right answer</div>` : ""}
    <div class="hs-options n${letters.length} ${q.type === "tile" ? "tiles" : ""}">
      ${letters.map((l) => {
        const n = counts[l] || 0, pct = counts.total ? Math.round((n / counts.total) * 100) : 0;
        const right = opts.reveal && (q.type === "multi" ? String(opts.reveal).includes(l) : l === opts.reveal);
        const cls = opts.reveal ? (right ? "correct" : "dim") : "";
        return `<div class="hs-opt ${cls}">
          <span class="hs-letter">${l}</span>
          <span class="hs-text ${isCodeLike(q.options[l]) ? "mono" : ""}">${esc(q.options[l])}</span>
          ${opts.showResults ? `<span class="hs-bar" style="--w:${(n / max) * 100}%"></span><span class="hs-count">${n} · ${pct}%</span>` : ""}
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

/** Fill in the blanks as a slide (projector + teacher preview). opts: {votes, blanks, showResults, reveal, answered, joined, open} */
export function fillSlideHtml(q, opts = {}) {
  const parts = fillParts(q.prompt), bl = opts.blanks || [];
  const status = opts.reveal ? "Answer" : opts.open ? "Answering" : opts.closed ? "Closed" : "Get ready";
  const sent = parts.map((t, i) => esc(t) + (i < parts.length - 1 ? `<span class="hs-blank">${opts.reveal && bl[i] ? esc(bl[i][0]) : (i + 1)}</span>` : "")).join("");
  return `<div class="hinge-slide ${opts.reveal ? "is-reveal" : ""}">
    <div class="hs-top"><span class="hs-kicker">${esc(TYPE_NAME.fill)}${q.round > 1 ? " · round " + q.round : ""}</span>
      <span class="hs-status ${opts.open ? "live" : ""}">${esc(status)}${opts.open || opts.closed ? ` · ${opts.answered || 0}${opts.joined ? " / " + opts.joined : ""} answered` : ""}</span></div>
    <h1 class="hs-prompt hs-fill">${sent}</h1>
    ${opts.showResults && bl.length ? fillResultsHtml(bl, opts.votes) : ""}
  </div>`;
}
/** Per blank: % right and the most common answers. */
export function fillStats(blanks, votes) {
  const vs = Object.values(votes || {}).filter((v) => v && v.f != null);
  return (blanks || []).map((acc, i) => {
    const m = new Map();
    let right = 0;
    vs.forEach((v) => {
      const w = splitFill(v.f)[i] || "", k = normText(w);
      if (blankMarks([acc], [w].join("|"))[0]) right++;
      if (k) m.set(k, { w: (m.get(k) || {}).w || w.trim(), n: ((m.get(k) || {}).n || 0) + 1, ok: (acc || []).map(normText).includes(k) });
    });
    return { n: vs.length, right, pct: vs.length ? Math.round((100 * right) / vs.length) : null, top: [...m.values()].sort((a, b) => b.n - a.n).slice(0, 5) };
  });
}
export function fillResultsHtml(blanks, votes) {
  return `<div class="hs-fres">${fillStats(blanks, votes).map((b, i) => `<div class="fr"><span class="hs-blank sm">${i + 1}</span><b>${b.pct == null ? "–" : b.pct + "%"}</b>
    <span class="fr-top">${b.top.map((x) => `<span class="${x.ok ? "ok" : ""}">${esc(x.w)} <i>${x.n}</i></span>`).join("")}</span></div>`).join("")}</div>`;
}

export function fmtTime(ms) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
export function ymd(ms) {
  const d = new Date(ms || Date.now());
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/* ---------- word cloud + leaderboard ---------- */
/** Normalise a typed answer for counting: lower case, trim punctuation. */
export const normWord = (w) => String(w || "").trim().toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");

/** Count words from votes {uid: {w}} → [{w, n}] sorted, hidden words removed. */
export function countWords(votes, hidden = {}) {
  const m = new Map(), shown = new Map();
  Object.values(votes || {}).forEach((v) => {
    const k = normWord(v && v.w);
    if (!k || hidden[encodeKey(k)]) return;
    m.set(k, (m.get(k) || 0) + 1);
    if (!shown.has(k)) shown.set(k, String(v.w).trim());
  });
  return [...m.entries()].map(([k, n]) => ({ w: shown.get(k), k, n })).sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));
}
/** Database-safe key for a word. */
export const encodeKey = (s) => String(s).replace(/[.#$\[\]\/%]/g, (c) => "%" + c.charCodeAt(0).toString(16));

/** Word cloud: size by count; the most common answers bold + highlighted. opts: {accept: [..], mine} */
export function cloudHtml(words, opts = {}) {
  if (!words || !words.length) return `<div class="cloud empty">No words yet…</div>`;
  const max = Math.max(...words.map((x) => x.n));
  const top = words.filter((x) => x.n === max && max > 1).map((x) => x.k);
  const acc = (opts.accept || []).map(normWord);
  const list = words.slice(0, 60);
  // interleave so big words sit in the middle
  const arranged = [];
  list.forEach((x, i) => (i % 2 ? arranged.push(x) : arranged.unshift(x)));
  return `<div class="cloud">${arranged.map((x) => {
    const sz = 1 + (max > 1 ? (x.n - 1) / (max - 1) : 0) * 2.2;
    const cls = [top.includes(x.k) ? "top" : "", x.n > 1 ? "multi" : "", acc.includes(x.k) ? "ok" : "", opts.mine && normWord(opts.mine) === x.k ? "mine" : ""].join(" ");
    return `<span class="cw ${cls}" style="--s:${sz.toFixed(2)}" ${opts.hideable ? `data-k="${esc(x.k)}"` : ""}>${esc(x.w)}${x.n > 1 ? `<sup>${x.n}</sup>` : ""}</span>`;
  }).join(" ")}</div>`;
}

export function boardHtml(board, opts = {}) {
  const rows = (board || []).slice(0, opts.limit || 10);
  if (!rows.length) return `<div class="board empty">No points yet</div>`;
  return `<ol class="board">${rows.map((r, i) => `<li class="${i < 3 ? "podium p" + (i + 1) : ""}"><span class="rk">${i + 1}</span><span class="nm">${esc(r.n)}</span><span class="pt">${r.p}</span></li>`).join("")}</ol>`;
}

export const fmtSecs = (s) => (s >= 60 ? Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0") : String(s));

/** The database can hand lists back as {0: …, 1: …}: turn the session's lists back into arrays. */
export function normS(s) {
  if (!s) return s;
  const arr = (x) => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.keys(x).sort((a, b) => a - b).map((k) => x[k]) : x);
  if (s.qs) s.qs.ids = arr(s.qs.ids) || [];
  if (s.top) s.top = arr(s.top);
  if (s.order) { s.order = arr(s.order); s.order.forEach((o) => { if (o && o.q) o.q.ids = arr(o.q.ids) || []; }); }
  if (s.cloud) Object.keys(s.cloud).forEach((k) => (s.cloud[k] = arr(s.cloud[k])));
  return s;
}
