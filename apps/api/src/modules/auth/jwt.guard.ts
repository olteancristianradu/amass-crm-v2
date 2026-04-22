import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { loadEnv } from '../../config/env';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { RedisService } from '../../infra/redis/redis.service';
import { JwtPayload, JWT_BLOCKLIST_PREFIX } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly env = loadEnv();

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // @Public() metadata on handler or class → skip auth. Enables a safer
    // default: when JwtAuthGuard is wired globally (APP_GUARD), forgetting
    // @UseGuards on a new controller no longer leaves the route anonymous.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'NO_TOKEN', message: 'Missing bearer token' });
    }
    const token = auth.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret: this.env.JWT_SECRET });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Token invalid or expired' });
    }

    // Tokens issued before this change have no jti — reject them defensively
    // so stale tokens don't slip through the revocation path.
    if (!payload.jti || !payload.exp) {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Token missing required claims' });
    }

    const revoked = await this.redis.client.exists(`${JWT_BLOCKLIST_PREFIX}${payload.jti}`);
    if (revoked) {
      throw new UnauthorizedException({ code: 'TOKEN_REVOKED', message: 'Token has been revoked' });
    }

    req.user = {
      userId: payload.sub,
      tenantId: payload.tid,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
      exp: payload.exp,
    };
    return true;
  }
}
