# Karsa — Implementation Plan

Source of truth: PRD-Karsa-v0.4.0.md (`/Users/mac/Documents/code/inception/PRD-Karsa-v0.4.0.md`)

**Key rule:** Presentations are stored in PostgreSQL via the backend. `localStorage` is only
for demo mode (`NEXT_PUBLIC_DEMO_MODE=true`), not the main data path.

---

## Phase status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Scaffold, contracts, domain files, Neobrutalism init | ✅ Done |
| 1 | Backend core | ✅ Done |
| 2 | Socket.IO gateway | ✅ Done |
| 3 | Frontend — Presenter POV (real backend) | ✅ Done |
| 4 | Frontend — Participant + Projector POVs | ✅ Done |
| 5 | Demo mode + edge cases | 🔄 In progress |
| 6 | Demo validation (PRD §9 E2E + AC01–AC29) | 🔲 Not started |
| 7 | Polish (Batch A ✅ · Batch B ✅ · Batch C 🔲) | 🔄 In progress |

---

## Phase 0 — Scaffold ✅

**Done.** Both repos scaffolded, contracts/ identical in both, domain files copied verbatim,
Neobrutalism Components initialized, TypeScript compiles clean, Prisma 14 tables migrated,
backend health endpoint live, git init + initial commit in both repos, check-contracts.sh
passing, READMEs written.

---

## Phase 1 — Backend core

### Scope

1. **Seed** — `prisma/seed.ts` inserts 4 demo presentations and 6 participants
   (Alya, Bima, Citra, Dimas, Eka, Farah) when `DEMO_MODE=true`.
2. **Auth** — `POST /api/auth/register`, `/login`, `/logout`; Argon2id hash; JWT access
   token (short-lived) + refresh token (httpOnly cookie).
3. **Presentations CRUD** — `GET/POST /api/presentations`, `GET/PATCH/DELETE /api/presentations/:id`,
   `PUT /api/presentations/:id/slides`. Slide array validated on save: at most one Kuis slide,
   Kuis always last, each slide type validates its own required fields.
4. **Sessions** — `POST /api/presentations/:id/sessions` creates session in LOBBY state.
   `POST /api/sessions/join` accepts code + name, returns participant identity.
5. **GET /api/sessions/:id/state** — Returns projected snapshot. Role determined from request:
   presenter JWT → `projectForPresenter(session)`, participant token → `projectForParticipant(session, pid)`,
   projector token → `projectForProjector(session)`.
6. **Projector token** — `GET /api/sessions/:id/projector-token` issues/returns a persistent
   token for the session (D20). Token expires when session ends.
7. **GET /api/sessions/:id/results** — Summary after session ends.

### Acceptance criteria

- [x] `npx prisma db seed` inserts demo data; re-run is idempotent.
- [x] `POST /api/auth/register` + `/login` returns JWT; protected endpoints reject missing/invalid JWT with 401.
- [x] `PUT /api/presentations/:id/slides` with a Kuis slide not-last returns 422 with clear message.
- [x] `POST /api/sessions/join` with invalid code returns 404; valid code + name returns `{ participantId, token }`.
- [x] `GET /api/sessions/:id/state` as presenter returns `PresenterView`; as participant returns `ParticipantView` without `correct` key; as projector returns `ProjectorView` without `correct`/`explanation`.
- [x] `GET /api/sessions/:id/projector-token` returns same token on repeated calls for same session.
- [x] `npm run build && node dist/main` starts without error; all endpoints respond correctly.
- [x] `npx tsc --noEmit` → 0 errors.

### Blocked by OQs

- OQ01, OQ02 not needed yet (quiz scoring/timer not in Phase 1).

---

## Phase 2 — Socket.IO gateway

### Scope

1. **Rooms** — `presenter-{sessionId}`, `projector-{sessionId}`, `participant-{pid}`.
   Client joins room on connect with its role token.
2. **Commands** — All `SessionCommandPayload` variants handled via `socket.emit('command', envelope)`.
   Server calls `execute()` / `quizExecute()` from domain, persists new state, then projects
   and broadcasts.
3. **Snapshot broadcast** — After each committed command: emit `session.snapshot` to
   `presenter-{sessionId}`, to `projector-{sessionId}`, and to each `participant-{pid}` room.
   Clients replace state (no merge).
4. **CommandReceipt idempotency** — `requestId` stored in `CommandReceipt` table; duplicate
   returns prior ack without re-executing.
5. **Quiz auto-close timer** — On `QuizOpenQuestion`, schedule server-side timer for
   `deadlineAt`. On expiry, execute `QuizCloseQuestion` automatically. Use NestJS
   `SchedulerRegistry` (cron or timeout). Timer survives hot-reload by persisting deadline
   in DB (OQ04 — timer does NOT pause when presenter disconnects; deadline runs to completion).
6. **Reconnect** — On reconnect, client calls `GET /api/sessions/:id/state` to get fresh
   snapshot before re-joining socket room.

### Acceptance criteria

- [x] Client emitting `command` gets ack with `ok: true` and updated `entityVersion`.
- [x] Duplicate `requestId` returns same ack without double-applying command.
- [x] After any command, all connected clients in all three room types receive `session.snapshot`.
- [x] `QuizOpenQuestion` schedules timer; question closes automatically at deadline without
  any client interaction.
- [x] Client that disconnects and reconnects gets correct current snapshot from REST before
  re-subscribing.
- [x] `npx tsc --noEmit` → 0 errors.

### Done

7 integration tests pass (70 total). Key: SessionGateway + SessionCommandService with
`CommandReceipt` idempotency, POV snapshot broadcast, quiz auto-close timer, presenter
grace period (PRESENTER_GRACE_MS), and JwtGuard skip for non-HTTP contexts.

### OQ status at Phase 2 close

All OQs blocking Phase 2 are resolved:
- OQ01 ✅ (scoring formula) — implemented in domain/quiz.ts; tested in quiz.spec.ts
- OQ02 ✅ (timer duration) — default 30 s, range 10–120 s; tests use `duration: 1` for speed
- OQ04 ✅ (timer when presenter disconnects) — timer runs to completion; quizSubmit bypasses
  the paused check in domain engine (CH19); verified by AC06 and AC14

---

## Phase 3 — Frontend: Presenter POV (real backend)

### Scope

All presenter-facing screens wired to the real backend via `ApiSessionService`.
`NEXT_PUBLIC_DEMO_MODE` is NOT set; JWT stored in sessionStorage.

1. **ApiSessionService** — `services/api-session-service.ts`:
   REST initial state via TanStack Query; Socket.IO with Bearer token from sessionStorage;
   `requestId` + ack per command; incoming `session.snapshot` replaces Zustand store state;
   refetch on reconnect; command failures show toast, keep draft.
2. **Login** — `/login`: email + password → POST /api/auth/login → JWT in sessionStorage.
3. **S01** — `/` Presentation list: TanStack Query for GET/POST/DELETE /api/presentations;
   "Mulai" creates session → POST /api/presentations/:id/sessions → navigate to presenter.
4. **S02** — `/presentations/[id]/edit` Editor: all slide types, layout picker, move
   up/down order, quiz-last enforcement, save via PUT /api/presentations/:id/slides.
5. **S13** — Quiz editor panel inside S02: add/edit/delete questions, correct key, duration.
6. **S04** — `/session/[id]/presenter` (status: lobi): code, participant count, Start button.
7. **S05** — `/session/[id]/presenter` (status: aktif): slide navigator, per-slide
   open/close/reveal controls, response count.
8. **S08** — Grouping panel: group count, Bagikan Kelompok, group list + responder replacement.
9. **S11** — Q&A panel for tanya slides: question list, show/hide.
10. **S14** — Quiz panel: countdown timer from deadlineAt, submission count, open-next/finish.
    No manual close button (D16).
11. **S16** — Leaderboard: top-5 table after quiz.revealLeaderboard.
12. **S12** — Session ended: redirect to `/session/[id]/summary`.

### Evidence ✅

- 25 screenshots in `e2e/screenshots/` (00–26) covering every presenter state.
- Playwright: 3/3 tests pass (full flow, login error, editor slide types).
- Key finding: `quiz.start` maps to `quizOpen` — first question opens immediately.
- Groups require ≥2 online participants; test connects 3 via Socket.IO in `beforeAll`.

### Acceptance criteria

- [x] Login error on wrong password; correct login redirects.
- [x] S01 list/create/delete works end-to-end.
- [x] Editor: all slide types save; quiz last enforced.
- [x] S04: code displayed; Start navigates to active.
- [x] S05: open/close/reveal updates clients in real time.
- [x] S08: group assignment + responder replacement work.
- [x] S14: countdown from deadlineAt; auto-close at deadline (D16).
- [x] S16: leaderboard shown after revealLeaderboard.
- [x] `pnpm typecheck` → 0 errors.
- [x] Playwright test passes (3/3).

---

## Phase 4 — Frontend: Participant + Projector POVs ✅

### Scope

1. **S03** — `/join`: code input, name input, error handling.
2. **S06** — `/session/[id]/projector`: slide content, response progress, revealed results.
3. **S07** — `/session/[id]/participant` (sub-role: individual): active slide, response input,
   sent/closed status.
4. **S09** — `/session/[id]/participant` (sub-role: member): group number, member list,
   responder name, group response read-only.
5. **S10** — `/session/[id]/participant` (sub-role: responder): group identity label, active
   input, Kirim Jawaban Kelompok button.
6. **S15** — Participant + projector quiz view: timer, question, answer options (participant),
   submission status, waiting state.
7. **S16** — Leaderboard on participant route: top-5 + own-rank row below (D17). On projector
   route: top-5 only (no own-rank row on projector; projector is not a specific participant).

### Acceptance criteria

- [x] `/join` with wrong code shows Indonesian error message.
- [x] S07: submitting answer updates own view; cannot re-submit after close.
- [x] S09: member sees group number and responder name; input disabled.
- [x] S10: responder can submit and update until closed; sees confirmation.
- [x] S15 participant: timer visible; answer locked after submission or deadline.
- [x] S16 participant: participant ranked 6th sees top-5 table then own row below (D17/AC33).
- [x] S16 projector: shows top-5 only; no own-rank row.
- [x] `pnpm typecheck` → 0 errors.

---

## Phase 5 — Demo mode + edge cases

### Scope

1. **MockSessionService** — Full in-browser implementation using domain/engine.ts and quiz.ts.
   Enabled by NEXT_PUBLIC_DEMO_MODE=true. No backend required.
2. **SimulationControls** — Demo-only overlay: role switch, add sim responses, force-close quiz.
3. **Reconnect banner** — Socket disconnect → banner; reconnect → re-fetch + dismiss.
4. **Projector token flow** — /session/[id]/projector uses projector token from
   GET /api/sessions/:id/projector-token.
5. **Participant + Projector views** — S03 join, S06 projector, S07/S09/S10 participant,
   S15 quiz participant/projector.

### Acceptance criteria

- [x] Demo mode: full quiz flow in browser with fixture participants. Evidence: `pnpm test:e2e:demo` passes 4/4 (e2e/demo.spec.ts).
- [ ] Disconnect banner appears within 3s; clears on reconnect. Evidence: e2e/phase4.spec.ts connection-banner test.
- [ ] Projector loads with projector token only. Evidence: e2e/phase4.spec.ts projector-token test.
- [x] SimulationControls visible only in demo mode. Evidence: e2e/demo.spec.ts D19 test + component only rendered in DemoPresenterClient.
- [x] `pnpm typecheck` → 0 errors. Evidence: `pnpm typecheck` exits 0.
- [x] MockSessionService unit tests pass (30/30). Evidence: `pnpm vitest run services/mock-session-service.spec.ts`.

---

## Phase 6 — Demo validation (PRD §9 E2E + AC01–AC29)

### Scope

One end-to-end Playwright run of the full PRD §9 demo scenario against the real backend,
plus a checklist of every PRD acceptance criterion (AC01–AC29) with test name or screenshot.

No new feature code. Only evidence gathering.

### PRD §9 demo scenario (e2e/demo.spec.ts against real backend)

Full flow: home → materi → pilihan → polling → kelompok → awan → tanya → kuis (3 questions, auto-close) → leaderboard → end.

Verified in each step:
- Privacy: participant POV never exposes `correct`/`explanation` before reveal.
- D17: participant ranked 6th sees own row below top-5.
- D16: quiz question closes automatically at deadline (no manual close).
- D19: demo participant names frozen to Alya, Bima, Citra, Dimas, Eka, Farah.

### AC01–AC34 evidence checklist

Criteria from PRD v0.3.1 §10 (AC01–AC29) and PRD v0.4.0 §11 (AC30–AC34).

| AC | PRD criteria (Indonesian) | Test / Screenshot |
|----|--------------------------|-------------------|
| AC01 | Membuat presentasi baru — tidak ada pilihan mode individu/kelompok | presenter.spec.ts editor |
| AC02 | Menjalankan aktivitas sebelum pembagian — setiap peserta memiliki hak jawab individu | mock-session-service.spec.ts |
| AC03 | Menjalankan pembagian 6 peserta/3 kelompok — 3 kelompok 2 peserta; 1 penjawab per kelompok | demo.spec.ts demo-08-slide-kelompok-assigned.png |
| AC04 | Anggota biasa membuka pilihan ganda setelah pembagian — input tidak tersedia; peran jelas | mock-session-service.spec.ts 'response.submit fails when no activePid set' + phase4.spec.ts 'member has no submit button' |
| AC05 | Penjawab mengirim lalu memperbarui respons biasa — satu respons kelompok dihitung; anggota melihat pembaruan | mock-session-service.spec.ts 'response.submit' + phase4.spec.ts 'responder submits → member sees terkirim' |
| AC06 | Mengganti penjawab — hak lama hilang, hak baru muncul, jawaban sebelumnya tidak hilang | presenter.spec.ts 'replace responder' + domain/engine.spec.ts 'AC06 — guard penjawab, update tanpa duplikasi, pergantian mencabut hak lama' |
| AC07 | Peserta baru masuk setelah pembagian — ditambahkan ke kelompok terkecil | domain/engine.spec.ts 'AC07 — late join kelompok terkecil dan penjawab tidak berubah' + 'AC07 — pembagian 6/3 seimbang' |
| AC08 | Presenter kembali ke slide pembagian — kelompok sama, tidak ada pembagian ulang | domain/engine.spec.ts 'AC07 — pembagian 6/3 seimbang' (navigate back assertion inside 15× loop) |
| AC09 | Presenter kembali ke slide individu setelah pembagian — hasil lama tetap; hanya tinjauan | domain/engine.spec.ts 'AC09 — individu tetap tersimpan, hasil tidak bocor, membuka kembali menyembunyikan' |
| AC10 | Hasil belum dibuka — peserta/proyektor tidak melihat distribusi atau kunci jawaban | demo.spec.ts privacy assertion |
| AC11 | Respons ditutup/sesi selesai — pengiriman tidak diterima | domain/engine.spec.ts 'AC11 — sesi baru bersih dan sesi selesai menolak kiriman' + 'AC11 — connection, jeda presenter, stale slide' |
| AC12 | Pembagian di akhir/tidak ada pembagian — tanpa pembagian semua respons individu | domain/engine.spec.ts 'AC12 — pembagian awal/akhir dan tanpa kelompok' |
| AC13 | Membuka sesi demo baru dari presentasi sama — kelompok dan respons sesi lama tidak terbawa | mock-session-service.spec.ts 'createSession validation' |
| AC14 | Membuka awan kata dengan frasa identik beda kapital — satu entri gabungan frekuensi benar | domain/engine.spec.ts 'AC14 — frasa identik dinormalisasi dan deduplikasi per pengirim' |
| AC15 | Anggota biasa bertanya melalui Q&A — pertanyaan masuk ke presenter; belum otomatis tampil | demo.spec.ts tanya section |
| AC16 | Membuka halaman hasil demo — data ditandai simulasi | CH25: `Participant.simulated` + `hasSimulatedData` in all 3 views. `SummaryView` shows "Berisi data simulasi — bukan hasil sesi nyata" when `hasSimulatedData=true`. Tests: mock-session-service.spec.ts 'AC16 — hasSimulatedData flag' (3 tests) + projection.service.spec.ts 'AC16 — hasSimulatedData propagated' (2 tests). |
| AC17 | Menambah/memindahkan Kuis — maks satu slide Kuis, selalu terakhir | mock-session-service.spec.ts 'throws when kuis is not the last slide' + domain/engine.spec.ts 'AC17+AC18 — kuis tunggal terakhir, sisipan slide' |
| AC18 | Kuis kosong atau lebih dari 10 pertanyaan — kosong tidak dapat dijalankan | domain/engine.spec.ts 'AC17+AC18 — insertSlide always keeps kuis last; empty questions rejected' |
| AC19 | Menjalankan kuis — urutan soal benar, satu durasi per soal, tertutup otomatis saat tenggat | demo.spec.ts AC30 auto-close section (waitFor timer, no Lewati) |
| AC20 | Kirim jawaban kedua atau retry — perubahan ditolak; retry mengembalikan kiriman dan poin lama | domain/engine.spec.ts 'AC20+AC23+AC28 — receipt idempoten, final, cepat lebih tinggi, tenggat eksklusif' |
| AC21 | Kuis kelompok dan penggantian penjawab — hanya penjawab aktif berhak; skor milik kelompok | mock-session-service.spec.ts 'quiz.answerSubmit' + domain/engine.spec.ts 'AC06 (quiz) — kelompok: anggota ditolak, penjawab baru tidak membuka jawaban final' + phase4.spec.ts quiz group section |
| AC22 | Jawaban benar cepat/lambat, salah/tidak menjawab — skor sesuai konfigurasi; salah/absen = 0 | domain/quiz.spec.ts OQ01 scoring formula |
| AC23 | Waktu klien dimanipulasi — build nyata memakai waktu penerimaan server | domain/engine.spec.ts 'AC20+AC23+AC28 — faster gets more points' (now param controls receivedAt) |
| AC24 | Membuka peringkat sebelum/selepas selesai — sebelum selesai tidak tersedia; setelah maks 5 entri; peserta luar top 5 lihat baris sendiri | demo.spec.ts demo-20-slide-kuis-leaderboard-revealed.png + mock-session-service.spec.ts 'AC33 — participant ranked 6th sees ownEntry' |
| AC25 | Refresh atau meninjau soal lama — tidak mengulang timer, kiriman, maupun penilaian | domain/engine.spec.ts 'AC25 — refresh memulihkan tenggat/skor; presenter terputus tidak menjeda kuis' |
| AC26 | Mengedit tiga varian materi — pratinjau sesuai hasil; dua slot gambar independen | presenter.spec.ts 'editor shows presentation with all slide types' (AC26 layout assertions: Teks/Teks+Gambar/Dua Gambar buttons + #slide-image/#slide-image2) |
| AC27 | Menjalankan pilihan ganda biasa — tidak ada skor kompetitif atau pengaruh pada peringkat | demo.spec.ts pilihan section |
| AC28 | Kiriman pada tenggat — openedAt ≤ receivedAt < deadlineAt; di tenggat/selepasnya ditolak | domain/engine.spec.ts 'AC20+AC23+AC28 — deadline=exclusive (129_999 accepted, 130_000 rejected)' |
| AC29 | Peringkat kuis kelompok — label kelompok dan skor kelompok tampil, bukan skor penjawab | domain/engine.spec.ts 'AC33+AC29 — peringkat maksimal lima' (quizScores uses group.id as ownerId, name=Kelompok N) + backend/projection.service.spec.ts 'quiz revealed: top 5 entries' |
| AC30 | Timer kuis habis tanpa interaksi presenter — soal menutup otomatis; tidak ada tombol tutup di UI | demo.spec.ts 'AC30: 10-second timer auto-closes Q1' (waitFor, no Lewati) + mock-session-service.spec.ts 'auto-closes question after deadline' |
| AC31 | SimulationControls close paksa soal kuis — soal menutup; tombol hanya di mode demo | demo.spec.ts AC31 section (Lewati button on Q2) |
| AC32 | Presenter Buka Kembali respons yang sudah ditutup — hasil publik tersembunyi hingga ditutup lagi | mock-session-service.spec.ts 're-opens a closed activity and resets visible to false' + domain/engine.spec.ts 'AC09 membuka kembali menyembunyikan' |
| AC33 | Peserta ke-6 bergabung saat leaderboard sudah top 5 — melihat baris peringkat sendiri di bawah | mock-session-service.spec.ts 'AC33 — participant ranked 6th sees ownEntry below top-5' + backend/projection.service.spec.ts 'participant pid6 rank 6: ownEntry not null' + domain/engine.spec.ts 'AC33+AC29 leaderboard capped at 5' |
| AC34 | Proyektor di-load sekali; sesi berlanjut 30 menit — token masih valid; tidak perlu join ulang | phase4.spec.ts 'participant + projector POVs — all slide types' (token used throughout; 30-min duration not validated) |

### Acceptance criteria

- [x] `pnpm test:e2e:demo` passes (4/4 tests in e2e/demo.spec.ts).
- [ ] Screenshots for AC03, AC10, AC15, AC16, AC19, AC24, AC27, AC28, AC30 exist in e2e/screenshots/demo-*.png.
- [ ] All AC01–AC34 rows above have a test name or screenshot filled in.
- [ ] `pnpm typecheck` + `npx tsc --noEmit` → 0 errors.

---

## Phase 7 — Polish

BATCH A — bugs (DONE)
A1 participant count real-time · A2 selected highlight · A3 Q&A shown only on
projector · A4 projector countdown ticks · A5 duration 10–120 s · A6 no navigation
while an activity is open (Q&A input must be closed too).

BATCH B — live session UX
B1. Waiting screens on all POVs show the Karsa logo and wordmark. Presenter lobby
    lists joined participants live. Projector shows a short alert when someone joins
    (no full list).
B2. Back button on the presenter lobby.
B3. If every slide is materi, the session starts automatically when it is created
    (presenter never sees the lobby); participants can still join with the code.
B4. Presenter controls: all buttons always visible, disabled according to activity
    status. belum → "Buka", tutup → "Buka Kembali".
B5. Results for Pilihan Ganda, Polling and other choice activities are bar charts
    using the installed neobrutalism chart, on presenter, projector, and participants
    where visible.
B6. Word cloud: no overlapping words (collision-aware layout) and varied, readable
    text colors from the palette (not all black), accessible contrast.
B7. Q&A on the projector shows "N pertanyaan" (total received), not "0/n".
B8. Q&A flow: participants submit while the Q&A slide's input is open; the presenter
    must close it before moving on. On any later slide, the presenter has a Q&A panel
    listing received questions and can show any of them on the projector (projector
    only, per A3).
B9. Quiz: per-question results as a bar chart; presenter button "Tampilkan Hasil" per
    question once it has closed, broadcast to the projector (participants only when
    hideContent is OFF); "Tampilkan Leaderboard" at the end. Early close when every
    eligible online owner has answered (disconnected participants do not block; bots
    count as eligible); speed bonus uses the original duration.
B10. Presenter toggle "Sembunyikan konten di perangkat peserta", default ON, global
    per session, Prisma migration. When ON: while answering, participants see the
    question and answer options/input; after submitting they see a friendly
    confirmation screen ("Jawabanmu sudah masuk! Lihat hasilnya di layar depan"),
    and results, charts, correct-answer highlight, explanation, and per-question quiz
    results are never shown on their device, for every activity type (pilihan,
    polling, awan, Q&A, kuis). Enforce it in the participant projection, not only
    in the UI. Exception: at leaderboard reveal each participant sees their own rank
    and score. When OFF: current POV matrix behavior.

BATCH C — editor
C1. Image upload by file (assets endpoint, create it if missing: local disk, static
    serving, 5 MB, images only), placed directly on the slide canvas.
C2. Materi editing directly on the canvas (WYSIWYG): title, body, image slots mapped
    to the layout; inline text editing.
C3. "Slide Baru" button opening a popover with slide types (icon + name).
C4. Drag-and-drop slide reordering (kuis stays last).
C5. Three-dot menu per slide: Duplikat, Hapus (with confirm).
C6. Autosave: debounced, version-checked (expectedVersion), saving/saved/error status,
    no lost edits on navigation, conflict handling.
C7. Multiple correct options (checkboxes) for Pilihan Ganda and quiz questions;
    participants still choose ONE option; correct if it is in the set; scoring
    unchanged; backward-compatible parsing (number → [number]) of stored slides and
    session snapshots.
C8. Session results stored and viewable later in a results area with line tabs per
    session, including received Q&A questions. Owner presenter only.

OQ-P7 answers
01 hideContent global per session, applies to quiz; own rank/score shown at
   leaderboard reveal. 02 disconnected participants do not block early close; bots
   eligible. 03 create the assets endpoint if missing (Batch C). 04 late joiners see
   the current slide. 05 highlight all correct options (projector; participants when
   hideContent OFF). 06 results page owner only. 07 Buka/Buka Kembali by activity
   status. 08 "Tampilkan Hasil" for a quiz question goes to the projector.
Every change must also work in MockSessionService.

Batch A ✅ Done.
Batch B fixes ✅ Done — all suites green (88/88 unit · 129/129 backend · 6/6 e2e · 4/4 demo · 1/1 bots). Both repos committed.
Batch C ✅ Done — C-1 ✅ · C-2 ✅ · C-Final ✅ (exact C8 backend+e2e assertions, C6 conflict uses own presentation + harmless bump, C6(b) Mulai Sesi toast on invalid draft, PRD CH40). All proofs: no hardcoded ports in app/, no dangerouslySetInnerHTML in editor. Suites green: 104/104 frontend unit · 144/144 backend unit · 15/15 e2e · 4/4 demo · 1/1 bots.

---

## D: BroadcastChannel for cross-tab demo sync

**Question (open):** What would it take to sync demo mode across browser tabs?

**What exists today:** `MockSessionService` is a module-level singleton. Each browser tab gets its own module scope → separate singleton → no shared state.

**What BroadcastChannel would require:**

1. **Serialise all mutations.** Every `command()`, `joinSession()`, `createSession()` call must post a message on a named channel (e.g. `new BroadcastChannel('karsa-demo')`). Payload = `{ type: 'command', sessionId, payload }` etc.

2. **Receive and replay.** Each tab listens on the same channel and applies the mutation to its own in-memory session map. This means the engine's `execute()` must be deterministic (no random inside a command that wasn't already resolved) — it already is, *except* `shuffled()` in `groups.assign`. That call would need the shuffle result to be part of the broadcast payload, not re-computed by each receiver.

3. **Initial sync.** A new tab opening mid-session would need a full-state snapshot broadcast (the sender serialises the entire `Session` object and sends it). Receiver sets its local map from the snapshot.

4. **Leader election (optional).** To avoid double-timers (quiz auto-close), only one tab should own the timer. BroadcastChannel has no built-in leader election; would need a heartbeat/takeover protocol or `localStorage` lock with `storage` event.

5. **Projected-view subscribers.** After receiving a foreign mutation, the receiving tab must call `broadcast(sessionId)` to push updated views to its own React subscribers. This is already done after every local command; the same call works for foreign ones.

**Estimated changes:** ~80 lines in `MockSessionService` + one `BroadcastChannel` wrapper. No domain changes needed except passing shuffle result through broadcast.

**Decision deferred.** Not planned for current phases.

---

## OQ resolution tracking

| ID | Question (short) | Blocking | Resolved | Decision |
|----|-----------------|----------|---------|---------|
| OQ01 | Quiz scoring formula | Phase 6 | ✅ | correct = 500 + round(500 × (1 − elapsed/duration)), [0,500]; wrong/miss = 0. elapsed = serverReceivedAt − openedAt. PRD CH16. |
| OQ02 | Default quiz duration + valid range | Phase 6 (editor) | ✅ | Default 30 s, range 10–120 s, step 5. PRD CH17. |
| OQ03 | Leaderboard tiebreak | Phase 6 | ✅ | Total pts desc → correct count desc → ties share same rank → display order within tie: alphabetical by name (group number for group quiz). PRD CH18. |
| OQ04 | Timer when presenter disconnects | Phase 2 | ✅ | Timer runs to completion. Participants can still submit until deadlineAt. §21 / PRD CH19. |
| OQ05 | Late-join during quiz | Phase 6 | ✅ | Can answer currently open question (until deadline) + all later questions. Missed = 0. No forced last place. PRD CH20. |
| OQ06 | Data retention policy | Not blocking | 🔲 deferred | Out of scope for mockup. PRD CH21. |
| OQ07 | Aggregate image upload limit | Phase 7 | ✅ | No aggregate limit. Per-file 5 MB only (PRD §19.8/CH22). |
