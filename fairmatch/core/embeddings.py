import logging
from typing import Protocol

import numpy as np

logger = logging.getLogger(__name__)


def _network_errors() -> tuple[type[BaseException], ...]:
    errs: list[type[BaseException]] = [OSError, ConnectionError, TimeoutError]
    try:
        import httpx

        errs.append(httpx.TransportError)
    except ImportError:
        pass
    try:
        from huggingface_hub import errors as hf

        errs += [hf.HfHubHTTPError, hf.LocalEntryNotFoundError, hf.OfflineModeIsEnabled]
    except (ImportError, AttributeError):
        pass
    return tuple(errs)


def SentenceTransformer(*args, **kwargs):
    from sentence_transformers import SentenceTransformer as _ST

    return _ST(*args, **kwargs)


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
            # Local cache first: avoids Hub round-trips (and their long retry/backoff
            # when the network is down). Only on a cache miss do we go online.
            try:
                self._model = SentenceTransformer(self.model_name, local_files_only=True)
            except _network_errors() as miss:
                logger.warning(
                    "Model %s not in local cache (%s); downloading from Hugging Face Hub",
                    self.model_name,
                    miss,
                )
                try:
                    self._model = SentenceTransformer(self.model_name)
                except _network_errors() as err:
                    raise RuntimeError(
                        f"Embedding model {self.model_name!r} is not available locally and the "
                        "Hub is unreachable; it must be downloaded once while online."
                    ) from err
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
