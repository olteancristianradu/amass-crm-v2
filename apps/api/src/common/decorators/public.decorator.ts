import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key consumed by `JwtAuthGuard` to skip authentication on an
 * endpoint. Use together with the `@Public()` decorator.
 */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route handler (or controller) as public — the global JWT guard
 * will let the request through without a valid bearer token.
 *
 * Use sparingly. Every `@Public()` is a surface that has to defend itself
 * with rate limiting / IP allow-list / signature verification. Cases
 * currently covered:
 *   - auth/register, auth/login, auth/refresh (pre-token by definition)
 *   - portal/* (client portal uses its own short-lived portal token)
 *   - health/* (liveness/readiness probes don't carry a JWT)
 *   - calls/webhook/* (Twilio signs requests; verified in TwilioClient)
 *   - sso callback routes
 *
 * Pattern:
 * ```ts
 * @Controller('auth')
 * export class AuthController {
 *   @Public()
 *   @Post('login')
 *   login(...) { ... }
 * }
 * ```
 */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);
