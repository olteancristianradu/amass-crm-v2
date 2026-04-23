# Python FastAPI worker: Whisper + Presidio + Claude summaries.
#
# Build context = repo root (for Railway consistency with api/web).
# Local:      docker build -f apps/ai-worker/Dockerfile -t amass-ai .
# Railway:    Root Directory = "/"  +  Dockerfile Path = "apps/ai-worker/Dockerfile"
FROM python:3.12-slim

WORKDIR /app

# System deps:
#   ffmpeg  — required by openai-whisper for audio decoding
#   curl    — healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY apps/ai-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/ai-worker/app ./app

# Non-root user — python image has no default unprivileged user, create one.
# Container escape is limited to an unprivileged account on the host.
RUN addgroup --system --gid 1001 app \
 && adduser  --system --uid 1001 --ingroup app --home /app --shell /sbin/nologin app \
 && chown -R app:app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD curl -f http://localhost:8000/health || exit 1

# Railway injects $PORT; fall back to 8000 for docker-compose.
CMD ["sh","-c","uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
