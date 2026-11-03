# M2 Task 4 report
Status: done. Added api/services/{__init__,embedding}.py, api/worker.py, tests/api/test_embedding_cache.py (7), tests/api/test_worker_config.py (2).
CachedEmbedder: emb:{model}:{sha256}, float32 bytes, one mget + one pipeline per call, Redis errors swallowed. Empty input returns (0, last-known-dim or 0).
worker: get_celery_app() lru_cache + module __getattr__ celery_app; no tasks.
Tests: new 9 pass; fast suite 130 pass excluding Task 2's in-progress tests/api/test_models.py (collection error); ruff errors only in Task 2 files.

## Fix note (judge M3, M6)
- worker.py: real module-level `celery_app` (no settings access at import); `configure_celery()` applies broker/backend/eager from settings (fakeredis:// maps to memory:// broker and cache+memory:// backend so eager tasks work); `get_celery_app()` is an alias. create_app() and settings_env call configure_celery().
- embedding.py: cached blobs not multiple of 4 / wrong width are misses and overwritten in the same pipeline write; if inner width differs from cached rows, everything is re-encoded by the inner embedder (no mixed widths). Miss path rounds through float32 (N15).
- Tests added for 3-byte/8-byte poison, shared-prefix dimension mismatch, task eager via .delay, find_app, import without JWT_SECRET.
- Ruff S603-style fix: subprocess.run(check=False) in test_worker_config.py.

## Fix note round 2 (M6 remainder, B1)
- embedding.py: CachedEmbedder(dim=...); get_embedder passes EMBEDDING_DIM. Blobs decoded only if bytes-like, non-empty, len%4==0, finite, and expected width; everything else is a miss, re-encoded and overwritten in the single pipeline write.
- worker.py: @celeryd_init.connect handler calls configure_celery(); tested by sending the signal.
- Tests: str, lone wrong-size (2B, 8B, 768-dim), empty bytes, bytearray, NaN blobs via get_embedder.
- Recheck R1-R7 skipped: R1/R2/R5/R6/R7 are outside my files; R3 (cached celery backend) and R4 (mixed-width heal, double inner call) skipped as not clearly small/safe; R4 is largely mitigated now that get_embedder fixes dim.

## Fix note round 3 (model reload)
- embedding.py: `_inner_embedder()` is an lru_cache(maxsize=1) factory so the lazy SentenceTransformerEmbedder is built once per process; get_embedder() still builds a CachedEmbedder per call with a fresh get_redis(), so REDIS_URL changes apply. Tests clear it via `_inner_embedder.cache_clear()`.
