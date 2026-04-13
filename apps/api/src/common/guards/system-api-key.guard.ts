import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { loadEnv } from '../../config/env';

/**
 * Guard for system-to-system endpoints (e.g. AI worker → /calls/:id/ai-result).
 * Validates a static Bearer token set in AI_WORKER_SECRET env var.
 * If AI_WORKER_SECRET is not set, all requests are rejected.
 */
@Injectable()
export class SystemApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ')) {
      throw new ForbiddenException({ code: 'SYSTEM_AUTH_REQUIRED', message: 'System API key required' });
    }
    const token = auth.slice('Bearer '.length).trim();
    const env = loadEnv();
    if (!env.AI_WORKER_SECRET || token !== env.AI_WORKER_SECRET) {
      throw new ForbiddenException({ code: 'INVALID_SYSTEM_API_KEY', message: 'Invalid system API key' });
    }
    return true;
  }
}
