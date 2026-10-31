/**
 * Projection functions — pure frontend port of the backend ProjectionService.
 *
 * Privacy rules (per POV matrix §5):
 * - `correct` key (pilihan ganda): absent before reveal; present in participant AND projector after reveal
 * - `explanation`: absent before reveal for participant; always absent from projector
 * - `hiddenWords` in Activity: stripped to [] in participant and projector views
 * - Quiz answer correct/score: shown to participant when the question is CLOSED
 * - Leaderboard: null until quiz.finished AND quiz.revealed
 * - Q&A questions: participant/projector see only visible=true questions (+ own submitted)
 */
import type { Session, Slide, Activity, PancingPick } from './model';
import { activity, grouped, aggregate } from './model';
import { quizScores } from './quiz';
import type {
  ProjectorQuizView,
  PresenterView,
  ParticipantView,
  ProjectorView,
  ParticipantQuizView,
  ProjectorResults,
  Leaderboard,
  LeaderboardEntry,
} from '../contracts/views';

export function projectForPresenter(session: Session, version: number): PresenterView {
  const hasSimulatedData = session.participants.some((p) => p.simulated === true);
  return {
    sessionId: session.id,
    sessionVersion: version,
    status: session.status,
    code: session.code,
    title: session.title,
    slides: session.slides.map((s) => ({ ...s })),
    activeSlideIndex: session.active,
    divisionSlideIndex: session.division,
    participants: session.participants,
    groups: session.groups,
    responses: session.responses,
    questions: session.questions,
    activities: Object.fromEntries(
      Object.entries(session.activities).map(([k, v]) => [k, { ...v, hiddenWords: [...v.hiddenWords] }])
    ),
    paused: session.paused,
    presenterOnline: session.presenterOnline,
    hideContent: session.hideContent,
    quiz: session.quiz
      ? {
          ...session.quiz,
          runs: session.quiz.runs.map((r) => ({ ...r, answers: [...r.answers] })),
        }
      : null,
    leaderboard: buildLeaderboard(session, null),
    lastPick: buildLastPick(session),
    picks: [...(session.picks ?? [])],
    hasSimulatedData,
  };
}

export function projectForParticipant(
  session: Session,
  pid: string,
  version: number,
): ParticipantView {
  const hasSimulatedData = session.participants.some((p) => p.simulated === true);
  const participant = session.participants.find((p) => p.id === pid);
  if (!participant) throw new Error(`Participant ${pid} not in session`);

  const myGroup = session.groups.find((g) => g.members.includes(pid)) ?? null;
  const isResponder = myGroup?.responder === pid;
  const subRole = !myGroup ? 'individu' : isResponder ? 'penjawab' : 'anggota';

  const rawSlide = session.slides[session.active];
  const act = activity(session, rawSlide.id);

  // B10: hideContent strips results visibility from participant projection
  const effectiveVisible = act.visible && !session.hideContent;

  const activeSlide = stripSlideForParticipant(rawSlide, effectiveVisible);

  const myResponse =
    session.responses.find(
      (r) => r.slideId === rawSlide.id && r.ownerType === 'individu' && r.ownerId === pid,
    ) ?? null;

  const groupResponse = myGroup
    ? (session.responses.find(
        (r) =>
          r.slideId === rawSlide.id &&
          r.ownerType === 'kelompok' &&
          r.ownerId === myGroup.id,
      ) ?? null)
    : null;

  const visibleQuestions = session.questions.filter(
    (q) => q.participantId === pid,
  );

  const actForParticipant: Activity = {
    status: act.status,
    visible: effectiveVisible,
    hiddenWords: [],
  };

  return {
    sessionId: session.id,
    sessionVersion: version,
    status: session.status,
    title: session.title,
    pid,
    name: participant.name,
    subRole: subRole as ParticipantView['subRole'],
    myGroup: myGroup
      ? {
          id: myGroup.id,
          number: myGroup.number,
          members: myGroup.members.map((memberId) => {
            const p = session.participants.find((x) => x.id === memberId)!;
            return { id: p.id, name: p.name, online: p.online };
          }),
          responderName:
            session.participants.find((p) => p.id === myGroup.responder)?.name ?? '',
          isResponder,
        }
      : null,
    activeSlide: activeSlide as ParticipantView['activeSlide'],
    activeSlideIndex: session.active,
    divisionSlideIndex: session.division,
    activity: actForParticipant,
    myResponse,
    groupResponse,
    questions: visibleQuestions,
    quiz: buildParticipantQuizView(session, pid),
    leaderboard: buildLeaderboard(session, pid),
    paused: session.paused,
    presenterOnline: session.presenterOnline,
    hideContent: session.hideContent,
    revealedWords:
      rawSlide.type === 'awan' && effectiveVisible
        ? buildParticipantWords(session, rawSlide)
        : null,
    revealedCounts:
      (rawSlide.type === 'pilihan' || rawSlide.type === 'polling') && effectiveVisible
        ? buildParticipantCounts(session, rawSlide)
        : null,
    lastPick: buildLastPick(session),
    hasSimulatedData,
  };
}

export function projectForProjector(session: Session, version: number): ProjectorView {
  const hasSimulatedData = session.participants.some((p) => p.simulated === true);
  const rawSlide = session.slides[session.active];
  const act = activity(session, rawSlide.id);

  const { explanation: _e, ...slideWithoutExpl } = rawSlide as Slide & { explanation: string };
  void _e;
  const slideForProjector =
    act.visible && rawSlide.type === 'pilihan'
      ? slideWithoutExpl
      : (() => {
          const { correct: _c, ...s } = slideWithoutExpl;
          void _c;
          return s;
        })();

  const isGrouped = grouped(session);
  const totalOwners = isGrouped ? session.groups.length : session.participants.length;
  const slideResponses = session.responses.filter((r) => r.slideId === rawSlide.id);
  const receivedCount = slideResponses.length;

  const revealedResults =
    act.visible || rawSlide.type === 'tanya'
      ? buildProjectorResults(session, rawSlide)
      : null;

  return {
    sessionId: session.id,
    sessionVersion: version,
    status: session.status,
    participantCount: session.participants.length,
    code: session.code,
    title: session.title,
    activeSlide: slideForProjector as ProjectorView['activeSlide'],
    activeSlideIndex: session.active,
    groups: session.groups.map((g) => ({ number: g.number, memberCount: g.members.length })),
    responseProgress: ['pilihan', 'polling', 'awan', 'tanya'].includes(rawSlide.type)
      ? {
          received: receivedCount,
          total: totalOwners,
          ...(rawSlide.type === 'awan'
            ? { wordsReceived: slideResponses.reduce((n, r) => n + r.value.length, 0) }
            : {}),
        }
      : null,
    revealedResults,
    quiz: session.quiz
      ? {
          slideId: session.quiz.slideId,
          ownerType: session.quiz.ownerType,
          finished: session.quiz.finished,
          activeQuestion: buildProjectorActiveQuestion(session, totalOwners),
        }
      : null,
    leaderboard: buildLeaderboard(session, null),
    paused: session.paused,
    lastPick: buildLastPick(session),
    pancingParticipants: session.slides[session.active]?.type === 'pancing'
      ? session.participants.map((p) => ({ id: p.id, name: p.name, online: p.online }))
      : null,
    hasSimulatedData,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function stripSlideForParticipant(
  slide: Slide,
  activityVisible: boolean,
): Omit<Slide, 'correct'> & { correct?: number[] } {
  if (activityVisible && slide.type === 'pilihan') {
    return slide;
  }
  const { correct: _c, ...rest } = slide;
  void _c;
  return { ...rest, explanation: '' };
}

function buildParticipantQuizView(session: Session, pid: string): ParticipantQuizView | null {
  const quiz = session.quiz;
  if (!quiz) return null;

  const run = quiz.runs.at(-1);
  const slide = session.slides.find((s) => s.id === quiz.slideId);
  const questions = slide?.quizQuestions ?? [];
  const total = questions.length;

  const myOwnerId =
    quiz.ownerType === 'kelompok'
      ? (session.groups.find((g) => g.members.includes(pid))?.id ?? pid)
      : pid;

  const myAnswer = run ? (run.answers.find((a) => a.ownerId === myOwnerId) ?? null) : null;
  const hideContent = session.hideContent;

  const activeQuestion = run
    ? {
        questionId: run.questionId,
        index: quiz.runs.length - 1,
        total,
        title: questions.find((q) => q.id === run.questionId)?.title ?? '',
        options: questions.find((q) => q.id === run.questionId)?.options ?? [],
        openedAt: run.openedAt,
        deadlineAt: run.deadlineAt,
        closed: run.closed,
        myAnswer: myAnswer
          ? {
              option: myAnswer.option,
              correct: run.closed && !hideContent ? myAnswer.correct : null,
              score: run.closed && !hideContent ? myAnswer.score : null,
            }
          : null,
        correctOption: run.closed && !hideContent
          ? (questions.find((q) => q.id === run.questionId)?.correct ?? null)
          : null,
        groupAnswered:
          quiz.ownerType === 'kelompok'
            ? run.answers.some(
                (a) =>
                  a.ownerId === session.groups.find((g) => g.members.includes(pid))?.id,
              )
            : false,
        resultsVisible: (run.resultsVisible ?? false) && !hideContent,
        answerCounts: (run.resultsVisible ?? false) && !hideContent
          ? (questions.find((q) => q.id === run.questionId)?.options ?? []).map(
              (_, i) => run.answers.filter((a) => a.option === i).length,
            )
          : null,
      }
    : null;

  return {
    slideId: quiz.slideId,
    ownerType: quiz.ownerType,
    finished: quiz.finished,
    revealed: quiz.revealed,
    activeQuestion,
  };
}

function buildProjectorActiveQuestion(
  session: Session,
  totalOwners: number,
): ProjectorQuizView['activeQuestion'] {
  const quiz = session.quiz;
  if (!quiz) return null;
  const run = quiz.runs.at(-1);
  if (!run) return null;
  const slide = session.slides.find((s) => s.id === quiz.slideId);
  const questions = slide?.quizQuestions ?? [];
  const question = questions.find((q) => q.id === run.questionId);
  return {
    questionId: run.questionId,
    index: quiz.runs.length - 1,
    total: questions.length,
    title: question?.title ?? '',
    options: question?.options ?? [],
    openedAt: run.openedAt,
    deadlineAt: run.deadlineAt,
    closed: run.closed,
    correctOption: run.closed ? (question?.correct ?? null) : null,
    submittedCount: run.answers.length,
    totalOwners,
    resultsVisible: run.resultsVisible ?? false,
    answerCounts: (run.resultsVisible ?? false)
      ? (question?.options ?? []).map((_, i) => run.answers.filter((a) => a.option === i).length)
      : null,
  };
}

function buildProjectorResults(session: Session, slide: Slide): ProjectorResults | null {
  if (!['pilihan', 'polling', 'awan', 'tanya'].includes(slide.type)) return null;
  const agg = aggregate(session, slide);
  if (slide.type === 'pilihan' || slide.type === 'polling') {
    return {
      type: slide.type,
      options: slide.options,
      counts: agg.options.map((o) => o.count),
      totalResponses: agg.total,
    };
  }
  if (slide.type === 'awan') {
    return {
      type: 'awan',
      words: agg.words.map(([text, count]) => ({ text, count })),
    };
  }
  if (slide.type === 'tanya') {
    return {
      type: 'tanya',
      questions: session.questions
        .filter((q) => q.slideId === slide.id && q.visible)
        .map((q) => ({ text: q.text, answered: q.answered })),
      totalReceived: session.questions.filter((q) => q.slideId === slide.id).length,
    };
  }
  return null;
}

function buildParticipantCounts(
  session: Session,
  slide: Slide,
): { options: string[]; counts: number[]; totalResponses: number } {
  const agg = aggregate(session, slide);
  return {
    options: slide.options,
    counts: agg.options.map((o) => o.count),
    totalResponses: agg.total,
  };
}

function buildParticipantWords(
  session: Session,
  slide: Slide,
): Array<{ text: string; count: number }> {
  const agg = aggregate(session, slide);
  const hiddenWords = activity(session, slide.id).hiddenWords;
  return agg.words
    .filter(([text]) => !hiddenWords.includes(text))
    .map(([text, count]) => ({ text, count }));
}

function buildLastPick(
  session: Session,
): Pick<PancingPick, 'participantId' | 'participantName' | 'timestamp'> | null {
  const slide = session.slides[session.active];
  if (!slide || slide.type !== 'pancing') return null;
  const picks = session.picks ?? [];
  const pick = [...picks].reverse().find((p) => p.slideId === slide.id);
  return pick ? { participantId: pick.participantId, participantName: pick.participantName, timestamp: pick.timestamp } : null;
}

function buildLeaderboard(session: Session, pid: string | null): Leaderboard | null {
  if (!session.quiz?.finished || !session.quiz.revealed) return null;
  const scores = quizScores(session);
  const top5: LeaderboardEntry[] = scores.slice(0, 5).map((s) => ({
    rank: s.rank,
    ownerId: s.id,
    ownerLabel: s.name,
    totalScore: s.total,
    correctCount: s.correct,
  }));

  let ownEntry: LeaderboardEntry | null = null;
  if (pid) {
    const myOwnerId =
      session.quiz.ownerType === 'kelompok'
        ? (session.groups.find((g) => g.members.includes(pid))?.id ?? pid)
        : pid;
    const inTop5 = top5.some((e) => e.ownerId === myOwnerId);
    if (!inTop5) {
      const me = scores.find((s) => s.id === myOwnerId);
      if (me) {
        ownEntry = {
          rank: me.rank,
          ownerId: me.id,
          ownerLabel: me.name,
          totalScore: me.total,
          correctCount: me.correct,
        };
      }
    }
  }

  return { entries: top5, ownEntry };
}
