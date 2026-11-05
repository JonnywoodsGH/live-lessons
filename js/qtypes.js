// Question types, and how an answer is marked. Shared by every page so they all agree.
//
//   mcq   hinge question: one option (A–D) is right            vote {a: "B"}
//   multi more than one right answer: tick all that apply      vote {a: "AC"}   (letters, A→Z order)
//   tile  select the right tile: tap one tile in a grid        vote {a: "E"}
//   fill  fill in the blanks: type a word into each blank      vote {f: "sensor|actuator"}
//   word  one word (word cloud)                                vote {w: "volatile"}
//   (card sets "set" are groups of mcq items)

export const TYPE_NAME = {
  mcq: "Hinge question", multi: "More than one answer", tile: "Select the right tile", fill: "Fill in the blanks", word: "One word", set: "Quick check",
};
export const SHORT_NAME = { mcq: "Q", multi: "multi", tile: "tiles", fill: "blanks", word: "word" };
export const BLANK = "___";
export const MAX_BLANKS = 6;

export const letters = (a) => String(a || "").toUpperCase().replace(/[^A-L]/g, "").split("").filter((x, i, l) => l.indexOf(x) === i).sort().join("");
/** For a typed answer: lower case, single spaces, no punctuation at either end. */
export const normText = (w) => String(w || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
export const splitFill = (f) => String(f == null ? "" : f).split("|");
/** blanks: [["sensor","sensors"], ["actuator"]] — accepted answers for each blank */
export function blankMarks(blanks, f) {
  const got = splitFill(f);
  return (blanks || []).map((acc, i) => (acc || []).map(normText).includes(normText(got[i])));
}
/** Is this vote right? null when the question has no answer set. */
export function isRight(q, v) {
  if (!q || !v) return false;
  if (q.type === "word") return q.accept && q.accept.length ? q.accept.map(normText).includes(normText(v.w)) : null;
  if (q.type === "fill") { const m = blankMarks(q.blanks, v.f); return m.length ? m.every(Boolean) : null; }
  if (!q.correct) return null;
  if (q.type === "multi") return letters(v.a) === letters(q.correct);
  return v.a === q.correct;
}
/** Readable answer for the CSV / teacher lists. */
export function answerText(q, v) {
  if (!v) return "";
  if (v.w != null) return v.w;
  if (v.f != null) return splitFill(v.f).join(" | ");
  return q && q.type === "multi" ? letters(v.a).split("").join(",") : v.a || "";
}
/** Fill-in prompt → [text, blank, text, blank, text …] parts. */
export const fillParts = (prompt) => String(prompt || "").split(BLANK);
