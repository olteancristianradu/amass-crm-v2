import { Body, Controller, HttpCode, HttpException, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { WebauthnService } from './webauthn.service';

/**
 * B2 — FIDO2 / WebAuthn endpoints (backed by @simplewebauthn/server).
 *
 * The 4-call ceremony:
 *   POST /webauthn/register/options    → PublicKeyCredentialCreationOptions   [PR1 wired]
 *   POST /webauthn/register/verify     → persist credential                   [PR1 wired]
 *   POST /webauthn/authenticate/options→ PublicKeyCredentialRequestOptions    [PR2 — still 501]
 *   POST /webauthn/authenticate/verify → mint session                         [PR2 — still 501]
 *
 * Hidden from public Swagger until the full ceremony is exposed.
 */

// Loose schema for the RegistrationResponseJSON shape — we don't try to
// re-validate the WebAuthn payload here (the library does that on every
// field), just confirm the request body is the right top-level shape.
const VerifyRegisterSchema = z.object({
  response: z
    .object({
      id: z.string().min(1),
      rawId: z.string().min(1),
      type: z.literal('public-key'),
      clientExtensionResults: z.unknown().optional(),
      authenticatorAttachment: z.string().optional(),
      response: z.object({
        clientDataJSON: z.string().min(1),
        attestationObject: z.string().min(1),
        transports: z.array(z.string()).optional(),
        publicKeyAlgorithm: z.number().optional(),
        publicKey: z.string().optional(),
        authenticatorData: z.string().optional(),
      }),
    })
    .passthrough(),
  deviceName: z.string().min(1).max(120).optional(),
});

type VerifyRegisterBody = z.infer<typeof VerifyRegisterSchema>;

@ApiExcludeController()
@Controller('webauthn')
export class WebauthnController {
  constructor(private readonly webauthn: WebauthnService) {}

  /** Begin passkey registration — returns the options JSON for navigator.credentials.create(). */
  @Post('register/options')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async registerOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.webauthn.generateRegistrationOptions(user.userId, user.tenantId);
  }

  /** Complete registration — verifies attestation and persists the Passkey row. */
  @Post('register/verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async registerVerify(
    @Body(new ZodValidationPipe(VerifyRegisterSchema)) body: VerifyRegisterBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // The cast to the library RegistrationResponseJSON is safe because the
    // Zod schema above already pins every required field as a non-empty
    // string of the right primitive type; any deeper validation (signature,
    // attestation format, RP ID, origin, challenge) is done by the library.
    return this.webauthn.verifyRegistration(
      user.userId,
      user.tenantId,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body.response as any,
      body.deviceName,
    );
  }

  /** B2-PR2: passkey login. Stubbed until the authenticate flow lands. */
  @Post('authenticate/options')
  authenticateOptions() {
    return this.unimplemented();
  }

  /** B2-PR2: passkey login. Stubbed until the authenticate flow lands. */
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
