import {
  Controller,
  Get,
  Header,
  HttpException,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import {
  ALL_SCHEMAS,
  RESOURCE_TYPES,
  SERVICE_PROVIDER_CONFIG,
  buildListResponse,
} from './scim-meta.fixtures';
import { SCIM_ERROR_SCHEMA_URN } from './scim.dto';

/**
 * SCIM 2.0 discovery surface — RFC 7644 §4.
 *
 * Endpoints:
 *   GET /scim/v2/ServiceProviderConfig
 *   GET /scim/v2/Schemas
 *   GET /scim/v2/Schemas/:id              (id is a SCIM URN, percent-decoded)
 *   GET /scim/v2/ResourceTypes
 *   GET /scim/v2/ResourceTypes/:id        (id is "User" or "Group")
 *
 * **Why @Public()**: RFC 7644 §4 says discovery is unauthenticated. Okta and
 * Azure AD probe these endpoints BEFORE the operator has even pasted a
 * bearer token into the wizard — gating them on auth means the wizard's
 * preflight fails and several Okta certification checks won't pass. The
 * tradeoff: these endpoints expose *capability metadata* (which features we
 * support) but no tenant data — so there is nothing useful for an
 * unauthenticated attacker to learn beyond "this is a SCIM server".
 *
 * Hidden from Swagger for the same reason `ScimController` is: this is an
 * IdP-facing surface, not a human one.
 */
@ApiExcludeController()
@Controller('scim/v2')
@Public()
export class ScimMetaController {
  @Get('ServiceProviderConfig')
  @Header('Content-Type', 'application/scim+json')
  getServiceProviderConfig(): typeof SERVICE_PROVIDER_CONFIG {
    return SERVICE_PROVIDER_CONFIG;
  }

  /**
   * RFC 7644 §4 — return all schemas as a ListResponse. We don't paginate
   * (the set is fixed at 2: User + Group).
   */
  @Get('Schemas')
  @Header('Content-Type', 'application/scim+json')
  listSchemas(): ReturnType<typeof buildListResponse<(typeof ALL_SCHEMAS)[number]>> {
    return buildListResponse(ALL_SCHEMAS);
  }

  /**
   * RFC 7644 §4 — return a single schema by its URN. Express URL-decodes
   * the `:id` segment automatically, so an IdP can send the URN either
   * raw (`urn:ietf:params:scim:schemas:core:2.0:User`) or URL-encoded.
   */
  @Get('Schemas/:id')
  @Header('Content-Type', 'application/scim+json')
  getSchema(@Param('id') id: string): (typeof ALL_SCHEMAS)[number] {
    const match = ALL_SCHEMAS.find((s) => s.id === id);
    if (!match) {
      throw new HttpException(
        {
          schemas: [SCIM_ERROR_SCHEMA_URN],
          status: '404',
          detail: `Schema not found: ${id}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return match;
  }

  @Get('ResourceTypes')
  @Header('Content-Type', 'application/scim+json')
  listResourceTypes(): ReturnType<typeof buildListResponse<(typeof RESOURCE_TYPES)[number]>> {
    return buildListResponse(RESOURCE_TYPES);
  }

  /**
   * RFC 7644 §4 — single ResourceType by `id` ("User" or "Group").
   * Reference to the schema URN is provided in the `schema` field for the
   * IdP to cross-link with `/Schemas/:id`.
   */
  @Get('ResourceTypes/:id')
  @Header('Content-Type', 'application/scim+json')
  getResourceType(@Param('id') id: string): (typeof RESOURCE_TYPES)[number] {
    const match = RESOURCE_TYPES.find((rt) => rt.id === id);
    if (!match) {
      throw new HttpException(
        {
          schemas: [SCIM_ERROR_SCHEMA_URN],
          status: '404',
          detail: `ResourceType not found: ${id}`,
        },
        HttpStatus.NOT_FOUND,
      );
    }
    return match;
  }
}

