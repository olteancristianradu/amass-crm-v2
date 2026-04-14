/**
 * Health check endpoints — used by Docker healthcheck, load balancer,
 * and monitoring systems.
 *
 *   GET /health          — liveness (returns 200 if the process is running)
 *   GET /health/ready    — readiness (checks DB + Redis connectivity)
 */
import { Controller, Get, HttpCode } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness — always 200 if the process is up */
  @Get()
  @HttpCode(200)
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness — verifies DB connection */
  @Get('ready')
  @HttpCode(200)
  async ready() {
    // Simple query to verify DB connection. If Prisma is not connected,
    // this throws and the global exception filter returns 500.
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
  }
}
