// Question builder: fill in a form, get a question slide in the Live Lessons deck format.
//  • HTML deck: choose the deck on your computer, pick where the question goes, add one or more
//    questions, download the updated deck (the file never leaves your computer).
//  • PDF lesson: builds the question file (*.hinges.json) to upload alongside the PDF.
// The slide markup matches the AS-style hinge slides and one-word slides that questions.js detects.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().split(/\s+/).slice(0, 4).join("-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
const L = ["A", "B", "C", "D"];

const deck = { name: "", text: "", css: "", slides: [], ids: new Set(), added: [], cls: "" };   // added: [{after, html, id, label}]
const pdf = { list: [] };
let mode = "html";   // "html" | "pdf"
let qtype = "mcq";   // "mcq" | "word"

/* ---------------- reading the deck ---------------- */
function slideSpans(text) {
  // each slide: <section ... class="slide ..."> … </section> (slides don't nest)
  const out = [], re = /<section\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*>/g;
  let m;
  while ((m = re.exec(text))) {
    const end = text.indexOf("</section>", m.index);
    if (end < 0) break;
    out.push({ start: m.index, end: end + "</section>".length, open: m[0] });
    re.lastIndex = end;
  }
  return out;
}
function attr(tag, name) { const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag); return m ? m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">") : ""; }

async function loadDeck(file) {
  const text = await file.text();
  const spans = slideSpans(text);
  if (!spans.length || !/id="stage"/.test(text)) throw new Error("This doesn't look like one of the interactive decks (no slides found).");
  deck.name = file.name; deck.text = text; deck.added = [];
  deck.slides = spans.map((s, i) => ({ n: i + 1, title: attr(s.open, "data-title") || `Slide ${i + 1}`, foot: attr(s.open, "data-foot"), hinge: /\bhinge\b/.test(attr(s.open, "class")) || /data-q="word"/.test(s.open) }));
  // class size the deck's own hinge tally uses ("n of 8 boards"): copy the deck's most common value
  const sizes = [...text.matchAll(/data-class="(\d+)"/g)].map((m) => m[1]);
  deck.cls = sizes.sort((a, b) => sizes.filter((x) => x === b).length - sizes.filter((x) => x === a).length)[0] || "";
  deck.ids = new Set([...text.matchAll(/data-(?:hinge|qid|timer-id)="([^"]*)"/g)].map((m) => m[1]));
  const head = text.slice(0, text.indexOf("</head>") > 0 ? text.indexOf("</head>") : 0);
  deck.css = [...head.matchAll(/<style\b[\s\S]*?<\/style>|<link\b[^>]*rel="stylesheet"[^>]*>/g)].map((m) => m[0]).join("\n");
  const sel = $("#after");
  sel.innerHTML = deck.slides.map((s) => `<option value="${s.n}">${s.n} · ${esc(s.title)}${s.hinge ? "  (question)" : ""}</option>`).join("");
  sel.value = String(Math.min(deck.slides.length, Math.max(1, Math.round(deck.slides.length / 2))));
  const qs = deck.slides.filter((s) => s.hinge).length;
  $("#deckInfo").innerHTML = `✅ <b>${esc(file.name)}</b> · ${deck.slides.length} slides · ${qs} question slide${qs === 1 ? "" : "s"} already`;
  $("#deckPick").classList.remove("hidden");
  fillTopic(); render();
}
function fillTopic() {
  const t = $("#topic");
  if (t.dataset.touched) return;
  // the chosen slide's footer topic, or the nearest earlier slide that has one
  for (let i = (+$("#after").value || 1) - 1; i >= 0; i--) { const f = deck.slides[i] && deck.slides[i].foot; if (f) { t.value = f.split(" · ")[0]; return; } }
  t.value = "";
}

/* ---------------- the form ---------------- */
function readForm() {
  const prompt = $("#prompt").value.trim();
  const id = ($("#qid").value.trim() || slug(prompt) || "Q").replace(/[^A-Za-z0-9_-]/g, "-");
  const topic = $("#topic").value.trim(), time = Math.max(10, Math.min(600, +$("#time").value || (qtype === "word" ? 45 : 30)));
  if (qtype === "word") {
    return { type: "word", id, prompt, topic, time, accept: $("#accept").value.split(/[,|\n]/).map((s) => s.trim()).filter(Boolean), explain: $("#wexplain").value.trim() };
  }
  const opts = L.map((k, i) => ({ k, text: $(`#o${i}`).value.trim(), why: $(`#w${i}`).value.trim(), mc: $(`#m${i}`).value.trim() })).filter((o) => o.text);
  const correct = (document.querySelector('input[name="right"]:checked') || {}).value || "";
  return { type: "mcq", id, prompt, topic, time, opts, correct, code: $("#isCode").checked, decide: $("#decide").value.trim() };
}
function problems(q) {
  const p = [];
  if (!q.prompt) p.push("Write the question.");
  if (q.type === "word") { if (!q.accept.length) p.push("Add at least one accepted answer."); }
  else {
    if (q.opts.length < 2) p.push("Fill in at least two options.");
    if (!q.correct) p.push("Choose which option is right.");
    else if (!q.opts.find((o) => o.k === q.correct)) p.push("The right answer must be one of the options you filled in.");
    const order = q.opts.map((o) => o.k).join("");
    if (order !== L.slice(0, q.opts.length).join("")) p.push("Fill the options in order, A first (no gaps).");
    q.opts.filter((o) => o.k !== q.correct && !o.why).forEach((o) => p.push(`Say why ${o.k} is wrong. Students see this as "Why not ${o.k}".`));
  }
  if (mode === "html" && deck.text) {
    const taken = new Set([...deck.ids, ...deck.added.map((a) => a.id)]);
    if (taken.has(q.id)) p.push(`The ID "${q.id}" is already used in this deck. Change the ID.`);
  }
  if (mode === "pdf") {
    if (pdf.list.some((h) => h.id === q.id)) p.push(`The ID "${q.id}" is already in this question file. Change the ID.`);
    const a = +$("#afterNum").value;
    if (!Number.isInteger(a) || a < 0) p.push("Say which slide the question comes after (a number, 0 = before slide 1).");
  }
  return p;
}

/* ---------------- slide markup (same format as the decks) ---------------- */
function hingeSlide(q) {
  const ans = L.indexOf(q.correct);
  const mc = {};
  q.opts.forEach((o) => { if (o.k !== q.correct && o.mc) mc[o.k] = o.mc; });
  const short = q.prompt.length > 48 ? q.prompt.slice(0, 47).trim() + "…" : q.prompt;
  const opts = q.opts.map((o, i) => `<div class="hopt${o.k === q.correct ? " right" : ""}" data-opt="${i}">
      <span class="hl">${o.k}</span><div class="ht"><p class="${q.code ? "mono" : ""}">${esc(o.text)}</p>${o.k === q.correct
        ? `<p class="why ok" data-step="3" data-fx="fade">✓ Correct</p>`
        : `<p class="why" data-step="3" data-fx="fade">${esc(o.why)}</p>`}</div>
      <div class="tally"><button class="tb" data-d="-1" aria-label="One fewer ${o.k}">−</button><span class="tc">0</span><button class="tb" data-d="1" aria-label="One more ${o.k}">+</button></div></div>`).join("");
  return `<section class="slide hinge" data-title="${esc("Hinge · " + short)}" data-foot="${esc((q.topic ? q.topic + " · " : "") + "Hinge question")}" data-hinge="${esc(q.id)}" data-ans="${ans}" data-q="${esc(q.prompt)}"${Object.keys(mc).length ? ` data-mc='${esc(JSON.stringify(mc)).replace(/'/g, "&#39;")}'` : ""} data-class="${esc(deck.cls)}">

  <div class="hd"><div class="tags"><span class="tag green">Hinge question</span><span class="tag navy">Mini-whiteboards · write ONE letter</span><button class="timer" data-timer-id="${esc("h-" + q.id)}" data-seconds="${q.time}" data-start-at="1" aria-label="Timer"><span class="t-ico">▶</span><span class="t-time">${fmt(q.time)}</span></button></div>
  <h2 class="hq">${esc(q.prompt)}</h2></div>
  <div class="body hbody">
  <div class="hopts">${opts}</div>
  <div class="hbar"><span class="up" data-step="2" data-fx="pop">Whiteboards UP! ✋</span><span class="hres" data-step="3" data-fx="fade"></span><span class="hflag" data-step="3"></span></div>
  <div class="call hdec" data-step="4"><span class="ico">★</span><div><b class="verdict">Decide</b><p>${esc(q.decide || "If many chose a wrong option, re-teach that point before moving on.")}</p></div></div></div>
</section>`;
}
function wordSlide(q) {
  const short = q.prompt.length > 48 ? q.prompt.slice(0, 47).trim() + "…" : q.prompt;
  return `<section class="slide" data-title="${esc("One word · " + short)}" data-foot="${esc((q.topic ? q.topic + " · " : "") + "One word")}" data-q="word" data-qid="${esc(q.id)}" data-accept="${esc(q.accept.join("|"))}" data-time="${q.time}"${q.explain ? ` data-explain="${esc(q.explain)}"` : ""}>

  <div class="hd"><div class="tags"><span class="tag green">One word</span><span class="tag navy">Type ONE word on your device</span><button class="timer" data-timer-id="${esc("w-" + q.id)}" data-seconds="${q.time}" aria-label="Timer"><span class="t-ico">▶</span><span class="t-time">${fmt(q.time)}</span></button></div>
  <h2 class="hq" data-prompt>${esc(q.prompt)}</h2></div>
  <div class="body">
  <div class="wq-area" style="flex:1;min-height:420px;border:4px dashed rgba(29,51,80,.25);border-radius:28px;display:flex;align-items:center;justify-content:center;font-size:40px;color:rgba(29,51,80,.45)">Words appear here</div>
  <div class="call" data-step="1" data-fx="fade"><span class="ico">★</span><div><b>Accepted answers</b><p>${esc(q.accept.join(", "))}${q.explain ? " · " + esc(q.explain) : ""}</p></div></div></div>
</section>`;
}
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const slideFor = (q) => (q.type === "word" ? wordSlide(q) : hingeSlide(q));

/* for PDF lessons: one entry of the question file */
function jsonEntry(q) {
  const after = +$("#afterNum").value;
  if (q.type === "word") return { id: q.id, type: "word", after, prompt: q.prompt, accept: q.accept, time: q.time, ...(q.explain ? { explain: q.explain } : {}) };
  const options = {}, notes = {}, misconceptions = {};
  q.opts.forEach((o) => { options[o.k] = o.text; if (o.k !== q.correct) { notes[o.k] = o.why; if (o.mc) misconceptions[o.k] = o.mc; } });
  return { id: q.id, after, prompt: q.prompt, options, correct: q.correct, notes, misconceptions, time: q.time, ...(q.decide ? { explain: q.decide } : {}) };
}

/* ---------------- preview ---------------- */
let previewT = null;
function render() {
  clearTimeout(previewT); previewT = setTimeout(renderNow, 120);
}
function renderNow() {
  document.body.dataset.mode = mode; document.body.dataset.qtype = qtype;
  const q = readForm(), p = problems(q);
  $("#problems").innerHTML = p.length ? p.map((x) => `<li>${esc(x)}</li>`).join("") : "";
  $("#problems").classList.toggle("hidden", !p.length);
  $("#addBtn").disabled = !!p.length || (mode === "html" && !deck.text);
  $("#addBtn").textContent = mode === "html" ? "Add to the deck" : "Add to the question file";
  $("#copyBtn").disabled = !!p.length;
  $("#qidHint").textContent = $("#qid").value.trim() ? "" : `Will be: ${q.id}`;
  // the wrong options need a "why"; the right one doesn't
  L.forEach((k, i) => { const right = q.correct === k; $(`#w${i}`).closest(".wrong").classList.toggle("hidden", right); });
  const show = $("#showAns").checked;
  const html = slideFor(q);
  const frame = $("#preview");
  const css = deck.css || `<style>${FALLBACK_CSS}</style>`;
  frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8">${css}<style>html,body{margin:0;height:100%;overflow:hidden;background:#0e1b2a}#viewport{position:fixed;inset:0}#stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0}[data-step]{transition:none!important}</style></head>
<body><div id="viewport"><div id="stage">${html.replace('class="slide', 'class="slide active')}</div></div>
<script>(function(){var vp=document.getElementById('viewport'),st=document.getElementById('stage');function fit(){var w=vp.clientWidth,h=vp.clientHeight,s=Math.min(w/1920,h/1080);st.style.transform='translate('+(w-1920*s)/2+'px,'+(h-1080*s)/2+'px) scale('+s+')';}addEventListener('resize',fit);fit();
${show ? "document.querySelectorAll('[data-step]').forEach(function(e){e.classList.add('shown')});" : ""}})();<\/script></body></html>`;
  $("#previewNote").textContent = deck.css ? "Preview in your deck's own style." : "Choose a deck to preview in its own style (this is a plain preview).";
  renderAdded();
}
// a plain look for the preview when no deck is loaded
const FALLBACK_CSS = `#stage{background:#FAF6EF;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d3350}
.slide{position:absolute;inset:0;display:flex;flex-direction:column;gap:30px;padding:80px 110px}
.tags{display:flex;gap:14px;align-items:center}.tag{font:700 26px sans-serif;padding:8px 18px;border-radius:99px;background:#e6efe9;color:#1C7A55}.tag.navy{background:#e3e8f0;color:#1d3350}
.timer{font:700 26px monospace;border:0;border-radius:99px;padding:8px 16px;background:#1d3350;color:#fff}
.hq{font-size:54px;line-height:1.2;margin:16px 0 0}.hopts{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.hopt{display:flex;gap:18px;align-items:flex-start;background:#fff;border:3px solid #e2d9ca;border-radius:22px;padding:20px 24px;font-size:34px}
.hl{flex:none;width:58px;height:58px;border-radius:14px;background:#1d3350;color:#fff;display:grid;place-items:center;font-weight:800}
.ht{flex:1}.ht p{margin:0}.why{font-size:26px;color:#B4372B;margin-top:8px!important}.why.ok{color:#1C7A55}.mono{font-family:monospace}
.tally{display:none}.hbar{display:flex;gap:24px;font-size:30px;font-weight:700}.call{display:flex;gap:16px;font-size:30px;background:#fff6e8;border-radius:18px;padding:18px 24px}
.call p{margin:6px 0 0}[data-step]{opacity:0}[data-step].shown{opacity:1}.slide:has(.hflag.shown) .hopt.right{border-color:#1C7A55;background:#e6f4ec}`;

/* ---------------- adding + downloading ---------------- */
function renderAdded() {
  const el = $("#added");
  if (mode === "html") {
    el.innerHTML = deck.added.length ? `<h3>Added to ${esc(deck.name)}</h3><ol>${deck.added.map((a, i) => `<li>After slide ${a.after}: ${esc(a.label)} <button class="btn ghost small" data-rm="${i}">Remove</button></li>`).join("")}</ol>` : "";
    $("#dlDeck").classList.toggle("hidden", !deck.added.length);
    $("#dlJson").classList.add("hidden");
  } else {
    el.innerHTML = pdf.list.length ? `<h3>In the question file</h3><ol>${pdf.list.map((h, i) => `<li>After slide ${h.after}: ${esc(h.prompt.slice(0, 70))} <button class="btn ghost small" data-rm="${i}">Remove</button></li>`).join("")}</ol>` : "";
    $("#dlJson").classList.toggle("hidden", !pdf.list.length);
    $("#dlDeck").classList.add("hidden");
  }
}
function add() {
  const q = readForm(); if (problems(q).length) return;
  if (mode === "html") deck.added.push({ after: +$("#after").value, html: slideFor(q), id: q.id, label: (q.type === "word" ? "One word · " : "Hinge · ") + q.prompt.slice(0, 70) });
  else pdf.list.push(jsonEntry(q));
  renderAdded();
  toast(mode === "html" ? "Added. Add another, or download the updated deck." : "Added. Add another, or download the question file.");
  clearForm();
}
function clearForm() {
  ["prompt", "qid", "accept", "wexplain", "decide", ...L.flatMap((_, i) => [`o${i}`, `w${i}`, `m${i}`])].forEach((id) => ($("#" + id).value = ""));
  document.querySelectorAll('input[name="right"]').forEach((r) => (r.checked = false));
  render();
}
/** The deck with the new slides inserted after the chosen slides (everything else unchanged). */
export function insertSlides(text, added) {
  const spans = slideSpans(text);
  const byAfter = {};
  added.forEach((a) => (byAfter[a.after] = (byAfter[a.after] || []).concat(a.html)));
  let out = "", pos = 0;
  spans.forEach((s, i) => {
    const extra = byAfter[i + 1];
    if (!extra) return;
    out += text.slice(pos, s.end) + "\n\n" + extra.join("\n\n");
    pos = s.end;
  });
  return out + text.slice(pos);
}
function save(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

/* ---------------- wiring ---------------- */
export function init() {
  document.querySelectorAll('input[name="mode"]').forEach((r) => (r.onchange = () => { mode = r.value; render(); }));
  document.querySelectorAll('input[name="qtype"]').forEach((r) => (r.onchange = () => { qtype = r.value; if (!$("#time").dataset.touched) $("#time").value = qtype === "word" ? 45 : 30; render(); }));
  $("#deckFile").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await loadDeck(f); } catch (err) { $("#deckInfo").innerHTML = `<span class="bad">❌ ${esc(err.message)}</span>`; } };
  $("#after").onchange = () => { fillTopic(); render(); };
  $("#topic").oninput = () => { $("#topic").dataset.touched = "1"; render(); };
  $("#time").oninput = () => { $("#time").dataset.touched = "1"; render(); };
  document.querySelector("main").addEventListener("input", render);
  document.querySelector("main").addEventListener("change", render);
  $("#addBtn").onclick = add;
  $("#copyBtn").onclick = async () => {
    const q = readForm(), text = mode === "html" ? slideFor(q) : JSON.stringify(jsonEntry(q), null, 2);
    try { await navigator.clipboard.writeText(text); toast("Copied."); } catch (e) { toast("Couldn't copy. Your browser blocked it."); }
  };
  $("#added").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    (mode === "html" ? deck.added : pdf.list).splice(+b.dataset.rm, 1); render();
  });
  $("#dlDeck").onclick = () => save(deck.name.replace(/(\.html?)?$/i, "") + " (with questions).html", insertSlides(deck.text, deck.added), "text/html");
  $("#dlJson").onclick = () => save("questions.hinges.json", JSON.stringify({ hinges: pdf.list }, null, 2), "application/json");
  render();
}
