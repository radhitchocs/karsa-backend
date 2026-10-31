/**
 * ProjectionService — thin NestJS wrapper around the pure projection functions
 * in domain/projection.ts (identical file in both repos).
 *
 * The pure functions contain the real logic and privacy rules.
 * This wrapper exists only to satisfy NestJS DI.
 */
import { Injectable } from '@nestjs/common';
import type { Session } from '../domain/model';
import {
  projectForPresenter as _projectForPresenter,
  projectForParticipant as _projectForParticipant,
  projectForProjector as _projectForProjector,
} from '../domain/projection';
import type {
  PresenterView,
  ParticipantView,
  ProjectorView,
} from '../contracts/views';

@Injectable()
export class ProjectionService {
  projectForPresenter(session: Session, version: number): PresenterView {
    return _projectForPresenter(session, version);
  }

  projectForParticipant(
    session: Session,
    pid: string,
    version: number,
  ): ParticipantView {
    return _projectForParticipant(session, pid, version);
  }

  projectForProjector(session: Session, version: number): ProjectorView {
    return _projectForProjector(session, version);
  }
}
