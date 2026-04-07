# Sprint 0 placeholder. Real Whisper/diarization/Presidio/Claude pipelines arrive in Sprint 13.
from fastapi import FastAPI

app = FastAPI(title="amass-ai-worker", version="0.0.0")


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "sprint": 0}
