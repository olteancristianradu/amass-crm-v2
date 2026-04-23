import { Module } from '@nestjs/common';
import { SsoController } from './sso.controller';

/**
 * SSO is intentionally disabled in this build — see sso.controller.ts.
 * Keeping the module + controller around so the /sso/* routes cleanly
 * return 410 GONE rather than 404 (which would be indistinguishable
 * from a typo). Re-add SsoService + JwtModule when the feature is
 * properly reimplemented.
 */
@Module({
  controllers: [SsoController],
})
export class SsoModule {}
