"""
Embedding Module
-----------------
Converts resume/posting text into numeric vectors so that "meaning
similarity" can be computed mathematically (cosine similarity), instead
of just checking for exact keyword matches.

Current implementation: TF-IDF vectors (scikit-learn) fit across all
candidate + posting text in a batch. This is lightweight, needs no
internet access or model download, and already captures useful
similarity (e.g. documents mentioning "machine learning" and "AI" score
closer than unrelated documents once combined with the skill-overlap
score in scoring.py).

Planned upgrade: swap TfidfVectorizer for a pretrained Sentence-
Transformer model (e.g. all-MiniLM-L6-v2) to capture deeper semantic
similarity. Because this class exposes the same fit()/embed() interface,
that swap will not require changing any other module.
"""

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class EmbeddingService:
    def __init__(self):
        self.vectorizer = TfidfVectorizer(stop_words="english")
        self._fitted = False

    def fit(self, texts: list[str]):
        """Fit the vectorizer on a batch of candidate + posting text."""
        self.vectorizer.fit(texts)
        self._fitted = True

    def embed(self, text: str):
        """Return the vector representation of a single piece of text."""
        if not self._fitted:
            raise RuntimeError("EmbeddingService must be fit() before embed().")
        return self.vectorizer.transform([text])

    def similarity(self, text_a: str, text_b: str) -> float:
        """Return cosine similarity (0 to 1) between two pieces of text."""
        vec_a = self.embed(text_a)
        vec_b = self.embed(text_b)
        return float(cosine_similarity(vec_a, vec_b)[0][0])
