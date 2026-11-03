// Finds the questions inside an interactive HTML deck slide.
//
//  1. "Whole class · fingers up" slides (existing decks): a .key with numbered options and lettered
//     .scard cards whose .ans build shows "N · Label". Each card becomes a question, options 1–N.
//  2. Hinge slides in the AS-deck format (Year 11 decks, and Year 9 via interactive_qtypes.py):
//     <section class="slide hinge" data-hinge="ID" data-ans="0" data-q="question" [data-mc='{"B":"MC-…"}']>
//     with .hopt options (.hl letter, .ht p text, .why note per option, .right on the correct one).
//     Older form (data-q="mcq"):  <section data-q="mcq" data-qid="H1" data-correct="B"
//     data-mc='{"A":"MC-…"}' data-notes='{"A":"…"}' data-explain="…" data-time="30"> with
//     [data-opt="A"] options (text in .t), optional .hq-code, answer reveal as a build.
//  3. One-word slides (Deck.word):  <section data-q="word" data-qid="W1" data-accept="subsystem|sub-system"
//     data-time="45">. Students type one word; everyone sees the word cloud.
//
// Answer data attributes are REMOVED from the section, so the copy stored for slides/students has none.

const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");
const json = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

export function detectQuestions(sec, n) {
  const slideNo = n + 1;
  const builds = [...sec.querySelectorAll("[data-step]")];
  const kind = sec.getAttribute("data-q");
  const h2 = txt(sec.querySelector("h2"));

  if (sec.classList.contains("hinge") && sec.hasAttribute("data-hinge")) {
    const raw = sec.getAttribute("data-hinge") || `H${slideNo}`;
    const id = raw.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 60) || `H${slideNo}`;
    const ans = +sec.getAttribute("data-ans");
    const options = {}, notes = {}, why = {};
    let correct = "";
    [...sec.querySelectorAll(".hopt")].forEach((o, i) => {
      const k = txt(o.querySelector(".hl")) || "ABCDEF"[i];
      options[k] = txt(o.querySelector(".ht p:not(.why)")) || `Option ${k}`;
      const w = txt(o.querySelector(".why"));
      if (i === ans || o.classList.contains("right")) correct = k;
      else if (w) { notes[k] = w; why[k] = w; }
      o.classList.remove("right");                       // students' copy must not show which one is right
    });
    const tm = sec.querySelector(".timer[data-seconds]");
    const rv = sec.querySelector(".hflag[data-step], .why[data-step], .hres[data-step]");
    const ansStep = rv ? +rv.getAttribute("data-step") || 0 : builds.length ? Math.max(...builds.map((b) => +b.getAttribute("data-step") || 0)) : 0;
    const q = {
      id, type: "mcq", prompt: sec.getAttribute("data-q") || txt(sec.querySelector("h2")), options, correct,
      misconceptions: json(sec.getAttribute("data-mc"), {}), notes, why, explain: "", reteach: txt(sec.querySelector(".hdec p")),
      time: Math.max(20, +(tm && tm.getAttribute("data-seconds")) || 30), mono: !!sec.querySelector(".ht p.mono"),
      fig: !!sec.querySelector(".hfig, .hopt img, .hopt svg"), ansStep,
      ansIdx: builds.map((b, i) => ((+b.getAttribute("data-step") || 0) >= ansStep ? i : -1)).filter((i) => i >= 0), slide: slideNo,
    };
    ["data-ans", "data-mc"].forEach((a) => sec.removeAttribute(a));
    if (Object.keys(options).length < 2) return null;
    return { type: "mcq", ids: [id], items: { [id]: q }, time: q.time, title: q.prompt };
  }

  if (kind === "mcq") {
    const id = sec.getAttribute("data-qid") || `H${slideNo}`;
    const options = {};
    sec.querySelectorAll("[data-opt]").forEach((o) => {
      const k = o.getAttribute("data-opt");
      options[k] = txt(o.querySelector(".t")) || txt(o).replace(new RegExp("^" + k + "\\s*"), "");
    });
    const codeEl = sec.querySelector(".hq-code");
    const q = {
      id, type: "mcq", prompt: txt(sec.querySelector("[data-prompt]")) || h2,
      code: codeEl ? codeEl.textContent.replace(/^\n+|\s+$/g, "") : "",
      options, correct: sec.getAttribute("data-correct") || "",
      misconceptions: json(sec.getAttribute("data-mc"), {}), notes: json(sec.getAttribute("data-notes"), {}),
      explain: sec.getAttribute("data-explain") || "", time: +sec.getAttribute("data-time") || 30,
      ansStep: builds.length ? Math.min(...builds.map((b) => +b.getAttribute("data-step") || 1)) : 0,
      ansIdx: builds.map((_, i) => i), slide: slideNo,
    };
    ["data-correct", "data-mc", "data-notes", "data-explain"].forEach((a) => sec.removeAttribute(a));
    if (Object.keys(options).length < 2) return null;
    return { type: "mcq", ids: [id], items: { [id]: q }, time: q.time, title: h2 };
  }

  if (kind === "word") {
    const id = sec.getAttribute("data-qid") || `W${slideNo}`;
    const q = {
      id, type: "word", prompt: txt(sec.querySelector("[data-prompt]")) || h2,
      accept: (sec.getAttribute("data-accept") || "").split("|").map((s) => s.trim()).filter(Boolean),
      explain: sec.getAttribute("data-explain") || "", time: +sec.getAttribute("data-time") || 45,
      ansStep: builds.length ? Math.min(...builds.map((b) => +b.getAttribute("data-step") || 1)) : 0,
      ansIdx: builds.map((_, i) => i), slide: slideNo,
    };
    ["data-accept", "data-explain"].forEach((a) => sec.removeAttribute(a));
    return { type: "word", ids: [id], items: { [id]: q }, time: q.time, title: h2 };
  }

  // fingers-up card sort
  const key = sec.querySelector(".key"), cards = [...sec.querySelectorAll(".scard")];
  if (kind === "set" || (key && cards.length && sec.querySelector(".sort"))) {
    const options = {};
    (key ? [...key.querySelectorAll("span")] : []).forEach((s) => {
      const i = s.querySelector("i");
      const num = txt(i);
      if (!/^\d$/.test(num)) return;
      options[num] = txt(s).replace(new RegExp("^" + num), "").trim();
    });
    if (Object.keys(options).length < 2) return null;
    const items = {}, ids = [];
    cards.forEach((c, i) => {
      const letter = txt(c.querySelector(".n")) || String.fromCharCode(65 + i);
      const dev = c.querySelector(".dev");
      const ans = c.querySelector(".ans");
      const small = ans && ans.querySelector("small");
      const ansText = ans ? txt(ans).replace(small ? txt(small) : "", "").trim() : "";
      const m = /^(\d)/.exec(ansText);
      const id = `S${slideNo}${letter.replace(/[^A-Za-z0-9]/g, "")}`;
      items[id] = {
        id, type: "mcq", card: letter, prompt: txt(dev), mono: !!(dev && dev.classList.contains("mono")),
        options, correct: m ? m[1] : "", misconceptions: {}, notes: {}, explain: txt(small),
        ansStep: ans ? +ans.getAttribute("data-step") || 0 : 0, ansIdx: ans ? [builds.indexOf(ans)] : [], slide: slideNo,
      };
      ids.push(id);
    });
    if (!ids.length) return null;
    return { type: "set", ids, items, time: Math.max(30, ids.length * 8), title: h2 };
  }
  return null;
}
