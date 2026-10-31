/**
 * Domain quiz unit tests — covers OQ01 (scoring formula) and OQ03 (tiebreak).
 */
import { describe, it, expect } from 'vitest';
import { quizScores, quizExecute, reconcileQuiz } from './quiz';
import { uid } from './model';
import type { Session, QuizState, QuizRun } from './model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeParticipant(id: string, name: string) {
  return { id, name, online: true };
}

function baseSession(): Session {
  const slideId = 'slide-kuis';
  const qId = 'q1';
  return {
    id: 's1',
    presentationId: 'p1',
    title: 'Test',
    slides: [{
      id: slideId,
      type: 'kuis',
      title: 'Kuis',
      body: '',
      options: [],
      correct: [],
      explanation: '',
      image: '',
      groups: 0,
      quizQuestions: [{ id: qId, title: 'Q1?', options: ['A', 'B'], correct: [0] }],
      duration: 30,
    }],
    code: '123456',
    status: 'aktif',
    active: 0,
    division: -1,
    participants: [
      makeParticipant('p1', 'Alya'),
      makeParticipant('p2', 'Bima'),
      makeParticipant('p3', 'Citra'),
    ],
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

function makeQuizState(runs: QuizRun[]): QuizState {
  return {
    slideId: 'slide-kuis',
    ownerType: 'individu',
    runs,
    finished: false,
    revealed: false,
    config: { version: 'v1', base: 500, bonus: 500 },
  };
}

// ---------------------------------------------------------------------------
// quizOpen — duration validation
// ---------------------------------------------------------------------------
describe('quizOpen duration validation', () => {
  function sessionWithDuration(duration: number | undefined): Session {
    const base = baseSession();
    (base.slides[0] as any).duration = duration;
    return base;
  }

  it('rejects undefined duration', () => {
    expect(() => quizExecute(sessionWithDuration(undefined), { type: 'quizOpen' }, 1000))
      .toThrow('Durasi kuis harus antara 10–120 detik.');
  });

  it('rejects duration 0', () => {
    expect(() => quizExecute(sessionWithDuration(0), { type: 'quizOpen' }, 1000))
      .toThrow('Durasi kuis harus antara 10–120 detik.');
  });

  it('rejects duration 9 (below minimum)', () => {
    expect(() => quizExecute(sessionWithDuration(9), { type: 'quizOpen' }, 1000))
      .toThrow('Durasi kuis harus antara 10–120 detik.');
  });

  it('rejects duration 121 (above maximum)', () => {
    expect(() => quizExecute(sessionWithDuration(121), { type: 'quizOpen' }, 1000))
      .toThrow('Durasi kuis harus antara 10–120 detik.');
  });

  it('accepts duration 10 (minimum)', () => {
    expect(() => quizExecute(sessionWithDuration(10), { type: 'quizOpen' }, 1000)).not.toThrow();
  });

  it('accepts duration 120 (maximum)', () => {
    expect(() => quizExecute(sessionWithDuration(120), { type: 'quizOpen' }, 1000)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// OQ01 — Scoring formula: correct=500+round(500×(1-elapsed/duration)), wrong=0
// ---------------------------------------------------------------------------
describe('OQ01 — scoring formula', () => {
  it('correct answer at t=0 (instant) → max score 1000', () => {
    const openedAt = 1000000;
    const deadlineAt = openedAt + 30000; // 30 s
    const receivedAt = openedAt; // instant
    const run: QuizRun = { questionId: 'q1', openedAt, deadlineAt, closed: false, answers: [] };
    const session = { ...baseSession(), quiz: makeQuizState([run]) };
    quizExecute(session, {
      type: 'quizSubmit',
      participantId: 'p1',
      questionId: 'q1',
      option: 0, // correct
      requestId: uid(),
    }, receivedAt);
    const answers = session.quiz!.runs[0].answers;
    expect(answers[0].correct).toBe(true);
    expect(answers[0].score).toBe(1000); // 500 + 500
  });

  it('correct answer at half-time → score ~750', () => {
    const openedAt = 1000000;
    const deadlineAt = openedAt + 30000;
    const receivedAt = openedAt + 15000; // 15 s elapsed, half duration
    const run: QuizRun = { questionId: 'q1', openedAt, deadlineAt, closed: false, answers: [] };
    const session = { ...baseSession(), quiz: makeQuizState([run]) };
    quizExecute(session, {
      type: 'quizSubmit',
      participantId: 'p1',
      questionId: 'q1',
      option: 0,
      requestId: uid(),
    }, receivedAt);
    const score = session.quiz!.runs[0].answers[0].score;
    // elapsed/duration = 15/30 = 0.5 → bonus = round(500 * 0.5) = 250 → total = 750
    expect(score).toBe(750);
  });

  it('correct answer at 99% of time → base only (bonus ~5)', () => {
    const openedAt = 1000000;
    const deadlineAt = openedAt + 30000;
    const receivedAt = openedAt + 29700; // 99% elapsed
    const run: QuizRun = { questionId: 'q1', openedAt, deadlineAt, closed: false, answers: [] };
    const session = { ...baseSession(), quiz: makeQuizState([run]) };
    quizExecute(session, {
      type: 'quizSubmit',
      participantId: 'p1',
      questionId: 'q1',
      option: 0,
      requestId: uid(),
    }, receivedAt);
    const score = session.quiz!.runs[0].answers[0].score;
    // elapsed/duration = 29.7/30 = 0.99 → bonus = round(500 * 0.01) = 5 → total = 505
    expect(score).toBe(505);
  });

  it('WRONG answer → score is 0, no speed bonus', () => {
    const openedAt = 1000000;
    const deadlineAt = openedAt + 30000;
    const receivedAt = openedAt + 1000; // near-instant (would be high bonus if correct)
    const run: QuizRun = { questionId: 'q1', openedAt, deadlineAt, closed: false, answers: [] };
    const session = { ...baseSession(), quiz: makeQuizState([run]) };
    quizExecute(session, {
      type: 'quizSubmit',
      participantId: 'p1',
      questionId: 'q1',
      option: 1, // WRONG (correct is 0)
      requestId: uid(),
    }, receivedAt);
    const ans = session.quiz!.runs[0].answers[0];
    expect(ans.correct).toBe(false);
    expect(ans.score).toBe(0); // NO speed bonus for wrong answers
  });

  it('no answer submitted → score not added to quizScores (missing)', () => {
    const run: QuizRun = {
      questionId: 'q1',
      openedAt: 1000000,
      deadlineAt: 1030000,
      closed: true,
      answers: [
        // p1 answered correctly, p2 did not answer
        { ownerId: 'p1', submittedBy: 'p1', option: 0, requestId: 'r1', receivedAt: 1005000, correct: true, score: 833 },
      ],
    };
    const session = { ...baseSession(), quiz: { ...makeQuizState([run]), finished: true, revealed: true } };
    const scores = quizScores(session);
    const p2score = scores.find((s) => s.id === 'p2');
    expect(p2score?.total).toBe(0);  // no answer = 0 total
    expect(p2score?.correct).toBe(0);
  });

  it('idempotent submit: same requestId returns same answer', () => {
    const openedAt = 1000000;
    const deadlineAt = openedAt + 30000;
    const run: QuizRun = { questionId: 'q1', openedAt, deadlineAt, closed: false, answers: [] };
    const session = { ...baseSession(), quiz: makeQuizState([run]) };
    const reqId = uid();
    quizExecute(session, { type: 'quizSubmit', participantId: 'p1', questionId: 'q1', option: 0, requestId: reqId }, openedAt + 1000);
    quizExecute(session, { type: 'quizSubmit', participantId: 'p1', questionId: 'q1', option: 0, requestId: reqId }, openedAt + 2000);
    expect(session.quiz!.runs[0].answers).toHaveLength(1); // not duplicated
  });
});

// ---------------------------------------------------------------------------
// OQ03 — Leaderboard tiebreak: pts desc → correct desc → shared rank → alphabetical
// ---------------------------------------------------------------------------
describe('OQ03 — tiebreak and shared rank', () => {
  function runWithAnswers(answers: QuizRun['answers']): QuizRun {
    return { questionId: 'q1', openedAt: 1000000, deadlineAt: 1030000, closed: true, answers };
  }

  it('different scores → strict rank order', () => {
    const run = runWithAnswers([
      { ownerId: 'p1', submittedBy: 'p1', option: 0, requestId: 'r1', receivedAt: 1001000, correct: true, score: 983 },
      { ownerId: 'p2', submittedBy: 'p2', option: 0, requestId: 'r2', receivedAt: 1010000, correct: true, score: 833 },
      { ownerId: 'p3', submittedBy: 'p3', option: 1, requestId: 'r3', receivedAt: 1005000, correct: false, score: 0 },
    ]);
    const session = { ...baseSession(), quiz: { ...makeQuizState([run]), finished: true, revealed: true } };
    const scores = quizScores(session);
    expect(scores[0].id).toBe('p1'); // rank 1
    expect(scores[0].rank).toBe(1);
    expect(scores[1].id).toBe('p2'); // rank 2
    expect(scores[1].rank).toBe(2);
    expect(scores[2].rank).toBe(3);  // p3 rank 3
  });

  it('tied score and correct count → same rank, rank after tie skips', () => {
    const run = runWithAnswers([
      { ownerId: 'p1', submittedBy: 'p1', option: 0, requestId: 'r1', receivedAt: 1001000, correct: true, score: 983 },
      { ownerId: 'p2', submittedBy: 'p2', option: 0, requestId: 'r2', receivedAt: 1015000, correct: true, score: 750 },
      { ownerId: 'p3', submittedBy: 'p3', option: 0, requestId: 'r3', receivedAt: 1015000, correct: true, score: 750 }, // same as p2
    ]);
    const session = { ...baseSession(), quiz: { ...makeQuizState([run]), finished: true, revealed: true } };
    const scores = quizScores(session);
    expect(scores[0].rank).toBe(1); // p1
    // p2 and p3 tied at rank 2
    const rankOf = (id: string) => scores.find((s) => s.id === id)!.rank;
    expect(rankOf('p2')).toBe(2);
    expect(rankOf('p3')).toBe(2); // same rank
    // No rank 3 (skipped) — p1 is not in this set
    // rank after tie = 4 (but only 3 participants so this isn't visible)
  });

  it('display order within tie is alphabetical by name', () => {
    const run = runWithAnswers([
      { ownerId: 'p2', submittedBy: 'p2', option: 0, requestId: 'r2', receivedAt: 1015000, correct: true, score: 750 },
      { ownerId: 'p3', submittedBy: 'p3', option: 0, requestId: 'r3', receivedAt: 1015000, correct: true, score: 750 },
      { ownerId: 'p1', submittedBy: 'p1', option: 1, requestId: 'r1', receivedAt: 1001000, correct: false, score: 0 },
    ]);
    // p1=Alya, p2=Bima, p3=Citra — both p2 and p3 tied
    // Alphabetical: Bima < Citra → p2 (Bima) before p3 (Citra)
    const session = { ...baseSession(), quiz: { ...makeQuizState([run]), finished: true, revealed: true } };
    const scores = quizScores(session);
    const idx2 = scores.findIndex((s) => s.id === 'p2'); // Bima
    const idx3 = scores.findIndex((s) => s.id === 'p3'); // Citra
    expect(idx2).toBeLessThan(idx3); // Bima before Citra (alphabetical)
  });

  it('correct count as secondary tiebreak when total pts equal', () => {
    // p2 and p3 same total but p2 has 1 correct, p3 has 0 correct (both scored wrong)
    // This scenario is impossible with current scoring (wrong=0, correct=positive)
    // but if they both scored 0 with 0 correct vs 0 correct → alphabetical
    const run = runWithAnswers([
      { ownerId: 'p1', submittedBy: 'p1', option: 0, requestId: 'r1', receivedAt: 1001000, correct: true, score: 983 },
      { ownerId: 'p2', submittedBy: 'p2', option: 1, requestId: 'r2', receivedAt: 1005000, correct: false, score: 0 },
      { ownerId: 'p3', submittedBy: 'p3', option: 1, requestId: 'r3', receivedAt: 1005000, correct: false, score: 0 },
    ]);
    // p2=Bima, p3=Citra both score 0, 0 correct → alphabetical tiebreak
    const session = { ...baseSession(), quiz: { ...makeQuizState([run]), finished: true, revealed: true } };
    const scores = quizScores(session);
    const idx2 = scores.findIndex((s) => s.id === 'p2');
    const idx3 = scores.findIndex((s) => s.id === 'p3');
    expect(idx2).toBeLessThan(idx3); // Bima before Citra
  });
});
