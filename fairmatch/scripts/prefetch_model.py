"""Download the embedding model into the HF cache at image build time.

Run once while online (``python scripts/prefetch_model.py``). At runtime the
embedder loads from the cache with ``local_files_only=True``.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def main() -> int:
    from core.embeddings import SentenceTransformerEmbedder

    # Any exception propagates: traceback and non-zero exit fail the image build.
    vectors = SentenceTransformerEmbedder().encode(["prefetch warm-up"])
    if getattr(vectors, "shape", (0,))[0] != 1:
        print("prefetch_model: unexpected encode output", file=sys.stderr)
        return 1
    print(f"prefetch_model: ok (dim={vectors.shape[-1]})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
