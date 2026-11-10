from datetime import datetime
from typing import Annotated, Literal

from fastapi import Path, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator


class RegisterIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = reject_nul(v).strip().lower()
        if not v:
            raise ValueError("email must not be blank")
        if len(v) > 320:
            raise ValueError("email must be at most 320 characters")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        if len(v.encode("utf-8")) > 72:
            raise ValueError("password must be at most 72 bytes")
        return v


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


MAX_TEXT_CHARS = 20000
PG_INT_MAX = 2_147_483_647
MAX_CAPACITY = 10_000  # seats per opportunity
MAX_EXPERIENCE_YEARS = 80

# Shared path/query types, bounded to the PostgreSQL integer range.
IdPath = Annotated[int, Path(ge=1, le=PG_INT_MAX)]
LimitQuery = Annotated[int, Query(ge=1, le=100)]
OffsetQuery = Annotated[int, Query(ge=0, le=PG_INT_MAX)]


def reject_nul(v: str) -> str:
    if "\x00" in v:
        raise ValueError("must not contain NUL characters")
    return v


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    skills: list[str]
    experience_years: float
    education_level: int
    used_fallback: bool


class DemographicsIn(BaseModel):
    group_label: str

    @field_validator("group_label")
    @classmethod
    def _label(cls, v: str) -> str:
        v = reject_nul(v).strip()
        if not v:
            raise ValueError("group_label must not be blank")
        if len(v) > 64:
            raise ValueError("group_label must be at most 64 characters")
        return v


class DemographicsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    candidate_id: int
    group_label: str


class OpportunityIn(BaseModel):
    title: str
    posting_text: str
    capacity: int = Field(ge=1, le=MAX_CAPACITY)
    min_experience_years: float = Field(ge=0, le=MAX_EXPERIENCE_YEARS, allow_inf_nan=False)
    min_education_level: int = Field(ge=0, le=4)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        v = reject_nul(v).strip()
        if not v:
            raise ValueError("title must not be blank")
        if len(v) > 200:
            raise ValueError("title must be at most 200 characters")
        return v

    @field_validator("posting_text")
    @classmethod
    def _text(cls, v: str) -> str:
        reject_nul(v)
        if not v.strip():
            raise ValueError("posting_text must not be blank")
        if len(v) > MAX_TEXT_CHARS:
            raise ValueError(f"posting_text must be at most {MAX_TEXT_CHARS} characters")
        return v


class OpportunityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    posting_text: str
    required_skills: list[str]
    capacity: int
    min_experience_years: float
    min_education_level: int


RUN_ALGORITHMS = ("hungarian", "gale_shapley", "both")


class RunIn(BaseModel):
    algorithm: Literal["hungarian", "gale_shapley", "both"]


class RunCreatedOut(BaseModel):
    id: int
    status: str


class AllocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    algorithm: str
    candidate_id: int
    opportunity_id: int
    score: float
    breakdown: dict
    reasons: list[str]
    narrative: str
    used_fallback: bool


class ExplanationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    algorithm: str
    candidate_id: int
    opportunity_id: int
    score: float
    reasons: list[str]
    narrative: str
    used_fallback: bool


class RunSummaryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    algorithm: str
    status: str
    error: str | None
    metrics: dict | None
    fairness: dict | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    requested_by_email: str | None = None


class RunOut(RunSummaryOut):
    allocations: list[AllocationOut]


SimilarLimitQuery = Annotated[int, Query(ge=1, le=50)]


class SimilarCandidateOut(BaseModel):
    candidate_id: int
    similarity: float
