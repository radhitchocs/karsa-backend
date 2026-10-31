import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, IS_PRESENTER_KEY, AuthPayload } from './decorators';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    // Gateway handles its own auth — skip non-HTTP contexts
    if (ctx.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user: AuthPayload }>();
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new UnauthorizedException('Token tidak ditemukan.');

    try {
      req.user = this.jwt.verify<AuthPayload>(token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kadaluarsa.');
    }

    const isPresenterOnly = this.reflector.getAllAndOverride<boolean>(IS_PRESENTER_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPresenterOnly && req.user.role !== 'presenter') {
      throw new ForbiddenException('Akses ditolak: endpoint ini hanya untuk presenter.');
    }

    return true;
  }
}
