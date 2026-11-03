# Task 3 report
Created core/llm.py (LLMClient, OpenAIClient, get_llm_client, FakeLLMClient) and tests/test_llm.py. Red then green; ruff clean. Live test skipped without key.
Note: openai is imported lazily inside OpenAIClient; assumes openai is in requirements.txt (not edited by me).

## Fix note
Added timeout=30/max_retries=1, RuntimeError on empty content (both methods), deepcopy in FakeLLMClient, and two tests.
