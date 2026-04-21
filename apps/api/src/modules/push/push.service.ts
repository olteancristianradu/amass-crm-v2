import { Injectable, Logger } from '@nestjs/common';

/**
 * F-scaffold: push-notification fan-out. Target providers:
 *   - APNs (Apple): `@parse/node-apn` or HTTP/2 direct
 *   - FCM (Android/web): `firebase-admin`
 *
 * When real:
 *   1. Device registers → we store (userId, platform, token) in
 *      `device_registrations` (migration pending).
 *   2. A notification producer calls `send(userId, payload)`; this service
 *      fans the payload out to every registered device of that user.
 *   3. Delivery failures (token invalid / unregistered) prune the row.
 *
 * For now `send()` is a no-op logger so callers can be wired today.
 */
export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  async send(userId: string, payload: PushPayload): Promise<void> {
    this.logger.debug(`push.send stub userId=${userId} title=${payload.title}`);
  }
}
