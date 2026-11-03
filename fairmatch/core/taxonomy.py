"""Skill taxonomy: canonical names, aliases and symmetric relations."""
import json
from functools import lru_cache
from pathlib import Path

_DEFAULT = Path(__file__).parent / "data" / "skills.json"


class Taxonomy:
    def __init__(self, path: Path | None = None):
        entries = json.loads((path or _DEFAULT).read_text(encoding="utf-8"))
        self._canon: dict[str, str] = {}
        self._related: dict[str, set[str]] = {}
        for e in entries:
            name = e["name"].lower()
            self._canon[name] = name
            self._related.setdefault(name, set())
            for a in e.get("aliases", []):
                self._canon[a.lower()] = name
        for e in entries:
            name = e["name"].lower()
            for r in e.get("related", []):
                other = self._canon.get(r.lower())
                if other and other != name:
                    self._related[name].add(other)
                    self._related.setdefault(other, set()).add(name)

    def canonical(self, term: str) -> str | None:
        return self._canon.get(term.strip().lower())

    def all_terms(self) -> list[str]:
        return sorted(self._canon)

    def related(self, skill: str) -> frozenset[str]:
        c = self.canonical(skill)
        return frozenset(self._related.get(c, ())) if c else frozenset()


@lru_cache(maxsize=1)
def get_taxonomy() -> Taxonomy:
    return Taxonomy()
