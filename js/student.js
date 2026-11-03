// Student page: sign in with the school Google account, enter the code, then either
//  • live: follow the teacher's slides and answer questions as they open, or
//  • student-paced: work through the lesson on your own.
import { configured, onUser, signIn, logOut, watch, read, r, set, update, onDisconnect, serverTimestamp, isTeacher } from "./fb.js";
import { SCHOOL_DOMAIN } from "./config.js";
import { $, esc, isCodeLike, cloudHtml, boardHtml, fmtSecs, normS } from "./ui.js";
import { deckView } from "./deckview.js";

const app = $("#app");
const CONF = [[1, "Guessing"], [2, "Not sure"], [3, "Fairly sure"], [4, "Certain"]];
let user = null, code = null, S = null, NOW = null, offset = 0;
let unsub = [], voteSubs = {}, MY = {}, KEYS = {}, keyLoading = {}, pick = {}, sending = {};
let PROG = null, selfPos = 0, selfStep = 0, selfPack = {};

const params = new URLSearchParams(location.search);
const saved = () => { try { return sessionStorage.getItem("ll_code"); } catch (e) { return null; } };
const remember = (c) => { try { c ? sessionStorage.setItem("ll_code", c) : sessionStorage.removeItem("ll_code"); } catch (e) {} };

function screen(html) { mounted = false; app.innerHTML = `<div class="center"><div class="card stack">${html}</div></div>`; }

// live layout: the deck frame stays mounted (re-creating it would reload it), the rest is repainted
let mounted = false, deck = null, deckLesson = null, deckLoading = null;
function paint(mainHtml, showDeck, below = "") {
  if (!mounted || !document.getElementById("main")) {
    app.innerHTML = `<div id="hdr"></div><div class="s-main"><div id="main"></div><div id="deckHost" class="hidden"></div><div id="below"></div></div>`;
    mounted = true; deck = null; deckLesson = null; deckLoading = null;
  }
  $("#hdr").innerHTML = header();
  $("#deckHost").classList.toggle("hidden", !showDeck);
  $("#main").innerHTML = mainHtml;
  $("#below").innerHTML = below;
}
async function ensureDeck(lessonId) {
  if (deck && deckLesson === lessonId) return deck;
  if (deckLoading && deckLesson === lessonId) return deckLoading;
  deckLesson = lessonId;
  deckLoading = read(`shells/${lessonId}`).then((shell) => {
    if (deckLesson !== lessonId || !document.getElementById("deckHost")) return null;
    if (deck) deck.destroy();
    deck = deckView($("#deckHost"), shell || {});
    return deck;
  });
  return deckLoading;
}

if (!configured) {
  screen(`<h2>Not set up yet</h2><p class="muted">Your teacher still needs to add the Firebase settings to <code>js/config.js</code>.</p>`);
} else {
  onUser((u) => {
    user = u;
    stopAll();
    if (!u) return showSignIn();
    const c = (params.get("c") || saved() || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    c ? join(c) : showCode();
  });
}

function showSignIn(msg) {
  screen(`
    <div class="kicker">Live lesson</div>
    <h2>Sign in to join</h2>
    <p class="muted">Use your school Google account${/yourschool/.test(SCHOOL_DOMAIN) ? "" : ` (<b>@${esc(SCHOOL_DOMAIN)}</b>)`}.</p>
    ${msg ? `<div class="banner bad">${esc(msg)}</div>` : ""}
    <button class="btn primary" id="go" style="width:100%">Sign in with Google</button>`);
  $("#go").onclick = async () => { try { await signIn(); } catch (e) { showSignIn(e.message || String(e)); } };
}

function showCode(msg) {
  stopAll(); remember(null);
  screen(`
    <div class="kicker">Live lesson</div>
    <h2>Enter the code on the board</h2>
    ${msg ? `<div class="banner bad">${esc(msg)}</div>` : ""}
    <input id="code" class="code-input" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="····">
    <button class="btn primary" id="go" style="width:100%">Join</button>
    <p class="small muted">Signed in as ${esc(user.email)} · <a href="#" id="out">not you?</a></p>
    ${isTeacher(user) ? `<p class="small"><a href="teacher.html">Open the teacher page →</a></p>` : ""}`);
  const inp = $("#code");
  inp.focus();
  const go = () => { const c = inp.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); if (c.length === 4) join(c); };
  inp.onkeydown = (e) => { if (e.key === "Enter") go(); };
  inp.oninput = () => { if (inp.value.replace(/\s/g, "").length === 4) go(); };
  $("#go").onclick = go;
  $("#out").onclick = (e) => { e.preventDefault(); logOut(); };
}

function stopAll() {
  unsub.forEach((f) => f()); unsub = [];
  Object.values(voteSubs).forEach((f) => f()); voteSubs = {};
  S = NOW = PROG = null; MY = {}; KEYS = {}; keyLoading = {}; pick = {}; sending = {}; selfPack = {};
}

async function join(c) {
  stopAll();
  screen(`<p class="muted">Joining ${esc(c)}…</p>`);
  let lessonId;
  try { lessonId = await read(`sessions/${c}/lessonId`); }
  catch (e) {
    if (/permission/i.test(e.message || e.code || "")) return showSignIn(`${user.email} can't join. Sign in with your school account.`);
    return showCode("Couldn't connect — check the Wi-Fi and try again.");
  }
  if (!lessonId) return showCode(`No lesson with the code ${c}.`);
  code = c; remember(c);

  const name = user.displayName || user.email.split("@")[0];
  set(r(`roster/${user.uid}`), { n: name, e: user.email }).catch(() => {});
  const presRef = r(`presence/${c}/${user.uid}`);
  unsub.push(watch(".info/connected", (on) => {
    if (!on) return;
    onDisconnect(presRef).remove().then(() => set(presRef, { n: name, t: serverTimestamp() })).catch(() => {});
  }));
  unsub.push(watch(".info/serverTimeOffset", (v) => (offset = +v || 0)));
  unsub.push(watch(`sessions/${c}`, (v) => {
    const first = !S;
    S = normS(v);
    if (!S) return showCode("This lesson was removed.");
    if (S.mode === "self") { if (first) startSelf(); else renderSelf(); return; }
    syncVotes(S.qs ? S.qs.ids : []); loadKeys(); render();
  }, () => showCode("Lost access to this lesson.")));
  unsub.push(watch(`now/${c}`, (v) => { NOW = v; if (S && S.mode !== "self") render(); }));
}

/* ---------------- my answers + keys ---------------- */
function syncVotes(ids) {
  Object.keys(voteSubs).forEach((vk) => { if (!ids.includes(vk)) { voteSubs[vk](); delete voteSubs[vk]; } });
  ids.forEach((vk) => {
    if (voteSubs[vk]) return;
    voteSubs[vk] = watch(`votes/${code}/${vk}/${user.uid}`, (v) => { MY[vk] = v; loadKeys(); rerender(); });
  });
}
const canSeeKey = (vk) => MY[vk] && (S.mode === "self" || S.feedback === "instant" || (S.reveal && S.reveal[vk]));
function loadKeys() {
  if (!S) return;
  Object.keys(voteSubs).forEach((vk) => {
    if (KEYS[vk] || keyLoading[vk] || !canSeeKey(vk)) return;
    keyLoading[vk] = true;
    read(`keys/${code}/${vk}`).then((k) => { k = k || {}; if (k.acc && !Array.isArray(k.acc)) k.acc = Object.values(k.acc); KEYS[vk] = k; rerender(); }).catch(() => {}).finally(() => (keyLoading[vk] = false));
  });
}
const rerender = () => (S && S.mode === "self" ? renderSelf() : render());

async function submit(vk, payload) {
  if (sending[vk]) return;
  sending[vk] = true; rerender();
  try {
    await set(r(`votes/${code}/${vk}/${user.uid}`), { ...payload, t: serverTimestamp() });
  } catch (e) {
    toast(/permission/i.test(e.message || e.code || "") ? "Too late — this question has closed." : "Not sent — check the Wi-Fi and try again.");
  }
  sending[vk] = false; rerender();
}
function toast(msg) { const d = document.createElement("div"); d.className = "toast"; d.textContent = msg; document.body.appendChild(d); setTimeout(() => d.remove(), 3000); }

/* ---------------- header ---------------- */
function header() {
  const me = S && S.scores && S.scores[user.uid];
  const left = liveLeft();
  return `<div class="s-top">
    <span class="title">${esc(S ? S.lessonTitle : "")}</span><span class="spacer"></span>
    ${left != null ? `<span class="pill timer-pill ${left <= 5 ? "warn" : ""}" id="tleft">⏱ ${fmtSecs(left)}</span>` : ""}
    ${me && S.points !== false ? `<span class="pill score">★ ${me.p} · #${me.r}</span>` : ""}
    ${S && S.active && S.mode !== "self" ? `<span class="pill live">Live</span>` : ""}
    <span class="pill">${esc(code)}</span>
  </div>`;
}
function liveLeft() {
  if (!S || S.mode === "self" || !S.qs || !S.open || S.timer === false || !S.qs.openedAt) return null;
  return Math.max(0, Math.ceil((S.qs.openedAt + (S.qs.time || 30) * 1000 - Date.now() - offset) / 1000));
}
setInterval(() => {
  const el = document.getElementById("tleft"), left = liveLeft();
  if (el && left != null) { el.textContent = "⏱ " + fmtSecs(left); el.classList.toggle("warn", left <= 5); }
}, 500);

/* ---------------- question rendering (live + self) ---------------- */
function itemState(vk, open) {
  const mine = MY[vk] || null, key = KEYS[vk];
  const rev = S.reveal && S.reveal[vk];
  const correct = key && key.c ? key.c : rev && rev !== "*" ? rev : null;
  return {
    open, mine, correct, explain: key ? key.x : "", why: key && key.w, accept: key && key.acc, sending: !!sending[vk],
    canChange: S.mode !== "self" && S.feedback === "reveal" && open,
  };
}

function optionsHtml(vk, it, st, compact) {
  const keys = Object.keys(it.options || {});
  const chosen = (st.mine && st.mine.a) || (pick[vk] && pick[vk].a);
  const can = st.open && (!st.mine || st.canChange) && !st.sending;
  return `<div class="s-opts ${compact ? "compact" : ""}">${keys.map((k) => {
    let cls = chosen === k ? "sel" : "";
    if (st.correct && st.mine) cls = k === st.correct ? "correct" : st.mine.a === k ? "wrong" : "";
    return `<button class="s-opt ${cls}" data-vk="${esc(vk)}" data-opt="${esc(k)}" ${can ? "" : "disabled"}><span class="l">${esc(k)}</span><span class="${isCodeLike(it.options[k]) ? "mono" : ""}">${esc(it.options[k])}</span></button>`;
  }).join("")}</div>`;
}

function feedbackHtml(st, it) {
  if (!st.mine) return st.open ? "" : `<div class="fb muted">No answer</div>`;
  if (!st.correct) return `<div class="fb muted">${st.sending ? "Sending…" : st.canChange ? "Sent — you can change it until time's up" : "Answer sent ✓"}</div>`;
  const ok = st.mine.a === st.correct;
  const why = !ok && st.why && st.why[st.mine.a] ? st.why[st.mine.a] : "";
  return `<div class="fb ${ok ? "ok" : "bad"}">${ok ? "✓ Correct" : `✗ The answer is ${esc(st.correct)}${it.options && it.options[st.correct] ? " · " + esc(it.options[st.correct]) : ""}`}${why ? `<span>Why not ${esc(st.mine.a)}: ${esc(why)}</span>` : ""}${st.explain ? `<span>${esc(st.explain)}</span>` : ""}</div>`;
}

function mcqHtml(vk, it, open) {
  const st = itemState(vk, open);
  const conf = it.confidence && st.open && !st.mine && pick[vk] && pick[vk].a;
  return `<div class="s-item ${it.card ? "is-card" : ""}">
    <div class="s-prompt ${it.mono ? "mono" : ""}">${it.card ? `<span class="card-l">${esc(it.card)}</span>` : ""}${esc(it.prompt)}</div>
    ${it.code ? `<div class="code">${esc(it.code)}</div>` : ""}
    ${it.fig ? `<div class="small muted">Look at the diagram on the board.</div>` : ""}
    ${optionsHtml(vk, it, st, !!it.card)}
    ${conf ? `<div><div class="small muted" style="margin:.3rem 0">How sure are you?</div><div class="conf">${CONF.map(([n, t]) => `<button data-conf="${n}" data-vk="${esc(vk)}">${t}</button>`).join("")}</div></div>` : ""}
    ${feedbackHtml(st, it)}
  </div>`;
}

function wordHtml(vk, it, open) {
  const st = itemState(vk, open);
  const can = st.open && (!st.mine || st.canChange);
  const words = (S.cloud && S.cloud[vk]) || [];
  const showCloud = st.mine || !st.open;
  const acc = st.accept || null;
  const okWord = st.mine && acc && acc.map((a) => a.toLowerCase()).includes(String(st.mine.w).toLowerCase());
  return `<div class="s-item">
    <div class="s-prompt">${esc(it.prompt)}</div>
    ${can ? `<form class="wform" data-vk="${esc(vk)}"><input type="text" name="w" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="One word" value="${esc(st.mine ? st.mine.w : "")}"><button class="btn accent" ${st.sending ? "disabled" : ""}>${st.mine ? "Change" : "Send"}</button></form>` : ""}
    ${st.mine ? `<div class="fb ${acc ? (okWord ? "ok" : "bad") : "muted"}">You wrote <b>${esc(st.mine.w)}</b>${acc ? (okWord ? " ✓" : ` · expected: ${esc(acc.join(" / "))}`) : ""}</div>` : ""}
    ${showCloud ? cloudHtml(words, { mine: st.mine && st.mine.w, accept: acc }) : `<p class="small muted">Everyone's words appear here after you send yours.</p>`}
  </div>`;
}

function questionsHtml(type, round, ids, items, openFn, title) {
  const done = ids.filter((vk) => MY[vk]).length;
  const kicker = type === "set" ? `Quick check · ${done}/${ids.length} answered` : type === "word" ? "One word" : "Hinge question";
  return `<div class="stack s-q">
    <div class="kicker">${kicker}${round > 1 ? " · round " + round : ""}</div>
    ${title && type === "set" ? `<h1>${esc(title)}</h1>` : ""}
    ${ids.map((vk) => { const it = items[vk]; if (!it) return ""; return it.type === "word" ? wordHtml(vk, it, openFn(vk)) : mcqHtml(vk, it, openFn(vk)); }).join("")}
  </div>`;
}

function currentItems() { return S.mode === "self" ? S.items || {} : (S.qs && S.qs.items) || {}; }
function wire() {
  app.querySelectorAll(".s-opt[data-vk]").forEach((b) => (b.onclick = () => {
    const vk = b.dataset.vk, it = currentItems()[vk];
    pick[vk] = { a: b.dataset.opt };
    if (it && it.confidence && !MY[vk]) return rerender();
    submit(vk, { a: b.dataset.opt });
  }));
  app.querySelectorAll("[data-conf]").forEach((b) => (b.onclick = () => submit(b.dataset.vk, { a: pick[b.dataset.vk].a, c: +b.dataset.conf })));
  app.querySelectorAll("form.wform").forEach((f) => (f.onsubmit = (e) => {
    e.preventDefault();
    const w = (f.w.value || "").trim().split(/\s+/)[0].slice(0, 30);
    if (w) submit(f.dataset.vk, { w });
  }));
}

/* ---------------- live ---------------- */
function render() {
  if (!S || S.mode === "self") return;
  const me = S.scores && S.scores[user.uid];
  if (!S.active) {
    paint(`<div class="card stack" style="text-align:center"><h2>The lesson has ended</h2>${me && S.points !== false ? `<p>You scored <b>${me.p}</b> points · #${me.r}</p>` : ""}<p class="muted">Thanks for taking part.</p><button class="btn" id="again">Join another lesson</button></div>`, false);
    $("#again").onclick = () => showCode();
    return;
  }
  if (S.board) {
    paint(`<div class="card stack"><div class="kicker">Leaderboard</div>${boardHtml(S.top)}${me ? `<p class="banner info">You: #${me.r} · ${me.p} points</p>` : ""}</div>`, false);
    return;
  }
  const foot = `<p class="small muted" style="text-align:center;margin-top:.6rem">Slide ${S.pos + 1} of ${S.total} · this page follows your teacher's screen</p>`;
  if (S.qs) {
    const qs = S.qs;
    const html = questionsHtml(qs.type, qs.round || 1, qs.ids, qs.items || {}, (vk) => !!(S.open && S.open[vk]), qs.title);
    const waiting = !S.open && qs.ids.some((vk) => MY[vk] && !KEYS[vk] && !(S.reveal && S.reveal[vk]));
    paint(html + (waiting ? `<div class="banner info">Time's up — the answers come up on the board.</div>` : ""), false);
    wire();
    return;
  }
  if (S.kind === "html") {
    const ready = NOW && NOW.pos === S.pos && NOW.html != null;
    paint(ready ? "" : `<div class="card"><p class="muted">Waiting for the slide…</p></div>`, ready, ready ? foot : "");
    if (ready) { const n = NOW; ensureDeck(n.deck).then((v) => v && v.show(n.html, n.step || 0, n.rev)); }
    return;
  }
  const img = NOW && NOW.pos === S.pos ? NOW.img : null;
  paint(`${img ? `<img class="s-slide" src="${img}" alt="Slide ${S.pos + 1}">` : `<div class="card"><p class="muted">Waiting for the slide…</p></div>`}${foot}`, false);
}

/* ---------------- student-paced ---------------- */
const listOf = (x) => (Array.isArray(x) ? x : Object.values(x || {}));
const selfOrder = () => listOf(S.order);
const qidsOf = (it) => (it && it.q ? listOf(it.q.ids) : []);

async function startSelf() {
  PROG = (await read(`progress/${code}/${user.uid}`).catch(() => null)) || {};
  selfPos = Math.min(PROG.pos || 0, Math.max(0, (S.total || 1) - 1));
  selfStep = PROG.step || 0;
  if (PROG.done) selfPos = selfOrder().length;
  renderSelf();
}
function slideData(i) {
  if (selfPack[i] === undefined) selfPack[i] = read(`selfpack/${code}/${i}`).catch(() => null);
  return selfPack[i];
}
function saveProgress(extra = {}) {
  const base = `progress/${code}/${user.uid}`;
  update(r("/"), { [`${base}/pos`]: Math.min(selfPos, selfOrder().length - 1), [`${base}/step`]: selfStep, [`${base}/t`]: serverTimestamp(), ...extra }).catch(() => {});
}
function markSeen(ids) {
  const seen = (PROG.seen = PROG.seen || {});
  const u = {};
  ids.forEach((vk) => { if (!seen[vk]) { u[`progress/${code}/${user.uid}/seen/${vk}`] = serverTimestamp(); seen[vk] = true; } });
  if (Object.keys(u).length) update(r("/"), u).catch(() => {});
}

function renderSelf() {
  if (!S || S.mode !== "self" || !PROG) return;
  const order = selfOrder();
  if (!S.active) {
    paint(`<div class="card stack" style="text-align:center"><h2>This assignment is closed</h2><p class="muted">Ask your teacher if you need more time.</p><button class="btn" id="again">Join another lesson</button></div>`, false);
    $("#again").onclick = () => showCode();
    return;
  }
  if (selfPos >= order.length) return renderSelfDone();
  const it = order[selfPos];
  const qids = qidsOf(it);
  syncVotes(qids); loadKeys();
  if (qids.length) markSeen(qids);
  const allDone = qids.every((vk) => MY[vk]);
  const max = it.t === "html" && !it.q ? it.max || 0 : 0;
  const last = selfPos === order.length - 1 && selfStep >= max;
  const nav = `<div class="row selfnav"><button class="btn" id="sPrev" ${selfPos === 0 && selfStep === 0 ? "disabled" : ""}>◀ Back</button><span class="spacer"></span>
    <span class="small muted">${selfPos + 1} / ${order.length}</span><span class="spacer"></span>
    <button class="btn primary" id="sNext" ${allDone ? "" : "disabled"}>${last ? "Finish" : "Next ▶"}</button></div>`;
  const qsHtml = qids.length
    ? questionsHtml(it.q.type, 1, qids, S.items || {}, (vk) => !MY[vk], it.q.title) + (!allDone ? `<p class="small muted">Answer ${qids.length > 1 ? "all of these" : "this"} to carry on.</p>` : "")
    : "";

  if (it.t === "html") {
    paint("", true, qsHtml + nav);
    slideData(selfPos).then((html) => {
      if (html == null) return;
      ensureDeck(S.shell || S.lessonId).then((v) => {
        if (!v) return;
        if (!it.q) return v.show(html, Math.min(selfStep, it.max || 0), null);
        // question slide: the answers on the slide appear once this student has answered
        const rev = {};
        qids.forEach((vk, j) => { const k = KEYS[vk]; if (k && k.rev) rev["s" + (j + 1)] = k.rev; });
        v.show(html, allDone ? it.max || 0 : 0, rev);
      });
    });
  } else if (it.t === "img") {
    paint("", false, `<div id="selfImg"></div>` + qsHtml + nav);
    slideData(selfPos).then((src) => { const el = $("#selfImg"); if (el && src) el.innerHTML = `<img class="s-slide" src="${src}" alt="">`; });
  } else {
    paint(qsHtml || "", false, nav);
  }
  wire();
  $("#sPrev").onclick = () => selfMove(-1);
  $("#sNext").onclick = () => selfMove(1);
}

function selfMove(d) {
  const order = selfOrder();
  const it = order[selfPos];
  const max = it && it.t === "html" && !it.q ? it.max || 0 : 0;
  if (d > 0) {
    if (selfStep < max) selfStep++;
    else if (selfPos < order.length - 1) { selfPos++; selfStep = 0; }
    else { PROG.done = true; selfPos = order.length; saveProgress({ [`progress/${code}/${user.uid}/done`]: true }); return renderSelfDone(); }
  } else {
    if (selfPos >= order.length) selfPos = order.length - 1;
    if (selfStep > 0) selfStep--;
    else if (selfPos > 0) { selfPos--; const p = order[selfPos]; selfStep = p && p.t === "html" && !p.q ? p.max || 0 : 0; }
  }
  saveProgress();
  renderSelf();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSelfDone() {
  const me = S.scores && S.scores[user.uid];
  paint(`<div class="card stack" style="text-align:center"><div class="kicker">Finished</div><h2>Well done!</h2>
    ${me && S.points !== false ? `<p>You scored <b>${me.p}</b> points · #${me.r}</p>` : ""}
    <p class="muted">Your answers have been saved for your teacher.</p>
    <button class="btn" id="review">Look back through the lesson</button></div>`, false);
  $("#review").onclick = () => { selfPos = 0; selfStep = 0; renderSelf(); };
}
