// Small shared helpers: escaping, toasts, hinge-question rendering, join links.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const LETTERS = ["A", "B", "C", "D", "E", "F"];

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
  Object.values(votes || {}).forEach((v) => { if (v && t[v.a] != null) { t[v.a]++; t.total++; } });
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
      <span class="hs-kicker">Hinge question${q.round > 1 ? " · round " + q.round : ""}</span>
      <span class="hs-status ${opts.open ? "live" : ""}">${esc(status)}${opts.open || opts.closed ? ` · ${opts.answered || 0}${opts.joined ? " / " + opts.joined : ""} answered` : ""}</span>
    </div>
    <h1 class="hs-prompt">${esc(q.prompt)}</h1>
    ${q.code ? `<div class="hs-code">${esc(q.code)}</div>` : ""}
    <div class="hs-options n${letters.length}">
      ${letters.map((l) => {
        const n = counts[l] || 0, pct = counts.total ? Math.round((n / counts.total) * 100) : 0;
        const cls = opts.reveal ? (l === opts.reveal ? "correct" : "dim") : "";
        return `<div class="hs-opt ${cls}">
          <span class="hs-letter">${l}</span>
          <span class="hs-text ${isCodeLike(q.options[l]) ? "mono" : ""}">${esc(q.options[l])}</span>
          ${opts.showResults ? `<span class="hs-bar" style="--w:${(n / max) * 100}%"></span><span class="hs-count">${n} · ${pct}%</span>` : ""}
        </div>`;
      }).join("")}
    </div>
  </div>`;
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
