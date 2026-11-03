from typing import Protocol

import numpy as np


class Embedder(Protocol):
    def encode(self, texts: list[str]) -> np.ndarray:
        """Return L2-normalised rows, shape (n, d)."""
        ...


class SentenceTransformerEmbedder:
    def __init__(self, model_name: str = "BAAI/bge-small-en-v1.5"):
        self.model_name = model_name
        self._model = None
        self._cache: dict[str, np.ndarray] = {}
        self._dim: int | None = None

    def _load(self):
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(self.model_name)
        return self._model

    def encode(self, texts: list[str]) -> np.ndarray:
        if not texts:
            return np.zeros((0, self._dim or 0), dtype=float)
        todo = list(dict.fromkeys(t for t in texts if t != "" and t not in self._cache))
        if todo:
            vecs = np.asarray(self._load().encode(todo, normalize_embeddings=True), dtype=float)
            self._dim = vecs.shape[1]
            for t, v in zip(todo, vecs):
                self._cache[t] = v
        if self._dim is None:
            # only empty strings seen so far; need the dimension from the model
            self._dim = int(self._load().get_sentence_embedding_dimension())
        zero = np.zeros(self._dim, dtype=float)
        return np.vstack([self._cache[t] if t != "" else zero for t in texts])


def cosine_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.shape[0] == 0 or b.shape[0] == 0:
        return np.zeros((a.shape[0], b.shape[0]))
    return a @ b.T
