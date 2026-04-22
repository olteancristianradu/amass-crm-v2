import { All, Controller, HttpException, HttpStatus, Param } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * A-scaffold: SCIM 2.0 endpoints — user/group provisioning protocol used by
 * IdPs (Okta, Azure AD, OneLogin, JumpCloud) to push directory changes into
 * SaaS apps. Target shape matches RFC 7644.
 *
 * **Every verb returns 501.** The module is wired so IdP connectors get a
 * coherent error envelope instead of a 404, but there is no actual
 * provisioning logic. Hidden from public Swagger so we don't advertise an
 * API surface we don't implement.
 *
 * NOTE on routing: stacking two `@All(...)` decorators on the same method
 * only registers the last one — Nest reflects decorator metadata and the
 * second write clobbers the first. Use two distinct methods so both
 * `/scim/v2/:resource` and `/scim/v2/:resource/:id` are actually served.
 */
@ApiExcludeController()
@Controller('scim/v2')
export class ScimController {
  @All(':resource')
  collection(@Param('resource') resource: string) {
    return this.notImplemented(resource);
  }

  @All(':resource/:id')
  item(@Param('resource') resource: string, @Param('id') id: string) {
    return this.notImplemented(`${resource}/${id}`);
  }

  private notImplemented(endpoint: string): never {
    throw new HttpException(
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        detail: `SCIM endpoint ${endpoint} is scaffolded but not implemented yet`,
        status: '501',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
