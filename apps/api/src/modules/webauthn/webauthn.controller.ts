import { Controller, HttpException, HttpStatus, Post } from '@nestjs/common';

/**
 * A-scaffold: FIDO2 / WebAuthn endpoints. Target library is
 * @simplewebauthn/server; the 4-call dance is:
 *   POST /webauthn/register/options    → PublicKeyCredentialCreationOptions
 *   POST /webauthn/register/verify     → persist credential
 *   POST /webauthn/authenticate/options→ PublicKeyCredentialRequestOptions
 *   POST /webauthn/authenticate/verify → mint session
 *
 * Returning 501 on every verb so the FE can hit these endpoints in staging
 * and see a clear "not ready yet" response instead of a 404.
 */
@Controller('webauthn')
export class WebauthnController {
  @Post('register/options')
  registerOptions() {
    return this.unimplemented();
  }

  @Post('register/verify')
  registerVerify() {
    return this.unimplemented();
  }

  @Post('authenticate/options')
  authenticateOptions() {
    return this.unimplemented();
  }

  @Post('authenticate/verify')
  authenticateVerify() {
    return this.unimplemented();
  }

  private unimplemented(): never {
    throw new HttpException(
      { code: 'WEBAUTHN_NOT_IMPLEMENTED', message: 'FIDO2/WebAuthn is scaffolded but not wired yet' },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
