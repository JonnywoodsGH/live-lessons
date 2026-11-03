// Builds the Realtime Database security rules from config.js (shown on setup.html to copy into Firebase).
//  • Teacher (your email) — everything.
//  • Students (school domain) — read the session they joined + the current slide; write only their own
//    answer, only while that question is open (or any time in a student-paced assignment, once);
//    read the correct answer only AFTER they have answered AND the question has closed (automatic feedback),
//    in a student-paced assignment, or after you reveal it. They never see other students' answers, the lesson file or slides not yet shown.
export function buildRules(teacherEmails, schoolDomain) {
  const q = (s) => "'" + String(s).toLowerCase().replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  const T = "(auth != null && auth.token.email_verified == true && (" +
    teacherEmails.map((e) => `auth.token.email.toLowerCase() == ${q(e)}`).join(" || ") + "))";
  const doms = [].concat(schoolDomain).filter(Boolean);
  const S = `(auth != null && auth.token.email_verified == true && (${doms.map((d) => `auth.token.email.toLowerCase().endsWith(${q("@" + d)})`).join(" || ")} || ${T}))`;
  const sess = (f) => `root.child('sessions').child($code).child('${f}')`;
  const live = `${sess("mode")}.val() != 'self'`;
  const self = `${sess("mode")}.val() == 'self'`;
  const active = `${sess("active")}.val() == true`;
  return {
    rules: {
      lessons: { ".read": T, ".write": T },
      slides: { ".read": T, ".write": T },
      decks: { ".read": T, ".write": T },
      shells: { $lesson: { ".read": S, ".write": T } },
      teacher: { ".read": T, ".write": T },
      sessions: { ".read": T, ".write": T, $code: { ".read": S } },
      now: { $code: { ".read": S, ".write": T } },
      selfpack: { $code: { ".read": `${S} && ${self} && ${active}`, ".write": T } },
      keys: {
        ".read": T, ".write": T,
        $code: {
          $vk: {
            ".read": `auth != null && root.child('votes').child($code).child($vk).child(auth.uid).exists() && ((${sess("feedback")}.val() == 'instant' && ${sess("open")}.child($vk).val() != true) || ${self} || ${sess("reveal")}.child($vk).exists())`,
          },
        },
      },
      votes: {
        $code: {
          ".read": T, ".write": T,
          $vk: {
            $uid: {
              ".read": "auth != null && auth.uid == $uid",
              ".write": `${S} && auth.uid == $uid && ${active} && ((${self} && !data.exists()) || (${live} && ${sess("open")}.child($vk).val() == true))`,
              ".validate": "newData.hasChild('t') && (newData.hasChild('a') || newData.hasChild('w'))",
              a: { ".validate": "newData.isString() && newData.val().matches(/^[A-F1-6]$/)" },
              w: { ".validate": "newData.isString() && newData.val().matches(/^[^ ]{1,30}$/)" },
              c: { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 4" },
              t: { ".validate": "newData.val() == now" },
              $other: { ".validate": false },
            },
          },
        },
      },
      progress: {
        $code: {
          ".read": T, ".write": T,
          $uid: {
            ".read": "auth != null && auth.uid == $uid",
            ".write": `${S} && auth.uid == $uid && ${self} && ${active}`,
            pos: { ".validate": "newData.isNumber()" },
            step: { ".validate": "newData.isNumber()" },
            t: { ".validate": "newData.val() == now" },
            done: { ".validate": "newData.isBoolean()" },
            seen: { $vk: { ".validate": "(!data.exists() && newData.val() == now) || data.val() == newData.val()" } },
            $other: { ".validate": false },
          },
        },
      },
      presence: {
        $code: {
          ".read": T, ".write": T,
          $uid: {
            ".write": `${S} && auth.uid == $uid`,
            ".validate": "newData.hasChildren(['n', 't'])",
            n: { ".validate": "newData.isString() && newData.val().length <= 80" },
            t: { ".validate": "newData.val() == now" },
            $other: { ".validate": false },
          },
        },
      },
      roster: {
        ".read": T,
        $uid: {
          ".read": "auth != null && auth.uid == $uid",
          ".write": `${S} && auth.uid == $uid`,
          ".validate": "newData.hasChildren(['n', 'e']) && newData.child('e').val() == auth.token.email",
          n: { ".validate": "newData.isString() && newData.val().length <= 80" },
          e: { ".validate": "newData.isString()" },
          $other: { ".validate": false },
        },
      },
    },
  };
}
