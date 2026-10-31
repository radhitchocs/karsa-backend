import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  ConflictException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validate, quizOrderErrors, slidesSchema } from '../domain/model';
import type { Slide } from '../domain/model';

@Injectable()
export class PresentationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string) {
    const rows = await this.prisma.presentation.findMany({
      where: { ownerId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true, version: true, slidesJson: true },
    });
    return rows.map((p) => {
      const slides = Array.isArray(p.slidesJson)
        ? (p.slidesJson as Array<{ type: string }>)
        : [];
      const slideKinds = [...new Set(slides.map((s) => s.type))];
      return {
        id: p.id,
        title: p.title,
        updatedAt: p.updatedAt,
        version: p.version,
        slideCount: slides.length,
        slideKinds,
      };
    });
  }

  async create(ownerId: string, title: string) {
    return this.prisma.presentation.create({
      data: { ownerId, title: title.trim() || 'Presentasi baru', slidesJson: [] },
      select: { id: true, title: true, updatedAt: true, version: true },
    });
  }

  async get(id: string, ownerId: string) {
    const p = await this.prisma.presentation.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Presentasi tidak ditemukan.');
    if (p.ownerId !== ownerId) throw new ForbiddenException();
    return p;
  }

  async update(id: string, ownerId: string, data: { title?: string }) {
    await this.get(id, ownerId);
    return this.prisma.presentation.update({
      where: { id },
      data: { title: data.title?.trim() },
    });
  }

  async delete(id: string, ownerId: string) {
    await this.get(id, ownerId);
    await this.prisma.presentation.delete({ where: { id } });
    return { ok: true };
  }

  async putSlides(
    id: string,
    ownerId: string,
    rawSlides: unknown,
    expectedVersion?: number,
  ) {
    const current = await this.get(id, ownerId);

    // Optimistic locking: reject if another save has happened since last load
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictException(
        'Presentasi telah diubah di tab lain. Muat ulang untuk melihat versi terbaru.',
      );
    }

    // Normalize correct: number → number[] for backward-compat
    const slides: Slide[] = slidesSchema.parse(rawSlides);

    // Validate slide ordering rules (quiz last, max 1 quiz) — always enforced
    const orderErrors = quizOrderErrors(slides);
    if (orderErrors.length) {
      throw new UnprocessableEntityException(orderErrors[0]);
    }

    // CH36: content validation removed from putSlides (option b).
    // Drafts with incomplete slides are allowed; validation runs at session start.

    return this.prisma.presentation.update({
      where: { id },
      data: { slidesJson: slides as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
  }

  /** Full content validation — called before session creation */
  validateForSession(id: string, title: string, slides: Slide[]): void {
    const allErrors = validate({ id, title, slides, updated: '' });
    if (allErrors.length) {
      throw new UnprocessableEntityException(allErrors[0]);
    }
  }
}
