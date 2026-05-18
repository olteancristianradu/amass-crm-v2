import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { loadEnv } from '../../config/env';

/**
 * Phase 2 F1 — feature flag gate. Throws HTTP 503 whenever
 * `CONTRACT_ESIGN_ENABLED=false` (the default). Applied to every controller
 * that touches the ceremony — owner-side send/void as well as the public
 * `/p/sign/*` callback paths.
 *
 * Separate from the prod boot-time check (env.ts `prodOnlyChecks`) because
 * the boot-time check guarantees the FLAG can only flip ON in prod after a
 * lawyer sign-off; this guard makes the flag actually do something at
 * runtime.
 */
@Injectable()
export class EsignEnabledGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    const env = loadEnv();
    if (!env.CONTRACT_ESIGN_ENABLED) {
      throw new ServiceUnavailableException({
        code: 'ESIGN_DISABLED',
        message: 'E-sign feature is disabled (CONTRACT_ESIGN_ENABLED=false).',
      });
    }
    return true;
  }
}
