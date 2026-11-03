"""Export (or verify with --check) the committed OpenAPI contract snapshot."""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "openapi.json"

for _k, _v in {
    "JWT_SECRET": "export",
    "DATABASE_URL": "sqlite://",
    "REDIS_URL": "fakeredis://",
    "CELERY_EAGER": "true",
}.items():
    os.environ.setdefault(_k, _v)

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def render() -> str:
    from api.main import create_app

    return json.dumps(create_app().openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--check" in argv:
        current = SNAPSHOT.read_bytes().decode("utf-8") if SNAPSHOT.exists() else None
        if current != text:
            print("openapi.json is stale: run `python scripts/export_openapi.py`")
            return 1
        print("openapi.json is up to date")
        return 0
    with open(SNAPSHOT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"wrote {SNAPSHOT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
