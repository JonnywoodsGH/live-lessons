// The Google Apps Script that emails students their notes (shown on setup.html to copy).
// It runs as the teacher, so it sends from the teacher's school Gmail. For every request it:
//  1. asks Google who the signed-in student is (their Firebase sign-in token — it can't be faked),
//  2. only accepts verified accounts from the school domain(s),
//  3. only ever emails THAT student's own address (so nobody can use it to email anyone else),
//  4. limits each student to 20 emails a day and the notes to 8,000 characters; links only to the site.
export function notesScript(apiKey, domains, site) {
  const doms = JSON.stringify([].concat(domains).filter(Boolean).map((d) => String(d).toLowerCase()));
  return `// Live Lessons — emails students their lesson notes. Paste all of this into Code.gs.
const API_KEY = ${JSON.stringify(apiKey)};
const DOMAINS = ${doms};
const PER_DAY = 20;
const SITE = ${JSON.stringify(site || "")};

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const who = lookup_(String(d.idToken || ""));
    if (!who || !who.email || who.emailVerified !== true) return out_({ ok: false, error: "Not signed in" });
    const email = String(who.email).toLowerCase();
    if (!DOMAINS.some(function (x) { return email.slice(-(x.length + 1)) === "@" + x; })) return out_({ ok: false, error: "Not a school account" });
    // notes come one per slide: [{slide, title, text, link}]
    var left = 8000;
    const list = (Array.isArray(d.entries) ? d.entries : []).slice(0, 200).map(function (x) {
      const text = String(x.text || "").trim().slice(0, Math.max(0, left)); left -= text.length;
      return { slide: Number(x.slide) || 0, title: String(x.title || "").slice(0, 120), text: text, link: safeLink_(x.link) };
    }).filter(function (x) { return x.text; });
    if (!list.length) return out_({ ok: false, error: "No notes" });
    const cache = CacheService.getScriptCache(), key = "n:" + email, n = Number(cache.get(key) || 0);
    if (n >= PER_DAY) return out_({ ok: false, error: "Too many emails today" });
    cache.put(key, String(n + 1), 21600);
    const title = String(d.title || "Lesson").slice(0, 120), date = String(d.date || "").slice(0, 40), review = safeLink_(d.review);
    const esc = function (s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
    const head = function (x) { return "Slide " + x.slide + (x.title ? " · " + x.title : ""); };
    const body = "Your notes from " + title + (date ? " (" + date + ")" : "") + ":\\n\\n" +
      list.map(function (x) { return head(x) + "\\n" + x.text + (x.link ? "\\nOpen this slide: " + x.link : ""); }).join("\\n\\n") +
      (review ? "\\n\\nReview the whole lesson: " + review : "") + "\\n\\n— Live Lessons";
    const html = "<div style='font:15px/1.5 sans-serif;color:#1d3350;max-width:640px'>" +
      "<p>Your notes from <b>" + esc(title) + "</b>" + (date ? " (" + esc(date) + ")" : "") + ":</p>" +
      list.map(function (x) {
        return "<div style='border-left:4px solid #D96A20;background:#FAF6EF;padding:8px 12px;margin:0 0 12px'>" +
          "<div style='font-weight:700'>" + esc(head(x)) + (x.link ? " &nbsp;<a href='" + esc(x.link) + "' style='font-weight:400;color:#D96A20'>Open this slide →</a>" : "") + "</div>" +
          "<div style='white-space:pre-wrap'>" + esc(x.text) + "</div></div>";
      }).join("") +
      (review ? "<p><a href='" + esc(review) + "' style='display:inline-block;background:#1d3350;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none'>Review the whole lesson</a></p>" : "") +
      "<p style='color:#7a8494;font-size:12px'>Sent by Live Lessons. Only you received this.</p></div>";
    MailApp.sendEmail({
      to: email,
      subject: "Your notes · " + title + (date ? " · " + date : ""),
      body: body,
      htmlBody: html,
      name: "Live Lessons",
    });
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err).slice(0, 200) });
  }
}
// Links may only point back to the Live Lessons site.
function safeLink_(u) { u = String(u || ""); return SITE && u.indexOf(SITE) === 0 && u.length < 300 && !/[\\s"<>]/.test(u) ? u : ""; }
function doGet() { return out_({ ok: true, ready: true }); }

// Ask Google whose sign-in token this is.
function lookup_(idToken) {
  if (!idToken) return null;
  const r = UrlFetchApp.fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + API_KEY, {
    method: "post", contentType: "application/json", payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) return null;
  const users = JSON.parse(r.getContentText()).users;
  return users && users[0];
}
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;
}
