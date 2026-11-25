# Live Lessons

A teacher-led classroom system that puts your slides on every student's device and has
assessment-for-learning (AfL) activities built in: hinge questions, more-than-one-answer
questions, tile questions, fill in the blanks, word clouds, quick checks, private notes and
"left the page" alerts. Results arrive live, so you can decide straight away whether to move on
or re-teach, and the CSV export lets you track learning over time.

It is a set of static web pages (hosted free on GitHub Pages) plus a Firebase Realtime Database
that handles Google sign-in and live data. There is no server to run.

---

## Contents

1. [What it aims to do](#what-it-aims-to-do)
2. [The pages](#the-pages)
3. [Running a live lesson](#running-a-live-lesson)
4. [Question types](#question-types)
5. [The question builder](#the-question-builder)
6. [Other features](#other-features)
7. [Student-paced assignments](#student-paced-assignments)
8. [Data and the CSV export](#data-and-the-csv-export)
9. [Privacy and security](#privacy-and-security)
10. [Setting up (one time)](#setting-up-one-time)
11. [Making changes](#making-changes)
12. [Slide formats (for deck makers)](#slide-formats-for-deck-makers)
13. [Files in this repository](#files-in-this-repository)
14. [Troubleshooting](#troubleshooting)

---

## What it aims to do

- **Keep the class together.** Students' screens follow the teacher's slide, build by build.
  They can't skip ahead, and builds they haven't been shown aren't on their device at all.
- **Hear from every student, not just the confident ones.** Every student answers every question
  on their own device, privately.
- **Decide on evidence.** You see the spread of answers, the % correct and the most common wrong
  answer while the question is still open. The slide gives a verdict ("Move on" at 80% or more,
  otherwise "Re-teach").
- **Build up a record.** Every answer is saved with the lesson, question, misconception tag,
  confidence and time taken, ready to export.

---

## The pages

| Page | Who uses it | Link |
|---|---|---|
| Student page (the QR code opens this) | Students | https://jonnywoodsgh.github.io/live-lessons/ |
| Teacher page: lessons, live control, results, export | Teacher | https://jonnywoodsgh.github.io/live-lessons/teacher.html |
| Projector view: the board / TV | Teacher's second screen | https://jonnywoodsgh.github.io/live-lessons/present.html |
| Question builder | Teacher | https://jonnywoodsgh.github.io/live-lessons/builder.html |
| Setup: checks settings, makes the database rules | Teacher (once, and after changes) | https://jonnywoodsgh.github.io/live-lessons/setup.html |

Only the account in `TEACHER_EMAILS` (in `js/config.js`) can use the teacher page, the projector
view and the builder uploads. Students sign in with their school Google account.

---

## Running a live lesson

### Before the lesson: add the lesson (once per lesson)

1. Open the **teacher page** and sign in.
2. Under **Add a lesson**, type a lesson ID (e.g. `Y9-W8-L1`) and a title, and choose the slides:
   - an **interactive HTML deck** (best: builds, timers and questions are picked up automatically), or
   - a **PDF** (from PowerPoint, Keynote, Google Slides or Canva), or one **image per slide**.
     For PDFs, add questions with a question file made in the [question builder](#the-question-builder).
3. Press **Upload lesson**. Uploading the same ID again replaces the lesson.

### In the lesson

1. On the teacher page, choose the lesson and class, set the options, and press **Start live lesson**:
   - *Students see if they're right*: when you reveal the answer (hinge style), or automatically
     when time's up.
   - *Points and leaderboard*, *Countdown timer on questions*, *Open questions as soon as I reach them*.
2. Press **Open projector view ↗** and drag that window onto the board (press **F** for full screen).
3. Press **J** (Join). The slides stay up, and a panel on the right of the board shows the QR code,
   the web address and a 4-letter code. Students scan, sign in and they're in. The panel shows how
   many have joined. Press **J** again to hide it.
4. Move through the lesson with the arrow keys, a clicker, the on-screen ▶ button or a tap on the board.
   Students' screens follow.
5. When you reach a question, it opens on every device with a countdown. Your teacher page shows
   who has finished and the live results. The board shows "n of N answered".
6. Press **Next** (or **A**) to show the answer. This closes the question, marks the right answer
   on the board and gives each student their feedback.
7. Read the verdict. If it says re-teach, explain again, then press **Ask again** for a second round.
   Round 1 is kept for your data.
8. Press **End lesson** when you're done.

### Keys (teacher page and projector)

| Key | Does |
|---|---|
| → ↓ Space Page Down (clicker) | Next build / next slide |
| ← ↑ Page Up | Back |
| V | Open / close the current question |
| R | Show / hide results on the board while a question is open |
| A | Reveal / hide the answer |
| J | Join panel (QR code + code) on / off |
| S | Leaderboard on / off |
| F | Full screen (projector) |

---

## Question types

| Type | What students do | How it's marked |
|---|---|---|
| **Hinge question** | Tap one option (A–D). Optional "how sure are you?" | Right option |
| **More than one answer** | Tick every right option (up to 6), then press Send | Exactly the right set ticked |
| **Select the right tile** | Tap one tile in a grid (up to 9 short tiles) | Right tile |
| **Fill in the blanks** | Type a word into each blank in a sentence (up to 6 blanks) | Every blank right. Several accepted answers per blank; capital letters and end punctuation are ignored |
| **One word** | Type one word; everyone sees the word cloud | Matches an accepted word (if you set any) |
| **Quick check (card set)** | Several short "fingers up" items on one slide | Right number per card |

For every type:

- Students **can change their answer until time's up**, and never see whether they're right while
  the question is open.
- After the reveal, a student who chose a wrong option sees **"Why not B: …"** (your note for that
  option), plus your explanation.
- Correct answers earn **500–1000 points**, more for answering faster. Points only appear once the
  question closes, so the leaderboard can't give answers away.
- Your teacher page shows the bars per option (or, for fill in the blanks, the % right per blank and
  the most common answers), the misconception linked to each wrong option, and anyone who was
  **confident but wrong**.

---

## The question builder

https://jonnywoodsgh.github.io/live-lessons/builder.html

1. Choose where the question goes:
   - **Into an interactive HTML deck**: choose the deck file. It stays on your computer and isn't
     uploaded. Then pick the slide the question comes after.
   - **A PDF lesson**: say which slide number it comes after. You'll get a question file.
2. Choose the type and fill in the form. The preview shows the slide in your deck's own style. Tick
   **Show the answer steps** to see the reveal.
   - *Hinge*: 2–4 options, the right one, and why each wrong one is wrong. A misconception ID
     (e.g. `MC-RAM-01`) is optional and goes into the CSV.
   - *More than one answer*: 3–6 options; tick every right one.
   - *Tiles*: 3–9 short tiles; choose the right one.
   - *Fill in the blanks*: write the sentence with each answer in square brackets. Put other
     accepted answers after a `|`, e.g.
     `The [sensor|sensors] sends readings to the [microprocessor|processor] …`
   - *One word*: the accepted words.
3. Press **Add to the deck** (add as many as you like), then **Download the updated deck**, or
   **Download the question file** for a PDF.
4. On the teacher page, upload the updated deck with the same lesson ID, or upload the PDF and the
   question file together.

Question slides have two steps after the question: **step 1 shows the answer** (and closes the
question), **step 2 shows the "Decide" box**.

---

## Other features

- **Full screen on students' devices**: the ⛶ button in the student header. It stays full screen
  through slide changes (laptops, Android, iPad; not iPhone).
- **Private notes**: students tap **Notes** to type notes beside the slide (a side panel on laptops,
  a bottom sheet on phones). Notes are saved per slide, and only that student can read them, not
  even the teacher. At the end of the lesson they can be emailed to the student with a link back to
  each slide (needs the notes email set up, below). Otherwise students can copy them.
- **"Left the page" alert**: if a student leaves the lesson page for 10 seconds or more, your
  teacher page shows who, for how long, and how many times. Only you see names. The student gets a
  gentle nudge when they come back, and they're told about this when they join. An optional setting
  shows the class a count on the board (no names) with a soft chime. A locked screen also counts,
  so check before acting on it.
- **Deck timers**: timers in interactive decks run on the board and on students' screens. On
  question slides the deck's timer shows the live countdown.
- **Leaderboard** (S): top 10 on the board; each student sees their own score and rank.
- **Word-cloud moderation**: tap a word on your teacher page to hide it from the board.

---

## Student-paced assignments

On the teacher page, choose a lesson and press **Assign student-paced…** (optionally with a due date).
Students join with the code and work through at their own pace. Each question must be answered
before they can go on, and feedback comes straight after answering. The teacher page shows each
student's progress, score and the % correct per question.

---

## Data and the CSV export

On the teacher page, press **Export this session (CSV)** during a lesson, or **Export everything (CSV)** for all sessions. There is one row per
student per question, with these columns:

`response_id, timestamp, session_id, mode, join_code, date, class, lesson_id, item_id,
question_type, round, student_name, student_email, answer, correct, misconception_id, confidence,
time_taken_s, points, activity, afl_strategy, time_away_s`

- `question_type`: `mcq`, `multi`, `tile`, `fill`, `word` or `card`.
- `answer`: the letter (or letters, e.g. `A,C,E`), the word, or each blank's answer separated by ` | `.
- `misconception_id`: the tag of each wrong option chosen.
- Students who were present but didn't answer appear as `(no answer)`.

---

## Privacy and security

- **Only the teacher account** can upload lessons, run lessons, see results and export.
- **Only school accounts** (`SCHOOL_DOMAIN` in `js/config.js`, currently `stu.vinschool.edu.vn` and
  `vinschool.edu.vn`) can join as students.
- Students can read only the session they joined and the slides already shown. They can write only
  their own answer, only while the question is open. They can see the right answer only after they
  have answered and the question has closed (or been revealed). They never see other students' answers.
- Students' notes are private to the student. Time away is visible only to the teacher.
- This repository holds **code only**. Lesson slides, answers and results live in the
  teacher-only part of the database.
- The Firebase settings in `js/config.js` are meant to be public. The data is protected by the
  **database rules**, which `setup.html` generates from `js/config.js`.

---

## Setting up (one time)

Already done for this project (`live-lessons-23d5b`). These steps are kept here in case it ever
needs redoing.

1. **Firebase**: create a project, add a **Realtime Database**, turn on **Authentication → Google**,
   and register a **web app**. Paste its config into `js/config.js` (with `databaseURL`).
2. **Settings** in `js/config.js`: `TEACHER_EMAILS`, `SCHOOL_DOMAIN`, `DEFAULT_CLASS`, and
   optionally `NOTES_EMAIL_URL`.
3. **Authorized domains**: Firebase → Authentication → Settings → Authorized domains → add
   `jonnywoodsgh.github.io`.
   https://console.firebase.google.com/project/live-lessons-23d5b/authentication/settings
4. **Database rules**: open `setup.html`, press **Copy rules**, then paste them into
   Firebase → Realtime Database → Rules and press **Publish**.
   https://console.firebase.google.com/project/live-lessons-23d5b/database/live-lessons-23d5b-default-rtdb/rules
5. **Hosting**: GitHub → Settings → Pages → deploy from the `main` branch. Changes go live a minute
   or two after merging.
6. **Notes email (optional)**: `setup.html` has a Google Apps Script to copy, with steps. Deploy it as
   a web app running as you, then paste its URL into `NOTES_EMAIL_URL`. Notes are sent from your
   school Gmail, only ever to the student who wrote them (20 a day each at most).

---

## Making changes

- Edit on a branch, open a pull request, and merge. GitHub Pages redeploys `main` automatically.
- **Merging doesn't change the database rules.** After any change to `js/config.js` or the rules
  code, re-publish them: open `setup.html` (hard refresh), press **Copy rules**, paste into Firebase,
  then press **Publish**.
- After a change, hard-refresh the pages (Ctrl/Cmd + Shift + R) so browsers pick up the new code.

---

## Slide formats (for deck makers)

Interactive decks are single HTML files with slides as `<section class="slide">` inside `#stage`.
Builds use `data-step="n"`, and timers use `.timer[data-timer-id][data-seconds][data-start-at]`.
These question slides are detected on upload. Their answer attributes are removed from the copy
students receive.

| Slide | Marked by | Answer data |
|---|---|---|
| Hinge (AS style) | `class="slide hinge" data-hinge="ID"` with `.hopt` options | `data-ans="1"` (0-based), `.why` notes, `data-mc='{"A":"MC-…"}'` |
| Hinge (older form) | `data-q="mcq" data-qid="ID"` with `[data-opt="A"]` | `data-correct="B"`, `data-notes`, `data-mc`, `data-explain` |
| More than one answer | `class="slide llq multi" data-q="multi" data-qid="ID"` with `.lq-opt[data-opt]` | `data-correct="ACE"`, `.lq-why` notes, `data-mc` |
| Tiles | `class="slide llq tile" data-q="tile" data-qid="ID"` with `.lq-tile[data-opt]` | `data-correct="A"`, `data-explain` |
| Fill in the blanks | `class="slide llq fill" data-q="fill" data-qid="ID"` with `.lq-blank` in `[data-prompt]` | `data-accept="sensor\|sensors;actuator"` (`;` between blanks, `\|` between accepted answers) |
| One word | `data-q="word" data-qid="ID"` | `data-accept="a\|b"`, `data-explain` |
| Quick check | a `.key` of numbered options and lettered `.scard` cards | each card's `.ans` build |

The question builder writes the `llq` slides for you. Each carries its own styling, so it looks
right in any deck.

**PDF question file** (`*.hinges.json`): `{"hinges": [ … ]}`. Each entry has an `id`, `after`
(slide number, 0 = before slide 1), `prompt`, an optional `time`, and:

- hinge: `options` `{"A": "…"}`, `correct`, optional `notes`, `misconceptions`
- `"type": "multi"`: `options` (A–L), `correct` `"ACE"`
- `"type": "tile"`: `options` (A–I), `correct`
- `"type": "fill"`: `prompt` with `___` for each blank, `blanks` `[["sensor","sensors"], ["actuator"]]`
- `"type": "word"`: `accept` `["…"]`

---

## Files in this repository

| File | What it does |
|---|---|
| `index.html`, `js/student.js` | Student page: sign-in, join, following slides, answering, feedback |
| `teacher.html`, `js/teacher.js` | Teacher page: lessons, live control, results, assignments, export |
| `present.html`, `js/present.js` | Projector: runs your deck, live countdown, results on the slide, join panel |
| `builder.html`, `js/builder.js` | Question builder |
| `setup.html`, `js/rules.js` | Settings check and database-rules generator |
| `js/config.js` | **The only settings file**: Firebase config, teacher, school domains, notes email |
| `js/session.js` | Running a lesson: moving, opening/closing questions, reveals, scores, assignments |
| `js/questions.js` | Finds questions in deck slides |
| `js/qtypes.js` | Question types and marking, shared by every page |
| `js/upload.js` | Adding a lesson (HTML deck, PDF or images, plus question file) |
| `js/deckview.js` | Shows one deck slide safely on students' screens (unseen builds scrambled) |
| `js/notes.js`, `js/notesmail.js` | Students' private notes, and the Apps Script that emails them |
| `js/away.js` | "Left the page" tracking |
| `js/export.js` | CSV export |
| `js/ui.js`, `js/qr.js`, `js/fb.js`, `app.css` | Shared helpers, QR codes, Firebase connection, styles |

---

## Troubleshooting

| Problem | Try |
|---|---|
| A change doesn't show | Wait 1–2 minutes after merging, then hard-refresh (Ctrl/Cmd + Shift + R). |
| Students get "permission denied" or can't answer a new question type | Re-publish the rules from `setup.html`. |
| `auth/unauthorized-domain` when signing in | Add the address shown in the message to Firebase → Authentication → Settings → Authorized domains. If it's already there, try a private window or another browser (an extension may interfere), and make sure the page isn't open inside another page. |
| A student isn't allowed in | Check they're using their school account (`@stu.vinschool.edu.vn`). |
| The projector isn't following | Make sure it's signed in with the teacher account and a lesson is running; it follows the current lesson automatically. |
| The deck's timer looks frozen on the board | On question slides it shows the live countdown; other timers start when you move forward onto their step. |
| Notes aren't emailed | `NOTES_EMAIL_URL` is empty until the Apps Script is deployed (see setup). Students can still copy their notes. |
