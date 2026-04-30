/**
 * Health check endpoints — used by Docker healthcheck, load balancer,
 * and monitoring systems.
 *
 *   GET /health           — liveness (returns 200 if the process is running)
 *   GET /health/ready     — readiness (checks DB connectivity)
 *   GET /health/detailed  — full probe: DB + Redis + queues + breakers
 */
import { Controller, Get, HttpCode, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { listBreakers } from '../../common/resilience/circuit-breaker';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

type ProbeStatus = 'up' | 'down' | 'degraded';

interface Probe {
  status: ProbeStatus;
  latencyMs?: number;
  message?: string;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness — always 200 if the process is up */
  @Get()
  @Public()
  @HttpCode(200)
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness — verifies DB connection */
  @Get('ready')
  @Public()
  @HttpCode(200)
  async ready() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', db: 'connected', timestamp: new Date().toISOString() };
  }

  /**
   * Detailed probe for ops dashboards + alerting. Never throws on a single
   * dependency being down — returns a structured report with status per
   * component plus an overall status that is 'down' if any critical check
   * failed, 'degraded' if a non-critical check is flaky, 'up' otherwise.
   *
   * Returns 503 when overall status is 'down' so load-balancers can take
   * this instance out of rotation.
   *
   * FIX (RED2#5): pre-fix this was @Public() and exposed the integration
   * topology (which AI provider, which payment processor, ANAF state, etc.)
   * to anyone scraping `/health/detailed` — useful recon for spear-phishing.
   * Now restricted to authenticated OWNER/ADMIN users.
   */
  @Get('detailed')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async detailed() {
    const [db, redis] = await Promise.all([this.probeDb(), this.probeRedis()]);

    const breakers = listBreakers();
    const anyBreakerOpen = breakers.some((b) => b.state === 'open');

    const criticalDown = db.status === 'down' || redis.status === 'down';
    const overall: ProbeStatus = criticalDown ? 'down' : anyBreakerOpen ? 'degraded' : 'up';

    const body = {
      status: overall,
      timestamp: new Date().toISOString(),
      checks: {
        db,
        redis,
        breakers,
      },
    };
    if (overall === 'down') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }

  private async probeDb(): Promise<Probe> {
    const start = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'unknown',
      };
    }
  }

  private async probeRedis(): Promise<Probe> {
    const start = Date.now();
    try {
      const pong = await this.redis.client.ping();
      if (pong !== 'PONG') {
        return { status: 'down', latencyMs: Date.now() - start, message: `unexpected ping response: ${pong}` };
      }
      return { status: 'up', latencyMs: Date.now() - start };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : 'unknown',
      };
    }
  }
}
