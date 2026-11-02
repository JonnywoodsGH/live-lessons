// Adding a lesson: slides (an interactive HTML deck, a PDF, or one image per slide) + an optional hinge-question file.
// Everything is turned into JPEGs in the browser and stored in the teacher-only part of the database,
// so slide images and answers never sit in the public website/repo.
import { r, set, update, serverTimestamp } from "./fb.js";

const MAX_W = 1280, QUALITY = 0.8;
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.pdfjsLib) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the PDF reader — check the internet connection."));
    document.head.appendChild(s);
  });
}

function canvasToJpeg(canvas) { return canvas.toDataURL("image/jpeg", QUALITY); }

async function imageFileToJpeg(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Can't read " + file.name)); i.src = url; });
    const scale = Math.min(1, MAX_W / img.naturalWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return canvasToJpeg(c);
  } finally { URL.revokeObjectURL(url); }
}

async function pdfToJpegs(file, onPage) {
  await loadScript(PDFJS + "pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js";
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const out = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: MAX_W / vp1.width });
    const c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push(canvasToJpeg(c));
    onPage && onPage(p, pdf.numPages);
  }
  return out;
}

/** Read an interactive HTML deck: its slides (<section class="slide">), build counts, CSS and footer text. */
export function parseDeck(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  let secs = [...doc.querySelectorAll("#stage > .slide")];
  if (!secs.length) secs = [...doc.querySelectorAll("section.slide, .slide")];
  if (!secs.length) throw new Error("This HTML file has no slides (<section class=\"slide\">) — is it one of the interactive decks?");
  const sections = secs.map((sec, n) => {
    let max = 0;
    sec.querySelectorAll("[data-step],[data-play],[data-start-at]").forEach((e) => {
      max = Math.max(max, +(e.getAttribute("data-step") || e.getAttribute("data-play") || e.getAttribute("data-start-at") || 0) || 0);
    });
    return { n, html: sec.outerHTML, max, title: sec.getAttribute("data-title") || `Slide ${n + 1}` };
  });
  const css = [...doc.head.querySelectorAll('style, link[rel="stylesheet"]')].map((e) => e.outerHTML).join("\n");
  const scripts = [...doc.querySelectorAll("script")].map((x) => x.textContent).join("\n");
  const m = /textContent\s*=\s*(['"`])([^'"`]*)\1\s*\+\s*s\.dataset\.foot/.exec(scripts);
  return { sections, css, foot: m ? m[2] : "", full: text };
}

const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Check the hinge file and return {hinges: {H1: {...}}, list: [...]} or throw a readable error. */
export function parseHinges(text, slideCount) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error("The hinge file isn't valid JSON: " + e.message); }
  const list = Array.isArray(data) ? data : data.hinges;
  if (!Array.isArray(list)) throw new Error('The hinge file needs a "hinges" list.');
  const hinges = {};
  list.forEach((h, i) => {
    const where = `Hinge ${i + 1}${h && h.id ? " (" + h.id + ")" : ""}`;
    if (!h || !h.id || !/^[A-Za-z0-9_-]+$/.test(h.id)) throw new Error(`${where}: needs an "id" made of letters, numbers, - or _.`);
    if (hinges[h.id]) throw new Error(`${where}: the id is used twice.`);
    if (!h.prompt) throw new Error(`${where}: needs a "prompt".`);
    const opts = Object.keys(h.options || {}).filter((k) => /^[A-F]$/.test(k) && h.options[k] !== "");
    if (opts.length < 2) throw new Error(`${where}: needs at least two options A–F.`);
    if (h.correct && !opts.includes(h.correct)) throw new Error(`${where}: "correct" must be one of ${opts.join(", ")}.`);
    const after = Number(h.after);
    if (!Number.isInteger(after) || after < 0 || after > slideCount) throw new Error(`${where}: "after" must be a slide number from 0 to ${slideCount}.`);
    hinges[h.id] = {
      id: h.id, after, prompt: String(h.prompt), code: h.code ? String(h.code) : "",
      options: Object.fromEntries(opts.map((k) => [k, String(h.options[k])])),
      correct: h.correct || "", misconceptions: h.misconceptions || {}, notes: h.notes || {},
      confidence: h.confidence !== false, teacher_note: h.teacher_note || "",
    };
  });
  return { hinges, list: Object.values(hinges) };
}

export async function uploadLesson({ id, title, slideFiles, hingeText, onProgress = () => {} }) {
  id = (id || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Lesson ID: use letters, numbers, - or _ only (e.g. Y9-W8-L1).");
  if (!slideFiles || !slideFiles.length) throw new Error("Choose the slides: one PDF, or the slide images.");

  const files = [...slideFiles];
  const htmlFile = files.find((f) => /html?$/i.test(f.type) || /\.html?$/i.test(f.name));
  if (htmlFile) return uploadDeck({ id, title, htmlFile, hingeText, onProgress });
  let jpegs;
  const pdf = files.find((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (pdf) {
    onProgress("Reading the PDF…", 0);
    jpegs = await pdfToJpegs(pdf, (p, n) => onProgress(`Reading slide ${p} of ${n}…`, (p / n) * 0.4));
  } else {
    const imgs = files.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif)$/i.test(f.name)).sort(natural);
    if (!imgs.length) throw new Error("No PDF or images found in what you chose.");
    jpegs = [];
    for (let i = 0; i < imgs.length; i++) {
      onProgress(`Preparing slide ${i + 1} of ${imgs.length}…`, ((i + 1) / imgs.length) * 0.4);
      jpegs.push(await imageFileToJpeg(imgs[i]));
    }
  }

  const { hinges, list } = hingeText ? parseHinges(hingeText, jpegs.length) : { hinges: {}, list: [] };
  const order = [];
  list.filter((h) => h.after === 0).forEach((h) => order.push({ t: "hinge", id: h.id }));
  jpegs.forEach((_, n) => {
    order.push({ t: "img", n });
    list.filter((h) => h.after === n + 1).forEach((h) => order.push({ t: "hinge", id: h.id }));
  });

  onProgress("Uploading…", 0.42);
  await set(r(`slides/${id}`), null);
  for (let n = 0; n < jpegs.length; n++) {
    await set(r(`slides/${id}/${n}`), jpegs[n]);
    onProgress(`Uploading slide ${n + 1} of ${jpegs.length}…`, 0.42 + ((n + 1) / jpegs.length) * 0.56);
  }
  const kb = Math.round(jpegs.reduce((s, j) => s + j.length, 0) / 1024);
  await set(r(`lessons/${id}`), {
    id, title: (title || id).trim(), slideCount: jpegs.length, order, hinges, sizeKB: kb, uploadedAt: serverTimestamp(),
  });
  onProgress("Done", 1);
  return { id, slides: jpegs.length, hinges: list.length, kb };
}

async function uploadDeck({ id, title, htmlFile, hingeText, onProgress }) {
  onProgress("Reading the deck…", 0.05);
  const deck = parseDeck(await htmlFile.text());
  const { hinges, list } = hingeText ? parseHinges(hingeText, deck.sections.length) : { hinges: {}, list: [] };
  const order = [];
  list.filter((h) => h.after === 0).forEach((h) => order.push({ t: "hinge", id: h.id }));
  deck.sections.forEach((sec) => {
    order.push({ t: "html", n: sec.n, max: sec.max, title: sec.title.slice(0, 120) });
    list.filter((h) => h.after === sec.n + 1).forEach((h) => order.push({ t: "hinge", id: h.id }));
  });
  onProgress("Uploading…", 0.1);
  await set(r(`slides/${id}`), null);
  for (const sec of deck.sections) {
    await set(r(`slides/${id}/${sec.n}`), sec.html);
    onProgress(`Uploading slide ${sec.n + 1} of ${deck.sections.length}…`, 0.1 + ((sec.n + 1) / deck.sections.length) * 0.7);
  }
  await set(r(`shells/${id}`), { css: deck.css, foot: deck.foot });
  onProgress("Uploading the full deck for the projector…", 0.85);
  await set(r(`decks/${id}`), deck.full);
  const kb = Math.round((deck.full.length + deck.sections.reduce((t, x) => t + x.html.length, 0)) / 1024);
  await set(r(`lessons/${id}`), {
    id, kind: "html", title: (title || id).trim(), slideCount: deck.sections.length, order, hinges, sizeKB: kb, uploadedAt: serverTimestamp(),
  });
  onProgress("Done", 1);
  return { id, slides: deck.sections.length, hinges: list.length, kb };
}

export async function deleteLesson(id) {
  const u = {}; u[`lessons/${id}`] = null; u[`slides/${id}`] = null; u[`shells/${id}`] = null; u[`decks/${id}`] = null;
  await update(r("/"), u);
}
