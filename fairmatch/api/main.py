from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from api.config import get_settings
from api.routers import auth, candidates, opportunities, runs
from api.worker import configure_celery


def create_app() -> FastAPI:
    get_settings()  # refuse to start without JWT_SECRET
    configure_celery()
    app = FastAPI(title="FairMatch AI")

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(candidates.router)
    app.include_router(opportunities.router)
    app.include_router(runs.router)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        parts = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e["loc"] if x not in ("body", "query", "path", "form"))
            msg = str(e.get("msg", "invalid")).removeprefix("Value error, ")
            parts.append(f"{loc}: {msg}" if loc else msg)  # never echoes the input value
        return JSONResponse(status_code=422, content={"detail": "; ".join(parts)[:500]})

    return app
