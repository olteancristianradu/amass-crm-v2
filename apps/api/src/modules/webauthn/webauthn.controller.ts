import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { z } from 'zod';
import { loadEnv } from '../../config/env';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthTokens } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { WebauthnService } from './webauthn.service';

/**
 * B2 — FIDO2 / WebAuthn endpoints (backed by @simplewebauthn/server).
 *
 * The 4-call ceremony (B2-PR1 + B2-PR2 wired; B2-PR3/PR4 are the FE):
 *   POST /webauthn/register/options    → PublicKeyCredentialCreationOptions
 *   POST /webauthn/register/verify     → persist credential
 *   POST /webauthn/authenticate/options→ PublicKeyCredentialRequestOptions  (public, pre-auth)
 *   POST /webauthn/authenticate/verify → mint session                       (public, pre-auth)
 *
 * Hidden from public Swagger until the FE ships the matching UI.
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

/** authenticate/options — the FE only knows the user's email at this point. */
const AuthenticateOptionsSchema = z.object({
  email: z.string().email().max(254),
  tenantSlug: z.string().min(1).max(64).optional(),
});
type AuthenticateOptionsBody = z.infer<typeof AuthenticateOptionsSchema>;

/**
 * authenticate/verify — userId is the session-binding hint we returned
 * from authenticate/options. The assertion proof is in `response`; the
 * library re-verifies the signature against the persisted public key.
 */
const VerifyAuthenticateSchema = z.object({
  userId: z.string().min(1).max(64),
  response: z
    .object({
      id: z.string().min(1),
      rawId: z.string().min(1),
      type: z.literal('public-key'),
      clientExtensionResults: z.unknown().optional(),
      authenticatorAttachment: z.string().optional(),
      response: z.object({
        clientDataJSON: z.string().min(1),
        authenticatorData: z.string().min(1),
        signature: z.string().min(1),
        userHandle: z.string().optional(),
      }),
    })
    .passthrough(),
});
type VerifyAuthenticateBody = z.infer<typeof VerifyAuthenticateSchema>;

@ApiExcludeController()
@Controller('webauthn')
export class WebauthnController {
  private readonly env = loadEnv();
  private readonly isProd = this.env.NODE_ENV === 'production';

  constructor(private readonly webauthn: WebauthnService) {}

  /**
   * Mirror of AuthController.commitTokensToCookie — commits the refresh
   * token to the httpOnly cookie and STRIPS it from the JSON body. The
   * FE relies on this cookie path for refresh, so the passkey-login
   * response shape must match `/auth/login` exactly.
   */
  private commitTokensToCookie(res: Response, tokens: AuthTokens): AuthTokens {
    // 7 days, same as auth.controller. If you bump one, bump the other.
    const sevenDays = 7 * 24 * 60 * 60;
    setRefreshCookie(res, tokens.refreshToken, sevenDays, this.isProd);
    return { ...tokens, refreshToken: '' };
  }

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

  /**
   * Begin passkey login — returns
   * PublicKeyCredentialRequestOptions for navigator.credentials.get() plus
   * a `userId` session-binding hint the FE echoes back on /verify.
   *
   * @Public() because at this point the user does NOT yet have a JWT;
   * this endpoint IS what produces one. Same threat model as /auth/login.
   */
  @Post('authenticate/options')
  @Public()
  @HttpCode(200)
  async authenticateOptions(
    @Body(new ZodValidationPipe(AuthenticateOptionsSchema)) body: AuthenticateOptionsBody,
  ) {
    return this.webauthn.generateAuthenticationOptions(body.email, body.tenantSlug);
  }

  /**
   * Complete passkey login — verifies the assertion, atomically updates
   * the passkey counter (cloned-credential defence), and returns the
   * `{ user, tokens }` envelope identical to /auth/login. The refresh
   * token is committed to the httpOnly cookie and stripped from the body.
   */
  @Post('authenticate/verify')
  @Public()
  @HttpCode(200)
  async authenticateVerify(
    @Body(new ZodValidationPipe(VerifyAuthenticateSchema)) body: VerifyAuthenticateBody,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.webauthn.verifyAuthentication(
      body.userId,
      // Same cast pattern as registerVerify — the Zod schema above pins
      // every load-bearing field; deeper crypto/signature validation is
      // done inside @simplewebauthn/server.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body.response as any,
      {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      },
    );
    return { ...result, tokens: this.commitTokensToCookie(res, result.tokens) };
  }
}
