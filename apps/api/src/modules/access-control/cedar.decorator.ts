import { SetMetadata } from '@nestjs/common';

/**
 * D-scaffold: route metadata consumed by `CedarGuard`. Attach to a handler
 * to enforce an ABAC decision from `CedarPolicyService` before the
 * handler runs.
 *
 * `resource` may be a static string (`'Deal'`) or a function that derives
 * the resource id from the incoming request — useful for per-row checks
 * like `Deal::<req.params.id>`.
 *
 * Example:
 * ```ts
 * @RequireCedar({ action: 'deal::delete', resource: (req) => `Deal::${req.params.id}` })
 * @Delete(':id')
 * remove(@Param('id') id: string) { ... }
 * ```
 *
 * Design notes:
 *  - No effect until `CedarGuard` is applied to the controller (or to the
 *    root module via APP_GUARD). This keeps the decorator declarative —
 *    removing the guard lifts the check in one place.
 *  - Decisions are always logged by `CedarPolicyService`, so deny paths
 *    leave an audit trail even without an audit.log() call in the guard.
 */

export const CEDAR_METADATA_KEY = 'cedar:requirement';

export interface CedarRequirement {
  action: string;
  resource: string | ((req: unknown) => string);
  /** Additional context merged into the decision input. Defaults to
   *  `{ role, isOwner }` resolved from `req.user`. */
  context?: (req: unknown) => Record<string, unknown>;
}

export const RequireCedar = (req: CedarRequirement): ReturnType<typeof SetMetadata> =>
  SetMetadata(CEDAR_METADATA_KEY, req);
