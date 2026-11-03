import json
import subprocess
import sys
from pathlib import Path

from api.main import create_app

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "openapi.json"
SCRIPT = ROOT / "scripts" / "export_openapi.py"


def test_committed_openapi_matches_app():
    committed = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert committed == json.loads(json.dumps(create_app().openapi())), (
        "openapi.json is stale: run `python scripts/export_openapi.py`"
    )


def test_export_script_check_mode_passes():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--check"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_snapshot_is_canonical_text():
    raw = SNAPSHOT.read_bytes()
    assert b"\r" not in raw
    assert raw.endswith(b"}\n")
