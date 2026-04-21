import 'reflect-metadata';
import * as Sentry from '@sentry/node';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail-fast on missing env

  // Sentry must be initialised before the app is created so it can instrument
  // the HTTP server. DSN is optional — no-op when absent (dev/test).
  if (process.env['SENTRY_DSN']) {
    Sentry.init({
      dsn: process.env['SENTRY_DSN'],
      environment: env.NODE_ENV,
      tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
    });
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Replace the default Nest console logger with Pino. This also picks up the
  // PII-redaction config from LoggerModule.forRoot().
  app.useLogger(app.get(Logger));

  // ── CORS ──────────────────────────────────────────────────────────────────
  // Restrict browsers to the configured allow-list. '*' is only ever valid in
  // dev/test; env validation blocks it in production.
  const allowedOrigins = env.CORS_ALLOWED_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins.includes('*') ? true : allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    maxAge: 86_400,
  });

  // ── Security headers ──────────────────────────────────────────────────────
  // Helmet sets X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy
  // and a strict CSP. The /metrics and /e/t/* (email-tracking pixel) routes
  // are public by design but still benefit from these headers.
  const isProd = env.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // 'unsafe-inline' kept because transactional email templates and
          // Swagger UI (non-prod) both embed inline <style> blocks. Scripts
          // remain strict.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", 'data:'],
          mediaSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          // Force HTTPS in prod only — dev runs over http://localhost.
          ...(isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      // HSTS: 1 year, include subdomains — enforced when behind Caddy HTTPS.
      strictTransportSecurity: {
        maxAge: 31_536_000,
        includeSubDomains: true,
        preload: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      // COEP disabled because it breaks third-party images (gravatars, etc.)
      // embedded in emails and would require explicit CORP on every remote.
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Permissions-Policy: deny powerful features the CRM doesn't need.
  // Helmet dropped the built-in helper in v7, so we set the header manually.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
    );
    next();
  });

  // ── /metrics access control ──────────────────────────────────────────────
  // Prometheus metrics expose internal telemetry (heap size, route timings,
  // queue depths) that aids reconnaissance. Restrict to:
  //   1) Source IPs in METRICS_ALLOWED_IPS (exact match on req.ip)
  //   2) OR Authorization: Bearer <METRICS_AUTH_TOKEN>
  //
  // Env validation requires at least one of these in production.
  const metricsAllowedIps = new Set(
    env.METRICS_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean),
  );
  const metricsToken = env.METRICS_AUTH_TOKEN;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path !== '/metrics' && req.path !== '/api/v1/metrics') return next();
    const ip = (req.ip ?? req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const ipOk = metricsAllowedIps.has(ip) || metricsAllowedIps.has(req.ip ?? '');
    const auth = req.headers.authorization ?? '';
    const tokenOk =
      metricsToken !== undefined &&
      auth.startsWith('Bearer ') &&
      auth.slice('Bearer '.length).trim() === metricsToken;
    if (ipOk || tokenOk) return next();
    res.status(403).setHeader('Content-Type', 'text/plain').send('forbidden');
  });

  // ── Body size limits ──────────────────────────────────────────────────────
  // Prevent DoS via oversized JSON payloads. File uploads go via presigned
  // PUT to MinIO directly and never pass through this API, so 2MB is plenty.
  app.use(json({ limit: '2mb' }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());

  // ── Swagger / OpenAPI (S35) ───────────────────────────────────────────────
  // Available at /api/docs in non-production environments.
  if (env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AMASS CRM API')
      .setDescription('REST API for AMASS CRM v2 — multi-tenant B2B/B2C CRM')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addServer(`http://localhost:${env.PORT}`, 'Local development')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  await app.listen(env.PORT, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`amass-api listening on http://0.0.0.0:${env.PORT}/api/v1`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to bootstrap:', err);
  process.exit(1);
});
