import hashlib
import logging
from functools import lru_cache

import numpy as np
import redis

from api.config import get_settings
from api.vector import EMBEDDING_DIM
from core.embeddings import Embedder, SentenceTransformerEmbedder

logger = logging.getLogger(__name__)

_REDIS_ERRORS = (redis.RedisError, ConnectionError)


def get_redis() -> redis.Redis:
    url = get_settings().redis_url
    if url.startswith("fakeredis://"):
        import fakeredis

        return fakeredis.FakeRedis()
    return redis.Redis.from_url(url)


def _normalise(m: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    return m / np.where(norms == 0, 1.0, norms)


class CachedEmbedder:
    def __init__(self, inner: Embedder, client, model: str | None = None,
                 dim: int | None = None):
        self.inner = inner
        self.client = client
        self.model = model or getattr(inner, "model_name", "default")
        self._dim: int | None = dim

    def _key(self, text: str) -> str:
        return f"emb:{self.model}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}"

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self._dim or 0), dtype=float)
        keys = [self._key(t) for t in texts]
        cached: list[bytes | None] = [None] * len(texts)
        try:
            cached = list(self.client.mget(keys))
        except _REDIS_ERRORS:
            logger.warning("embedding cache read failed; using inner embedder", exc_info=True)

        decoded: list[np.ndarray | None] = []
        for b in cached:
            vec = None
            if isinstance(b, (bytes, bytearray, memoryview)) and len(b) > 0 and len(b) % 4 == 0:
                try:
                    vec = np.frombuffer(b, dtype=np.float32).astype(float)
                except ValueError:
                    vec = None
                if vec is not None and not np.all(np.isfinite(vec)):
                    vec = None
            decoded.append(vec)
        dim = self._dim
        if dim is None:
            sizes = [v.shape[0] for v in decoded if v is not None]
            dim = max(set(sizes), key=sizes.count) if sizes else None
        rows: list[np.ndarray | None] = [
            v if v is not None and v.shape[0] == dim else None for v in decoded
        ]
        miss_texts = list(dict.fromkeys(t for t, r in zip(texts, rows) if r is None))
        if miss_texts:
            fresh = np.asarray(self.inner.encode(miss_texts), dtype=np.float32).astype(float)
            by_text = dict(zip(miss_texts, fresh))
            rows = [r if r is not None else by_text[t] for t, r in zip(texts, rows)]
            try:
                pipe = self.client.pipeline()
                for t, v in by_text.items():
                    pipe.set(self._key(t), v.astype(np.float32).tobytes())
                pipe.execute()
            except _REDIS_ERRORS:
                logger.warning("embedding cache write failed", exc_info=True)
        if len({r.shape[0] for r in rows}) > 1:  # inner dim differs from cached rows
            rows = list(np.asarray(self.inner.encode(texts), dtype=np.float32).astype(float))
        out = _normalise(np.vstack(rows))
        self._dim = out.shape[1]
        return out


@lru_cache(maxsize=1)
def _inner_embedder() -> Embedder:
    """One lazy-loading model wrapper per process (tests: _inner_embedder.cache_clear())."""
    return SentenceTransformerEmbedder()


def get_embedder() -> Embedder:
    return CachedEmbedder(_inner_embedder(), get_redis(), dim=EMBEDDING_DIM)
