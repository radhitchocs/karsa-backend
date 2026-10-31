/**
 * Engine domain tests — ported from ruang-rasa-prototype/tests/domain.test.ts.
 *
 * AC mapping:
 *   AC06 — replace responder: old loses submit, new gains it, answer kept
 *   AC07 — group assignment: balanced, unique, one responder; late join → smallest group
 *   AC08 — nav back to kelompok slide → same groups (no re-assign)
 *   AC09 — nav back to individu slide after groups → review only
 *   AC11 — closed/ended/offline reject submit; stale-slide rejected
 *   AC12 — no kelompok slide → all responses are individu
 *   AC14 — case-insensitive normalize + dedup per sender (awan kata)
 *   AC17 — quiz must be last slide; single kuis only; insert preserves last
 *   AC18 — empty kuis (no questions) rejected
 *   AC20 — second submit with same requestId idempotent; different requestId rejected as final
 *   AC23 — server receivedAt used (now param), not client time
 *   AC25 — quiz state survives restart; presenter disconnect does not pause quiz
 *   AC28 — deadline boundary: accepted before, rejected at/after
 *   AC29 — group leaderboard uses group label + group score
 *   AC33 — leaderboard capped at 5; only after finish+reveal
 */

import { describe, it, expect } from 'vitest';
import { fixtures, } from './fixtures';
import { uid, activity, publicResults, aggregate, insertSlide, newSlide, validate } from './model';
import { execute } from './engine';
import { quizScores, leaderboard, reconcileQuiz } from './quiz';
import type { Session } from './model';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

const NAMES = ['Alya', 'Bima', 'Citra', 'Dimas', 'Eka', 'Farah'];

function makeSession(presIndex = 0): Session {
  const data = fixtures();
  const p = data.presentations[presIndex];
  return {
    id: uid(),
    presentationId: p.id,
    title: p.title,
    slides: structuredClone(p.slides),
    code: '123456',
    status: 'lobi',
    active: 0,
    division: -1,
    participants: NAMES.map((name) => ({ id: uid(), name, online: true })),
    groups: [],
    responses: [],
    questions: [],
    activities: {},
    paused: false,
    presenterOnline: true,
    hideContent: true,
    created: new Date().toISOString(),
  };
}

function setup(presIndex = 0, now = 100_000) {
  const s = makeSession(presIndex);
  execute(s, { type: 'start' }, now);
  const cmd = (c: Parameters<typeof execute>[1], t = now) => execute(s, c, t);
  const participants = s.participants;
  return { s, cmd, participants, now };
}

// Quiz setup: single kuis slide (or kelompok+kuis), N questions, clock-based
function quizSetup(group = false, count = 1) {
  const data = fixtures();
  const p = data.presentations[0];
  const quiz = structuredClone(p.slides.at(-1)!);
  quiz.quizQuestions = Array.from({ length: count }, (_, i) => ({
    id: uid(),
    title: `Soal ${i}`,
    options: ['Benar', 'Salah'],
    correct: [0],
  }));
  quiz.duration = 30;
  p.slides = group ? [p.slides[3], quiz] : [quiz];

  let now = 100_000;
  const s: Session = {
    id: uid(),
    presentationId: p.id,
    title: p.title,
    slides: structuredClone(p.slides),
    code: '654321',
    status: 'lobi',
    active: 0,
    division: -1,
    participants: NAMES.map((name) => ({ id: uid(), name, online: true })),
    groups: [],
    responses: [],
    questions: [],
    activities: {},
    paused: false,
    presenterOnline: true,
    hideContent: true,
    created: new Date().toISOString(),
  };

  const cmd = (c: Parameters<typeof execute>[1]) => execute(s, c, now);
  execute(s, { type: 'start' }, now);
  if (group) {
    execute(s, { type: 'assign', count: 3 }, now);
    execute(s, { type: 'navigate', index: 1 }, now);
  }
  execute(s, { type: 'quizOpen' }, now);

  const submit = (
    participantId = s.participants[0].id,
    option = 0,
    requestId = uid(),
  ) =>
    execute(
      s,
      {
        type: 'quizSubmit',
        participantId,
        questionId: s.quiz!.runs.at(-1)!.questionId,
        option,
        requestId,
      },
      now,
    );

  return {
    s,
    cmd,
    submit,
    get now() { return now; },
    setTime: (v: number) => { now = v; },
  };
}

// ---------------------------------------------------------------------------
// AC07, AC08 — group assignment
// ---------------------------------------------------------------------------

describe('AC07 — pembagian 6/3 seimbang, unik, satu penjawab; tidak bisa melewati pembagian', () => {
  it('repeat 15×: balanced groups, all members unique, each group has responder', () => {
    for (let i = 0; i < 15; i++) {
      const { s, cmd } = setup();
      // Can't skip past kelompok slide without assigning (index 4 needs index 3 done)
      expect(() => cmd({ type: 'navigate', index: 4 })).toThrow(/Bagikan kelompok/);
      cmd({ type: 'navigate', index: 3 });
      cmd({ type: 'assign', count: 3 });
      expect(s.groups.map((g) => g.members.length)).toEqual([2, 2, 2]);
      expect(new Set(s.groups.flatMap((g) => g.members)).size).toBe(6);
      s.groups.forEach((g) => expect(g.members).toContain(g.responder));

      // Navigate away and back → same groups
      const before = structuredClone(s.groups);
      cmd({ type: 'navigate', index: 4 });
      cmd({ type: 'navigate', index: 3 });
      expect(s.groups).toEqual(before); // AC08

      // Cannot re-assign once done
      expect(() => cmd({ type: 'assign', count: 3 })).toThrow(/sudah dibagikan/);
    }
  });
});

// ---------------------------------------------------------------------------
// AC07 (addendum) — real participant always responder when group has one
// ---------------------------------------------------------------------------

describe('AC07 — tidak bisa melewati pembagian; hanya peserta online dibagi', () => {
  it('single-member group cannot replace responder; offline excluded from assignment', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 3 });
    // Take 5 of 6 offline so only 1 online → assign needs ≥2
    s.participants.slice(1).forEach((p) => { p.online = false; });
    expect(() => cmd({ type: 'assign', count: 1 })).toThrow(/minimal 2 peserta/);
  });

  it('repeat 10×: when group has real+simulated members, real is always responder', () => {
    for (let i = 0; i < 10; i++) {
      const { s, cmd } = setup();
      // Mark participants[3], [4], [5] as simulated bots (offline)
      s.participants[3].simulated = true;
      s.participants[3].online = false;
      s.participants[4].simulated = true;
      s.participants[4].online = false;
      s.participants[5].simulated = true;
      s.participants[5].online = false;
      cmd({ type: 'navigate', index: 3 });
      cmd({ type: 'assign', count: 2 });
      // Every group with at least one real member must have a real responder
      s.groups.forEach((g) => {
        const hasReal = g.members.some(
          (id) => s.participants.some((p) => p.id === id && !p.simulated),
        );
        if (hasReal) {
          const responder = s.participants.find((p) => p.id === g.responder);
          expect(responder?.simulated ?? false, 'responder must be real when real member exists').toBe(false);
        }
      });
    }
  });

  it('all-simulated group: bot is responder (acceptable)', () => {
    const { s, cmd } = setup();
    // Mark ALL participants as simulated (all-bot session)
    s.participants.forEach((p) => { p.simulated = true; });
    cmd({ type: 'navigate', index: 3 });
    cmd({ type: 'assign', count: 2 });
    s.groups.forEach((g) => {
      expect(g.responder, 'responder must be set even in all-bot group').toBeTruthy();
      expect(g.members).toContain(g.responder);
    });
  });
});

// ---------------------------------------------------------------------------
// AC06 — replace responder
// ---------------------------------------------------------------------------

describe('AC06 — guard penjawab, update tanpa duplikasi, pergantian mencabut hak lama', () => {
  it('member cannot submit; replace transfers right; old answer kept; closed rejects', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 3 });
    cmd({ type: 'assign', count: 3 });
    cmd({ type: 'navigate', index: 5 });
    cmd({ type: 'open' });

    const g = s.groups[0];
    const old = g.responder;
    const member = g.members.find((id) => id !== old)!;
    const submit = (id: string, value = '0') =>
      cmd({
        type: 'submit',
        slideId: s.slides[5].id,
        participantId: id,
        value: [value],
      });

    // member cannot submit (only responder)
    expect(() => submit(member)).toThrow(/Hanya penjawab/);

    // responder submits twice → only 1 response (idempotent update)
    submit(old);
    submit(old, '1');
    expect(s.responses.length).toBe(1);

    // replace responder
    cmd({ type: 'replace', groupId: g.id });
    expect(s.groups[0].responder).toBe(member);

    // old responder loses right
    expect(() => submit(old)).toThrow(/Hanya penjawab/);

    // new responder submits (overwrites)
    submit(member, '2');
    expect(s.responses.length).toBe(1);
    expect(s.responses[0].ownerId).toBe(g.id);
    expect(s.responses[0].submittedBy).toBe(member);

    // closed rejects
    cmd({ type: 'close' });
    expect(() => submit(member)).toThrow(/ditutup/);
  });
});

// ---------------------------------------------------------------------------
// AC09 — individu answer kept; no leak before reveal; reopen hides results
// ---------------------------------------------------------------------------

describe('AC09 — individu tetap tersimpan, hasil tidak bocor, membuka kembali menyembunyikan', () => {
  it('response saved individually; publicResults=null until close+reveal; reopen hides again', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 1 });
    cmd({ type: 'open' });
    cmd({
      type: 'submit',
      slideId: s.slides[1].id,
      participantId: s.participants[0].id,
      value: ['1'],
    });

    // no leak before reveal
    expect(publicResults(s, s.slides[1])).toBeNull();

    // cannot reveal before close
    expect(() => cmd({ type: 'reveal' })).toThrow(/Tutup respons/);

    // close then reveal
    cmd({ type: 'close' });
    cmd({ type: 'reveal' });
    expect(publicResults(s, s.slides[1])!.total).toBe(1);

    // reopen hides results again (AC: D18)
    cmd({ type: 'open' });
    expect(publicResults(s, s.slides[1])).toBeNull();

    // navigate while activity is open → must close first (A6)
    expect(() => cmd({ type: 'navigate', index: 3 })).toThrow(/Tutup aktivitas/);

    // close first, then navigate
    cmd({ type: 'close' });
    cmd({ type: 'navigate', index: 3 });
    expect(activity(s, s.slides[1].id).status).toBe('tutup');
    cmd({ type: 'assign', count: 3 });
    cmd({ type: 'navigate', index: 1 });
    expect(() => cmd({ type: 'open' })).toThrow(/ditinjau/);
    expect(s.responses[0].ownerType).toBe('individu');
  });
});

// ---------------------------------------------------------------------------
// AC07 — late join → smallest group
// ---------------------------------------------------------------------------

describe('AC07 — late join kelompok terkecil dan penjawab tidak berubah', () => {
  it('late joiner placed in smallest group; responders unchanged', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 3 });
    cmd({ type: 'assign', count: 3 });
    const responders = s.groups.map((g) => g.responder);

    // 4 late joiners
    for (let i = 0; i < 4; i++) {
      s.participants.push({ id: uid(), name: `Tamu${i}`, online: true });
      // simulate reconnect to trigger group assignment for new participant
      execute(s, { type: 'connection', participantId: s.participants.at(-1)!.id });
      execute(s, { type: 'connection', participantId: s.participants.at(-1)!.id });
    }

    const sizes = s.groups.map((g) => g.members.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(s.groups.map((g) => g.responder)).toEqual(responders);
  });
});

// ---------------------------------------------------------------------------
// AC14 — awan kata: normalize + dedup per sender
// ---------------------------------------------------------------------------

describe('AC14 — frasa identik dinormalisasi dan deduplikasi per pengirim', () => {
  it('three identical phrases (different case/spacing) from each responder deduped to one per group', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 3 });
    cmd({ type: 'assign', count: 3 });
    cmd({ type: 'navigate', index: 6 });
    cmd({ type: 'open' });

    for (const g of s.groups) {
      cmd({
        type: 'submit',
        slideId: s.slides[6].id,
        participantId: g.responder,
        value: ['  Saling   Dengar  ', 'saling dengar', 'SALING DENGAR'],
      });
    }

    expect(aggregate(s, s.slides[6]).words).toEqual([['saling dengar', 3]]);
  });
});

// ---------------------------------------------------------------------------
// AC11 — Q&A privacy + ended session rejects submit
// ---------------------------------------------------------------------------

describe('AC11 — sesi baru bersih dan sesi selesai menolak kiriman', () => {
  it('ended session rejects submit; new session has fresh participants', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 1 });
    cmd({ type: 'open' });
    cmd({ type: 'simulate' }); // 6 simulated responses
    expect(s.responses.length).toBe(6);

    cmd({ type: 'end' });
    expect(() =>
      cmd({
        type: 'submit',
        slideId: s.slides[1].id,
        participantId: s.participants[0].id,
        value: ['1'],
      }),
    ).toThrow(/berakhir/);

    // New session created fresh (different participant IDs)
    const s2 = makeSession(0);
    execute(s2, { type: 'start' });
    expect(s2.responses.length).toBe(0);
    expect(s2.groups.length).toBe(0);
    expect(s2.participants[0].id).not.toBe(s.participants[0].id);
  });
});

// ---------------------------------------------------------------------------
// AC12 — no kelompok → all individu
// ---------------------------------------------------------------------------

describe('AC12 — pembagian awal/akhir dan tanpa kelompok', () => {
  it('presentation without kelompok: all responses are individu', () => {
    // presentation index 3: no kelompok slide
    const { s, cmd } = setup(3);
    const division = s.slides.findIndex((sl) => sl.type === 'kelompok');
    if (division >= 0) {
      cmd({ type: 'navigate', index: division });
      cmd({ type: 'assign', count: 3 });
      expect(s.groups.length).toBe(3);
    } else {
      cmd({ type: 'navigate', index: 1 });
      cmd({ type: 'open' });
      cmd({ type: 'simulate' });
      expect(s.responses.every((r) => r.ownerType === 'individu')).toBe(true);
      expect(s.responses.length).toBe(6);
    }
  });

  it('presentations 1 and 2 also work (groups or individu)', () => {
    for (const idx of [1, 2]) {
      const { s, cmd } = setup(idx);
      const division = s.slides.findIndex((sl) => sl.type === 'kelompok');
      if (division >= 0) {
        cmd({ type: 'navigate', index: division });
        cmd({ type: 'assign', count: 3 });
        expect(s.groups.length).toBe(3);
      } else {
        cmd({ type: 'navigate', index: 1 });
        cmd({ type: 'open' });
        cmd({ type: 'simulate' });
        expect(s.responses.every((r) => r.ownerType === 'individu')).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC11 — connection toggle, stale-slide rejected
// ---------------------------------------------------------------------------

describe('AC11 — connection, jeda presenter, stale slide', () => {
  it('offline participant cannot submit; paused session rejects; stale slideId rejected', () => {
    const { s, cmd } = setup();
    cmd({ type: 'navigate', index: 1 });
    cmd({ type: 'open' });
    const pid = s.participants[0].id;
    const submit = () =>
      cmd({
        type: 'submit',
        slideId: s.slides[1].id,
        participantId: pid,
        value: ['1'],
      });

    // toggle offline
    cmd({ type: 'connection', participantId: pid });
    expect(() => submit()).toThrow(/terputus/);

    // toggle back online
    cmd({ type: 'connection', participantId: pid });

    // presenter disconnect → paused
    cmd({ type: 'presenterDisconnect' });
    expect(() => submit()).toThrow(/dijeda/);

    // reconnect but not resumed
    cmd({ type: 'presenterReconnect' });
    expect(() => submit()).toThrow(/dijeda/);

    // resume → can submit
    cmd({ type: 'resume' });
    submit();

    // navigate away then try to submit old slideId → stale
    cmd({ type: 'close' });
    cmd({ type: 'navigate', index: 2 });
    cmd({ type: 'open' });
    expect(() => submit()).toThrow(/Slide telah berubah/);
  });
});

// ---------------------------------------------------------------------------
// replace without candidates; only online participants assigned
// ---------------------------------------------------------------------------

describe('AC07 — tidak mengganti penjawab tanpa kandidat; hanya peserta online dibagi', () => {
  it('single-member group cannot replace responder; offline excluded from assignment', () => {
    const { s, cmd } = setup();
    // take participant 0 offline
    cmd({ type: 'connection', participantId: s.participants[0].id });
    cmd({ type: 'navigate', index: 3 });

    // fewer than 2 groups if only 5 online with count=6 → error
    expect(() => cmd({ type: 'assign', count: 6 })).toThrow(/minimal 2/);

    // assign 3 groups from 5 online → one group has 1 member
    cmd({ type: 'assign', count: 3 });
    expect(s.groups.flatMap((g) => g.members).length).toBe(5);

    const single = s.groups.find((g) => g.members.length === 1)!;
    expect(() => cmd({ type: 'replace', groupId: single.id })).toThrow(/Tidak ada anggota/);
    expect(s.groups.find((g) => g.id === single.id)!.responder).toBe(single.responder);
  });
});

// ---------------------------------------------------------------------------
// Late joiner (offline during assign) gets group on reconnect
// ---------------------------------------------------------------------------

describe('AC07 — peserta offline saat pembagian mendapatkan kelompok saat kembali', () => {
  it('offline participant excluded, joins smallest group on reconnect', () => {
    const { s, cmd } = setup();
    const pid = s.participants[0].id;
    cmd({ type: 'connection', participantId: pid }); // offline
    cmd({ type: 'navigate', index: 3 });
    cmd({ type: 'assign', count: 3 });

    // participant 0 not in any group
    expect(s.groups.some((g) => g.members.includes(pid))).toBe(false);
    const responders = s.groups.map((g) => g.responder);

    // reconnect → added to smallest group
    cmd({ type: 'connection', participantId: pid });
    expect(s.groups.filter((g) => g.members.includes(pid)).length).toBe(1);
    expect(s.groups.map((g) => g.responder)).toEqual(responders); // responders unchanged
  });
});

// ---------------------------------------------------------------------------
// AC17, AC18 — kuis validation
// ---------------------------------------------------------------------------

describe('AC17+AC18 — kuis tunggal terakhir, sisipan slide, kosong ditolak, 12 soal dapat dimainkan', () => {
  it('insertSlide always keeps kuis last; duplicate kuis throws; empty questions rejected', () => {
    const data = fixtures();
    const p = data.presentations[0];
    const quiz = p.slides.at(-1)!;

    // Insert a non-kuis slide → kuis stays last
    expect(insertSlide(p.slides, newSlide('materi')).at(-1)!.id).toBe(quiz.id);

    // Insert a second kuis → throws
    expect(() => insertSlide(p.slides, newSlide('kuis'))).toThrow(/satu/);

    // validate empty questions
    expect(
      validate({ id: '', title: p.title, slides: [{ ...quiz, quizQuestions: [] }], updated: '' })
        .some((e) => e.includes('minimal')),
    ).toBe(true);
  });

  it('12-question quiz plays all rounds', () => {
    const q = quizSetup(false, 12);
    for (let i = 0; i < 12; i++) {
      q.setTime(130_000 + i * 30_000);
      q.cmd({ type: 'quizTick' });
      if (i < 11) q.cmd({ type: 'quizOpen' });
    }
    q.cmd({ type: 'quizFinish' });
    expect(q.s.quiz!.runs.length).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// AC20, AC23, AC28 — idempotent, server time, deadline boundary
// ---------------------------------------------------------------------------

describe('AC20+AC23+AC28 — receipt idempoten, final, cepat lebih tinggi, tenggat eksklusif', () => {
  it('same requestId idempotent; different requestId after final rejected; faster gets more points; deadline=exclusive', () => {
    const q = quizSetup();
    const ps = q.s.participants;

    // AC20: idempotent submit
    q.setTime(101_000);
    q.submit(ps[0].id, 0, 'receipt');
    const first = structuredClone(q.s.quiz!.runs[0].answers[0]);
    q.submit(ps[0].id, 0, 'receipt'); // same requestId → same answer
    expect(q.s.quiz!.runs[0].answers).toHaveLength(1);

    // different requestId with different option → different-request error
    expect(() => q.submit(ps[0].id, 1, 'receipt')).toThrow(/berbeda/);

    // same participant, new requestId → already final
    expect(() => q.submit(ps[0].id, 0)).toThrow(/final/);

    // AC23: scoring uses receivedAt (now param), not client time
    q.setTime(120_000); // later → less bonus
    q.submit(ps[1].id);
    q.submit(ps[2].id, 1); // wrong answer

    q.setTime(129_999); // just before deadline
    q.submit(ps[3].id); // AC28: accepted

    // AC28: deadline boundary — at exactly deadlineAt is rejected
    q.setTime(130_000);
    expect(() => q.submit(ps[4].id)).toThrow(/waktu habis/);

    // close + submit for already-answered idempotent
    q.cmd({ type: 'quizTick' });
    q.submit(ps[0].id, 0, 'receipt'); // still idempotent after close

    const scores = quizScores(q.s);

    // faster = higher score (ps[1] at 120s < ps[3] at 129s? no wait, ps[0] at 101s is fastest)
    expect(scores[0].total).toBeGreaterThan(scores[1].total);

    // wrong answer → wrong count = 1
    expect(scores.find((r) => r.id === ps[2].id)!.wrong).toBe(1);

    // missed deadline → missing count = 1
    expect(scores.find((r) => r.id === ps[4].id)!.missing).toBe(1);

    // AC20: original answer preserved (idempotent)
    expect(q.s.quiz!.runs[0].answers[0]).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// AC06 (quiz) — group: member rejected; replace doesn't reopen final answer
// ---------------------------------------------------------------------------

describe('AC06 (quiz) — kelompok: anggota ditolak, penjawab baru tidak membuka jawaban final', () => {
  it('member cannot quiz-submit; replace does not allow re-submit; group score accumulates', () => {
    const q = quizSetup(true, 2);
    const g = q.s.groups[0];
    const oldResponder = g.responder; // capture before replace mutates g.responder
    const member = g.members.find((id) => id !== oldResponder)!;

    // member cannot submit
    expect(() => q.submit(member)).toThrow(/penjawab/);

    q.submit(oldResponder);
    const before = structuredClone(q.s.quiz!.runs[0]);

    // replace responder
    q.cmd({ type: 'replace', groupId: g.id });

    // old responder can no longer submit
    expect(() => q.submit(oldResponder)).toThrow(/penjawab/);

    // new responder cannot re-submit (answer already final for this group)
    expect(() => q.submit(member)).toThrow(/final/);

    // answer unchanged
    expect(q.s.quiz!.runs[0]).toEqual(before);
    expect(before.answers[0].ownerId).toBe(g.id);

    // open Q2 — new responder is `member` now, can submit
    q.setTime(130_000);
    q.cmd({ type: 'quizOpen' });
    q.submit(member);
    expect(quizScores(q.s).find((r) => r.id === g.id)!.correct).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC33, AC29 — leaderboard capped at 5; group labels; only after finish+reveal
// ---------------------------------------------------------------------------

describe('AC33+AC29 — peringkat maksimal lima, group label, hanya setelah finish+reveal', () => {
  it('leaderboard empty before finish; empty before reveal; 5 entries after reveal', () => {
    const q = quizSetup();

    // quizReveal before finish should throw
    expect(() => q.cmd({ type: 'quizReveal' })).toThrow(/setelah/);
    expect(leaderboard(q.s)).toEqual([]);

    // add 7th participant (late joiner — now 7 total, still only top 5 shown)
    q.s.participants.push({ id: uid(), name: 'Terlambat', online: true });

    q.setTime(130_000);
    q.cmd({ type: 'quizFinish' });
    expect(leaderboard(q.s)).toEqual([]); // not revealed yet

    q.cmd({ type: 'quizReveal' });
    expect(leaderboard(q.s).length).toBe(5); // capped at 5

    // all unanswered → same score → all rank 1
    expect(leaderboard(q.s).every((r) => r.rank === 1)).toBe(true);
  });

  it('tiebreak: pts desc → correct desc → alphabetical; correct count secondary', () => {
    const q = quizSetup();
    q.setTime(130_000);
    q.cmd({ type: 'quizFinish' });
    q.cmd({ type: 'quizReveal' });

    const s = structuredClone(q.s);
    const ids = s.participants.map((p) => p.id);
    // Manually set: p2 correct, p1 wrong, same score column
    s.quiz!.runs[0].answers = [
      { ownerId: ids[1], submittedBy: ids[1], option: 0, requestId: 'a', receivedAt: 1, correct: true, score: 500 },
      { ownerId: ids[0], submittedBy: ids[0], option: 1, requestId: 'b', receivedAt: 1, correct: false, score: 500 },
    ];
    expect(quizScores(s)[0].id).toBe(ids[1]); // correct wins tiebreak
    expect(quizScores(s)[1].rank).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AC25 — quiz state survives restart; presenter disconnect doesn't pause quiz
// ---------------------------------------------------------------------------

describe('AC25 — refresh memulihkan tenggat/skor; presenter terputus tidak menjeda kuis', () => {
  it('deadline and answers preserved after state clone; presenter disconnect does not block submit', () => {
    const q = quizSetup(false, 2);
    q.submit(); // p0 answers Q1 fast
    const before = structuredClone(q.s.quiz!.runs[0]);

    // cannot navigate away while quiz open
    expect(() => q.cmd({ type: 'navigate', index: 0 })).toThrow(/Tunggu/);

    // presenter disconnect does NOT pause quiz (AC25)
    q.cmd({ type: 'presenterDisconnect' });
    q.setTime(120_000);
    q.submit(q.s.participants[1].id); // p1 can still submit despite disconnect

    // restore: clone snapshot → deadlineAt preserved
    const restored = structuredClone(q.s);
    reconcileQuiz(restored, q.now);
    expect(restored.quiz!.runs[0].deadlineAt).toBe(before.deadlineAt);

    // after deadline passes: reconcile closes run
    q.setTime(131_000);
    const restarted = structuredClone(q.s);
    reconcileQuiz(restarted, 131_000);
    expect(restarted.quiz!.runs[0].closed).toBe(true);

    // original answers unchanged
    expect(restarted.quiz!.runs[0].answers[0]).toEqual(before.answers[0]);

    // quizTick closes; presenter reconnect+resume allows navigate
    q.cmd({ type: 'quizTick' });
    q.cmd({ type: 'presenterReconnect' });
    q.cmd({ type: 'resume' });
    q.cmd({ type: 'navigate', index: 0 });

    // Q1 run openedAt unchanged after review
    expect(q.s.quiz!.runs[0].openedAt).toBe(before.openedAt);

    q.cmd({ type: 'end' });
    expect(leaderboard(q.s)).toEqual([]); // not finished/revealed
  });
});
