// Question builder: fill in a form, get a question slide in the Live Lessons deck format.
//  • HTML deck: choose the deck on your computer, pick where the question goes, add one or more
//    questions, download the updated deck (the file never leaves your computer).
//  • PDF lesson: builds the question file (*.hinges.json) to upload alongside the PDF.
// The slide markup matches the AS-style hinge slides and one-word slides that questions.js detects.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => String(s || "").normalize("NFKD").replace(/[^\w\s-]/g, "").trim().split(/\s+/).slice(0, 4).join("-").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
const L = ["A", "B", "C", "D", "E", "F"];
const TL = "ABCDEFGHI".split("");
const NAMES = { mcq: "Hinge", multi: "More than one answer", tile: "Tiles", fill: "Fill in the blanks", word: "One word" };
const DEFAULT_TIME = { mcq: 30, multi: 45, tile: 30, fill: 60, word: 45 };

const deck = { name: "", text: "", css: "", slides: [], ids: new Set(), added: [], cls: "" };   // added: [{after, html, id, label}]
const pdf = { list: [] };
let mode = "html";   // "html" | "pdf"
let qtype = "mcq";   // "mcq" | "multi" | "tile" | "fill" | "word"

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
  deck.slides = spans.map((s, i) => ({ n: i + 1, title: attr(s.open, "data-title") || `Slide ${i + 1}`, foot: attr(s.open, "data-foot"), hinge: /\bhinge\b/.test(attr(s.open, "class")) || /data-q="(word|multi|tile|fill|mcq|set)"/.test(s.open) }));
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
  const topic = $("#topic").value.trim(), time = Math.max(10, Math.min(600, +$("#time").value || DEFAULT_TIME[qtype]));
  if (qtype === "word") {
    return { type: "word", id, prompt, topic, time, accept: $("#accept").value.split(/[,|\n]/).map((s) => s.trim()).filter(Boolean), explain: $("#wexplain").value.trim() };
  }
  if (qtype === "fill") {
    // "The [sensor|sensors] measures …" → parts of the sentence + accepted answers for each blank
    const blanks = [], parts = [];
    let rest = prompt, m;
    const re = /\[([^\]]*)\]/g;
    let last = 0;
    while ((m = re.exec(prompt))) { parts.push(prompt.slice(last, m.index)); blanks.push(m[1].split("|").map((x) => x.trim()).filter(Boolean)); last = m.index + m[0].length; }
    parts.push(prompt.slice(last));
    rest = parts.join("___");
    return { type: "fill", id: ($("#qid").value.trim() || slug(rest.replace(/___/g, " ")) || "Q").replace(/[^A-Za-z0-9_-]/g, "-"), prompt: rest, raw: prompt, parts, blanks, topic, time, explain: $("#fexplain").value.trim() };
  }
  if (qtype === "tile") {
    const tiles = TL.map((k, i) => ({ k, text: $(`#t${i}`).value.trim() })).filter((t) => t.text);
    const correct = (document.querySelector('input[name="rtile"]:checked') || {}).value || "";
    return { type: "tile", id, prompt, topic, time, tiles, correct, explain: $("#texplain").value.trim(), decide: $("#decide").value.trim() };
  }
  const n = qtype === "multi" ? 6 : 4;
  const opts = L.slice(0, n).map((k, i) => ({ k, text: $(`#o${i}`).value.trim(), why: $(`#w${i}`).value.trim(), mc: $(`#m${i}`).value.trim() })).filter((o) => o.text);
  const correct = qtype === "multi"
    ? [...document.querySelectorAll(".rightc:checked")].map((c) => c.value).filter((k) => opts.find((o) => o.k === k)).sort().join("")
    : (document.querySelector('input[name="right"]:checked') || {}).value || "";
  return { type: qtype, id, prompt, topic, time, opts, correct, code: $("#isCode").checked, decide: $("#decide").value.trim() };
}
function problems(q) {
  const p = [];
  if (!q.prompt) p.push("Write the question.");
  if (q.type === "word") { if (!q.accept.length) p.push("Add at least one accepted answer."); }
  else if (q.type === "fill") {
    if (!q.blanks.length) p.push("Put at least one answer in [square brackets] to make a blank.");
    if (q.blanks.length > 6) p.push("Use 6 blanks at most.");
    if (q.blanks.some((b) => !b.length)) p.push("A blank is empty: write the answer inside the [ ].");
    if (/[[\]]/.test(q.prompt)) p.push("A [ or ] is missing its partner.");
    if (!q.prompt.replace(/___/g, "").trim()) p.push("Write some of the sentence around the blanks.");
  } else if (q.type === "tile") {
    if (q.tiles.length < 3) p.push("Fill in at least three tiles.");
    if (q.tiles.map((t) => t.k).join("") !== TL.slice(0, q.tiles.length).join("")) p.push("Fill the tiles in order, A first (no gaps).");
    if (!q.correct) p.push("Choose which tile is right.");
    else if (!q.tiles.find((t) => t.k === q.correct)) p.push("The right tile must be one you filled in.");
  } else if (q.type === "multi") {
    if (q.opts.length < 3) p.push("Fill in at least three options.");
    if (q.opts.map((o) => o.k).join("") !== L.slice(0, q.opts.length).join("")) p.push("Fill the options in order, A first (no gaps).");
    if (!q.correct) p.push("Tick every option that is right (at least one).");
    else if (q.correct.length === q.opts.length) p.push("At least one option should be wrong.");
  } else {
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

/* the newer question slides (class "llq"): they carry their own styling, so they look right in any deck.
   Step 1 shows the answer (and closes answering), step 2 the "Decide" box. */
const LLQ_CSS = `<style>
.llq h2.hq{font-size:46px;line-height:1.2;margin:0}
.llq .lq-body{gap:22px}
.llq .lq-opts{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.llq .lq-opt{position:relative;display:grid;grid-template-columns:64px 1fr auto;gap:18px;align-items:center;background:var(--card,#fff);border:2px solid var(--line,#E0D6C2);border-radius:10px;padding:16px 20px;transition:opacity .4s,border-color .4s,background .4s}
.llq .lq-l{width:64px;height:64px;border-radius:10px;background:var(--navy,#16324F);color:#fff;display:grid;place-items:center;font:800 32px var(--sans,sans-serif)}
.llq.multi .lq-l{box-shadow:inset 0 0 0 6px var(--navy,#16324F),inset 0 0 0 9px #fff}
.llq .lq-t p{margin:0;font-size:30px;line-height:1.3;color:var(--ink,#1F2A37)}
.llq .lq-t p.mono{font-family:var(--mono,monospace)}
.llq .lq-t p.lq-why{font-size:22px;color:var(--red,#B4372B);margin-top:6px}
.llq .lq-t p.lq-why.ok{color:var(--green,#1C7A55);font-weight:700}
.llq .lq-n{min-width:56px;text-align:center;font:800 28px var(--sans,sans-serif);color:var(--navy,#16324F);background:var(--blue-l,#F3F6FA);border:1px solid var(--line,#E0D6C2);border-radius:999px;padding:6px 12px}
.llq:has(.lq-flag.shown) .lq-opt:not(.right){opacity:.55}
.llq:has(.lq-flag.shown) .lq-opt.right{border-color:var(--green,#1C7A55);background:var(--green-l,#E7F3EC)}
.llq:has(.lq-flag.shown) .lq-opt.right .lq-l{background:var(--green,#1C7A55);box-shadow:none}
.llq .lq-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.llq .lq-tiles.n4{grid-template-columns:repeat(2,1fr)}
.llq .lq-tile{grid-template-columns:1fr;justify-items:center;text-align:center;min-height:140px;padding:30px 24px 22px}
.llq .lq-tile .lq-l{position:absolute;left:12px;top:12px;width:40px;height:40px;font-size:20px;border-radius:8px}
.llq .lq-tile .lq-t p{font-size:40px;font-weight:800}
.llq .lq-tile .lq-n{position:absolute;right:12px;top:12px;font-size:22px;min-width:44px;padding:4px 10px}
.llq .lq-bar{display:flex;gap:24px;align-items:center}
.llq .lq-res{font:700 26px var(--sans,sans-serif);color:var(--navy,#16324F)}
.llq .lq-flag{display:none}
.llq .lq-sent{font-size:50px;line-height:1.85;font-weight:600}
.llq .lq-blank{display:inline-block;min-width:230px;margin:0 10px 0 50px;padding:0 14px;border-bottom:6px solid var(--orange,#D96A20);text-align:center;line-height:1.2;position:relative}
.llq .lq-blank::before{content:attr(data-n);position:absolute;left:-40px;top:50%;transform:translateY(-50%);width:30px;height:30px;border-radius:50%;background:var(--orange,#D96A20);color:#fff;font:800 18px/30px var(--sans,sans-serif)}
.llq .lq-bw{color:var(--green,#1C7A55);font-weight:800}
.llq .lq-fres{display:grid;gap:12px;align-content:start}
.llq .lq-fr{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font:600 26px var(--sans,sans-serif);color:var(--ink,#1F2A37)}
.llq .lq-fr b{min-width:80px}
.llq .lq-bn{width:38px;height:38px;border-radius:50%;background:var(--orange,#D96A20);color:#fff;display:grid;place-items:center;font-weight:800}
.llq .lq-chip{background:var(--card,#fff);border:2px solid var(--line,#E0D6C2);border-radius:999px;padding:4px 14px}
.llq .lq-chip.ok{border-color:var(--green,#1C7A55);color:var(--green,#1C7A55);background:var(--green-l,#E7F3EC)}
.llq .lq-chip i{font-style:normal;color:var(--muted,#5F6B7A);margin-left:6px}
.llq .verdict.go{color:var(--green,#1C7A55)}.llq .verdict.stop{color:var(--red,#B4372B)}
</style>`;
const headOf = (q, kind, tag, hint) => `<div class="hd"><div class="tags"><span class="tag green">${tag}</span><span class="tag navy">${hint}</span><button class="timer" data-timer-id="${esc(kind[0] + "-" + q.id)}" data-seconds="${q.time}" aria-label="Timer"><span class="t-ico">▶</span><span class="t-time">${fmt(q.time)}</span></button></div>`;
const decideOf = (q, dflt) => `<div class="call lq-dec" data-step="2" data-fx="fade"><span class="ico">★</span><div><b class="verdict">Decide</b><p>${esc(q.decide || dflt)}</p></div></div>`;
const shortOf = (t) => (t.length > 48 ? t.slice(0, 47).trim() + "…" : t);
function multiSlide(q) {
  const mc = {};
  q.opts.forEach((o) => { if (!q.correct.includes(o.k) && o.mc) mc[o.k] = o.mc; });
  const opts = q.opts.map((o) => { const ok = q.correct.includes(o.k); return `<div class="lq-opt${ok ? " right" : ""}" data-opt="${o.k}"><span class="lq-l">${o.k}</span><div class="lq-t"><p class="t${q.code ? " mono" : ""}">${esc(o.text)}</p>${ok
    ? `<p class="lq-why ok" data-step="1" data-fx="fade">✓ Right</p>` : o.why ? `<p class="lq-why" data-step="1" data-fx="fade">${esc(o.why)}</p>` : ""}</div><span class="lq-n">·</span></div>`; }).join("\n    ");
  return `<section class="slide llq multi" data-title="${esc("More than one answer · " + shortOf(q.prompt))}" data-foot="${esc((q.topic ? q.topic + " · " : "") + "More than one answer")}" data-q="multi" data-qid="${esc(q.id)}" data-correct="${q.correct}" data-time="${q.time}"${Object.keys(mc).length ? ` data-mc='${esc(JSON.stringify(mc)).replace(/'/g, "&#39;")}'` : ""}>
  ${LLQ_CSS}
  ${headOf(q, "multi", "More than one answer", "Tick ALL the right answers on your device")}
  <h2 class="hq" data-prompt>${esc(q.prompt)}</h2></div>
  <div class="body lq-body">
  <div class="lq-opts">
    ${opts}
  </div>
  <div class="lq-bar"><span class="lq-res"></span><span class="lq-flag" data-step="1"></span></div>
  ${decideOf(q, "If many missed one of the right answers, re-teach that one before moving on.")}</div>
</section>`;
}
function tileSlide(q) {
  const tiles = q.tiles.map((t) => `<div class="lq-opt lq-tile${t.k === q.correct ? " right" : ""}" data-opt="${t.k}"><span class="lq-l">${t.k}</span><div class="lq-t"><p class="t">${esc(t.text)}</p></div><span class="lq-n">·</span></div>`).join("\n    ");
  return `<section class="slide llq tile" data-title="${esc("Tiles · " + shortOf(q.prompt))}" data-foot="${esc((q.topic ? q.topic + " · " : "") + "Select the right tile")}" data-q="tile" data-qid="${esc(q.id)}" data-correct="${q.correct}" data-time="${q.time}"${q.explain ? ` data-explain="${esc(q.explain)}"` : ""}>
  ${LLQ_CSS}
  ${headOf(q, "tile", "Select the right tile", "Tap ONE tile on your device")}
  <h2 class="hq" data-prompt>${esc(q.prompt)}</h2></div>
  <div class="body lq-body">
  <div class="lq-tiles n${q.tiles.length}">
    ${tiles}
  </div>
  <div class="lq-bar"><span class="lq-res"></span><span class="lq-flag" data-step="1"></span>${q.explain ? `<span class="lq-res" data-step="1" data-fx="fade" style="font-weight:600">${esc(q.explain)}</span>` : ""}</div>
  ${decideOf(q, "If many chose the same wrong tile, ask why it looks right, then re-teach.")}</div>
</section>`;
}
function fillSlide(q) {
  const sent = q.parts.map((t, i) => esc(t) + (i < q.blanks.length ? `<span class="lq-blank" data-n="${i + 1}"><span class="lq-bw" data-step="1" data-fx="fade">${esc(q.blanks[i][0])}</span></span>` : "")).join("");
  return `<section class="slide llq fill" data-title="${esc("Fill in the blanks · " + shortOf(q.prompt.replace(/___/g, "…")))}" data-foot="${esc((q.topic ? q.topic + " · " : "") + "Fill in the blanks")}" data-q="fill" data-qid="${esc(q.id)}" data-accept="${esc(q.blanks.map((b) => b.join("|")).join(";"))}" data-time="${q.time}"${q.explain ? ` data-explain="${esc(q.explain)}"` : ""}>
  ${LLQ_CSS}
  ${headOf(q, "fill", "Fill in the blanks", "Type the missing words on your device")}
  </div>
  <div class="body lq-body">
  <h2 class="hq lq-sent" data-prompt>${sent}</h2>
  <div class="lq-bar"><span class="lq-res"></span><span class="lq-flag" data-step="1"></span>${q.explain ? `<span class="lq-res" data-step="1" data-fx="fade" style="font-weight:600">${esc(q.explain)}</span>` : ""}</div>
  <div class="lq-fres"></div>
  ${decideOf(q, "Re-teach the blank most students missed, then ask again.")}</div>
</section>`;
}
const slideFor = (q) => ({ word: wordSlide, multi: multiSlide, tile: tileSlide, fill: fillSlide }[q.type] || hingeSlide)(q);

/* for PDF lessons: one entry of the question file */
function jsonEntry(q) {
  const after = +$("#afterNum").value;
  if (q.type === "word") return { id: q.id, type: "word", after, prompt: q.prompt, accept: q.accept, time: q.time, ...(q.explain ? { explain: q.explain } : {}) };
  if (q.type === "fill") return { id: q.id, type: "fill", after, prompt: q.prompt, blanks: q.blanks, time: q.time, ...(q.explain ? { explain: q.explain } : {}) };
  if (q.type === "tile") return { id: q.id, type: "tile", after, prompt: q.prompt, options: Object.fromEntries(q.tiles.map((t) => [t.k, t.text])), correct: q.correct, time: q.time, ...(q.explain ? { explain: q.explain } : {}) };
  const options = {}, notes = {}, misconceptions = {};
  q.opts.forEach((o) => { options[o.k] = o.text; if (!q.correct.includes(o.k)) { if (o.why) notes[o.k] = o.why; if (o.mc) misconceptions[o.k] = o.mc; } });
  return { id: q.id, ...(q.type === "multi" ? { type: "multi" } : {}), after, prompt: q.prompt, options, correct: q.correct, notes, misconceptions, time: q.time, ...(q.decide ? { explain: q.decide } : {}) };
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
  // the wrong options need a "why"; the right one(s) don't
  L.forEach((k, i) => { const right = !!q.correct && (q.type === "multi" ? q.correct.includes(k) : q.correct === k); $(`#w${i}`).closest(".wrong").classList.toggle("hidden", right); });
  $("#prompt").placeholder = qtype === "fill" ? "e.g. The [sensor|sensors] measures the temperature and the [actuator] switches the heater." : "e.g. Which memory loses its contents when the power is turned off?";
  if (q.type === "fill") $("#fillInfo").textContent = q.blanks.length ? `${q.blanks.length} blank${q.blanks.length > 1 ? "s" : ""}: ${q.blanks.map((b, i) => `${i + 1}) ${b.join(" / ") || "?"}`).join("   ")}` : "No blanks yet.";
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
  if (mode === "html") deck.added.push({ after: +$("#after").value, html: slideFor(q), id: q.id, label: NAMES[q.type] + " · " + q.prompt.slice(0, 70) });
  else pdf.list.push(jsonEntry(q));
  renderAdded();
  toast(mode === "html" ? "Added. Add another, or download the updated deck." : "Added. Add another, or download the question file.");
  clearForm();
}
function clearForm() {
  ["prompt", "qid", "accept", "wexplain", "texplain", "fexplain", "decide", ...L.flatMap((_, i) => [`o${i}`, `w${i}`, `m${i}`]), ...TL.map((_, i) => `t${i}`)].forEach((id) => ($("#" + id).value = ""));
  document.querySelectorAll('input[name="right"], input[name="rtile"], .rightc').forEach((r) => (r.checked = false));
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
  document.querySelectorAll('input[name="qtype"]').forEach((r) => (r.onchange = () => { qtype = r.value; if (!$("#time").dataset.touched) $("#time").value = DEFAULT_TIME[qtype]; render(); }));
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
