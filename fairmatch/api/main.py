from fastapi import FastAPI

from api.config import get_settings
from api.worker import configure_celery


def create_app() -> FastAPI:
    get_settings()  # refuse to start without JWT_SECRET
    configure_celery()
    app = FastAPI(title="FairMatch AI")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app
