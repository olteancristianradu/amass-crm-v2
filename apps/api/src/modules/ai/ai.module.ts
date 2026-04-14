/**
 * AiModule — @Global so EmbeddingService is injectable in CompaniesModule,
 * ContactsModule and ClientsModule without explicit imports.
 *
 * Provides:
 *   EmbeddingService  — OpenAI vector generation + DB storage
 *   SearchService     — semantic search + similar records
 *   DealAiService     — Claude-powered deal suggestions
 *   AiController      — REST endpoints under /api/v1/ai
 */
import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { EmbeddingService } from './embedding.service';
import { SearchService } from './search.service';
import { DealAiService } from './deal-ai.service';
import { AiController } from './ai.controller';

@Global()
@Module({
  imports: [PrismaModule, AuthModule],
  providers: [EmbeddingService, SearchService, DealAiService],
  controllers: [AiController],
  exports: [EmbeddingService, SearchService, DealAiService],
})
export class AiModule {}
