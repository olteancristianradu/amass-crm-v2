"""
Environment config for the AI worker.
All settings have safe defaults so the worker starts even in dev without full .env.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # API callback
    API_URL: str = "http://localhost:3000"
    AI_WORKER_SECRET: str = ""  # Bearer token sent to POST /calls/:id/ai-result

    # Redis (BullMQ queue)
    REDIS_URL: str = "redis://localhost:6379"

    # MinIO (fallback: download from Twilio URL if storage key not set)
    MINIO_ENDPOINT: str = "http://localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "amass-files"

    # Twilio credentials — needed to download recordings from Twilio's CDN
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""

    # Anthropic
    ANTHROPIC_API_KEY: str = ""

    # Whisper model size. Set to "off" to skip real transcription (use stub).
    WHISPER_MODEL: str = "off"


settings = Settings()
