"""LLM client interface. LLMs parse and narrate only; they never affect scores."""
from __future__ import annotations

import copy
import json
import os
from typing import Protocol

PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "skills": {"type": "array", "items": {"type": "string"}},
        "experience_years": {"type": "integer"},
        "education_level": {"type": "integer"},
    },
    "required": ["skills", "experience_years", "education_level"],
    "additionalProperties": False,
}

_EXTRACT_PROMPT = (
    "Extract a profile from the text. skills: technical skills mentioned. "
    "experience_years: total years of experience (0 if none). education_level: "
    "0 none, 1 diploma, 2 bachelor, 3 master, 4 PhD."
)


class LLMClient(Protocol):
    def extract_profile(self, text: str) -> dict: ...

    def complete(self, prompt: str) -> str: ...


class OpenAIClient:
    def __init__(self, api_key: str | None = None, model: str | None = None):
        from openai import OpenAI

        self._client = OpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"),
            timeout=15,
            max_retries=0,
        )
        self._model = model or os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

    def extract_profile(self, text: str) -> dict:
        resp = self._client.chat.completions.create(
            model=self._model,
            temperature=0,
            messages=[
                {"role": "system", "content": _EXTRACT_PROMPT},
                {"role": "user", "content": text},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "profile", "strict": True, "schema": PROFILE_SCHEMA},
            },
        )
        content = resp.choices[0].message.content
        if content is None:
            raise RuntimeError("LLM returned no content")
        data = json.loads(content)
        return {
            "skills": [str(s) for s in data.get("skills", [])],
            "experience_years": int(data.get("experience_years", 0)),
            "education_level": int(data.get("education_level", 0)),
        }

    def complete(self, prompt: str) -> str:
        resp = self._client.chat.completions.create(
            model=self._model, messages=[{"role": "user", "content": prompt}]
        )
        content = resp.choices[0].message.content
        if content is None:
            raise RuntimeError("LLM returned no content")
        return content


def get_llm_client() -> LLMClient | None:
    if not os.environ.get("OPENAI_API_KEY"):
        return None
    return OpenAIClient()


class FakeLLMClient:
    """Deterministic client for tests."""

    def __init__(self, profile: dict | None = None, completion: str = "", raises: bool = False):
        self._profile = profile or {"skills": [], "experience_years": 0, "education_level": 0}
        self._completion = completion
        self._raises = raises

    def extract_profile(self, text: str) -> dict:
        if self._raises:
            raise RuntimeError("fake LLM failure")
        return copy.deepcopy(self._profile)

    def complete(self, prompt: str) -> str:
        if self._raises:
            raise RuntimeError("fake LLM failure")
        return self._completion
