/**
 * contracts/commands.ts
 *
 * Commands sent from client to server via Socket.IO.
 * No REST endpoint for commands — Socket.IO only.
 *
 * Every command is wrapped in CommandEnvelope.
 * Identity (actorId, role) is derived from server credentials, NOT from payload.
 *
 * IDENTICAL COPY in both repos — do not diverge.
 */

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------
export type CommandEnvelope<T extends SessionCommandPayload = SessionCommandPayload> = {
  requestId: string;       // unique per send attempt; same requestId = idempotent retry
  sessionId: string;
  expectedVersion?: number; // for concurrent mutation control (presenter commands)
  responderVersion?: number; // for quiz.answerSubmit group validation
  payload: T;
};

// ---------------------------------------------------------------------------
// Command payload union
// ---------------------------------------------------------------------------
export type SessionCommandPayload =
  | SessionStart
  | ToggleHideContent
  | SlideActivate
  | ActivityOpen
  | ActivityClose
  | ActivityReopen
  | ActivityHideWord
  | ResultsReveal
  | GroupsAssign
  | GroupReplaceResponder
  | ResponseSubmit
  | QuestionSubmit
  | QuestionModerate
  | QuizOpenQuestion
  | QuizAnswerSubmit
  | QuizRevealQuestion
  | QuizFinish
  | QuizRevealLeaderboard
  | SessionResume
  | SessionEnd
  | SimulateResponses
  | SimulateQuiz
  | PancingPick;

// Presenter commands
export type SessionStart           = { type: "session.start" };
export type ToggleHideContent      = { type: "session.toggleHideContent" };
export type SlideActivate          = { type: "slide.activate"; slideIndex: number };
export type ActivityOpen           = { type: "activity.open"; slideId: string };
export type ActivityClose          = { type: "activity.close"; slideId: string };
export type ActivityReopen         = { type: "activity.reopen"; slideId: string }; // D18
export type ActivityHideWord       = { type: "activity.hideWord"; slideId: string; word: string };
export type ResultsReveal          = { type: "results.reveal"; slideId: string };
export type GroupsAssign           = { type: "groups.assign"; groupCount: number };
export type GroupReplaceResponder  = { type: "group.replaceResponder"; groupId: string };
export type QuestionModerate       = { type: "question.moderate"; questionId: string; visible: boolean };
export type QuizOpenQuestion       = { type: "quiz.openQuestion"; questionId: string };
export type QuizRevealQuestion     = { type: "quiz.revealQuestion"; questionRunId: string };
export type QuizFinish             = { type: "quiz.finish" };
export type QuizRevealLeaderboard  = { type: "quiz.revealLeaderboard" };
export type SessionResume          = { type: "session.resume" };
export type SessionEnd             = { type: "session.end" };
export type SimulateResponses      = { type: "session.simulate" };   // DEMO_MODE presenter only
export type SimulateQuiz           = { type: "session.simulateQuiz" }; // DEMO_MODE presenter only

// Participant commands
export type ResponseSubmit = {
  type: "response.submit";
  slideId: string;
  value: string[];         // array for word cloud; single-element for MC/polling
};
export type QuestionSubmit = {
  type: "question.submit";
  slideId: string;
  text: string;
};
export type QuizAnswerSubmit = {
  type: "quiz.answerSubmit";
  questionRunId: string;
  optionIndex: number;
};

// Pancing command — presenter picks a random participant
export type PancingPick = { type: "pancing.pick"; excludeIds?: string[] };
