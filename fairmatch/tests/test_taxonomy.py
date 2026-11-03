from core.taxonomy import Taxonomy, get_taxonomy


def test_alias_resolves_to_canonical():
    t = Taxonomy()
    assert t.canonical("React") == "react.js"
    assert t.canonical("Postgres") == "postgresql"


def test_unknown_term_is_none():
    assert Taxonomy().canonical("basket weaving") is None


def test_related_is_symmetric(tmp_path):
    f = tmp_path / "s.json"
    f.write_text(
        '[{"name":"a","aliases":[],"related":["b"]},'
        '{"name":"b","aliases":[],"related":[]}]',
        encoding="utf-8",
    )
    t = Taxonomy(f)
    assert "b" in t.related("a")
    assert "a" in t.related("b")


def test_related_accepts_alias():
    t = Taxonomy()
    assert t.related("AI") == t.related("artificial intelligence")
    assert t.related("AI")


def test_all_seed_skills_resolve():
    import json
    from pathlib import Path

    import core.taxonomy as mod

    entries = json.loads(
        (Path(mod.__file__).parent / "data" / "skills.json").read_text(encoding="utf-8")
    )
    assert len(entries) >= 50
    t = Taxonomy()
    for e in entries:
        for term in [e["name"], *e["aliases"]]:
            assert t.canonical(term) is not None


def test_ambiguous_aliases_removed():
    t = Taxonomy()
    assert t.canonical("express") is None
    assert t.canonical("js") is None
    assert t.canonical("expressjs") == "express.js"


def test_ml_related_to_ai():
    assert "artificial intelligence" in Taxonomy().related("machine learning")


def test_cached_and_all_terms():
    assert get_taxonomy() is get_taxonomy()
    assert "nodejs" in get_taxonomy().all_terms()
