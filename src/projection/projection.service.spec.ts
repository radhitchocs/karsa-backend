/**
 * ProjectionService unit tests.
 * Covers every row of the POV privacy matrix using fixture Sessions built in-memory.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProjectionService } from './projection.service';
import type { Session, Slide, Activity, QuizState, QuizRun } from '../domain/model';
import { uid } from '../domain/model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlide(overrides: Partial<Slide> = {}): Slide {
  return {
    id: uid(),
    type: 'materi',
    title: 'Test slide',
    body: '',
    options: [],
    correct: 0,
    explanation: '',
    image: '',
    groups: 3,
    ...overrides,
  };
}

function makeParticipant(id: string, name: string, online = true) {
  return { id, name, online };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  const slide = makeSlide({ type: 'materi', title: 'S1' });
  return {
    id: 's1',
    presentationId: 'p1',
    title: 'Test',
    slides: [slide],
    code: '123456',
    status: 'aktif',
    active: 0,
    division: -1,
    participants: [makeParticipant('pid1', 'Alya'), makeParticipant('pid2', 'Bima')],
    groups: [],
    responses: [],
    questions: [],
    activities: {},
    paused: false,
    presenterOnline: true,
    created: new Date().toISOString(),
    ...overrides,
  };
}

const VERSION = 1;
let svc: ProjectionService;

beforeEach(() => {
  svc = new ProjectionService();
});

// ---------------------------------------------------------------------------
// Pilihan Ganda — POV matrix
// ---------------------------------------------------------------------------
describe('Pilihan Ganda', () => {
  const slideId = 'slide-pilihan';
  const slide = makeSlide({
    id: slideId,
    type: 'pilihan',
    title: 'Pertanyaan?',
    options: ['A', 'B', 'C'],
    correct: 1,
    explanation: 'B adalah jawaban yang benar.',
  });

  function pilihanSession(activityOverride: Partial<Activity> = {}): Session {
    return makeSession({
      slides: [slide],
      activities: {
        [slideId]: {
          status: 'buka',
          visible: false,
          hiddenWords: [],
          ...activityOverride,
        },
      },
      responses: [
        { id: 'r1', slideId, ownerType: 'individu', ownerId: 'pid1', submittedBy: 'pid1', value: ['1'], updated: '' },
      ],
    });
  }

  it('open: participant does not see correct or explanation', () => {
    const session = pilihanSession({ status: 'buka', visible: false });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBeUndefined();
    expect(view.activeSlide.explanation).toBe('');
  });

  it('closed not revealed: participant still no correct or explanation', () => {
    const session = pilihanSession({ status: 'tutup', visible: false });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBeUndefined();
    expect(view.activeSlide.explanation).toBe('');
  });

  it('revealed: participant sees correct key and explanation', () => {
    const session = pilihanSession({ status: 'tutup', visible: true });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBe(1);
    expect(view.activeSlide.explanation).toBe('B adalah jawaban yang benar.');
  });

  it('projector before reveal: correct and explanation absent', () => {
    for (const actOverride of [
      { status: 'buka', visible: false } as const,
      { status: 'tutup', visible: false } as const,
    ]) {
      const session = pilihanSession(actOverride);
      const view = svc.projectForProjector(session, VERSION);
      const s = view.activeSlide as unknown as Record<string, unknown>;
      expect(s['correct']).toBeUndefined();
      expect(s['explanation']).toBeUndefined();
    }
  });

  it('projector after reveal: correct visible, explanation always absent', () => {
    const session = pilihanSession({ status: 'tutup', visible: true });
    const view = svc.projectForProjector(session, VERSION);
    const s = view.activeSlide as unknown as Record<string, unknown>;
    expect(s['correct']).toBe(1);          // correct key present after reveal
    expect(s['explanation']).toBeUndefined(); // explanation never on projector
  });

  it('revealed: projector sees aggregate results', () => {
    const session = pilihanSession({ status: 'tutup', visible: true });
    const view = svc.projectForProjector(session, VERSION);
    expect(view.revealedResults).not.toBeNull();
    expect(view.revealedResults?.type).toBe('pilihan');
  });

  it('not revealed: projector revealedResults is null', () => {
    const session = pilihanSession({ status: 'tutup', visible: false });
    const view = svc.projectForProjector(session, VERSION);
    expect(view.revealedResults).toBeNull();
  });

  it('presenter sees correct key', () => {
    const session = pilihanSession({ status: 'buka', visible: false });
    const view = svc.projectForPresenter(session, VERSION);
    const pSlide = view.slides.find((s) => s.id === slideId)!;
    expect(pSlide.correct).toBe(1);
    expect(pSlide.explanation).toBe('B adalah jawaban yang benar.');
  });

  it('revealed: group member (anggota) receives correct key and explanation', () => {
    const session = pilihanSession({ status: 'tutup', visible: true });
    // Add groups so pid1 is anggota, pid2 is responder
    session.groups = [{ id: 'g1', number: 1, members: ['pid1', 'pid2'], responder: 'pid2' }];
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect(view.subRole).toBe('anggota');
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBe(1);
    expect(view.activeSlide.explanation).toBe('B adalah jawaban yang benar.');
  });

  it('revealed: group responder (penjawab) receives correct key and explanation', () => {
    const session = pilihanSession({ status: 'tutup', visible: true });
    session.groups = [{ id: 'g1', number: 1, members: ['pid1', 'pid2'], responder: 'pid2' }];
    const view = svc.projectForParticipant(session, 'pid2', VERSION);
    expect(view.subRole).toBe('penjawab');
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBe(1);
    expect(view.activeSlide.explanation).toBe('B adalah jawaban yang benar.');
  });
});

// ---------------------------------------------------------------------------
// Kuis — POV matrix
// ---------------------------------------------------------------------------
describe('Kuis', () => {
  const kuisSlideId = 'slide-kuis';
  const qId1 = 'q1';
  const qId2 = 'q2';

  const kuisSlide = makeSlide({
    id: kuisSlideId,
    type: 'kuis',
    title: 'Kuis',
    quizQuestions: [
      { id: qId1, title: 'Q1?', options: ['A', 'B'], correct: 0 },
      { id: qId2, title: 'Q2?', options: ['X', 'Y'], correct: 1 },
    ],
    duration: 30,
  });

  function kuisSession(quizOverride: Partial<QuizState> = {}, runOverride: Partial<QuizRun> = {}): Session {
    const now = 1000000;
    const run: QuizRun = {
      questionId: qId1,
      openedAt: now,
      deadlineAt: now + 30000,
      closed: false,
      answers: [],
      ...runOverride,
    };
    const quiz: QuizState = {
      slideId: kuisSlideId,
      ownerType: 'individu',
      runs: [run],
      finished: false,
      revealed: false,
      config: { version: 'v1', base: 500, bonus: 500 },
      ...quizOverride,
    };
    return makeSession({
      slides: [kuisSlide],
      active: 0,
      quiz,
      participants: [
        makeParticipant('pid1', 'Alya'),
        makeParticipant('pid2', 'Bima'),
        makeParticipant('pid3', 'Citra'),
        makeParticipant('pid4', 'Dimas'),
        makeParticipant('pid5', 'Eka'),
        makeParticipant('pid6', 'Farah'),
      ],
    });
  }

  it('question open: participant quiz view has no answer key', () => {
    const session = kuisSession({}, { closed: false, answers: [] });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect(view.quiz?.activeQuestion?.closed).toBe(false);
    expect(view.quiz?.activeQuestion?.myAnswer).toBeNull();
    // No correct field in question options
    const qOptions = view.quiz?.activeQuestion?.options;
    expect(qOptions).toEqual(['A', 'B']);
  });

  it('question open: presenter quiz shows correct key in slide', () => {
    const session = kuisSession({}, { closed: false });
    const view = svc.projectForPresenter(session, VERSION);
    const q = view.quiz?.runs[0];
    expect(q).toBeDefined();
    // Presenter slide has full quizQuestions with correct keys
    expect(view.slides[0].quizQuestions?.[0].correct).toBe(0);
  });

  it('question open: projector shows no correct field', () => {
    const session = kuisSession({}, { closed: false });
    const view = svc.projectForProjector(session, VERSION);
    const aq = view.quiz?.activeQuestion;
    expect(aq).toBeDefined();
    expect((aq as unknown as Record<string, unknown>)['correct']).toBeUndefined();
    // No answer key in projector quiz view
    expect(aq?.closed).toBe(false);
  });

  it('question open: correctOption is null in participant and projector views', () => {
    const session = kuisSession({}, { closed: false, answers: [] });
    const part = svc.projectForParticipant(session, 'pid1', VERSION);
    const proj = svc.projectForProjector(session, VERSION);
    expect(part.quiz?.activeQuestion?.correctOption).toBeNull();
    expect(proj.quiz?.activeQuestion?.correctOption).toBeNull();
  });

  it('question closed: projector receives correctOption', () => {
    const now = 1000000;
    const session = kuisSession({}, {
      closed: true,
      answers: [{ ownerId: 'pid1', submittedBy: 'pid1', option: 0, requestId: 'r1', receivedAt: now + 5000, correct: true, score: 750 }],
    });
    const view = svc.projectForProjector(session, VERSION);
    // qId1 correct is 0 (A)
    expect(view.quiz?.activeQuestion?.closed).toBe(true);
    expect(view.quiz?.activeQuestion?.correctOption).toBe(0);
  });

  it('question closed: participant who answered wrong receives correctOption', () => {
    const now = 1000000;
    const session = kuisSession({}, {
      closed: true,
      answers: [{ ownerId: 'pid1', submittedBy: 'pid1', option: 1, requestId: 'r1', receivedAt: now + 5000, correct: false, score: 0 }],
    });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect(view.quiz?.activeQuestion?.myAnswer?.correct).toBe(false);
    expect(view.quiz?.activeQuestion?.correctOption).toBe(0); // correct option is A (index 0)
  });

  it('question closed: participant who did not answer receives correctOption; myAnswer is null', () => {
    const now = 1000000;
    // pid2 did not submit; only pid1 answered
    const session = kuisSession({}, {
      closed: true,
      answers: [{ ownerId: 'pid1', submittedBy: 'pid1', option: 0, requestId: 'r1', receivedAt: now + 5000, correct: true, score: 750 }],
    });
    const view = svc.projectForParticipant(session, 'pid2', VERSION);
    expect(view.quiz?.activeQuestion?.myAnswer).toBeNull();
    expect(view.quiz?.activeQuestion?.correctOption).toBe(0);
  });

  it('question closed: participant myAnswer.correct and score revealed', () => {
    const now = 1000000;
    const session = kuisSession(
      {},
      {
        closed: true,
        answers: [{
          ownerId: 'pid1',
          submittedBy: 'pid1',
          option: 0,      // correct
          requestId: 'r1',
          receivedAt: now + 5000,
          correct: true,
          score: 750,
        }],
      },
    );
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    const myA = view.quiz?.activeQuestion?.myAnswer;
    expect(myA?.correct).toBe(true);
    expect(myA?.score).toBe(750);
  });

  it('question open: participant myAnswer.correct is null (not yet closed)', () => {
    const now = 1000000;
    const session = kuisSession(
      {},
      {
        closed: false,
        answers: [{
          ownerId: 'pid1',
          submittedBy: 'pid1',
          option: 0,
          requestId: 'r1',
          receivedAt: now + 2000,
          correct: true,
          score: 833,
        }],
      },
    );
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    const myA = view.quiz?.activeQuestion?.myAnswer;
    expect(myA?.correct).toBeNull();
    expect(myA?.score).toBeNull();
  });

  it('question closed: per-question score visible; leaderboard null (quiz not yet revealed)', () => {
    const now = 1000000;
    // Quiz not finished, just one question closed; leaderboard must still be null
    const session = kuisSession(
      { finished: false, revealed: false },
      {
        closed: true,
        answers: [{
          ownerId: 'pid1',
          submittedBy: 'pid1',
          option: 0,
          requestId: 'r1',
          receivedAt: now + 5000,
          correct: true,
          score: 750,
        }],
      },
    );
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    // Per-question feedback visible immediately on close
    expect(view.quiz?.activeQuestion?.myAnswer?.correct).toBe(true);
    expect(view.quiz?.activeQuestion?.myAnswer?.score).toBe(750);
    // Total rank / leaderboard stays hidden until quiz finished + revealed
    expect(view.leaderboard).toBeNull();
  });

  it('quiz finished, not revealed: leaderboard is null in all views', () => {
    const run: QuizRun = {
      questionId: qId1, openedAt: 1000000, deadlineAt: 1030000, closed: true,
      answers: [
        { ownerId: 'pid1', submittedBy: 'pid1', option: 0, requestId: 'r1', receivedAt: 1005000, correct: true, score: 750 },
      ],
    };
    const session = kuisSession({ finished: true, revealed: false, runs: [run] });
    expect(svc.projectForPresenter(session, VERSION).leaderboard).toBeNull();
    expect(svc.projectForParticipant(session, 'pid1', VERSION).leaderboard).toBeNull();
    expect(svc.projectForProjector(session, VERSION).leaderboard).toBeNull();
  });

  it('quiz revealed: top 5 entries in all views', () => {
    const now = 1000000;
    const run: QuizRun = {
      questionId: qId1, openedAt: now, deadlineAt: now + 30000, closed: true,
      answers: [
        { ownerId: 'pid1', submittedBy: 'pid1', option: 0, requestId: 'r1', receivedAt: now + 3000, correct: true, score: 950 },
        { ownerId: 'pid2', submittedBy: 'pid2', option: 0, requestId: 'r2', receivedAt: now + 5000, correct: true, score: 917 },
        { ownerId: 'pid3', submittedBy: 'pid3', option: 0, requestId: 'r3', receivedAt: now + 8000, correct: true, score: 867 },
        { ownerId: 'pid4', submittedBy: 'pid4', option: 0, requestId: 'r4', receivedAt: now + 12000, correct: true, score: 800 },
        { ownerId: 'pid5', submittedBy: 'pid5', option: 0, requestId: 'r5', receivedAt: now + 20000, correct: true, score: 667 },
        { ownerId: 'pid6', submittedBy: 'pid6', option: 1, requestId: 'r6', receivedAt: now + 25000, correct: false, score: 0 },
      ],
    };
    const session = kuisSession({ finished: true, revealed: true, runs: [run] });

    // All views have leaderboard
    const pres = svc.projectForPresenter(session, VERSION);
    expect(pres.leaderboard?.entries).toHaveLength(5);

    // Projector: top 5, no ownEntry
    const proj = svc.projectForProjector(session, VERSION);
    expect(proj.leaderboard?.entries).toHaveLength(5);
    expect(proj.leaderboard?.ownEntry).toBeNull();

    // Participant pid5 is rank 5 (in top 5): ownEntry = null
    const p5 = svc.projectForParticipant(session, 'pid5', VERSION);
    expect(p5.leaderboard?.entries).toHaveLength(5);
    expect(p5.leaderboard?.ownEntry).toBeNull();

    // Participant pid6 is rank 6 (outside top 5): sees ownEntry
    const p6 = svc.projectForParticipant(session, 'pid6', VERSION);
    expect(p6.leaderboard?.ownEntry).not.toBeNull();
    expect(p6.leaderboard?.ownEntry?.ownerId).toBe('pid6');
    expect(p6.leaderboard?.ownEntry?.totalScore).toBe(0);
    expect(p6.leaderboard?.ownEntry?.rank).toBeGreaterThan(5);
  });

  it('shared rank on ties: tied participants get same rank, next rank skips', () => {
    const now = 1000000;
    // pid2 and pid3 both correct fast → same score → same rank
    const run: QuizRun = {
      questionId: qId1, openedAt: now, deadlineAt: now + 30000, closed: true,
      answers: [
        { ownerId: 'pid1', submittedBy: 'pid1', option: 0, requestId: 'r1', receivedAt: now + 1000, correct: true, score: 983 },
        { ownerId: 'pid2', submittedBy: 'pid2', option: 0, requestId: 'r2', receivedAt: now + 15000, correct: true, score: 750 },
        { ownerId: 'pid3', submittedBy: 'pid3', option: 0, requestId: 'r3', receivedAt: now + 15000, correct: true, score: 750 }, // same score as pid2
        { ownerId: 'pid4', submittedBy: 'pid4', option: 1, requestId: 'r4', receivedAt: now + 5000, correct: false, score: 0 },
      ],
    };
    const session = kuisSession({ finished: true, revealed: true, runs: [run] });
    const lb = svc.projectForPresenter(session, VERSION).leaderboard!;
    const ranks = lb.entries.map((e) => ({ label: e.ownerLabel, rank: e.rank, score: e.totalScore }));

    // pid1 rank 1, pid2 and pid3 both rank 2 (tie), pid4 rank 4 (skips 3)
    const pid1e = ranks.find((r) => r.label === 'Alya')!;
    const pid2e = ranks.find((r) => r.label === 'Bima')!;
    const pid3e = ranks.find((r) => r.label === 'Citra')!;
    const pid4e = ranks.find((r) => r.label === 'Dimas')!;

    expect(pid1e.rank).toBe(1);
    expect(pid2e.rank).toBe(2);
    expect(pid3e.rank).toBe(2);    // same rank as pid2
    expect(pid4e.rank).toBe(4);    // rank 3 is skipped

    // Display order within tie should be alphabetical (Bima before Citra)
    const idx2 = lb.entries.findIndex((e) => e.ownerLabel === 'Bima');
    const idx3 = lb.entries.findIndex((e) => e.ownerLabel === 'Citra');
    expect(idx2).toBeLessThan(idx3);
  });

  it('participant outside top 5 because of tie at position 5: sees ownEntry', () => {
    const now = 1000000;
    // Ranks 5 and 6 are tied (same score); pid6 is rank 6 outside top-5
    const run: QuizRun = {
      questionId: qId1, openedAt: now, deadlineAt: now + 30000, closed: true,
      answers: [
        { ownerId: 'pid1', submittedBy: 'pid1', option: 0, requestId: 'r1', receivedAt: now + 1000, correct: true, score: 983 },
        { ownerId: 'pid2', submittedBy: 'pid2', option: 0, requestId: 'r2', receivedAt: now + 2000, correct: true, score: 967 },
        { ownerId: 'pid3', submittedBy: 'pid3', option: 0, requestId: 'r3', receivedAt: now + 3000, correct: true, score: 950 },
        { ownerId: 'pid4', submittedBy: 'pid4', option: 0, requestId: 'r4', receivedAt: now + 4000, correct: true, score: 933 },
        { ownerId: 'pid5', submittedBy: 'pid5', option: 0, requestId: 'r5', receivedAt: now + 20000, correct: true, score: 667 },
        { ownerId: 'pid6', submittedBy: 'pid6', option: 0, requestId: 'r6', receivedAt: now + 20000, correct: true, score: 667 }, // same as pid5
      ],
    };
    const session = kuisSession({ finished: true, revealed: true, runs: [run] });
    // pid5 (rank 5, in top-5) and pid6 (rank 5 too, but only 5 entries shown → pid6 is outside)
    const p5 = svc.projectForParticipant(session, 'pid5', VERSION);
    const p6 = svc.projectForParticipant(session, 'pid6', VERSION);

    // pid5 is entry 5 (top-5 slice keeps first 5)
    expect(p5.leaderboard?.entries).toHaveLength(5);

    // pid6 is 6th by alphabetical order within tie (Eka < Farah)
    // So entries[4] = Eka, pid6 = Farah is outside
    expect(p6.leaderboard?.ownEntry).not.toBeNull();
    expect(p6.leaderboard?.ownEntry?.ownerId).toBe('pid6');
  });

  it('group mode: member (anggota) sees groupAnswered; myAnswer reflects group answer', () => {
    const now = 1000000;
    // kelompok mode: group g1 answered (ownerId = 'g1')
    const run: QuizRun = {
      questionId: qId1, openedAt: now, deadlineAt: now + 30000, closed: true,
      answers: [{ ownerId: 'g1', submittedBy: 'pid2', option: 0, requestId: 'r1', receivedAt: now + 5000, correct: true, score: 750 }],
    };
    const session = kuisSession(
      { ownerType: 'kelompok', runs: [run] },
      {},
    );
    session.groups = [{ id: 'g1', number: 1, members: ['pid1', 'pid2'], responder: 'pid2' }];

    // pid1 is the member (anggota)
    const memberView = svc.projectForParticipant(session, 'pid1', VERSION);
    expect(memberView.subRole).toBe('anggota');
    // Member's myAnswer is the group's answer (ownerId g1)
    expect(memberView.quiz?.activeQuestion?.myAnswer?.option).toBe(0);
    expect(memberView.quiz?.activeQuestion?.myAnswer?.correct).toBe(true);
    expect(memberView.quiz?.activeQuestion?.groupAnswered).toBe(true);
    expect(memberView.quiz?.activeQuestion?.correctOption).toBe(0);
  });

  it('group mode: responder (penjawab) sees own answer with correct/score; correctOption after close', () => {
    const now = 1000000;
    const run: QuizRun = {
      questionId: qId1, openedAt: now, deadlineAt: now + 30000, closed: true,
      answers: [{ ownerId: 'g1', submittedBy: 'pid2', option: 1, requestId: 'r1', receivedAt: now + 5000, correct: false, score: 0 }],
    };
    const session = kuisSession(
      { ownerType: 'kelompok', runs: [run] },
      {},
    );
    session.groups = [{ id: 'g1', number: 1, members: ['pid1', 'pid2'], responder: 'pid2' }];

    // pid2 is the responder (penjawab)
    const respView = svc.projectForParticipant(session, 'pid2', VERSION);
    expect(respView.subRole).toBe('penjawab');
    expect(respView.quiz?.activeQuestion?.myAnswer?.option).toBe(1);   // answered B (wrong)
    expect(respView.quiz?.activeQuestion?.myAnswer?.correct).toBe(false);
    expect(respView.quiz?.activeQuestion?.correctOption).toBe(0);       // correct was A
  });
});

// ---------------------------------------------------------------------------
// Q&A — POV matrix
// ---------------------------------------------------------------------------
describe('Q&A', () => {
  const slideId = 'slide-qa';
  const qaSlide = makeSlide({ id: slideId, type: 'tanya', title: 'Tanya' });

  function qaSession(questions: Session['questions']): Session {
    return makeSession({
      slides: [qaSlide],
      questions,
      activities: { [slideId]: { status: 'buka', visible: false, hiddenWords: [] } },
    });
  }

  it('unmoderated question: only in PresenterView', () => {
    const session = qaSession([
      { id: 'q1', slideId, participantId: 'pid1', text: 'Private Q?', visible: false, answered: false },
    ]);
    const pres = svc.projectForPresenter(session, VERSION);
    const part = svc.projectForParticipant(session, 'pid2', VERSION);
    const proj = svc.projectForProjector(session, VERSION);

    // Presenter sees all
    expect(pres.questions.find((q) => q.id === 'q1')).toBeDefined();
    // Participant (not the submitter) does not see unmoderated question
    expect(part.questions.find((q) => q.id === 'q1')).toBeUndefined();
    // Projector: tanya always shows (A3 CH26); no visible questions → empty list
    const tanyaResult = proj.revealedResults;
    expect(tanyaResult?.type).toBe('tanya');
    expect((tanyaResult as { type: 'tanya'; questions: unknown[] })?.questions).toHaveLength(0);
  });

  it('own submitted question: participant sees it even if not yet moderated', () => {
    const session = qaSession([
      { id: 'q1', slideId, participantId: 'pid1', text: 'My Q?', visible: false, answered: false },
    ]);
    const part = svc.projectForParticipant(session, 'pid1', VERSION);
    expect(part.questions.find((q) => q.id === 'q1')).toBeDefined();
  });

  it('moderated visible question: projector sees it; non-submitter participant does not (A3 CH26)', () => {
    const session = qaSession([
      { id: 'q1', slideId, participantId: 'pid1', text: 'Public Q?', visible: true, answered: false },
    ]);
    // Mark activity as visible so projector shows results
    session.activities[slideId] = { status: 'tutup', visible: true, hiddenWords: [] };

    // pid2 is NOT the submitter → does not see the question (A3)
    const part = svc.projectForParticipant(session, 'pid2', VERSION);
    expect(part.questions.find((q) => q.id === 'q1')).toBeUndefined();

    // Projector always shows tanya; shows visible questions
    const proj = svc.projectForProjector(session, VERSION);
    expect(proj.revealedResults?.type).toBe('tanya');
    const tanyaQ = (proj.revealedResults as { type: 'tanya'; questions: { text: string }[] })?.questions;
    expect(tanyaQ?.[0]?.text).toBe('Public Q?');
  });

  it('visible=true question but slide not yet revealed: other participant does not see it', () => {
    // visible=true means moderated by presenter; but slide reveal (activity.visible) still false
    const session = qaSession([
      { id: 'q1', slideId, participantId: 'pid1', text: 'Moderated but unrevealed?', visible: true, answered: false },
    ]);
    // activity.visible stays false (from qaSession default)

    // pid2 (not the submitter) must not see it
    const part = svc.projectForParticipant(session, 'pid2', VERSION);
    expect(part.questions.find((q) => q.id === 'q1')).toBeUndefined();

    // pid1 (submitter) still sees own question
    const own = svc.projectForParticipant(session, 'pid1', VERSION);
    expect(own.questions.find((q) => q.id === 'q1')).toBeDefined();

    // Projector: tanya always shows (A3 CH26); shows the visible question regardless of act.visible
    const proj = svc.projectForProjector(session, VERSION);
    expect(proj.revealedResults?.type).toBe('tanya');
    const tanyaQ = (proj.revealedResults as { type: 'tanya'; questions: { text: string }[] })?.questions;
    expect(tanyaQ?.[0]?.text).toBe('Moderated but unrevealed?');
  });
});

// ---------------------------------------------------------------------------
// Awan Kata — hiddenWords
// ---------------------------------------------------------------------------
describe('Awan Kata', () => {
  const slideId = 'slide-awan';
  const awanSlide = makeSlide({ id: slideId, type: 'awan', title: 'Awan' });

  it('hiddenWords not sent to participant or projector', () => {
    const session = makeSession({
      slides: [awanSlide],
      activities: {
        [slideId]: { status: 'buka', visible: false, hiddenWords: ['badword', 'spam'] },
      },
    });

    const part = svc.projectForParticipant(session, 'pid1', VERSION);
    const proj = svc.projectForProjector(session, VERSION);

    expect(part.activity?.hiddenWords).toEqual([]);
    // Projector view has no activity field — words hidden from aggregate too
    // (hiddenWords filtering done by aggregate() using presenter activities, not participant activity)
    // Verify projector doesn't expose the words directly
    expect((proj as unknown as Record<string, unknown>)['activities']).toBeUndefined();
  });

  it('presenter sees hiddenWords', () => {
    const session = makeSession({
      slides: [awanSlide],
      activities: {
        [slideId]: { status: 'buka', visible: false, hiddenWords: ['badword'] },
      },
    });
    const pres = svc.projectForPresenter(session, VERSION);
    expect(pres.activities[slideId].hiddenWords).toEqual(['badword']);
  });

  it('revealed: projector sees word aggregate', () => {
    const session = makeSession({
      slides: [awanSlide],
      activities: { [slideId]: { status: 'tutup', visible: true, hiddenWords: [] } },
      responses: [
        { id: 'r1', slideId, ownerType: 'individu', ownerId: 'pid1', submittedBy: 'pid1', value: ['halo', 'dunia'], updated: '' },
        { id: 'r2', slideId, ownerType: 'individu', ownerId: 'pid2', submittedBy: 'pid2', value: ['halo'], updated: '' },
      ],
    });
    const view = svc.projectForProjector(session, VERSION);
    expect(view.revealedResults?.type).toBe('awan');
    const words = (view.revealedResults as { type: 'awan'; words: { text: string; count: number }[] })?.words;
    const haloEntry = words?.find((w) => w.text === 'halo');
    expect(haloEntry?.count).toBe(2);
  });

  it('not revealed: projector revealedResults is null for awan kata', () => {
    const session = makeSession({
      slides: [awanSlide],
      activities: { [slideId]: { status: 'tutup', visible: false, hiddenWords: [] } },
    });
    const view = svc.projectForProjector(session, VERSION);
    expect(view.revealedResults).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pembagian Kelompok — participant sees only own group; projector no names
// ---------------------------------------------------------------------------
describe('Pembagian Kelompok', () => {
  it('participant sees only their own group, not others', () => {
    const session = makeSession({
      groups: [
        { id: 'g1', number: 1, members: ['pid1', 'pid2'], responder: 'pid1' },
        { id: 'g2', number: 2, members: ['pid3', 'pid4'], responder: 'pid3' },
      ],
      participants: [
        makeParticipant('pid1', 'Alya'),
        makeParticipant('pid2', 'Bima'),
        makeParticipant('pid3', 'Citra'),
        makeParticipant('pid4', 'Dimas'),
      ],
    });

    const view = svc.projectForParticipant(session, 'pid1', VERSION);

    // ParticipantView has myGroup (pid1's group) but no `groups` array with all groups
    expect(view.myGroup?.number).toBe(1);
    expect(view.myGroup?.members.map((m) => m.name)).toEqual(['Alya', 'Bima']);
    expect((view as unknown as Record<string, unknown>)['groups']).toBeUndefined();
  });

  it('projector groups tiles: number and memberCount only, no names or ids', () => {
    const session = makeSession({
      groups: [
        { id: 'g1', number: 1, members: ['pid1', 'pid2'], responder: 'pid1' },
        { id: 'g2', number: 2, members: ['pid3', 'pid4'], responder: 'pid3' },
      ],
      participants: [
        makeParticipant('pid1', 'Alya'),
        makeParticipant('pid2', 'Bima'),
        makeParticipant('pid3', 'Citra'),
        makeParticipant('pid4', 'Dimas'),
      ],
    });

    const view = svc.projectForProjector(session, VERSION);
    const viewRaw = view as unknown as Record<string, unknown>;

    // Has groups tiles with number + memberCount
    expect(view.groups).toHaveLength(2);
    expect(view.groups[0]).toEqual({ number: 1, memberCount: 2 });
    expect(view.groups[1]).toEqual({ number: 2, memberCount: 2 });

    // No participants field on projector
    expect(viewRaw['participants']).toBeUndefined();

    // No participant names, ids in the serialised view
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('Alya');
    expect(serialised).not.toContain('Bima');
    expect(serialised).not.toContain('"g1"');
    expect(serialised).not.toContain('"g2"');
  });
});

// ---------------------------------------------------------------------------
// Polling — no correct key; aggregate visible after reveal
// ---------------------------------------------------------------------------
describe('Polling', () => {
  const slideId = 'slide-polling';
  const pollingSlide = makeSlide({
    id: slideId,
    type: 'polling',
    title: 'Polling?',
    options: ['Opsi A', 'Opsi B', 'Opsi C'],
    correct: 0, // meaningless for polling (U03: no correct key)
  });

  function pollingSession(activityOverride: Partial<Activity> = {}): Session {
    return makeSession({
      slides: [pollingSlide],
      activities: {
        [slideId]: { status: 'buka', visible: false, hiddenWords: [], ...activityOverride },
      },
      responses: [
        { id: 'r1', slideId, ownerType: 'individu', ownerId: 'pid1', submittedBy: 'pid1', value: ['0'], updated: '' },
        { id: 'r2', slideId, ownerType: 'individu', ownerId: 'pid2', submittedBy: 'pid2', value: ['1'], updated: '' },
      ],
    });
  }

  it('revealed: projector sees polling aggregate (no correct key concept)', () => {
    const session = pollingSession({ status: 'tutup', visible: true });
    const view = svc.projectForProjector(session, VERSION);
    expect(view.revealedResults?.type).toBe('polling');
    const r = view.revealedResults as { type: 'polling'; options: string[]; counts: number[]; totalResponses: number };
    expect(r.totalResponses).toBe(2);
    expect(r.counts).toHaveLength(3);
  });

  it('not revealed: projector revealedResults is null for polling', () => {
    const session = pollingSession({ status: 'tutup', visible: false });
    const view = svc.projectForProjector(session, VERSION);
    expect(view.revealedResults).toBeNull();
  });

  it('revealed: participant never receives correct key for polling', () => {
    const session = pollingSession({ status: 'tutup', visible: true });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBeUndefined();
  });

  it('not revealed: participant never receives correct key for polling', () => {
    const session = pollingSession({ status: 'buka', visible: false });
    const view = svc.projectForParticipant(session, 'pid1', VERSION);
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBeUndefined();
  });

  it('revealed: projector never receives correct key for polling', () => {
    const session = pollingSession({ status: 'tutup', visible: true });
    const view = svc.projectForProjector(session, VERSION);
    expect((view.activeSlide as unknown as Record<string, unknown>)['correct']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// AC16 — hasSimulatedData
// ---------------------------------------------------------------------------

describe('AC16 — hasSimulatedData propagated from Participant.simulated', () => {
  it('hasSimulatedData=true when any participant has simulated=true', () => {
    const session = makeSession({
      participants: [
        { id: 'pid1', name: 'Alya', online: true, simulated: true },
        { id: 'pid2', name: 'Bima', online: true, simulated: false },
      ],
    });
    expect(svc.projectForPresenter(session, VERSION).hasSimulatedData).toBe(true);
    expect(svc.projectForParticipant(session, 'pid1', VERSION).hasSimulatedData).toBe(true);
    expect(svc.projectForProjector(session, VERSION).hasSimulatedData).toBe(true);
  });

  it('hasSimulatedData=false when no participant has simulated=true', () => {
    const session = makeSession({
      participants: [
        { id: 'pid1', name: 'Alya', online: true },
        { id: 'pid2', name: 'Bima', online: true, simulated: false },
      ],
    });
    expect(svc.projectForPresenter(session, VERSION).hasSimulatedData).toBe(false);
    expect(svc.projectForParticipant(session, 'pid1', VERSION).hasSimulatedData).toBe(false);
    expect(svc.projectForProjector(session, VERSION).hasSimulatedData).toBe(false);
  });
});
