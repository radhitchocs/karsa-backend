import { Session, QuizRun, uid, validate } from "./model";
export interface ClockAdapter {
  now(): number;
}
export const systemClock: ClockAdapter = { now: () => Date.now() };
import { QUIZ_CONFIG } from "./quiz-config";
export type QuizCommand =
  | { type: "quizOpen" | "quizFinish" | "quizReveal" | "quizTick" }
  | {
      type: "quizSubmit";
      participantId: string;
      questionId: string;
      option: number;
      requestId: string;
    }
  | { type: "quizRevealQuestion"; questionRunId: string }
  | {
      type: "quizSimulate";
      scenario: "cepat" | "lambat" | "salah" | "kosong" | "retry";
    };
function reject(m: string): never {
  throw new Error(m);
}
export function reconcileQuiz(s: Session, now: number) {
  s.quiz?.runs.forEach((r) => {
    if (now >= r.deadlineAt) r.closed = true;
  });
}
export function quizExecute(s: Session, c: QuizCommand, now: number) {
  reconcileQuiz(s, now);
  const slide = s.slides[s.active];
  if (c.type === "quizTick") return;
  const quiz = s.quiz;
  if (c.type === "quizSubmit") {
    const run = quiz?.runs.find((r) => r.questionId === c.questionId);
    const old = run?.answers.find(
      (a) => a.submittedBy === c.participantId && a.requestId === c.requestId,
    );
    if (old) {
      if (old.option !== c.option)
        reject("Request yang sama memiliki jawaban berbeda.");
      return;
    }
  }
  if (s.status !== "aktif" || slide.type !== "kuis")
    reject("Aktifkan slide Kuis dalam sesi berjalan.");
  if (c.type !== "quizSubmit" && (s.paused || !s.presenterOnline))
    reject("Lanjutkan sesi presenter terlebih dahulu.");
  const questions = slide.quizQuestions ?? [];
  if (c.type === "quizOpen") {
    const dur = slide.duration ?? 0;
    if (dur < 10 || dur > 120)
      reject("Durasi kuis harus antara 10–120 detik.");
    if (
      validate({ id: "", title: s.title, slides: [slide], updated: "" }).length
    )
      reject("Lengkapi pertanyaan dan durasi kuis.");
    if (!s.quiz)
      s.quiz = {
        slideId: slide.id,
        ownerType: s.groups.length ? "kelompok" : "individu",
        runs: [],
        finished: false,
        revealed: false,
        config: { ...QUIZ_CONFIG },
      };
    const q = s.quiz;
    if (
      q.finished ||
      q.runs.some((r) => !r.closed) ||
      q.runs.length >= questions.length
    )
      reject("Pertanyaan belum ditutup atau seluruh soal telah dimainkan.");
    q.runs.push({
      questionId: questions[q.runs.length].id,
      openedAt: now,
      deadlineAt: now + (slide.duration ?? 30) * 1000,
      closed: false,
      answers: [],
    });
    return;
  }
  if (!quiz) reject("Kuis belum dimulai.");
  const run = quiz.runs.at(-1);
  if (c.type === "quizFinish") {
    if (quiz.runs.length !== questions.length || !run?.closed)
      reject("Selesaikan seluruh pertanyaan terlebih dahulu.");
    quiz.finished = true;
    return;
  }
  if (c.type === "quizReveal") {
    if (!quiz.finished)
      reject("Peringkat hanya tersedia setelah kuis selesai.");
    quiz.revealed = true;
    return;
  }
  if (c.type === "quizRevealQuestion") {
    const revRun = quiz.runs.find((r) => r.questionId === c.questionRunId);
    if (!revRun?.closed) reject("Soal belum ditutup.");
    revRun.resultsVisible = true;
    return;
  }
  if (c.type === "quizSubmit") {
    if (
      !run ||
      run.questionId !== c.questionId ||
      run.closed ||
      now < run.openedAt ||
      now >= run.deadlineAt ||
      quiz.finished
    )
      reject("Pertanyaan belum dibuka atau waktu habis.");
    const p = s.participants.find((p) => p.id === c.participantId);
    if (!p?.online && !p?.simulated) reject("Peserta terputus.");
    const group = s.groups.find((g) => g.members.includes(p.id));
    if (quiz.ownerType === "kelompok" && (!group || group.responder !== p.id))
      reject("Hanya penjawab aktif yang dapat mengirim.");
    const ownerId = quiz.ownerType === "kelompok" ? group!.id : p.id;
    if (run.answers.some((a) => a.ownerId === ownerId))
      reject("Jawaban sudah final.");
    const question = questions.find((q) => q.id === run.questionId)!;
    if (
      !c.requestId ||
      !Number.isInteger(c.option) ||
      c.option < 0 ||
      c.option >= question.options.length
    )
      reject("Pilih satu opsi yang tersedia.");
    const correct = question.correct.includes(c.option);
    const score = correct
      ? quiz.config.base +
        Math.round(
          (quiz.config.bonus * (run.deadlineAt - now)) /
            (run.deadlineAt - run.openedAt),
        )
      : 0;
    run.answers.push({
      ownerId,
      submittedBy: p.id,
      option: c.option,
      requestId: c.requestId,
      receivedAt: now,
      correct,
      score,
    });
    // B9: early close when all online/simulated owners have answered
    const onlineOwners =
      quiz.ownerType === "kelompok"
        ? s.groups.filter((g) =>
            s.participants.some(
              (pt) => pt.id === g.responder && (pt.online || pt.simulated === true),
            ),
          ).map((g) => g.id)
        : s.participants
            .filter((pt) => pt.online || pt.simulated === true)
            .map((pt) => pt.id);
    if (
      onlineOwners.length > 0 &&
      onlineOwners.every((oid) => run.answers.some((a) => a.ownerId === oid))
    ) {
      run.closed = true;
    }
    return;
  }
  if (c.type === "quizSimulate") {
    if (!run) reject("Buka pertanyaan dahulu.");
    if (c.scenario === "retry") {
      const a = run.answers.at(-1);
      if (!a) reject("Kirim jawaban dahulu.");
      quizExecute(
        s,
        {
          type: "quizSubmit",
          participantId: a.submittedBy,
          questionId: run.questionId,
          option: a.option,
          requestId: a.requestId,
        },
        now,
      );
      return;
    }
    if (run.closed) reject("Waktu habis. Buka soal berikutnya.");
    const target =
      c.scenario === "kosong"
        ? run.deadlineAt
        : c.scenario === "lambat"
          ? Math.max(now, run.openedAt + (run.deadlineAt - run.openedAt) * 0.8)
          : now;
    s.clockOffset = (s.clockOffset ?? 0) + target - now;
    if (c.scenario === "kosong") {
      reconcileQuiz(s, target);
      return;
    }
    const p = s.participants.find(
      (p) =>
        (p.online || p.simulated === true) &&
        (quiz.ownerType === "individu"
          ? !run.answers.some((a) => a.ownerId === p.id)
          : s.groups.some(
              (g) =>
                g.responder === p.id &&
                !run.answers.some((a) => a.ownerId === g.id),
            )),
    );
    if (!p) reject("Semua pemilik sudah menjawab.");
    const q = questions.find((q) => q.id === run.questionId)!;
    quizExecute(
      s,
      {
        type: "quizSubmit",
        participantId: p.id,
        questionId: run.questionId,
        option:
          c.scenario === "salah"
            ? (() => {
                const wrong = q.options.findIndex((_, i) => !q.correct.includes(i));
                return wrong >= 0 ? wrong : (q.correct[0] + 1) % q.options.length;
              })()
            : q.correct[0] ?? 0,
        requestId: uid(),
      },
      target,
    );
  }
}
export function quizScores(s: Session) {
  const quiz = s.quiz;
  if (!quiz) return [];
  const owners =
    quiz.ownerType === "kelompok"
      ? s.groups.map((g) => ({ id: g.id, name: `Kelompok ${g.number}` }))
      : s.participants.map((p) => ({ id: p.id, name: p.name }));
  const scores = owners
    .map((o, order) => {
      const answers = quiz.runs.flatMap((r) =>
        r.answers.filter((a) => a.ownerId === o.id),
      );
      return {
        ...o,
        order,
        total: answers.reduce((sum, a) => sum + a.score, 0),
        correct: answers.filter((a) => a.correct).length,
        wrong: answers.filter((a) => !a.correct).length,
        missing: quiz.runs.filter(
          (r) => r.closed && !r.answers.some((a) => a.ownerId === o.id),
        ).length,
        rank: 0,
      };
    })
    .sort(
      (a, b) => b.total - a.total || b.correct - a.correct || a.name.localeCompare(b.name, "id"),
    );
  scores.forEach((s, i) => {
    s.rank =
      i &&
      s.total === scores[i - 1].total &&
      s.correct === scores[i - 1].correct
        ? scores[i - 1].rank
        : i + 1;
  });
  return scores;
}
export function leaderboard(s: Session) {
  return s.quiz?.finished && s.quiz.revealed ? quizScores(s).slice(0, 5) : [];
}
export const activeQuizRun = (s: Session): QuizRun | undefined =>
  s.quiz?.runs.at(-1);
