/* eslint-disable */
// Single Node/Express container that exposes seven mock endpoints on
// different ports — kept in one process for simplicity. Set MOCK_PORT_*
// env vars to customise; defaults match docker-compose.
const express = require('express');
const crypto = require('crypto');

function newApp(name) {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use((req, _res, next) => { console.log(`[${name}] ${req.method} ${req.url}`); next(); });
  app.get('/_health', (_req, res) => res.json({ ok: true, name }));
  return app;
}

// ── Twilio mock ────────────────────────────────────────────────────────
const twilio = newApp('twilio');
twilio.post('/2010-04-01/Accounts/:sid/Calls.json', (req, res) => {
  const callSid = 'CA' + crypto.randomBytes(16).toString('hex');
  const accountSid = req.params.sid;
  // Log body keys so we can see when StatusCallback is missing.
  console.log('[twilio]   body keys:', Object.keys(req.body).join(','));
  console.log('[twilio]   StatusCallback:', req.body.StatusCallback || '(missing)');
  // Fire callback after a short delay so the in-DB Call row gets the SID first.
  if (req.body.StatusCallback) {
    setTimeout(() => {
      const url = req.body.StatusCallback;
      const params = {
        CallSid: callSid,
        AccountSid: accountSid,
        CallStatus: 'completed',
        CallDuration: '42',
        RecordingUrl: `http://twilio-mock:3001/recordings/${callSid}.mp3`,
        RecordingSid: 'RE' + crypto.randomBytes(16).toString('hex'),
      };
      // Twilio signature = HMAC-SHA1(authToken, url + sortedKeys.join(key+value)) base64.
      // The auth token must match what the API uses (from TWILIO_AUTH_TOKEN env).
      // Mock reads it from MOCK_TWILIO_AUTH_TOKEN with a default fallback so the
      // signature is reproducible without leaking real creds.
      const authToken = process.env.MOCK_TWILIO_AUTH_TOKEN || 'mockauthtoken1234567890abcdef1234';
      const sortedKeys = Object.keys(params).sort();
      const data = url + sortedKeys.map((k) => k + params[k]).join('');
      const signature = crypto.createHmac('sha1', authToken).update(data).digest('base64');

      const body = new URLSearchParams(params);
      const fetchFn = global.fetch || require('node-fetch');
      fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Twilio-Signature': signature,
        },
        body: body.toString(),
      })
        .then((r) => console.log('[twilio]   callback fired →', url, 'status', r.status))
        .catch((e) => console.log('[twilio]   callback error', e.message));
    }, 3000);
  }
  res.json({ sid: callSid, account_sid: accountSid, status: 'queued', date_created: new Date().toUTCString() });
});
twilio.post('/2010-04-01/Accounts/:sid/Messages.json', (req, res) => {
  res.json({ sid: 'SM' + crypto.randomBytes(16).toString('hex'), account_sid: req.params.sid, status: 'queued', body: req.body.Body, to: req.body.To, from: req.body.From });
});
twilio.get('/recordings/:file', (_req, res) => {
  res.set('Content-Type', 'audio/mpeg').send(Buffer.alloc(1024, 0x00));
});

// ── Meta WhatsApp mock ─────────────────────────────────────────────────
const meta = newApp('meta');
meta.post('/v19.0/:phoneId/messages', (req, res) => {
  res.json({
    messaging_product: 'whatsapp',
    contacts: [{ input: req.body.to, wa_id: req.body.to }],
    messages: [{ id: 'wamid.' + crypto.randomBytes(8).toString('hex') }],
  });
});

// ── Google OAuth + Calendar mock ──────────────────────────────────────
const google = newApp('google');
google.post('/token', (_req, res) => {
  res.json({ access_token: 'ya29.MOCK.' + crypto.randomBytes(8).toString('hex'), refresh_token: '1//MOCK.' + crypto.randomBytes(8).toString('hex'), expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/calendar' });
});
google.get('/calendar/v3/calendars/primary/events', (_req, res) => {
  const now = new Date();
  res.json({ items: [
    { id: 'evt-mock-1', summary: 'Mock onboarding call', start: { dateTime: new Date(now.getTime() + 3600e3).toISOString() }, end: { dateTime: new Date(now.getTime() + 5400e3).toISOString() } },
    { id: 'evt-mock-2', summary: 'Mock follow-up demo', start: { dateTime: new Date(now.getTime() + 86400e3).toISOString() }, end: { dateTime: new Date(now.getTime() + 90000e3).toISOString() } },
  ]});
});

// ── Microsoft OAuth + Outlook calendar mock ───────────────────────────
const microsoft = newApp('microsoft');
microsoft.post('/common/oauth2/v2.0/token', (_req, res) => {
  res.json({ access_token: 'EwBwA8l6BAAU.MOCK.' + crypto.randomBytes(8).toString('hex'), refresh_token: 'M.R3.AAA.MOCK.' + crypto.randomBytes(8).toString('hex'), expires_in: 3600, token_type: 'Bearer' });
});
microsoft.get('/v1.0/me/calendar/events', (_req, res) => {
  const now = new Date();
  res.json({ value: [
    { id: 'AAMkAD-MOCK-1', subject: 'Mock Outlook event', start: { dateTime: new Date(now.getTime() + 7200e3).toISOString(), timeZone: 'Europe/Bucharest' }, end: { dateTime: new Date(now.getTime() + 9000e3).toISOString(), timeZone: 'Europe/Bucharest' } },
  ]});
});

// ── ANAF e-Factura mock ───────────────────────────────────────────────
const anaf = newApp('anaf');
const anafSubmissions = new Map(); // index_incarcare -> { stare, id_descarcare }
anaf.post('/anaf-oauth2/token', (_req, res) => {
  res.json({ access_token: 'anaf.MOCK.' + crypto.randomBytes(12).toString('hex'), refresh_token: 'anaf.refresh.MOCK.' + crypto.randomBytes(12).toString('hex'), expires_in: 86400, token_type: 'Bearer' });
});
anaf.post('/prod/FCTEL/rest/upload', (req, res) => {
  const idx = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  anafSubmissions.set(idx, { stare: 'in prelucrare', id_descarcare: null });
  // After 8s, mark submission OK and assign id_descarcare
  setTimeout(() => {
    anafSubmissions.set(idx, { stare: 'ok', id_descarcare: 'DL' + idx });
  }, 8000);
  res.set('Content-Type', 'application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><header xmlns="mfp:anaf:dgti:spv:respUploadFisier:v1" dateResponse="${new Date().toISOString()}" ExecutionStatus="0" index_incarcare="${idx}" />`);
});
anaf.get('/prod/FCTEL/rest/stareMesaj', (req, res) => {
  const idx = String(req.query.id_incarcare ?? '');
  const sub = anafSubmissions.get(idx);
  if (!sub) return res.status(404).send(`<header ExecutionStatus="1" Errors="not found"/>`);
  if (sub.stare === 'in prelucrare') {
    return res.set('Content-Type', 'application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><header xmlns="mfp:anaf:dgti:spv:stareMesajFactura:v1" stare="in prelucrare" />`);
  }
  return res.set('Content-Type', 'application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><header xmlns="mfp:anaf:dgti:spv:stareMesajFactura:v1" stare="ok" id_descarcare="${sub.id_descarcare}" />`);
});

// ── Generic webhook listener ─────────────────────────────────────────
const webhook = newApp('webhook');
const receivedHooks = [];
webhook.post('/*', (req, res) => {
  const entry = { at: new Date().toISOString(), method: 'POST', url: req.originalUrl, headers: req.headers, body: req.body };
  receivedHooks.unshift(entry);
  if (receivedHooks.length > 200) receivedHooks.length = 200;
  res.status(200).json({ ok: true, received: entry.at });
});
webhook.get('/_received', (_req, res) => res.json(receivedHooks.slice(0, 100)));
webhook.delete('/_received', (_req, res) => { receivedHooks.length = 0; res.json({ cleared: true }); });

// ── OpenAI/Gemini fallback mock (only if key missing) ────────────────
const ai = newApp('ai');
ai.post('/v1/chat/completions', (req, res) => {
  res.json({ id: 'chatcmpl-mock-' + crypto.randomBytes(4).toString('hex'), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: req.body.model || 'gpt-4o-mini', choices: [{ index: 0, message: { role: 'assistant', content: '[mock-ai] Lucrezi cu un mock local — răspuns determinist pentru testare.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 8, total_tokens: 9 } });
});
ai.post('/v1/embeddings', (req, res) => {
  const inputs = Array.isArray(req.body.input) ? req.body.input : [req.body.input];
  const data = inputs.map((_t, i) => ({ object: 'embedding', index: i, embedding: Array.from({ length: 1536 }, (__, j) => Math.sin(i * 7 + j) * 0.001) }));
  res.json({ object: 'list', data, model: req.body.model || 'text-embedding-3-small', usage: { prompt_tokens: 1, total_tokens: 1 } });
});
ai.post('/v1beta/models/:m\\:generateContent', (_req, res) => {
  res.json({ candidates: [{ content: { role: 'model', parts: [{ text: '[mock-gemini] Răspuns mock determinist pentru testare locală.' }] }, finishReason: 'STOP' }] });
});

// ── Boot all listeners ──────────────────────────────────────────────
const ports = {
  twilio: Number(process.env.MOCK_PORT_TWILIO) || 3001,
  meta: Number(process.env.MOCK_PORT_META) || 3002,
  google: Number(process.env.MOCK_PORT_GOOGLE) || 3003,
  microsoft: Number(process.env.MOCK_PORT_MICROSOFT) || 3004,
  anaf: Number(process.env.MOCK_PORT_ANAF) || 3005,
  webhook: Number(process.env.MOCK_PORT_WEBHOOK) || 3006,
  ai: Number(process.env.MOCK_PORT_AI) || 3007,
};
twilio.listen(ports.twilio, () => console.log(`[twilio] listening on :${ports.twilio}`));
meta.listen(ports.meta, () => console.log(`[meta] listening on :${ports.meta}`));
google.listen(ports.google, () => console.log(`[google] listening on :${ports.google}`));
microsoft.listen(ports.microsoft, () => console.log(`[microsoft] listening on :${ports.microsoft}`));
anaf.listen(ports.anaf, () => console.log(`[anaf] listening on :${ports.anaf}`));
webhook.listen(ports.webhook, () => console.log(`[webhook] listening on :${ports.webhook}`));
ai.listen(ports.ai, () => console.log(`[ai] listening on :${ports.ai}`));
