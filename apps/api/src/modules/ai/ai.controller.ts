import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { SearchService, EntityType } from './search.service';
import { EmbeddingService } from './embedding.service';
import { DealAiService } from './deal-ai.service';

@Controller('ai')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AiController {
  constructor(
    private readonly search: SearchService,
    private readonly embedding: EmbeddingService,
    private readonly dealAi: DealAiService,
  ) {}

  /**
   * GET /ai/search?q=acme&limit=10
   * Semantic search across companies + contacts + clients.
   */
  @Get('search')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  async semanticSearch(
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    if (!q?.trim()) return { results: [] };
    const results = await this.search.semanticSearch(q.trim(), limit ? parseInt(limit, 10) : 10);
    return { results };
  }

  /**
   * GET /ai/similar/:type/:id?limit=5
   * Find records similar to the given entity.
   * type: company | contact | client
   */
  @Get('similar/:type/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  async findSimilar(
    @Param('type') type: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    const results = await this.search.findSimilar(type as EntityType, id, limit ? parseInt(limit, 10) : 5);
    return { results };
  }

  /**
   * POST /ai/deals/:id/suggest
   * Get Claude's recommended next action for a deal.
   */
  @Post('deals/:id/suggest')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  async suggestDealAction(@Param('id') id: string) {
    return this.dealAi.suggest(id);
  }

  /**
   * POST /ai/reindex
   * Re-generate embeddings for all records in this tenant.
   * Restricted to OWNER/ADMIN. Can take a while if many records.
   */
  @Post('reindex')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async reindex() {
    const counts = await this.embedding.reindexAll();
    return { message: 'Reindex complete', counts };
  }
}
