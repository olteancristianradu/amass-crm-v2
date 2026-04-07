import { Injectable, NestMiddleware } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import { loadEnv } from '../../config/env';
import { JwtPayload } from '../../modules/auth/auth.service';
import { tenantStorage } from '../../infra/prisma/tenant-context';

/**
 * Decodes the JWT (best-effort, non-blocking) and stores tenant context in
 * AsyncLocalStorage so downstream services can call `prisma.runWithTenant`.
 *
 * This is a MIDDLEWARE not a guard — it doesn't reject requests. JwtAuthGuard
 * remains the actual access gate. Routes without the guard simply have no
 * tenant context (login, register), which is intentional.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  private readonly env = loadEnv();

  constructor(private readonly jwt: JwtService) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return next();
    }
    const token = auth.slice('Bearer '.length).trim();
    try {
      const payload = this.jwt.verify<JwtPayload>(token, { secret: this.env.JWT_SECRET });
      tenantStorage.run(
        { tenantId: payload.tid, userId: payload.sub, role: payload.role },
        () => next(),
      );
    } catch {
      // Invalid token — let the guard reject it. No context set.
      next();
    }
  }
}
