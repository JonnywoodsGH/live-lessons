// =====================================================================
//  Live Lessons — settings. This is the ONLY file you need to edit.
//  (Nothing here is secret: Firebase web config is meant to be public.
//   Your data is protected by the database rules, not by hiding this.)
// =====================================================================

// 1. Paste the config object from Firebase console →
//    Project settings → General → Your apps → Web app → "SDK setup and configuration" → Config.
//    Make sure databaseURL is included (it appears once the Realtime Database exists).
export const firebaseConfig = {
  apiKey: "AIzaSyAjx5xHZAAqFdFWzp-4w9FKf_C2oBgETB4",
  authDomain: "live-lessons-23d5b.firebaseapp.com",
  databaseURL: "https://live-lessons-23d5b-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "live-lessons-23d5b",
  storageBucket: "live-lessons-23d5b.firebasestorage.app",
  messagingSenderId: "503395876297",
  appId: "1:503395876297:web:14080b7be8e95bdd33bc18",
};

// 2. Your Google account(s) — only these can run lessons, upload slides and see results.
export const TEACHER_EMAILS = ["v.johnwa@vinschool.edu.vn"];

// 3. The part after @ in the Google accounts that can join as students. One domain, or a list.
//    "*" = ANY Google account can join as a student. Teachers are still only TEACHER_EMAILS.
//    Testing: school accounts plus personal Gmail accounts. After testing, set it back to
//    ["stu.vinschool.edu.vn"] and re-publish the rules from setup.html.
export const SCHOOL_DOMAIN = ["stu.vinschool.edu.vn", "vinschool.edu.vn", "gmail.com"];

// 4. Students' notes by email (optional). Paste the "Web app URL" from Google Apps Script here —
//    setup.html has the script and the steps. Leave it "" and students can still take notes and
//    copy them at the end, but nothing is emailed.
export const NOTES_EMAIL_URL = "";

// 5. Default class label used in session IDs and the CSV (matches the AfL Platform).
export const DEFAULT_CLASS = "IGCSE2627";
