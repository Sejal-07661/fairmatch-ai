# Task 5 report: Embeddings

Status: DONE

- Created core/embeddings.py (Embedder Protocol, SentenceTransformerEmbedder with lazy load and per-text cache, cosine_matrix) and tests/test_embeddings.py.
- conftest.py untouched.
- Fast: 4 passed, 1 deselected (red confirmed first: ModuleNotFoundError).
- Slow: test_bge_relates_ml_and_ai passed (59s, model downloaded).
- Concerns: empty strings are never sent to the model; the dimension is taken from the model's first encode (or get_sentence_embedding_dimension if only empties seen). No commit made.

## Fix note (judge B1)
cosine_matrix is now shape-safe (empty side returns zeros of shape (n_a, n_b)); added test_cosine_matrix_with_empty_side and tightened shape/range test with allclose.

## Fix note (Milestone 1 Task 5): offline-safe model load
Load order is local cache first (`local_files_only=True`), then online download on an OSError/httpx/huggingface_hub network-type failure (one warning logged); if both fail, RuntimeError naming the model ("must be downloaded once while online") with `__cause__` set. ValueError etc. are not swallowed. Deviation from the requested order (online first): online-first took 147s under a dead proxy because HF retries with backoff; local-first took ~31s (mostly torch import and weight loading). `SentenceTransformer` is a module-level lazy wrapper so tests can stub it. Under a dead proxy, the embedding one-liner printed (1, 384) and `python demo.py` exited 0 (~39s).
