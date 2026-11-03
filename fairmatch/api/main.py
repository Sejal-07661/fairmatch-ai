from fastapi import FastAPI

from api.config import get_settings


def create_app() -> FastAPI:
    get_settings()  # refuse to start without JWT_SECRET
    app = FastAPI(title="FairMatch AI")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app
