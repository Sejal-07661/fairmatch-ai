from functools import lru_cache

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    database_url: str = "sqlite:///./fairmatch.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = Field(min_length=1)
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 60
    celery_eager: bool = False
    run_timeout_minutes: int = 30
    pending_grace_minutes: int = 5

    @field_validator("jwt_secret")
    @classmethod
    def _secret_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("JWT_SECRET must not be blank")
        return v


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        if any(e["loc"] == ("jwt_secret",) for e in exc.errors()):
            raise RuntimeError("JWT_SECRET is required") from exc
        raise
