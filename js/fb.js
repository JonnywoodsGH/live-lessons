// Firebase set-up shared by every page.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDatabase, ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, TEACHER_EMAILS } from "./config.js";

export const configured = !/PASTE_/.test(JSON.stringify(firebaseConfig));
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export { ref, get, set, update, remove, onValue, onDisconnect, serverTimestamp };

export const r = (path) => ref(db, path);
export const isTeacher = (user) =>
  !!user && TEACHER_EMAILS.map((e) => e.toLowerCase()).includes((user.email || "").toLowerCase());

export function onUser(cb) { return onAuthStateChanged(auth, cb); }

export async function signIn() {
  const provider = new GoogleAuthProvider();
  // No "hd" domain hint: students' accounts (@stu…) are a sub-domain of the school's Google Workspace,
  // and a hint can hide them in the account chooser. The database rules enforce the domain instead.
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // iPads sometimes block the pop-up: fall back to a full-page redirect.
    if (e && (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment")) {
      return signInWithRedirect(auth, provider);
    }
    if (e && e.code === "auth/popup-closed-by-user") return null;
    throw e;
  }
}
export const logOut = () => signOut(auth);

// Watch a path; returns an unsubscribe function. cb(value) — value is null if missing.
export function watch(path, cb, onErr) {
  return onValue(r(path), (snap) => cb(snap.val()), (err) => (onErr ? onErr(err) : console.warn(path, err)));
}
export async function read(path) { return (await get(r(path))).val(); }
