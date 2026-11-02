# Live lessons

Teacher-paced slides on students' devices, with live hinge-question voting.
Static pages + Firebase Realtime Database (Google sign-in).

- `index.html` — student page (the QR code opens this)
- `teacher.html` — teacher control: lessons, live session, private results, CSV export
- `present.html` — projector view
- `setup.html` — checks `js/config.js` and generates the database rules

This repository holds code only. Lesson slides and answers live in the teacher-only part of the
database and are never stored here.
