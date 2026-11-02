// Adding a lesson: slides (a PDF, or one image per slide) + an optional hinge-question file.
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

export async function deleteLesson(id) {
  const u = {}; u[`lessons/${id}`] = null; u[`slides/${id}`] = null;
  await update(r("/"), u);
}
