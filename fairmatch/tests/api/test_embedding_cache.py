import fakeredis
import numpy as np
import pytest
import redis

from api.services.embedding import CachedEmbedder, get_redis
from core.embeddings import cosine_matrix


class Counting:
    model_name = "m"

    def __init__(self, inner):
        self.inner = inner
        self.calls: list[list[str]] = []

    def encode(self, texts):
        self.calls.append(list(texts))
        return self.inner.encode(texts)


@pytest.fixture
def r():
    return fakeredis.FakeRedis()


def test_second_encode_hits_cache(fake_embedder, r):
    inner = Counting(fake_embedder)
    c = CachedEmbedder(inner, r)
    c.encode(["python sql"])
    c.encode(["python sql"])
    assert len(inner.calls) == 1


def test_partial_hit_encodes_only_misses(fake_embedder, r):
    inner = Counting(fake_embedder)
    c = CachedEmbedder(inner, r)
    c.encode(["alpha"])
    out = c.encode(["alpha", "beta"])
    assert inner.calls[-1] == ["beta"]
    assert out.shape == (2, 64)


def test_redis_down_falls_back_to_inner(fake_embedder):
    class Down:
        def mget(self, keys):
            raise redis.ConnectionError("down")

        def pipeline(self):
            raise redis.ConnectionError("down")

    inner = Counting(fake_embedder)
    out = CachedEmbedder(inner, Down()).encode(["a b", "c"])
    assert out.shape == (2, 64)
    assert np.allclose(out, fake_embedder.encode(["a b", "c"]))


def test_empty_list_returns_zero_rows_without_calls(fake_embedder):
    class Boom:
        def __getattr__(self, name):
            raise AssertionError("redis touched")

    inner = Counting(fake_embedder)
    out = CachedEmbedder(inner, Boom()).encode([])
    assert out.shape[0] == 0
    assert inner.calls == []
    assert cosine_matrix(out, fake_embedder.encode(["x"])).shape == (0, 1)


def test_cached_vectors_equal_fresh_vectors(fake_embedder, r):
    c = CachedEmbedder(Counting(fake_embedder), r)
    fresh = c.encode(["data science", "nursing"])
    cached = c.encode(["data science", "nursing"])
    assert np.allclose(fresh, cached, atol=1e-6)
    assert np.allclose(np.linalg.norm(cached, axis=1), 1.0, atol=1e-5)


def test_one_mget_and_one_pipeline_per_call(fake_embedder):
    class Spy(fakeredis.FakeRedis):
        mgets = 0
        pipes = 0

        def mget(self, *a, **k):
            Spy.mgets += 1
            return super().mget(*a, **k)

        def pipeline(self, *a, **k):
            Spy.pipes += 1
            return super().pipeline(*a, **k)

    CachedEmbedder(Counting(fake_embedder), Spy()).encode(["a", "b", "c"])
    assert (Spy.mgets, Spy.pipes) == (1, 1)


def test_get_redis_fakeredis_url(monkeypatch):
    monkeypatch.setenv("REDIS_URL", "fakeredis://")
    assert isinstance(get_redis(), fakeredis.FakeRedis)


def test_poisoned_keys_are_misses_and_overwritten(fake_embedder, r):
    c = CachedEmbedder(Counting(fake_embedder), r)
    good = c.encode(["a", "b", "c"])
    for t, blob in (("a", b"abc"), ("b", b"12345678")):
        r.set(c._key(t), blob)
    c2 = CachedEmbedder(Counting(fake_embedder), r)
    out = c2.encode(["a", "b", "c"])
    assert out.shape == (3, 64)
    assert np.allclose(out, good, atol=1e-6)
    assert len(r.get(c._key("a"))) == 64 * 4
    assert len(r.get(c._key("b"))) == 64 * 4


def test_shared_prefix_different_dimensions(fake_embedder, r):
    class Small:
        def encode(self, texts):
            return np.tile(np.array([[1.0, 0.0, 0.0, 0.0]]), (len(texts), 1))

    big = CachedEmbedder(Counting(fake_embedder), r, model="x")
    big.encode(["a", "b"])
    out = CachedEmbedder(Small(), r, model="x").encode(["a", "b", "c"])
    assert out.shape == (3, 4)
    assert len({row.shape for row in out}) == 1


class Dim384:
    model_name = "m384"

    def encode(self, texts):
        out = np.zeros((len(texts), 384))
        out[:, 0] = 1.0
        return out


def _via_get_embedder(monkeypatch, r):
    import api.services.embedding as emb

    monkeypatch.setattr(emb, "SentenceTransformerEmbedder", Dim384)
    monkeypatch.setattr(emb, "get_redis", lambda: r)
    return emb.get_embedder()


@pytest.mark.parametrize("blob", [b"ab", b"x" * 8, b"x" * (768 * 4), "abcd", b"", bytearray(b"ab")])
def test_lone_poisoned_blob_via_get_embedder(monkeypatch, r, blob):
    e = _via_get_embedder(monkeypatch, r)
    r.set(e._key("x"), blob)
    out = e.encode(["x"])
    assert out.shape == (1, 384)
    assert len(r.get(e._key("x"))) == 384 * 4


def test_nan_blob_of_right_size_is_miss(monkeypatch, r):
    e = _via_get_embedder(monkeypatch, r)
    r.set(e._key("x"), np.full(384, np.nan, dtype=np.float32).tobytes())
    out = e.encode(["x"])
    assert np.all(np.isfinite(out))
    assert np.all(np.isfinite(np.frombuffer(r.get(e._key("x")), dtype=np.float32)))
