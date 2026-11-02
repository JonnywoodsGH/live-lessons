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

// 3. The part after @ in students' school Google accounts. Only these accounts can join.
export const SCHOOL_DOMAIN = "stu.vinschool.edu.vn";

// 4. Default class label used in session IDs and the CSV (matches the AfL Platform).
export const DEFAULT_CLASS = "IGCSE2627";
