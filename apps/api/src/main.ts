import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv(); // fail-fast on missing env
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  // ── Security headers ──────────────────────────────────────────────────────
  // Helmet sets X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy
  // and a strict CSP. The /metrics and /e/t/* (email-tracking pixel) routes
  // are public by design but still benefit from these headers.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"], // allow inline styles for emails
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          fontSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      // HSTS: 1 year, include subdomains — enforced when behind Caddy HTTPS.
      strictTransportSecurity: {
        maxAge: 31_536_000,
        includeSubDomains: true,
      },
    }),
  );

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
