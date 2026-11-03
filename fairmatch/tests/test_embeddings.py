import numpy as np
import pytest

import core.embeddings as emb_mod
from core.embeddings import SentenceTransformerEmbedder, cosine_matrix


def test_cosine_matrix_shape_and_range(fake_embedder):
    a = fake_embedder.encode(["python developer", "chef", "data scientist"])
    b = fake_embedder.encode(["python engineer", "baker"])
    m = cosine_matrix(a, b)
    assert m.shape == (3, 2)
    assert np.all(m >= -1e-9) and np.all(m <= 1 + 1e-9)
    assert np.allclose(m, a @ b.T)


def test_cosine_matrix_with_empty_side():
    emb = SentenceTransformerEmbedder()
    empty = emb.encode([])
    m = cosine_matrix(empty, np.ones((2, 4)))
    assert m.shape == (0, 2)
    assert emb._model is None


def test_fake_embedder_similar_texts_closer(fake_embedder):
    v = fake_embedder.encode(["machine learning engineer", "machine learning expert", "pastry chef"])
    m = cosine_matrix(v[:1], v[1:])
    assert m[0, 0] > m[0, 1]


def test_empty_text_gives_zero_vector_not_nan(fake_embedder):
    v = fake_embedder.encode([""])
    assert not np.isnan(v).any()
    assert np.all(v == 0)


class _StubModel:
    def __init__(self):
        self.calls = []

    def encode(self, texts, normalize_embeddings=True):
        self.calls.append(list(texts))
        out = np.zeros((len(texts), 4))
        for i, t in enumerate(texts):
            out[i, len(t) % 4] = 1.0
        return out


def test_encode_caches_repeated_text():
    emb = SentenceTransformerEmbedder()
    stub = _StubModel()
    emb._model = stub
    first = emb.encode(["abc", "abc", "de"])
    second = emb.encode(["abc", "de", ""])
    assert first.shape == (3, 4)
    assert second.shape == (3, 4)
    encoded = [t for call in stub.calls for t in call]
    assert sorted(encoded) == ["abc", "de"]
    assert np.all(second[2] == 0)
    assert np.array_equal(first[0], second[0])


@pytest.mark.slow
def test_bge_relates_ml_and_ai():
    emb = SentenceTransformerEmbedder()
    v = emb.encode(["machine learning engineer", "AI engineer", "pastry chef"])
    m = cosine_matrix(v[:1], v[1:])
    assert m[0, 0] > m[0, 1]


class _OkModel:
    def encode(self, texts, normalize_embeddings=True):
        return np.ones((len(texts), 3)) / np.sqrt(3)


def _patch(monkeypatch, behaviours):
    calls = []

    def fake(*args, **kwargs):
        calls.append(kwargs)
        b = behaviours[len(calls) - 1]
        if isinstance(b, Exception):
            raise b
        return b

    monkeypatch.setattr(emb_mod, "SentenceTransformer", fake)
    return calls


def test_cached_model_loaded_locally_without_network(monkeypatch):
    calls = _patch(monkeypatch, [_OkModel()])
    out = SentenceTransformerEmbedder().encode(["x"])
    assert out.shape == (1, 3)
    assert calls == [{"local_files_only": True}]


def test_cache_miss_falls_back_to_online_load(monkeypatch):
    calls = _patch(monkeypatch, [OSError("miss"), _OkModel()])
    out = SentenceTransformerEmbedder().encode(["x"])
    assert out.shape == (1, 3)
    assert calls == [{"local_files_only": True}, {}]


def test_load_both_fail_raises_runtimeerror(monkeypatch):
    _patch(monkeypatch, [OSError("a"), ConnectionError("b")])
    with pytest.raises(RuntimeError, match="bge-small-en-v1.5.*online") as ei:
        SentenceTransformerEmbedder().encode(["x"])
    assert isinstance(ei.value.__cause__, ConnectionError)


def test_non_network_error_not_swallowed(monkeypatch):
    calls = _patch(monkeypatch, [ValueError("bug"), _OkModel()])
    with pytest.raises(ValueError):
        SentenceTransformerEmbedder().encode(["x"])
    assert len(calls) == 1
