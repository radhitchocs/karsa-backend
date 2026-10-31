/**
 * contracts/views.ts
 *
 * Projected state types for each Point of View.
 * Server applies projectForPresenter / projectForParticipant / projectForProjector
 * before pushing snapshots. Clients receive only what their POV allows.
 *
 * IDENTICAL COPY in both repos — do not diverge.
 */

import type {
  Slide,
  Participant,
  Group,
  Response,
  Question,
  Activity,
  QuizState,
  PancingPick,
} from "../domain/model";

// ---------------------------------------------------------------------------
// Leaderboard entry (shared across all three views after quiz ends + reveal)
// ---------------------------------------------------------------------------
export type LeaderboardEntry = {
  rank: number;
  ownerId: string;
  ownerLabel: string;
  totalScore: number;
  correctCount: number;
};

export type Leaderboard = {
  entries: LeaderboardEntry[]; // max 5
  /** Viewer's own entry if outside top 5; null if inside top 5 or not applicable */
  ownEntry: LeaderboardEntry | null;
};

// ---------------------------------------------------------------------------
// PresenterView — full data, quiz answer keys, Q&A private questions
// ---------------------------------------------------------------------------
export type PresenterView = {
  sessionId: string;
  sessionVersion: number;
  status: "lobi" | "aktif" | "selesai";
  code: string;
  title: string;
  slides: Slide[];
  activeSlideIndex: number;
  divisionSlideIndex: number;
  participants: Participant[];
  groups: Group[];
  responses: Response[];
  questions: Question[]; // all questions including hidden ones
  activities: Record<string, Activity>;
  paused: boolean;
  presenterOnline: boolean;
  quiz: QuizState | null;
  leaderboard: Leaderboard | null; // populated after quiz.revealLeaderboard
  hideContent: boolean;
  lastPick: Pick<PancingPick, 'participantId' | 'participantName' | 'timestamp'> | null;
  picks: PancingPick[];
  /** True when any participant in the session is marked simulated (demo or DEMO_MODE backend) */
  hasSimulatedData: boolean;
};

// ---------------------------------------------------------------------------
// ParticipantView — filtered per participant; no hidden keys or private data
// ---------------------------------------------------------------------------
export type ParticipantSubRole = "individu" | "anggota" | "penjawab";

export type ParticipantView = {
  sessionId: string;
  sessionVersion: number;
  status: "lobi" | "aktif" | "selesai";
  title: string;
  pid: string; // this participant's id
  name: string;
  subRole: ParticipantSubRole;
  myGroup: {
    id: string;
    number: number;
    members: Array<{ id: string; name: string; online: boolean }>;
    responderName: string;
    isResponder: boolean;
  } | null;
  /** correct and explanation stripped before reveal; both present after presenter reveals results */
  activeSlide: Omit<Slide, "correct"> & { correct?: number[] };
  activeSlideIndex: number;
  divisionSlideIndex: number;
  activity: Activity | null;
  myResponse: Response | null;
  groupResponse: Response | null; // read-only for members
  questions: Question[]; // only visible ones + own submitted
  quiz: ParticipantQuizView | null;
  leaderboard: Leaderboard | null;
  paused: boolean;
  presenterOnline: boolean;
  hideContent: boolean;
  /** Awan kata aggregate words (hiddenWords excluded) — non-null only when slide=awan && visible=true && !hideContent */
  revealedWords: Array<{ text: string; count: number }> | null;
  /** Pilihan/polling aggregate counts — non-null only when slide=pilihan|polling && visible=true && !hideContent */
  revealedCounts: { options: string[]; counts: number[]; totalResponses: number } | null;
  lastPick: Pick<PancingPick, 'participantId' | 'participantName' | 'timestamp'> | null;
  /** True when any participant in the session is marked simulated */
  hasSimulatedData: boolean;
};

export type ParticipantQuizView = {
  slideId: string;
  ownerType: "individu" | "kelompok";
  finished: boolean;
  revealed: boolean;
  activeQuestion: {
    questionId: string;
    index: number;
    total: number;
    title: string;
    options: string[];
    openedAt: number;
    deadlineAt: number;
    closed: boolean;
    myAnswer: {
      option: number;
      correct: boolean | null; // null while open or hideContent=ON; present after close when hideContent=OFF
      score: number | null;
    } | null;
    /** Correct option indices; null while open or hideContent=ON; present after close when hideContent=OFF */
    correctOption: number[] | null;
    groupAnswered: boolean; // for group mode members
    /** True when presenter revealed per-question results AND hideContent=OFF */
    resultsVisible: boolean;
    /** Per-option answer counts; non-null when resultsVisible=true */
    answerCounts: number[] | null;
  } | null;
};

// ---------------------------------------------------------------------------
// ProjectorView — public display only; no admin controls or private data
// ---------------------------------------------------------------------------
export type ProjectorView = {
  sessionId: string;
  sessionVersion: number;
  status: "lobi" | "aktif" | "selesai";
  /** Total participants in session (for join notification in lobby) */
  participantCount: number;
  code: string;
  title: string;
  /** explanation always stripped; correct stripped before reveal, present only for pilihan after reveal */
  activeSlide: Omit<Slide, "explanation"> & { correct?: number[] };
  activeSlideIndex: number;
  /** Group tiles for Pembagian Kelompok slide; number + memberCount only, no names or ids */
  groups: { number: number; memberCount: number }[];
  responseProgress: {
    received: number;
    total: number; // groups if divided, participants otherwise
    /** Awan kata only: total words sent across all responses (hidden words included) */
    wordsReceived?: number;
  } | null;
  revealedResults: ProjectorResults | null;
  quiz: ProjectorQuizView | null;
  leaderboard: Leaderboard | null;
  paused: boolean;
  lastPick: Pick<PancingPick, 'participantId' | 'participantName' | 'timestamp'> | null;
  pancingParticipants: Array<{ id: string; name: string; online: boolean }> | null;
  /** True when any participant in the session is marked simulated */
  hasSimulatedData: boolean;
};

export type ProjectorResults =
  | { type: "pilihan" | "polling"; options: string[]; counts: number[]; totalResponses: number }
  | { type: "awan"; words: Array<{ text: string; count: number }> }
  | { type: "tanya"; questions: Array<{ text: string; answered: boolean }>; totalReceived: number };

export type ProjectorQuizView = {
  slideId: string;
  ownerType: "individu" | "kelompok";
  finished: boolean;
  activeQuestion: {
    questionId: string;
    index: number;
    total: number;
    title: string;
    options: string[];
    openedAt: number;
    deadlineAt: number;
    closed: boolean;
    /** Correct option indices; null while question open, present after question closes */
    correctOption: number[] | null;
    submittedCount: number;
    totalOwners: number;
    /** True once presenter clicks "Tampilkan Hasil" for this question */
    resultsVisible: boolean;
    /** Per-option answer counts; non-null when resultsVisible=true */
    answerCounts: number[] | null;
  } | null;
};
