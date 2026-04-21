import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  /** JWT id claim — needed to revoke this token on logout. */
  jti: string;
  /** JWT expiry (epoch seconds) — needed to set Redis TTL on revocation. */
  exp: number;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthenticatedUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
  if (!req.user) {
    throw new Error('CurrentUser used on a route without JwtAuthGuard');
  }
  return req.user;
});
