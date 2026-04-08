import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client as MinioClient } from 'minio';
import { loadEnv } from '../../config/env';

const PRESIGN_TTL_SECONDS = 15 * 60; // 15 min — matches the FE upload UX window

/**
 * Thin wrapper around the MinIO/S3 SDK. Encapsulates the bucket name and
 * presign TTL so feature code never touches them directly. Per CLAUDE.md
 * architecture mandate: "FE → presigned PUT → MinIO. API only stores metadata.
 * Downloads via presigned GET (15min)."
 *
 * The MinIO client is constructed from the parsed MINIO_ENDPOINT URL — we
 * derive `endPoint`, `port`, and `useSSL` ourselves so the same env var
 * works for `http://localhost:9000` (dev) and `https://files.example.com`
 * (prod).
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly env = loadEnv();
  private readonly client: MinioClient;
  readonly bucket: string;

  constructor() {
    const url = new URL(this.env.MINIO_ENDPOINT);
    this.bucket = this.env.MINIO_BUCKET;
    this.client = new MinioClient({
      endPoint: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
      useSSL: url.protocol === 'https:',
      accessKey: this.env.MINIO_ACCESS_KEY,
      secretKey: this.env.MINIO_SECRET_KEY,
    });
  }

  /**
   * Ensure the bucket exists at boot. The compose `minio-init` sidecar
   * normally creates it, but if someone runs the API against a fresh MinIO
   * we don't want the first upload to crash with NoSuchBucket.
   */
  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Created MinIO bucket "${this.bucket}"`);
      }
    } catch (err) {
      this.logger.error(`Failed to verify MinIO bucket: ${(err as Error).message}`);
      // Don't crash boot — let individual upload calls surface a real error.
    }
  }

  /**
   * Presigned PUT URL for direct browser → MinIO upload. The FE PUTs the raw
   * bytes to this URL with `Content-Type` matching what was used at sign time.
   */
  presignPut(storageKey: string): Promise<string> {
    return this.client.presignedPutObject(this.bucket, storageKey, PRESIGN_TTL_SECONDS);
  }

  /**
   * Presigned GET URL for download. 15-minute window.
   */
  presignGet(storageKey: string): Promise<string> {
    return this.client.presignedGetObject(this.bucket, storageKey, PRESIGN_TTL_SECONDS);
  }

  /**
   * Returns true if the object actually exists in the bucket. Used after
   * a presigned upload to confirm the FE actually completed the PUT before
   * we write the metadata row — guards against half-finished uploads.
   */
  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, storageKey);
      return true;
    } catch {
      return false;
    }
  }

  async remove(storageKey: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, storageKey);
    } catch (err) {
      // Best-effort: storage cleanup must not break the API call.
      this.logger.warn(`Failed to remove ${storageKey}: ${(err as Error).message}`);
    }
  }

  /**
   * Server-side upload of an in-memory buffer. Used by the importer
   * (admin-only, small files) which doesn't need the FE-direct presigned
   * dance — the API receives the multipart body in `multer.memoryStorage`
   * and immediately persists it to MinIO so workers (which may run on a
   * different host) can fetch it.
   */
  async putObject(storageKey: string, body: Buffer, mimeType: string): Promise<void> {
    await this.client.putObject(this.bucket, storageKey, body, body.length, {
      'Content-Type': mimeType,
    });
  }

  /**
   * Read the object back as a UTF-8 string. Used by the import processor
   * to load CSV bodies into papaparse. We deliberately buffer the whole
   * thing rather than stream — GestCom exports are small and papaparse's
   * synchronous mode keeps the dedup logic simple.
   */
  async getObjectAsString(storageKey: string): Promise<string> {
    const stream = await this.client.getObject(this.bucket, storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }
}
