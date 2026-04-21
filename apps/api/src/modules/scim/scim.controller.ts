import { All, Controller, HttpException, HttpStatus, Param } from '@nestjs/common';

/**
 * A-scaffold: SCIM 2.0 endpoints — user/group provisioning protocol used by
 * IdPs (Okta, Azure AD, OneLogin, JumpCloud) to push directory changes into
 * SaaS apps. Target shape matches RFC 7644.
 *
 * Live endpoints arrive once we have paying customers pulled through an IdP.
 * For now every verb returns 501 with a SCIM-compliant error envelope so
 * connectors can be pointed at this endpoint and produce coherent logs.
 */
@Controller('scim/v2')
export class ScimController {
  @All(':resource')
  @All(':resource/:id')
  any(@Param('resource') resource: string, @Param('id') id?: string) {
    throw new HttpException(
      {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
        detail: `SCIM endpoint ${resource}${id ? '/' + id : ''} is scaffolded but not implemented yet`,
        status: '501',
      },
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
