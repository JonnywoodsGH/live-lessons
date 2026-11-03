// The Google Apps Script that emails students their notes (shown on setup.html to copy).
// It runs as the teacher, so it sends from the teacher's school Gmail. For every request it:
//  1. asks Google who the signed-in student is (their Firebase sign-in token — it can't be faked),
//  2. only accepts verified accounts from the school domain(s),
//  3. only ever emails THAT student's own address (so nobody can use it to email anyone else),
//  4. limits each student to 20 emails a day, and the notes to 5,000 characters.
export function notesScript(apiKey, domains) {
  const doms = JSON.stringify([].concat(domains).filter(Boolean).map((d) => String(d).toLowerCase()));
  return `// Live Lessons — emails students their lesson notes. Paste all of this into Code.gs.
const API_KEY = ${JSON.stringify(apiKey)};
const DOMAINS = ${doms};
const PER_DAY = 20;

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    const who = lookup_(String(d.idToken || ""));
    if (!who || !who.email || who.emailVerified !== true) return out_({ ok: false, error: "Not signed in" });
    const email = String(who.email).toLowerCase();
    if (!DOMAINS.some(function (x) { return email.slice(-(x.length + 1)) === "@" + x; })) return out_({ ok: false, error: "Not a school account" });
    const notes = String(d.notes || "").slice(0, 5000).trim();
    if (!notes) return out_({ ok: false, error: "No notes" });
    const cache = CacheService.getScriptCache(), key = "n:" + email, n = Number(cache.get(key) || 0);
    if (n >= PER_DAY) return out_({ ok: false, error: "Too many emails today" });
    cache.put(key, String(n + 1), 21600);
    const title = String(d.title || "Lesson").slice(0, 120), date = String(d.date || "").slice(0, 40);
    const esc = function (s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); };
    MailApp.sendEmail({
      to: email,
      subject: "Your notes · " + title + (date ? " · " + date : ""),
      body: "Your notes from " + title + (date ? " (" + date + ")" : "") + ":\\n\\n" + notes + "\\n\\n— Live Lessons",
      htmlBody: "<p>Your notes from <b>" + esc(title) + "</b>" + (date ? " (" + esc(date) + ")" : "") + ":</p>" +
        "<div style='white-space:pre-wrap;font:15px/1.5 sans-serif;border-left:4px solid #D96A20;padding:8px 12px;background:#FAF6EF'>" + esc(notes) + "</div>" +
        "<p style='color:#7a8494;font-size:12px'>Sent by Live Lessons. Only you received this.</p>",
      name: "Live Lessons",
    });
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, error: String(err).slice(0, 200) });
  }
}
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
