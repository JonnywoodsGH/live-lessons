// Builds the Realtime Database security rules from config.js (shown on setup.html to copy into Firebase).
//  • Teacher (your email) — everything.
//  • Students (school domain) — read the session they joined + the current slide; write only their own
//    vote, only while that question is open; read only their own vote. They never see answers,
//    other students' votes, the lesson file or any slide you haven't shown yet.
export function buildRules(teacherEmails, schoolDomain) {
  const q = (s) => "'" + String(s).toLowerCase().replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  const T = "(auth != null && auth.token.email_verified == true && (" +
    teacherEmails.map((e) => `auth.token.email.toLowerCase() == ${q(e)}`).join(" || ") + "))";
  const S = `(auth != null && auth.token.email_verified == true && (auth.token.email.toLowerCase().endsWith(${q("@" + schoolDomain)}) || ${T}))`;
  return {
    rules: {
      lessons: { ".read": T, ".write": T },
      slides: { ".read": T, ".write": T },
      teacher: { ".read": T, ".write": T },
      sessions: { ".read": T, ".write": T, $code: { ".read": S } },
      now: { $code: { ".read": S, ".write": T } },
      votes: {
        $code: {
          ".read": T, ".write": T,
          $qkey: {
            $uid: {
              ".read": "auth != null && auth.uid == $uid",
              ".write": `${S} && auth.uid == $uid && root.child('sessions').child($code).child('active').val() == true && root.child('sessions').child($code).child('q').child('key').val() == $qkey && root.child('sessions').child($code).child('q').child('open').val() == true`,
              ".validate": "newData.hasChildren(['a', 't'])",
              a: { ".validate": "newData.isString() && newData.val().matches(/^[A-F]$/)" },
              t: { ".validate": "newData.val() == now" },
              c: { ".validate": "newData.isNumber() && newData.val() >= 1 && newData.val() <= 4" },
              $other: { ".validate": false },
            },
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
