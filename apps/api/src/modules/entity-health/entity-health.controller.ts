import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SubjectType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EntityHealthService, type RelationshipHealth } from './entity-health.service';

const VALID_TYPES = new Set<SubjectType>(['COMPANY', 'CONTACT', 'CLIENT']);

@UseGuards(JwtAuthGuard)
@Controller('entity-health')
export class EntityHealthController {
  constructor(private readonly health: EntityHealthService) {}

  @Get(':type/:id')
  async get(
    @Param('type') type: string,
    @Param('id') id: string,
  ): Promise<RelationshipHealth> {
    const upper = type.toUpperCase() as SubjectType;
    if (!VALID_TYPES.has(upper)) {
      // Fail closed — unknown entity types must not leak data through this
      // endpoint. The frontend is the only legit caller and it always sends
      // COMPANY/CONTACT/CLIENT.
      throw new Error(`Unsupported entity type: ${type}`);
    }
    return this.health.getHealth(upper, id);
  }
}
