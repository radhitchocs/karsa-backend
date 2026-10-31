import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  Req,
  HttpCode,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { SessionsService } from './sessions.service';
import { Public, CurrentUser, AuthPayload, PresenterOnly } from '../auth/decorators';
import { UnauthorizedException } from '@nestjs/common';

@Controller('api')
export class SessionsController {
  constructor(
    private readonly svc: SessionsService,
    private readonly jwt: JwtService,
  ) {}

  /** POST /api/presentations/:id/sessions — presenter creates a session */
  @PresenterOnly()
  @Post('presentations/:id/sessions')
  createSession(
    @Param('id') presentationId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    return this.svc.createSession(presentationId, user.sub);
  }

  /** POST /api/sessions/join — public */
  @Public()
  @Post('sessions/join')
  @HttpCode(200)
  join(@Body() body: { code: string; name: string }) {
    return this.svc.join(body.code, body.name);
  }

  /**
   * GET /api/sessions/:id/state
   * Role is inferred from JWT payload (role: 'presenter' | 'participant')
   * or projectorToken query param.
   */
  @Public()
  @Get('sessions/:id/state')
  async getState(
    @Param('id') sessionId: string,
    @Query('projectorToken') projectorToken: string | undefined,
    @Req() req: Request,
  ) {
    if (projectorToken) {
      return this.svc.getProjectorView(sessionId, projectorToken);
    }

    const rawToken = req.headers.authorization?.split(' ')[1];
    if (!rawToken) throw new UnauthorizedException('Token tidak ditemukan.');

    let payload: AuthPayload;
    try {
      payload = this.jwt.verify<AuthPayload>(rawToken);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kadaluarsa.');
    }

    if (payload.role === 'presenter') {
      return this.svc.getPresenterView(sessionId, payload.sub);
    }
    if (payload.role === 'participant') {
      return this.svc.getParticipantView(sessionId, payload.sub);
    }
    throw new UnauthorizedException('Peran tidak dikenali.');
  }

  /** GET /api/sessions/:id/projector-token — presenter only */
  @PresenterOnly()
  @Get('sessions/:id/projector-token')
  getProjectorToken(
    @Param('id') sessionId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    return this.svc.getProjectorToken(sessionId, user.sub);
  }

  /** GET /api/sessions/:id/results — presenter only */
  @PresenterOnly()
  @Get('sessions/:id/results')
  getResults(
    @Param('id') sessionId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    return this.svc.getResults(sessionId, user.sub);
  }

  /** GET /api/presentations/:id/results — list past sessions (presenter only) */
  @PresenterOnly()
  @Get('presentations/:id/results')
  getPresentationResults(
    @Param('id') presentationId: string,
    @CurrentUser() user: AuthPayload,
  ) {
    return this.svc.getPresentationResults(presentationId, user.sub);
  }
}
