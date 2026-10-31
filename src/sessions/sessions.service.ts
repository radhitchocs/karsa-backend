import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SessionBuilderService } from '../session-builder/session-builder.service';
import { ProjectionService } from '../projection/projection.service';
import { SessionCommandService } from '../realtime/session-command.service';
import { joinSchema, slidesSchema, validate, quizOrderErrors } from '../domain/model';
import { UnprocessableEntityException } from '@nestjs/common';

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: SessionBuilderService,
    private readonly projection: ProjectionService,
    private readonly jwt: JwtService,
    private readonly commands: SessionCommandService,
  ) {}

  /** Presenter creates a session from a presentation */
  async createSession(presentationId: string, ownerId: string) {
    const presentation = await this.prisma.presentation.findUnique({
      where: { id: presentationId },
    });
    if (!presentation) throw new NotFoundException('Presentasi tidak ditemukan.');
    if (presentation.ownerId !== ownerId) throw new ForbiddenException();

    // CH36: full content validation at session start (drafts with invalid slides are allowed)
    const parsedSlides = slidesSchema.parse(presentation.slidesJson);
    const orderErrors = quizOrderErrors(parsedSlides);
    if (orderErrors.length) throw new UnprocessableEntityException(orderErrors[0]);
    const contentErrors = validate({
      id: presentationId,
      title: presentation.title,
      slides: parsedSlides,
      updated: '',
    });
    if (contentErrors.length) throw new UnprocessableEntityException(contentErrors[0]);

    const code = await this.generateUniqueCode();

    // B3: auto-start when all slides are materi (no interaction needed)
    const slides = presentation.slidesJson as Array<{ type: string }>;
    const allMateri = slides.length > 0 && slides.every((s) => s.type === 'materi');

    const session = await this.prisma.session.create({
      data: {
        code,
        presentationId,
        slidesSnapshot: presentation.slidesJson as unknown as Prisma.InputJsonValue,
        activitiesJson: {},
        ...(allMateri ? { status: 'ACTIVE' as const } : {}),
      },
    });

    // DEMO_MODE: auto-create 6 offline bot participants marked as simulated
    if (process.env['DEMO_MODE'] === 'true') {
      const botNames = ['Alya', 'Bima', 'Citra', 'Dimas', 'Eka', 'Farah'];
      for (const botName of botNames) {
        const tokenHash = createHash('sha256')
          .update(`bot:${session.id}:${botName}`)
          .digest('hex');
        await this.prisma.participant.create({
          data: {
            name: botName,
            tokenHash,
            sessionId: session.id,
            online: false,
            simulated: true,
          },
        });
      }
    }

    return { sessionId: session.id, code: session.code, autoStarted: allMateri };
  }

  /** Participant joins a session by code + name */
  async join(code: string, name: string) {
    const parsed = joinSchema.safeParse({ code, name });
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0].message);
    }

    const session = await this.prisma.session.findUnique({ where: { code } });
    if (!session) throw new NotFoundException('Kode sesi tidak valid.');
    if (session.status === 'ENDED') {
      throw new ConflictException('Sesi sudah berakhir.');
    }

    const tokenBytes = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(tokenBytes).digest('hex');

    const participant = await this.prisma.participant.create({
      data: { name: parsed.data.name, tokenHash, sessionId: session.id, simulated: false },
    });

    const token = this.jwt.sign({
      sub: participant.id,
      role: 'participant',
      sessionId: session.id,
    });

    await this.commands.broadcastAfterJoin(session.id);

    return { participantId: participant.id, token, sessionId: session.id };
  }

  /** GET /api/sessions/:id/state as presenter */
  async getPresenterView(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { presentation: true },
    });
    if (!session) throw new NotFoundException('Sesi tidak ditemukan.');
    if (session.presentation.ownerId !== userId) throw new ForbiddenException();

    const { session: domainSession, version } =
      await this.builder.load(sessionId);
    return this.projection.projectForPresenter(domainSession, version);
  }

  /** GET /api/sessions/:id/state as participant */
  async getParticipantView(sessionId: string, participantId: string) {
    const participant = await this.prisma.participant.findUnique({
      where: { id: participantId },
    });
    if (!participant || participant.sessionId !== sessionId) {
      throw new ForbiddenException();
    }
    const { session: domainSession, version } =
      await this.builder.load(sessionId);
    return this.projection.projectForParticipant(domainSession, participantId, version);
  }

  /** GET /api/sessions/:id/state as projector (token from query) */
  async getProjectorView(sessionId: string, rawToken: string) {
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const record = await this.prisma.projectorToken.findFirst({
      where: { sessionId, tokenHash },
      include: { session: { select: { status: true } } },
    });
    if (!record) throw new ForbiddenException('Token proyektor tidak valid.');
    // D20: token expires on session end
    if (record.session.status === 'ENDED') {
      throw new ForbiddenException('Sesi sudah berakhir.');
    }
    const { session: domainSession, version } =
      await this.builder.load(sessionId);
    return this.projection.projectForProjector(domainSession, version);
  }

  /** GET /api/sessions/:id/projector-token — idempotent, presenter only */
  async getProjectorToken(sessionId: string, userId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { presentation: true, projectorToken: true },
    });
    if (!session) throw new NotFoundException('Sesi tidak ditemukan.');
    if (session.presentation.ownerId !== userId) throw new ForbiddenException();

    if (session.projectorToken) {
      // Return existing token hash — note: we can't reverse hash, so we store the raw token too
      // Instead, re-issue a new token only on first call. We need to store the raw token.
      // Workaround: store raw token encrypted or just always reissue and update hash.
      // For simplicity: store token in a separate field. But schema only has tokenHash.
      // Solution: we sign a JWT-like token that encodes sessionId + "projector".
      // This is deterministic and doesn't need storage.
      return { token: this.signProjectorToken(sessionId) };
    }

    const rawToken = this.signProjectorToken(sessionId);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    // INSERT … ON CONFLICT DO NOTHING: two concurrent first calls (two presenter tabs, or a page
    // plus the projector) would otherwise collide on the unique sessionId and 500. The token is
    // deterministic, so whichever insert wins, both callers return the same value.
    await this.prisma.projectorToken.createMany({
      data: [{ sessionId, tokenHash }],
      skipDuplicates: true,
    });
    return { token: rawToken };
  }

  /** GET /api/sessions/:id/results — presenter only */
  async getResults(sessionId: string, userId: string) {
    return this.getPresenterView(sessionId, userId);
  }

  /** GET /api/presentations/:id/results — list past sessions with per-slide summaries */
  async getPresentationResults(presentationId: string, ownerId: string) {
    const presentation = await this.prisma.presentation.findUnique({
      where: { id: presentationId },
    });
    if (!presentation) throw new NotFoundException('Presentasi tidak ditemukan.');
    if (presentation.ownerId !== ownerId) throw new ForbiddenException();

    const sessions = await this.prisma.session.findMany({
      where: { presentationId },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: { select: { id: true, name: true, simulated: true } },
        groups: { select: { id: true, number: true } },
        responses: {
          select: {
            slideId: true,
            valueJson: true,
            participantOwnerId: true,
            groupOwnerId: true,
            participantOwner: { select: { name: true } },
            groupOwner: { select: { number: true } },
          },
        },
        questions: {
          select: { slideId: true, text: true, visible: true, answered: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
        quizSession: {
          include: {
            questionRuns: {
              include: {
                answers: {
                  select: {
                    participantOwnerId: true,
                    groupOwnerId: true,
                    optionIndex: true,
                    isCorrect: true,
                    computedScore: true,
                    participantOwner: { select: { name: true } },
                  },
                },
              },
            },
          },
        },
        _count: { select: { participants: true } },
      },
    });

    return sessions.map((s) => {
      const groupNumberMap = new Map(s.groups.map((g) => [g.id, g.number]));
      return {
        id: s.id,
        code: s.code,
        status: s.status,
        createdAt: s.createdAt,
        endedAt: s.endedAt,
        participantCount: s._count.participants,
        slides: (s.slidesSnapshot as Array<{ id: string; type: string; title: string }>).map((slide) => {
          const responses = s.responses.filter((r) => r.slideId === slide.id);
          const questions = s.questions.filter((q) => q.slideId === slide.id);
          return {
            id: slide.id,
            type: slide.type,
            title: slide.title,
            responseCount: responses.length,
            responses: responses.map((r) => ({
              value: r.valueJson,
              ownerLabel:
                r.participantOwner?.name ??
                (r.groupOwnerId ? `Kelompok ${groupNumberMap.get(r.groupOwnerId) ?? '?'}` : null),
            })),
            questions: questions.map((q) => ({
              text: q.text,
              visible: q.visible,
              answered: q.answered,
            })),
          };
        }),
        quizScores: s.quizSession
          ? s.quizSession.questionRuns.flatMap((run) =>
              run.answers.map((a) => ({
                questionRunId: run.id,
                questionIndex: run.index,
                ownerLabel:
                  a.participantOwner?.name ??
                  (a.groupOwnerId ? `Kelompok ${groupNumberMap.get(a.groupOwnerId) ?? '?'}` : null),
                optionIndex: a.optionIndex,
                isCorrect: a.isCorrect,
                score: a.computedScore,
              })),
            )
          : [],
      };
    });
  }

  private signProjectorToken(sessionId: string): string {
    return createHmac('sha256', process.env['JWT_SECRET'] ?? 'dev-secret-change-in-production')
      .update(sessionId)
      .digest('hex');
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const existing = await this.prisma.session.findUnique({ where: { code } });
      if (!existing) return code;
    }
    throw new Error('Gagal membuat kode sesi unik.');
  }
}
