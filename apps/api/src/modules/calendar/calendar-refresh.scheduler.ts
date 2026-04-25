import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CalendarService } from './calendar.service';

/**
 * M-17: proactively refresh calendar OAuth tokens before they expire.
 *
 * Without this, a token quietly expires and the next user-initiated sync
 * blows up with 401 — the integration appears broken even though the
 * refresh token is still valid. The sweep runs every 15 minutes and
 * refreshes anything expiring within the next hour, so user-facing
 * sync calls never see expired tokens in practice.
 *
 * Failures are logged but never block the sweep — the integration can
 * still be used until the user-facing 401 path catches the error and
 * surfaces it to the user.
 */
@Injectable()
export class CalendarRefreshScheduler {
  private readonly logger = new Logger(CalendarRefreshScheduler.name);

  constructor(private readonly calendar: CalendarService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async tick(): Promise<void> {
    try {
      await this.calendar.refreshExpiring();
    } catch (err) {
      this.logger.error(
        `Calendar refresh sweep crashed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
