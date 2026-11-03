import os

import pytest

from core.llm import FakeLLMClient, OpenAIClient, get_llm_client


def test_get_llm_client_none_without_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    assert get_llm_client() is None


def test_fake_client_returns_configured_profile():
    profile = {"skills": ["python"], "experience_years": 3, "education_level": 2}
    fake = FakeLLMClient(profile=profile, completion="hi")
    assert fake.extract_profile("x") == profile
    assert fake.complete("p") == "hi"


def test_fake_client_can_raise():
    fake = FakeLLMClient(raises=True)
    with pytest.raises(RuntimeError):
        fake.extract_profile("x")
    with pytest.raises(RuntimeError):
        fake.complete("x")


@pytest.mark.llm
def test_openai_extract_profile_live():
    if not os.getenv("OPENAI_API_KEY"):
        pytest.skip("OPENAI_API_KEY not set")
    result = OpenAIClient().extract_profile("5 years Python developer, M.Tech")
    assert "python" in [s.lower() for s in result["skills"]]


def test_fake_client_returns_copy():
    fake = FakeLLMClient(profile={"skills": ["python"], "experience_years": 1, "education_level": 2})
    fake.extract_profile("x")["skills"].append("junk")
    assert fake.extract_profile("x")["skills"] == ["python"]


def test_get_llm_client_returns_openai_with_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    assert isinstance(get_llm_client(), OpenAIClient)
