import { Module } from '@nestjs/common';
import { WebauthnController } from './webauthn.controller';

/**
 * A-scaffold: FIDO2/WebAuthn placeholder. Real implementation needs:
 *   - Credential table (user, credentialId, publicKey, counter, transports)
 *   - Challenge store (Redis, short TTL)
 *   - @simplewebauthn/server for assertion verification
 * All kept out of this commit — shape only.
 */
@Module({
  controllers: [WebauthnController],
})
export class WebauthnModule {}
