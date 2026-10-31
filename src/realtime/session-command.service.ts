/**
 * SessionCommandService
 *
 * Executes socket commands against the domain engine, persists the
 * resulting state changes to Postgres, and broadcasts POV-projected
 * snapshots to all rooms.
 *
 * Also owns the quiz auto-close timers (server-side setTimeout).
 * Timers survive presenter disconnects (CH19).
 */
import { Injectable } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { Prisma, SessionStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionBuilderService } from '../session-builder/session-builder.service';
import { ProjectionService } from '../projection/projection.service';
import type { Session } from '../domain/model';
import { grouped, uid } from '../domain/model';
import { execute } from '../domain/engine';
import type { Command } from '../domain/engine';
import { quizExecute } from '../domain/quiz';
import type { CommandEnvelope, SessionCommandPayload } from '../contracts/commands';
import type { CommandAck, AckCode } from '../contracts/acks';

const STATUS_DB: Record<Session['status'], SessionStatus> = {
  lobi: 'LOBBY',
  aktif: 'ACTIVE',
  selesai: 'ENDED',
};

@Injectable()
export class SessionCommandService {
  private readonly quizTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private server: Server | null = null;

  constructor(
    readonly builder: SessionBuilderService,
    readonly projection: ProjectionService,
    private readonly prisma: PrismaService,
  ) {}

  setServer(server: Server): void {
    this.server = server;
  }

  async broadcastAfterJoin(sessionId: string): Promise<void> {
    if (!this.server) return;
    await this.broadcastSnapshots(sessionId, this.server, false);
  }

  // ---------------------------------------------------------------------------
  // Command execution
  // ---------------------------------------------------------------------------

  async executeCommand(
    sessionId: string,
    actorId: string,
    envelope: CommandEnvelope,
    presenterOnline: boolean,
  ): Promise<CommandAck> {
    const { requestId, payload, expectedVersion } = envelope;

    // 1. Idempotency — return stored ack for duplicate requestId
    const existing = await this.prisma.commandReceipt.findUnique({
      where: { sessionId_actorId_requestId: { sessionId, actorId, requestId } },
    });
    if (existing) return existing.responseJson as CommandAck;

    // 2. Load + inject runtime presenterOnline flag
    const { session, version } = await this.builder.load(sessionId);
    session.presenterOnline = presenterOnline;

    // 3. Optimistic version check
    if (expectedVersion !== undefined && expectedVersion !== version) {
      return this.fail(requestId, 'STATE_CONFLICT', 'Versi sesi berubah. Muat ulang.', version);
    }

    const now = Date.now();

    // 4. Special pre-execute: question.moderate uses a boolean setter, domain uses toggle
    if (payload.type === 'question.moderate') {
      const q = session.questions.find((q) => q.id === payload.questionId);
      if (!q) return this.fail(requestId, 'NOT_FOUND', 'Pertanyaan tidak ditemukan.', version);
      if (q.visible === payload.visible) {
        // Already in desired state — idempotent no-op
        const ack: CommandAck = { requestId, ok: true, code: '', message: 'OK', entityVersion: version };
        await this.saveReceipt(sessionId, actorId, requestId, ack);
        return ack;
      }
    }

    // 5a. Special: session.simulate — DEMO_MODE presenter only
    if (payload.type === 'session.simulate') {
      if (process.env['DEMO_MODE'] !== 'true') {
        return this.fail(requestId, 'UNAUTHORIZED', 'Hanya tersedia dalam mode demo.', version);
      }
      return await this.executeSimulateResponses(sessionId, session, version, actorId, requestId, now);
    }

    // 5b. Special: session.simulateQuiz — DEMO_MODE presenter only
    if (payload.type === 'session.simulateQuiz') {
      if (process.env['DEMO_MODE'] !== 'true') {
        return this.fail(requestId, 'UNAUTHORIZED', 'Hanya tersedia dalam mode demo.', version);
      }
      return await this.executeSimulateQuiz(sessionId, session, version, actorId, requestId, now);
    }

    // 5c. Special: pancing.pick — server picks a random online participant
    if (payload.type === 'pancing.pick') {
      const slide = session.slides[session.active];
      if (!slide || slide.type !== 'pancing') {
        return this.fail(requestId, 'INVALID_STATE', 'Aktifkan slide Pancing Peserta.', version);
      }
      const excludeIds = new Set((payload as { excludeIds?: string[] }).excludeIds ?? []);
      const pool = session.participants.filter(
        (p) => (p.online || p.simulated === true) && !excludeIds.has(p.id),
      );
      if (!pool.length) {
        return this.fail(requestId, 'INVALID_STATE', 'Semua peserta sudah terpilih.', version);
      }
      const picked = pool[Math.floor(Math.random() * pool.length)];
      try {
        execute(session, { type: 'pick', participantId: picked.id }, now);
      } catch (e) {
        return this.fail(requestId, 'INVALID_STATE', (e as Error).message, version);
      }
      let newVersion: number;
      try {
        newVersion = await this.persistChanges(sessionId, session, payload, actorId, requestId, version, now);
      } catch {
        return this.fail(requestId, 'INTERNAL_ERROR', 'Gagal menyimpan perubahan.', version);
      }
      const ack: CommandAck = { requestId, ok: true, code: '', message: 'OK', entityVersion: newVersion };
      await this.saveReceipt(sessionId, actorId, requestId, ack);
      return ack;
    }

    // 5. Map contract command → domain Command
    let cmd: Command;
    try {
      cmd = this.buildDomainCmd(payload, actorId, requestId);
    } catch (e) {
      return this.fail(requestId, 'INVALID_STATE', (e as Error).message, version);
    }

    // 6. Execute domain command (mutates in-memory session)
    try {
      execute(session, cmd, now);
    } catch (e) {
      return this.fail(requestId, 'INVALID_STATE', (e as Error).message, version);
    }

    // 7. Persist changes to DB
    let newVersion: number;
    try {
      newVersion = await this.persistChanges(sessionId, session, payload, actorId, requestId, version, now);
    } catch (e) {
      return this.fail(requestId, 'INTERNAL_ERROR', 'Gagal menyimpan perubahan.', version);
    }

    // 8. Save receipt and return ack
    const ack: CommandAck = { requestId, ok: true, code: '', message: 'OK', entityVersion: newVersion };
    await this.saveReceipt(sessionId, actorId, requestId, ack);
    return ack;
  }

  // ---------------------------------------------------------------------------
  // Direct DB mutations (bypass domain engine)
  // ---------------------------------------------------------------------------

  /** Marks quiz question run closed at deadline. Called by the quiz timer. */
  async closeQuizRun(sessionId: string, questionId: string): Promise<number | null> {
    const qs = await this.prisma.quizSession.findUnique({
      where: { sessionId },
      select: { id: true },
    });
    if (!qs) return null;

    const run = await this.prisma.quizQuestionRun.findFirst({
      where: { quizSessionId: qs.id, questionId, closed: false },
      select: { id: true },
    });
    if (!run) return null;

    await this.prisma.$transaction([
      this.prisma.quizQuestionRun.update({
        where: { id: run.id },
        data: { closed: true, closedAt: new Date() },
      }),
      this.prisma.session.update({
        where: { id: sessionId },
        data: { version: { increment: 1 } },
      }),
    ]);

    const updated = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { version: true },
    });
    return updated?.version ?? null;
  }

  /** Pauses or unpauses a session (presenter heartbeat / resume). */
  async setSessionPaused(sessionId: string, paused: boolean): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { paused, version: { increment: 1 } },
    });
  }

  /** Updates participant online state; returns sessionId or null on not-found. */
  async setParticipantOnline(participantId: string, online: boolean): Promise<string | null> {
    const p = await this.prisma.participant
      .update({
        where: { id: participantId },
        data: { online },
        select: { sessionId: true },
      })
      .catch(() => null);
    return p?.sessionId ?? null;
  }

  // ---------------------------------------------------------------------------
  // Snapshot broadcast
  // ---------------------------------------------------------------------------

  async broadcastSnapshots(
    sessionId: string,
    server: Server,
    presenterOnline: boolean,
  ): Promise<void> {
    const { session, version } = await this.builder.load(sessionId);
    session.presenterOnline = presenterOnline;

    server.to(`presenter-${sessionId}`).emit('session.snapshot', {
      type: 'session.snapshot',
      pov: 'presenter',
      view: this.projection.projectForPresenter(session, version),
    });

    server.to(`projector-${sessionId}`).emit('session.snapshot', {
      type: 'session.snapshot',
      pov: 'projector',
      view: this.projection.projectForProjector(session, version),
    });

    for (const p of session.participants) {
      server.to(`participant-${p.id}`).emit('session.snapshot', {
        type: 'session.snapshot',
        pov: 'participant',
        view: this.projection.projectForParticipant(session, p.id, version),
      });
    }
  }

  /** Send a snapshot to one specific socket (used on reconnect). */
  async sendSocketSnapshot(
    socket: Socket,
    sessionId: string,
    role: 'presenter' | 'participant' | 'projector',
    actorId: string,
    presenterOnline: boolean,
  ): Promise<void> {
    const { session, version } = await this.builder.load(sessionId);
    session.presenterOnline = presenterOnline;

    if (role === 'presenter') {
      socket.emit('session.snapshot', {
        type: 'session.snapshot',
        pov: 'presenter',
        view: this.projection.projectForPresenter(session, version),
      });
    } else if (role === 'projector') {
      socket.emit('session.snapshot', {
        type: 'session.snapshot',
        pov: 'projector',
        view: this.projection.projectForProjector(session, version),
      });
    } else {
      socket.emit('session.snapshot', {
        type: 'session.snapshot',
        pov: 'participant',
        view: this.projection.projectForParticipant(session, actorId, version),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Quiz auto-close timer
  // ---------------------------------------------------------------------------

  scheduleQuizTimer(
    sessionId: string,
    questionId: string,
    deadlineAt: number,
    server: Server,
    getPresenterOnline: () => boolean,
  ): void {
    const key = `${sessionId}:${questionId}`;
    const prev = this.quizTimers.get(key);
    if (prev) clearTimeout(prev);

    const delay = Math.max(0, deadlineAt - Date.now());
    const timer = setTimeout(async () => {
      this.quizTimers.delete(key);
      await this.closeQuizRun(sessionId, questionId);
      await this.broadcastSnapshots(sessionId, server, getPresenterOnline());
    }, delay);
    this.quizTimers.set(key, timer);
  }

  clearQuizTimers(sessionId: string): void {
    for (const key of this.quizTimers.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        clearTimeout(this.quizTimers.get(key)!);
        this.quizTimers.delete(key);
      }
    }
  }

  /**
   * On server startup: find all open QuizQuestionRuns in the DB and reschedule
   * their close timers from the persisted deadlineAt.  Runs whose deadline has
   * already passed are closed immediately (server was down during that window).
   */
  async recoverQuizTimers(
    server: Server,
    getPresenterOnline: (sessionId: string) => boolean,
  ): Promise<void> {
    const openRuns = await this.prisma.quizQuestionRun.findMany({
      where: { closed: false },
      select: { questionId: true, deadlineAt: true, quizSession: { select: { sessionId: true } } },
    });

    const now = Date.now();
    for (const run of openRuns) {
      const { sessionId } = run.quizSession;
      if (!run.deadlineAt) continue;
      const deadlineAt = run.deadlineAt.getTime();

      if (deadlineAt <= now) {
        // Deadline already passed while server was down — close immediately
        await this.closeQuizRun(sessionId, run.questionId);
        await this.broadcastSnapshots(sessionId, server, getPresenterOnline(sessionId));
      } else {
        // Deadline still in the future — reschedule from the original deadlineAt
        this.scheduleQuizTimer(sessionId, run.questionId, deadlineAt, server,
          () => getPresenterOnline(sessionId));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private fail(requestId: string, code: AckCode, message: string, version: number): CommandAck {
    return { requestId, ok: false, code, message, entityVersion: version };
  }

  private async saveReceipt(
    sessionId: string,
    actorId: string,
    requestId: string,
    ack: CommandAck,
  ): Promise<void> {
    await this.prisma.commandReceipt.upsert({
      where: { sessionId_actorId_requestId: { sessionId, actorId, requestId } },
      create: { sessionId, actorId, requestId, responseJson: ack as object },
      update: {},
    });
  }

  private async executeSimulateResponses(
    sessionId: string,
    session: Session,
    version: number,
    actorId: string,
    requestId: string,
    now: number,
  ): Promise<CommandAck> {
    const prevRespLen = session.responses.length;
    const prevQLen = session.questions.length;

    try {
      execute(session, { type: 'simulate' }, now);
    } catch (e) {
      return this.fail(requestId, 'INVALID_STATE', (e as Error).message, version);
    }

    const newResponses = session.responses.slice(prevRespLen);
    const newQuestions = session.questions.slice(prevQLen);

    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        activitiesJson: session.activities as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    for (const resp of newResponses) {
      if (resp.ownerType === 'kelompok') {
        await this.prisma.response.upsert({
          where: { sessionId_slideId_groupOwnerId: { sessionId, slideId: resp.slideId, groupOwnerId: resp.ownerId } },
          create: { id: resp.id, slideId: resp.slideId, sessionId, valueJson: resp.value as unknown as Prisma.InputJsonValue, submittedBy: resp.submittedBy, groupOwnerId: resp.ownerId },
          update: { valueJson: resp.value as unknown as Prisma.InputJsonValue, submittedBy: resp.submittedBy },
        });
      } else {
        await this.prisma.response.upsert({
          where: { sessionId_slideId_participantOwnerId: { sessionId, slideId: resp.slideId, participantOwnerId: resp.ownerId } },
          create: { id: resp.id, slideId: resp.slideId, sessionId, valueJson: resp.value as unknown as Prisma.InputJsonValue, submittedBy: resp.submittedBy, participantOwnerId: resp.ownerId },
          update: { valueJson: resp.value as unknown as Prisma.InputJsonValue, submittedBy: resp.submittedBy },
        });
      }
    }

    for (const q of newQuestions) {
      await this.prisma.question.create({
        data: { id: q.id, slideId: q.slideId, sessionId, text: q.text, participantId: q.participantId },
      });
    }

    const row = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { version: true } });
    const newVersion = row!.version;

    const ack: CommandAck = { requestId, ok: true, code: '', message: 'OK', entityVersion: newVersion };
    await this.saveReceipt(sessionId, actorId, requestId, ack);
    return ack;
  }

  private async executeSimulateQuiz(
    sessionId: string,
    session: Session,
    version: number,
    actorId: string,
    requestId: string,
    now: number,
  ): Promise<CommandAck> {
    const quiz = session.quiz;
    if (!quiz) return this.fail(requestId, 'INVALID_STATE', 'Tidak ada kuis aktif.', version);

    const run = quiz.runs.at(-1);
    if (!run || run.closed) return this.fail(requestId, 'INVALID_STATE', 'Buka pertanyaan dahulu.', version);

    const quizSlide = session.slides.find((s) => s.id === quiz.slideId);
    const questions = quizSlide?.quizQuestions ?? [];
    const question = questions.find((q) => q.id === run.questionId);
    if (!question) return this.fail(requestId, 'INVALID_STATE', 'Soal tidak ditemukan.', version);

    const bots = session.participants.filter((p) => p.simulated === true);
    const scenarios = ['cepat', 'lambat', 'salah'] as const;
    let scenarioIdx = 0;
    const prevAnswerCount = run.answers.length;

    for (const bot of bots) {
      const alreadyAnswered =
        quiz.ownerType === 'individu'
          ? run.answers.some((a) => a.ownerId === bot.id)
          : session.groups.some((g) => g.responder === bot.id && run.answers.some((a) => a.ownerId === g.id));
      if (alreadyAnswered) continue;

      const scenario = scenarios[scenarioIdx % 3];
      scenarioIdx++;

      const submitTime =
        scenario === 'lambat'
          ? Math.max(now, run.openedAt + (run.deadlineAt - run.openedAt) * 0.8)
          : now;

      const option =
        scenario === 'salah'
          ? ((question.correct[0] ?? 0) + 1) % question.options.length
          : question.correct[0] ?? 0;

      try {
        quizExecute(
          session,
          { type: 'quizSubmit', participantId: bot.id, questionId: run.questionId, option, requestId: uid() },
          submitTime,
        );
      } catch {
        // skip bots that fail (e.g. already answered via race condition)
      }
    }

    // Persist new answers
    const qs = await this.prisma.quizSession.findUnique({ where: { sessionId }, select: { id: true } });
    if (qs) {
      const runRecord = await this.prisma.quizQuestionRun.findUnique({
        where: { quizSessionId_questionId: { quizSessionId: qs.id, questionId: run.questionId } },
        select: { id: true },
      });
      if (runRecord) {
        const newAnswers = run.answers.slice(prevAnswerCount);
        for (const answer of newAnswers) {
          const ownerGroup =
            quiz.ownerType === 'kelompok' ? session.groups.find((g) => g.id === answer.ownerId) : null;
          await this.prisma.quizAnswer.create({
            data: {
              questionRunId: runRecord.id,
              requestId: answer.requestId,
              optionIndex: answer.option,
              receivedAt: new Date(answer.receivedAt),
              isCorrect: answer.correct,
              computedScore: answer.score,
              submittedBy: answer.submittedBy,
              ...(ownerGroup ? { groupOwnerId: ownerGroup.id } : { participantOwnerId: answer.ownerId }),
            },
          });
        }
      }
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { version: { increment: 1 } },
    });

    const row = await this.prisma.session.findUnique({ where: { id: sessionId }, select: { version: true } });
    const newVersion = row!.version;

    const ack: CommandAck = { requestId, ok: true, code: '', message: 'OK', entityVersion: newVersion };
    await this.saveReceipt(sessionId, actorId, requestId, ack);
    return ack;
  }

  private buildDomainCmd(
    payload: SessionCommandPayload,
    actorId: string,
    requestId: string,
  ): Command {
    switch (payload.type) {
      case 'session.start':
        return { type: 'start' };
      case 'slide.activate':
        return { type: 'navigate', index: payload.slideIndex };
      case 'activity.open':
        return { type: 'open' };
      case 'activity.close':
        return { type: 'close' };
      case 'activity.reopen':
        return { type: 'open' }; // engine resets visible=false on re-open
      case 'activity.hideWord':
        return { type: 'hideWord', word: payload.word };
      case 'session.resume':
        return { type: 'resume' };
      case 'results.reveal':
        return { type: 'reveal' };
      case 'groups.assign':
        return { type: 'assign', count: payload.groupCount };
      case 'group.replaceResponder':
        return { type: 'replace', groupId: payload.groupId };
      case 'response.submit':
        return { type: 'submit', participantId: actorId, value: payload.value, slideId: payload.slideId };
      case 'question.submit':
        return { type: 'submit', participantId: actorId, value: [payload.text], slideId: payload.slideId };
      case 'question.moderate':
        return { type: 'moderate', questionId: payload.questionId, action: 'visible' };
      case 'quiz.openQuestion':
        return { type: 'quizOpen' } as unknown as Command;
      case 'quiz.answerSubmit':
        return {
          type: 'quizSubmit',
          participantId: actorId,
          questionId: payload.questionRunId,
          option: payload.optionIndex,
          requestId,
        } as unknown as Command;
      case 'quiz.revealQuestion':
        return { type: 'quizRevealQuestion', questionRunId: payload.questionRunId } as unknown as Command;
      case 'quiz.finish':
        return { type: 'quizFinish' } as unknown as Command;
      case 'quiz.revealLeaderboard':
        return { type: 'quizReveal' } as unknown as Command;
      case 'session.toggleHideContent':
        return { type: 'toggleHideContent' };
      case 'session.end':
        return { type: 'end' };
      case 'session.simulate':
      case 'session.simulateQuiz':
        // Handled before buildDomainCmd; should not reach here
        throw new Error(`Perintah ditangani lebih awal: ${payload.type}`);
      default: {
        const t = (payload as { type: string }).type;
        throw new Error(`Perintah tidak dikenal: ${t}`);
      }
    }
  }

  private async persistChanges(
    sessionId: string,
    session: Session,
    payload: SessionCommandPayload,
    actorId: string,
    requestId: string,
    prevVersion: number,
    now: number,
  ): Promise<number> {
    // Always update session base fields
    await this.prisma.session.update({
      where: { id: sessionId },
      data: {
        status: STATUS_DB[session.status] as SessionStatus,
        activeSlide: session.active,
        divisionSlide: session.division,
        activitiesJson: session.activities as unknown as Prisma.InputJsonValue,
        paused: session.paused,
        hideContent: session.hideContent,
        version: { increment: 1 },
        ...(session.status === 'selesai' ? { endedAt: new Date(now) } : {}),
      },
    });

    // Command-specific relational writes
    switch (payload.type) {
      case 'groups.assign': {
        for (const g of session.groups) {
          await this.prisma.group.create({
            data: {
              id: g.id,
              number: g.number,
              sessionId,
              members: {
                create: g.members.map((pid) => ({
                  participantId: pid,
                  isResponder: g.responder === pid,
                })),
              },
            },
          });
        }
        break;
      }

      case 'group.replaceResponder': {
        const g = session.groups.find((g) => g.id === payload.groupId);
        if (g) {
          await this.prisma.groupMember.updateMany({
            where: { groupId: g.id },
            data: { isResponder: false },
          });
          await this.prisma.groupMember.update({
            where: { groupId_participantId: { groupId: g.id, participantId: g.responder } },
            data: { isResponder: true },
          });
        }
        break;
      }

      case 'response.submit': {
        const isGrouped = grouped(session);
        const actorGroup = isGrouped
          ? session.groups.find((g) => g.members.includes(actorId))
          : null;
        const ownerId = actorGroup ? actorGroup.id : actorId;
        const resp = session.responses.find(
          (r) => r.slideId === payload.slideId && r.ownerId === ownerId,
        );
        if (resp) {
          if (actorGroup) {
            await this.prisma.response.upsert({
              where: {
                sessionId_slideId_groupOwnerId: {
                  sessionId,
                  slideId: payload.slideId,
                  groupOwnerId: ownerId,
                },
              },
              create: {
                id: resp.id,
                slideId: payload.slideId,
                sessionId,
                valueJson: resp.value as unknown as Prisma.InputJsonValue,
                submittedBy: actorId,
                groupOwnerId: ownerId,
              },
              update: {
                valueJson: resp.value as unknown as Prisma.InputJsonValue,
                submittedBy: actorId,
              },
            });
          } else {
            await this.prisma.response.upsert({
              where: {
                sessionId_slideId_participantOwnerId: {
                  sessionId,
                  slideId: payload.slideId,
                  participantOwnerId: actorId,
                },
              },
              create: {
                id: resp.id,
                slideId: payload.slideId,
                sessionId,
                valueJson: resp.value as unknown as Prisma.InputJsonValue,
                submittedBy: actorId,
                participantOwnerId: actorId,
              },
              update: {
                valueJson: resp.value as unknown as Prisma.InputJsonValue,
                submittedBy: actorId,
              },
            });
          }
        }
        break;
      }

      case 'question.submit': {
        const matching = session.questions.filter(
          (q) => q.participantId === actorId && q.slideId === payload.slideId,
        );
        const newQ = matching[matching.length - 1];
        if (newQ) {
          await this.prisma.question.create({
            data: {
              id: newQ.id,
              slideId: newQ.slideId,
              sessionId,
              text: newQ.text,
              participantId: actorId,
            },
          });
        }
        break;
      }

      case 'question.moderate': {
        // Only one question per Q&A slide can be shown at a time
        if (payload.visible) {
          const q = session.questions.find((q) => q.id === payload.questionId)!;
          await this.prisma.question.updateMany({
            where: { sessionId, slideId: q.slideId, id: { not: q.id }, visible: true },
            data: { visible: false },
          });
        }
        await this.prisma.question.update({
          where: { id: payload.questionId },
          data: { visible: payload.visible },
        });
        break;
      }

      case 'quiz.openQuestion': {
        const quiz = session.quiz!;
        const run = quiz.runs.at(-1)!;
        const slide = session.slides.find((s) => s.id === quiz.slideId);

        await this.prisma.quizSession.upsert({
          where: { sessionId },
          create: {
            sessionId,
            ownerType: quiz.ownerType === 'kelompok' ? 'KELOMPOK' : 'INDIVIDU',
            duration: slide?.duration ?? 30,
            configJson: quiz.config as unknown as Prisma.InputJsonValue,
            status: 'RUNNING',
          },
          update: { status: 'RUNNING' },
        });

        const qs = await this.prisma.quizSession.findUnique({
          where: { sessionId },
          select: { id: true },
        });
        if (qs) {
          await this.prisma.quizQuestionRun.upsert({
            where: {
              quizSessionId_questionId: { quizSessionId: qs.id, questionId: run.questionId },
            },
            create: {
              quizSessionId: qs.id,
              questionId: run.questionId,
              index: quiz.runs.length - 1,
              openedAt: new Date(run.openedAt),
              deadlineAt: new Date(run.deadlineAt),
              closed: false,
            },
            update: {},
          });
        }
        break;
      }

      case 'quiz.answerSubmit': {
        const quiz = session.quiz;
        const run = quiz?.runs.find((r) => r.questionId === payload.questionRunId);
        const answer = run?.answers.find((a) => a.requestId === requestId);
        if (!answer) break;

        const qs = await this.prisma.quizSession.findUnique({
          where: { sessionId },
          select: { id: true },
        });
        if (!qs) break;

        const runRecord = await this.prisma.quizQuestionRun.findUnique({
          where: {
            quizSessionId_questionId: { quizSessionId: qs.id, questionId: payload.questionRunId },
          },
          select: { id: true },
        });
        if (!runRecord) break;

        const actorGroup =
          quiz!.ownerType === 'kelompok'
            ? session.groups.find((g) => g.members.includes(actorId))
            : null;

        await this.prisma.quizAnswer.create({
          data: {
            questionRunId: runRecord.id,
            requestId: answer.requestId,
            optionIndex: answer.option,
            receivedAt: new Date(answer.receivedAt),
            isCorrect: answer.correct,
            computedScore: answer.score,
            submittedBy: actorId,
            ...(actorGroup
              ? { groupOwnerId: actorGroup.id }
              : { participantOwnerId: actorId }),
          },
        });
        // B9: persist early close if domain auto-closed the run
        if (run?.closed) {
          await this.prisma.quizQuestionRun.update({
            where: { id: runRecord.id },
            data: { closed: true, closedAt: new Date(now) },
          });
        }
        break;
      }

      case 'quiz.finish': {
        await this.prisma.quizSession.update({
          where: { sessionId },
          data: { finished: true, status: 'FINISHED' },
        });
        break;
      }

      case 'quiz.revealLeaderboard': {
        await this.prisma.quizSession.update({
          where: { sessionId },
          data: { revealed: true },
        });
        break;
      }

      case 'quiz.revealQuestion': {
        const qs = await this.prisma.quizSession.findUnique({ where: { sessionId }, select: { id: true } });
        if (qs) {
          await this.prisma.quizQuestionRun.update({
            where: { quizSessionId_questionId: { quizSessionId: qs.id, questionId: payload.questionRunId } },
            data: { resultsVisible: true },
          });
        }
        break;
      }

      case 'pancing.pick': {
        await this.prisma.session.update({
          where: { id: sessionId },
          data: { picksJson: (session.picks ?? []) as unknown as Prisma.InputJsonValue },
        });
        break;
      }
    }

    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { version: true },
    });
    return row!.version;
  }
}
