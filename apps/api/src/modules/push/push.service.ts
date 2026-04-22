import { Injectable, Logger } from '@nestjs/common';

/**
 * F-scaffold: push-notification fan-out. Target providers:
 *   - APNs (Apple): `@parse/node-apn` or HTTP/2 direct
 *   - FCM (Android/web): `firebase-admin`
 *
 * **Status: NOT IMPLEMENTED.** `send()` is a no-op logger. The interface
 * is stable so feature code can depend on it today; when the real provider
 * SDKs land, only the inside of `send()` changes.
 *
 * When real:
 *   1. Device registers → we store (userId, platform, token) in
 *      `device_registrations` (migration pending).
 *   2. A notification producer calls `send(userId, payload)`; this service
 *      fans the payload out to every registered device of that user.
 *   3. Delivery failures (token invalid / unregistered) prune the row.
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
