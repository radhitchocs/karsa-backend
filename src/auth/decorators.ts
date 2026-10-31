import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_PRESENTER_KEY = 'isPresenterOnly';
export const PresenterOnly = () => SetMetadata(IS_PRESENTER_KEY, true);

export type AuthPayload =
  | { role: 'presenter'; sub: string }
  | { role: 'participant'; sub: string; sessionId: string };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPayload => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthPayload }>();
    return req.user;
  },
);
