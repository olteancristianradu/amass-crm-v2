import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Call, CallStatus, CallTranscript, Prisma, TranscriptionStatus } from '@prisma/client';
import { AiCallResultDto, InitiateCallDto, ListCallsQueryDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { RedisService } from '../../infra/redis/redis.service';
import { ActivitiesService } from '../activities/activities.service';
import { SubjectResolver } from '../activities/subject-resolver';
import { TwilioClient } from './twilio.client';
import { QUEUE_AI_CALLS } from '../../infra/queue/queue.constants';
import { CursorPage, makeCursorPage } from '../../common/pagination';

/** Twilio lowercase status → our enum. */
const TWILIO_STATUS_MAP: Partial<Record<string, CallStatus>> = {
  queued:        'QUEUED',
  initiated:     'QUEUED',
  ringing:       'RINGING',
  'in-progress': 'IN_PROGRESS',
  completed:     'COMPLETED',
  busy:          'BUSY',
  'no-answer':   'NO_ANSWER',
  failed:        'FAILED',
  canceled:      'CANCELED',
};

export interface AiCallJobPayload {
  callId: string;
  tenantId: string;
  recordingUrl: string;
  recordingSid: string;
}

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilio: TwilioClient,
    private readonly activities: ActivitiesService,
    private readonly subjects: SubjectResolver,
    private readonly redis: RedisService,
    @InjectQueue(QUEUE_AI_CALLS) private readonly aiQueue: Queue,
  ) {}

  // ─── Outbound call initiation ────────────────────────────────────

  async initiateCall(dto: InitiateCallDto): Promise<Call> {
    const ctx = requireTenantContext();
    if (!ctx.userId) {
      throw new BadRequestException({ code: 'AUTH_REQUIRED', message: 'Authenticated user required to initiate calls' });
    }

    await this.subjects.assertExists(dto.subjectType, dto.subjectId);

    // Resolve the "from" number — explicit or user/tenant default
    let phoneNumberId: string | null = dto.phoneNumberId ?? null;
    let fromNumber: string;

    if (phoneNumberId) {
      const pn = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.phoneNumber.findFirst({ where: { id: phoneNumberId!, tenantId: ctx.tenantId, deletedAt: null } }),
      );
      if (!pn) throw new NotFoundException({ code: 'PHONE_NUMBER_NOT_FOUND', message: 'Phone number not found' });
      fromNumber = pn.number;
    } else {
      // User-specific default first, then tenant-level (userId=null) default
      const pn = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.phoneNumber.findFirst({
          where: {
            tenantId: ctx.tenantId,
            isDefault: true,
            deletedAt: null,
            OR: [{ userId: ctx.userId! }, { userId: null }],
          },
          orderBy: { userId: 'desc' }, // user-specific first
        }),
      );
      if (!pn) {
        throw new BadRequestException({
          code: 'NO_PHONE_NUMBER',
          message: 'No default phone number configured. Add one via /phone-numbers.',
        });
      }
      phoneNumberId = pn.id;
      fromNumber = pn.number;
    }

    // Create Call row in QUEUED state before dialling so the webhook has a row to update
    const call = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.call.create({
        data: {
          tenantId: ctx.tenantId,
          subjectType: dto.subjectType,
          subjectId: dto.subjectId,
          phoneNumberId,
          userId: ctx.userId!,
          direction: 'OUTBOUND',
          status: 'QUEUED',
          fromNumber,
          toNumber: dto.toNumber,
          startedAt: new Date(),
        },
      }),
    );

    // Ask Twilio to dial — on failure, mark FAILED immediately
    try {
      const { sid } = await this.twilio.createCall({ from: fromNumber, to: dto.toNumber, callId: call.id });
      await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.call.update({ where: { id: call.id }, data: { twilioCallSid: sid } }),
      );
      call.twilioCallSid = sid;
    } catch (err) {
      await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
        tx.call.update({ where: { id: call.id }, data: { status: 'FAILED', endedAt: new Date() } }),
      );
      throw err;
    }

    await this.activities.log({
      subjectType: dto.subjectType,
      subjectId: dto.subjectId,
      action: 'call.initiated',
      metadata: { callId: call.id, to: dto.toNumber, from: fromNumber },
    });

    return call;
  }

  // ─── Twilio webhook handlers ──────────────────────────────────────

  /**
   * Voice webhook — called when Twilio dials and the callee answers
   * (outbound-api) or when one of our numbers receives a call (inbound).
   *
   * For outbound calls `record:true` is set in createCall(), so Twilio
   * records automatically — we just return empty TwiML.
   * For inbound calls: create a Call row + look up caller by phone number.
   * Returns a TwiML XML string; controller must set Content-Type: text/xml.
   */
  async handleVoiceWebhook(
    params: Record<string, string>,
    signature: string | undefined,
    rawUrl: string,
  ): Promise<string> {
    const fullUrl = this.twilio.publicWebhookUrl(rawUrl);
    if (!this.twilio.verifySignature(fullUrl, params, signature)) {
      throw new ForbiddenException({ code: 'INVALID_TWILIO_SIGNATURE', message: 'Twilio webhook signature invalid' });
    }

    // Idempotency: Twilio may retry webhooks. Skip if already processed.
    const callSid = params['CallSid'] ?? '';
    if (callSid) {
      const idempKey = `twilio:processed:${callSid}:voice`;
      const already = await this.redis.client.get(idempKey);
      if (already) {
        this.logger.debug(`Voice webhook ${callSid} already processed — skipping`);
        return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
      }
      await this.redis.client.set(idempKey, '1', 'EX', 300);
    }

    const direction = (params['Direction'] ?? '').toLowerCase();
    if (direction === 'inbound') {
      const toNumber = params['To'] ?? '';
      const fromNumber = params['From'] ?? '';
      const twilioCallSid = params['CallSid'] ?? '';

      // Look up which tenant owns the destination number.
      const phoneNumber = await this.prisma.phoneNumber.findFirst({
        where: { number: toNumber },
      });

      if (phoneNumber) {
        // Try to match caller to a contact or client in the tenant.
        const [contact, client, company] = await Promise.all([
          this.prisma.runWithTenant(phoneNumber.tenantId, (tx) =>
            tx.contact.findFirst({ where: { tenantId: phoneNumber.tenantId, OR: [{ phone: fromNumber }, { mobile: fromNumber }] } }),
          ),
          this.prisma.runWithTenant(phoneNumber.tenantId, (tx) =>
            tx.client.findFirst({ where: { tenantId: phoneNumber.tenantId, OR: [{ phone: fromNumber }, { mobile: fromNumber }] } }),
          ),
          this.prisma.runWithTenant(phoneNumber.tenantId, (tx) =>
            tx.company.findFirst({ where: { tenantId: phoneNumber.tenantId, phone: fromNumber } }),
          ),
        ]);

        const subject = contact
          ? { subjectType: 'CONTACT' as const, subjectId: contact.id }
          : client
            ? { subjectType: 'CLIENT' as const, subjectId: client.id }
            : company
              ? { subjectType: 'COMPANY' as const, subjectId: company.id }
              : { subjectType: 'CONTACT' as const, subjectId: 'unknown' };

        await this.prisma.runWithTenant(phoneNumber.tenantId, (tx) =>
          tx.call.create({
            data: {
              tenantId: phoneNumber.tenantId,
              phoneNumberId: phoneNumber.id,
              twilioCallSid,
              direction: 'INBOUND',
              status: 'RINGING',
              fromNumber,
              toNumber,
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              startedAt: new Date(),
            },
          }),
        );
        this.logger.log(`Inbound call created from=${fromNumber} tenant=${phoneNumber.tenantId} subject=${subject.subjectType}:${subject.subjectId}`);
      } else {
        this.logger.warn(`Inbound call to unrecognised number ${toNumber} — no tenant found`);
      }

      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ro-RO">Apelul dvs. a fost înregistrat. Vă mulțumim.</Say><Hangup/></Response>`;
    }

    // outbound-api: callee answered; recording is handled by record:true in createCall()
    return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  }

  /**
   * Status callback — Twilio POSTs on every call state change.
   * `callId` is our internal id appended to the statusCallback URL in createCall().
   */
  async handleStatusWebhook(
    params: Record<string, string>,
    signature: string | undefined,
    rawUrl: string,
    callId: string,
  ): Promise<void> {
    const fullUrl = this.twilio.publicWebhookUrl(rawUrl);
    if (!this.twilio.verifySignature(fullUrl, params, signature)) {
      throw new ForbiddenException({ code: 'INVALID_TWILIO_SIGNATURE', message: 'Twilio webhook signature invalid' });
    }

    const twilioStatus = (params['CallStatus'] ?? '').toLowerCase();
    const ourStatus = TWILIO_STATUS_MAP[twilioStatus];
    if (!ourStatus) {
      this.logger.warn(`Unknown Twilio status "${twilioStatus}" callId=${callId}`);
      return;
    }

    // Idempotency: deduplicate status transitions per (CallSid, status).
    const statusSid = params['CallSid'] ?? '';
    if (statusSid) {
      const idempKey = `twilio:processed:${statusSid}:status:${twilioStatus}`;
      const already = await this.redis.client.get(idempKey);
      if (already) {
        this.logger.debug(`Status webhook ${statusSid}/${twilioStatus} already processed — skipping`);
        return;
      }
      await this.redis.client.set(idempKey, '1', 'EX', 300);
    }

    // callId is always present for outbound (we set it in the URL)
    if (!callId) {
      this.logger.warn('Status webhook missing callId query param — skipped');
      return;
    }

    const existing = await this.prisma.call.findFirst({ where: { id: callId } });
    if (!existing) {
      this.logger.warn(`Status webhook for unknown callId=${callId}`);
      return;
    }

    const now = new Date();
    const durationSec = params['CallDuration'] ? parseInt(params['CallDuration'], 10) : undefined;
    const callSid = params['CallSid'] ?? '';

    const terminalStatuses: CallStatus[] = ['COMPLETED', 'BUSY', 'NO_ANSWER', 'FAILED', 'CANCELED'];

    const data: Prisma.CallUpdateInput = {
      status: ourStatus,
      ...(callSid && !existing.twilioCallSid ? { twilioCallSid: callSid } : {}),
      ...(ourStatus === 'RINGING' && !existing.startedAt ? { startedAt: now } : {}),
      ...(ourStatus === 'IN_PROGRESS' && !existing.answeredAt ? { answeredAt: now } : {}),
      ...(terminalStatuses.includes(ourStatus)
        ? { endedAt: now, ...(durationSec !== undefined ? { durationSec } : {}) }
        : {}),
    };

    await this.prisma.runWithTenant(existing.tenantId, (tx) =>
      tx.call.update({ where: { id: callId }, data }),
    );

    if (ourStatus === 'COMPLETED') {
      await this.activities.log({
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        action: 'call.completed',
        metadata: { callId, durationSec: durationSec ?? null, direction: existing.direction },
      });
    }

    this.logger.log(`Call ${callId} status → ${ourStatus}`);
  }

  /**
   * Recording callback — Twilio POSTs when a recording is ready.
   * Saves recordingSid + recordingUrl, marks transcriptionStatus=PENDING,
   * and enqueues the S13 AI worker job.
   */
  async handleRecordingWebhook(
    params: Record<string, string>,
    signature: string | undefined,
    rawUrl: string,
    callId: string,
  ): Promise<void> {
    const fullUrl = this.twilio.publicWebhookUrl(rawUrl);
    if (!this.twilio.verifySignature(fullUrl, params, signature)) {
      throw new ForbiddenException({ code: 'INVALID_TWILIO_SIGNATURE', message: 'Twilio webhook signature invalid' });
    }

    const recordingSid = params['RecordingSid'] ?? '';
    const recordingUrl = params['RecordingUrl'] ?? '';

    if (!callId || !recordingSid || !recordingUrl) {
      this.logger.warn(`Recording webhook missing required fields callId=${callId}`);
      return;
    }

    const existing = await this.prisma.call.findFirst({ where: { id: callId } });
    if (!existing) {
      this.logger.warn(`Recording webhook for unknown callId=${callId}`);
      return;
    }

    await this.prisma.runWithTenant(existing.tenantId, (tx) =>
      tx.call.update({
        where: { id: callId },
        data: {
          recordingSid,
          recordingUrl,
          transcriptionStatus: TranscriptionStatus.PENDING,
        },
      }),
    );

    // Enqueue AI job — jobId = callId for idempotency
    const payload: AiCallJobPayload = {
      callId,
      tenantId: existing.tenantId,
      recordingUrl,
      recordingSid,
    };
    await this.aiQueue.add('process', payload, { jobId: callId });

    this.logger.log(`Recording ready callId=${callId} sid=${recordingSid} — AI job enqueued`);
  }

  // ─── AI worker callback (S13) ─────────────────────────────────────

  /**
   * Called by the Python AI worker after transcription + summarisation.
   * Auth is handled by SystemApiKeyGuard (not JwtAuthGuard) in the controller.
   */
  async saveAiResult(callId: string, dto: AiCallResultDto): Promise<CallTranscript> {
    // No tenant context here (called by system worker), look up raw
    const call = await this.prisma.call.findFirst({ where: { id: callId } });
    if (!call) throw new NotFoundException({ code: 'CALL_NOT_FOUND', message: 'Call not found' });

    const transcriptData = {
      language: dto.language ?? null,
      rawText: dto.rawText,
      segments: dto.segments as unknown as Prisma.InputJsonValue,
      redactedText: dto.redactedText ?? null,
      summary: dto.summary ?? null,
      actionItems: dto.actionItems ? (dto.actionItems as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      sentiment: dto.sentiment ?? null,
      topics: dto.topics ? (dto.topics as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      model: dto.model ?? null,
    };

    const transcript = await this.prisma.runWithTenant(call.tenantId, (tx) =>
      tx.callTranscript.upsert({
        where: { callId },
        create: { tenantId: call.tenantId, callId, ...transcriptData },
        update: { ...transcriptData, processedAt: new Date() },
      }),
    );

    await this.prisma.runWithTenant(call.tenantId, (tx) =>
      tx.call.update({
        where: { id: callId },
        data: { transcriptionStatus: TranscriptionStatus.COMPLETED },
      }),
    );

    // Best-effort activity — no tenant ctx, log manually
    try {
      await this.prisma.runWithTenant(call.tenantId, (tx) =>
        tx.activity.create({
          data: {
            tenantId: call.tenantId,
            subjectType: call.subjectType,
            subjectId: call.subjectId,
            actorId: null,
            action: 'call.transcribed',
            metadata: { callId, model: dto.model ?? null } as Prisma.InputJsonValue,
          },
        }),
      );
    } catch (err) {
      this.logger.error(`Activity for call.transcribed failed: ${(err as Error).message}`);
    }

    this.logger.log(`AI result saved callId=${callId} model=${dto.model ?? 'unknown'}`);
    return transcript;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  async list(q: ListCallsQueryDto): Promise<CursorPage<Call>> {
    const ctx = requireTenantContext();
    const where: Prisma.CallWhereInput = {
      tenantId: ctx.tenantId,
      ...(q.subjectType ? { subjectType: q.subjectType } : {}),
      ...(q.subjectId ? { subjectId: q.subjectId } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.direction ? { direction: q.direction } : {}),
    };

    const items = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.call.findMany({
        where,
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { phoneNumber: true },
      }),
    );
    return makeCursorPage(items as Call[], q.limit);
  }

  async findOne(id: string): Promise<Call & { transcript: CallTranscript | null }> {
    const ctx = requireTenantContext();
    const call = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.call.findFirst({
        where: { id, tenantId: ctx.tenantId },
        include: { phoneNumber: true, transcript: true },
      }),
    );
    if (!call) throw new NotFoundException({ code: 'CALL_NOT_FOUND', message: 'Call not found' });
    return call as Call & { transcript: CallTranscript | null };
  }
}
