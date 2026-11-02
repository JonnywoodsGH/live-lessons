// Student page: sign in with the school Google account, enter the code, follow the slides, answer hinge questions.
import { configured, auth, onUser, signIn, logOut, watch, read, r, set, onDisconnect, serverTimestamp, isTeacher } from "./fb.js";
import { SCHOOL_DOMAIN } from "./config.js";
import { $, esc, optionLetters, isCodeLike } from "./ui.js";

const app = $("#app");
const CONF = [[1, "Guessing"], [2, "Not sure"], [3, "Fairly sure"], [4, "Certain"]];
let user = null, code = null;
let S = null, NOW = null, MYVOTE = null;           // live data
let unsub = [], unsubVote = null, voteKey = null;
let pick = { key: null, a: null, c: null, sending: false };

const params = new URLSearchParams(location.search);
const saved = () => { try { return sessionStorage.getItem("ll_code"); } catch (e) { return null; } };
const remember = (c) => { try { c ? sessionStorage.setItem("ll_code", c) : sessionStorage.removeItem("ll_code"); } catch (e) {} };

function screen(html) { app.innerHTML = `<div class="center"><div class="card stack">${html}</div></div>`; }

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
  $("#go").onclick = async () => {
    try { await signIn(); } catch (e) { showSignIn(e.message || String(e)); }
  };
}

function showCode(msg) {
  stopAll(); remember(null);
  screen(`
    <div class="kicker">Live lesson</div>
    <h2>Enter the code on the board</h2>
    ${msg ? `<div class="banner bad">${esc(msg)}</div>` : ""}
    <input id="code" class="code-input" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="····" inputmode="text">
    <button class="btn primary" id="go" style="width:100%">Join</button>
    <p class="small muted">Signed in as ${esc(user.email)} · <a href="#" id="out">not you?</a></p>`);
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
  if (unsubVote) { unsubVote(); unsubVote = null; voteKey = null; }
  S = NOW = MYVOTE = null;
}

async function join(c) {
  stopAll();
  screen(`<p class="muted">Joining ${esc(c)}…</p>`);
  let lessonId;
  try { lessonId = await read(`sessions/${c}/lessonId`); }
  catch (e) {
    if (/permission/i.test(e.message || e.code || "")) {
      return showSignIn(`${user.email} can't join. Sign in with your school account.`);
    }
    return showCode("Couldn't connect — check the Wi-Fi and try again.");
  }
  if (!lessonId) return showCode(`No lesson with the code ${c}.`);
  code = c; remember(c);

  // who I am (teacher sees names) + "I'm here" while the page is open
  const name = user.displayName || user.email.split("@")[0];
  set(r(`roster/${user.uid}`), { n: name, e: user.email }).catch(() => {});
  const presRef = r(`presence/${c}/${user.uid}`);
  unsub.push(watch(".info/connected", (on) => {
    if (!on) return;
    onDisconnect(presRef).remove().then(() => set(presRef, { n: name, t: serverTimestamp() })).catch(() => {});
  }));

  unsub.push(watch(`sessions/${c}`, (v) => { S = v; syncVote(); render(); }, () => showCode("Lost access to this lesson.")));
  unsub.push(watch(`now/${c}`, (v) => { NOW = v; render(); }));
}

function syncVote() {
  const key = S && S.q ? S.q.key : null;
  if (key === voteKey) return;
  if (unsubVote) unsubVote();
  unsubVote = null; voteKey = key; MYVOTE = null;
  if (pick.key !== key) pick = { key, a: null, c: null, sending: false };
  if (key) unsubVote = watch(`votes/${code}/${key}/${user.uid}`, (v) => {
    MYVOTE = v;
    if (v && !pick.a) { pick.a = v.a; pick.c = v.c || null; }
    render();
  });
}

function header() {
  return `<div class="s-top">
    <span class="title">${esc(S ? S.lessonTitle : "")}</span><span class="spacer"></span>
    ${S && S.active ? `<span class="pill live">Live</span>` : ""}
    <span class="pill">${esc(code)}</span>
  </div>`;
}

function render() {
  if (!S) return;
  if (!S.active) {
    app.innerHTML = header() + `<div class="s-main"><div class="card stack" style="text-align:center"><h2>The lesson has ended</h2><p class="muted">Thanks for taking part.</p><button class="btn" id="again">Join another lesson</button></div></div>`;
    $("#again").onclick = () => showCode();
    return;
  }
  if (S.kind === "hinge" && S.q) return renderQuestion();
  const img = NOW && NOW.pos === S.pos ? NOW.img : null;
  app.innerHTML = header() + `<div class="s-main">${img
    ? `<img class="s-slide" src="${img}" alt="Slide ${S.pos + 1}">`
    : `<div class="card"><p class="muted">Waiting for the slide…</p></div>`}
    <p class="small muted" style="text-align:center;margin-top:.6rem">Slide ${S.pos + 1} of ${S.total} · this page follows your teacher's screen${innerWidth < 700 ? " · pinch to zoom" : ""}</p></div>`;
}

function renderQuestion() {
  const q = S.q, letters = optionLetters(q);
  const open = !!q.open, rev = S.reveal || null;
  const sent = MYVOTE && MYVOTE.a;
  const changed = sent && (pick.a !== MYVOTE.a || (q.confidence && pick.c !== (MYVOTE.c || null)));
  const canPick = open && !rev;

  let banner = "";
  if (rev) {
    banner = !sent ? `<div class="banner info">You didn't answer this one. The answer is <b>${esc(rev)}</b>.</div>`
      : MYVOTE.a === rev ? `<div class="banner ok">Correct — well done!</div>`
      : `<div class="banner bad">Not this time. You chose ${esc(MYVOTE.a)}; the answer is <b>${esc(rev)}</b>.</div>`;
  } else if (!open && !sent) banner = `<div class="banner info">${S.opened && S.opened[q.key] ? "Voting has closed." : "Read the question. Voting opens when your teacher says go."}</div>`;
  else if (!open && sent) banner = `<div class="banner info">Voting closed. Your answer: <b>${esc(MYVOTE.a)}</b>.</div>`;
  else if (sent && !changed) banner = `<div class="banner ok">Sent: ${esc(MYVOTE.a)}${MYVOTE.c ? " · " + esc(CONF[MYVOTE.c - 1][1]) : ""}. You can change it until voting closes.</div>`;

  const optCls = (l) => {
    if (rev) return l === rev ? "correct" : sent && MYVOTE.a === l ? "wrong" : "";
    return pick.a === l ? "sel" : "";
  };
  const needConf = q.confidence && canPick && pick.a;
  const ready = canPick && pick.a && (!q.confidence || pick.c) && (!sent || changed) && !pick.sending;

  app.innerHTML = header() + `<div class="s-main stack s-q">
    <div class="kicker">Hinge question${q.round > 1 ? " · round " + q.round : ""}</div>
    <h1>${esc(q.prompt)}</h1>
    ${q.code ? `<div class="code">${esc(q.code)}</div>` : ""}
    <div class="s-opts">${letters.map((l) => `
      <button class="s-opt ${optCls(l)}" data-l="${l}" ${canPick ? "" : "disabled"}><span class="l">${l}</span><span class="${isCodeLike(q.options[l]) ? "mono" : ""}">${esc(q.options[l])}</span></button>`).join("")}
    </div>
    ${needConf ? `<div><div class="small muted" style="margin-bottom:.35rem">How sure are you?</div><div class="conf">${CONF.map(([n, t]) =>
      `<button data-c="${n}" class="${pick.c === n ? "sel" : ""}">${t}</button>`).join("")}</div></div>` : ""}
    ${canPick ? `<button class="btn accent" id="send" style="width:100%;min-height:54px" ${ready ? "" : "disabled"}>${pick.sending ? "Sending…" : sent ? "Change my answer" : "Send answer"}</button>` : ""}
    ${banner}
  </div>`;

  app.querySelectorAll(".s-opt").forEach((b) => (b.onclick = () => { pick.a = b.dataset.l; render(); }));
  app.querySelectorAll(".conf button").forEach((b) => (b.onclick = () => { pick.c = +b.dataset.c; render(); }));
  const send = $("#send");
  if (send) send.onclick = submit;
}

async function submit() {
  const q = S && S.q;
  if (!q || !q.open || !pick.a) return;
  pick.sending = true; render();
  const v = { a: pick.a, t: serverTimestamp() };
  if (q.confidence && pick.c) v.c = pick.c;
  try {
    await set(r(`votes/${code}/${q.key}/${user.uid}`), v);
  } catch (e) {
    alertBanner(/permission/i.test(e.message || e.code || "") ? "Voting has closed." : "Not sent — check the Wi-Fi and press Send again.");
  }
  pick.sending = false; render();
}

function alertBanner(msg) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}

// teacher opening the student page by mistake — offer a link to the teacher view
if (configured) onUser((u) => { if (u && isTeacher(u) && !params.get("c")) setTimeout(() => {
  const p = document.querySelector(".card"); if (p && !document.getElementById("tlink")) p.insertAdjacentHTML("beforeend", `<p class="small" id="tlink"><a href="teacher.html">Open the teacher page →</a></p>`);
}, 50); });
