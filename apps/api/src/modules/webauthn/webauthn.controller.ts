import { Controller, HttpException, HttpStatus, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';

/**
 * A-scaffold: FIDO2 / WebAuthn endpoints. Target library is
 * @simplewebauthn/server; the 4-call dance is:
 *   POST /webauthn/register/options    → PublicKeyCredentialCreationOptions
 *   POST /webauthn/register/verify     → persist credential
 *   POST /webauthn/authenticate/options→ PublicKeyCredentialRequestOptions
 *   POST /webauthn/authenticate/verify → mint session
 *
 * Every verb returns 501 — no credential table, no challenge store, no
 * @simplewebauthn/server integration. Hidden from public Swagger so the
 * API surface we don't implement isn't advertised.
 */
@ApiExcludeController()
@Controller('webauthn')
@Public()
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
