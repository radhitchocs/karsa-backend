/**
 * SessionBuilderService — assembles a domain Session from Prisma relational rows.
 * Used before applying projection functions.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Session, Slide, Activity, Response, Question, QuizState, QuizRun, QuizAnswer as DomainQuizAnswer, PancingPick } from '../domain/model';
import { slidesSchema } from '../domain/model';

type SessionWithAll = Prisma.SessionGetPayload<{
  include: {
    presentation: true;
    participants: { include: { groupMembership: { include: { group: true } } } };
    groups: { include: { members: true } };
    responses: true;
    questions: true;
    quizSession: { include: { questionRuns: { include: { answers: true } } } };
  };
}>;

@Injectable()
export class SessionBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  async load(sessionId: string): Promise<{ session: Session; version: number }> {
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        presentation: true,
        participants: {
          include: {
            groupMembership: { include: { group: true } },
          },
        },
        groups: { include: { members: true } },
        responses: true,
        questions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        quizSession: {
          include: {
            questionRuns: {
              orderBy: { index: 'asc' },
              include: { answers: true },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Sesi tidak ditemukan.');
    return { session: this.map(row), version: row.version };
  }

  private map(row: SessionWithAll): Session {
    const slides = slidesSchema.parse(row.slidesSnapshot);

    const statusMap: Record<string, Session['status']> = {
      LOBBY: 'lobi',
      ACTIVE: 'aktif',
      ENDED: 'selesai',
    };

    const participants = row.participants.map((p) => ({
      id: p.id,
      name: p.name,
      online: p.online,
      simulated: p.simulated,
    }));

    const groups = row.groups.map((g) => ({
      id: g.id,
      number: g.number,
      members: g.members.map((m) => m.participantId),
      responder: g.members.find((m) => m.isResponder)?.participantId ?? '',
    }));

    const responses: Response[] = row.responses.map((r) => ({
      id: r.id,
      slideId: r.slideId,
      ownerType: r.groupOwnerId ? 'kelompok' : 'individu',
      ownerId: (r.groupOwnerId ?? r.participantOwnerId) as string,
      submittedBy: r.submittedBy,
      value: r.valueJson as string[],
      updated: r.updatedAt.toISOString(),
    }));

    const questions: Question[] = row.questions.map((q) => ({
      id: q.id,
      slideId: q.slideId,
      participantId: q.participantId,
      text: q.text,
      visible: q.visible,
      answered: q.answered,
    }));

    const activities = row.activitiesJson as unknown as Record<string, Activity>;
    const picks = (row.picksJson as unknown as PancingPick[]) ?? [];

    const quiz = row.quizSession
      ? this.mapQuiz(row.quizSession, slides)
      : undefined;

    return {
      id: row.id,
      presentationId: row.presentationId,
      title: row.presentation.title,
      slides,
      code: row.code,
      status: statusMap[row.status] ?? 'lobi',
      active: row.activeSlide,
      division: row.divisionSlide,
      participants,
      groups,
      responses,
      questions,
      activities,
      picks,
      paused: row.paused,
      presenterOnline: true, // set by socket gateway in Phase 2
      hideContent: row.hideContent,
      created: row.createdAt.toISOString(),
      quiz,
    };
  }

  private mapQuiz(
    qs: NonNullable<SessionWithAll['quizSession']>,
    slides: Slide[],
  ): QuizState {
    const slide = slides.find((s) => s.type === 'kuis');
    const ownerType = qs.ownerType === 'INDIVIDU' ? 'individu' : 'kelompok';
    const config = qs.configJson as { version: string; base: number; bonus: number };

    const runs: QuizRun[] = qs.questionRuns.map((run) => {
      const answers: DomainQuizAnswer[] = run.answers.map((a) => ({
        ownerId: (a.groupOwnerId ?? a.participantOwnerId) as string,
        submittedBy: a.submittedBy,
        option: a.optionIndex,
        requestId: a.requestId,
        receivedAt: a.receivedAt.getTime(),
        correct: a.isCorrect,
        score: a.computedScore,
      }));
      return {
        questionId: run.questionId,
        openedAt: run.openedAt?.getTime() ?? 0,
        deadlineAt: run.deadlineAt?.getTime() ?? 0,
        closed: run.closed,
        resultsVisible: run.resultsVisible,
        answers,
      };
    });

    return {
      slideId: slide?.id ?? '',
      ownerType,
      runs,
      finished: qs.finished,
      revealed: qs.revealed,
      config,
    };
  }
}
