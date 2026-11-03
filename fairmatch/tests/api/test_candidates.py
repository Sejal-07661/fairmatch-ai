import io
import logging

import pytest

from api.models import Candidate, CandidateDemographics, Opportunity, User
from api.security import hash_password


def _user(session, email, role="candidate"):
    u = User(email=email, password_hash=hash_password("password123"), role=role)
    session.add(u)
    session.commit()
    return u


def _hdr(client, email):
    r = client.post("/auth/login", data={"username": email, "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(autouse=True)
def _embedder(monkeypatch, fake_embedder_384):
    monkeypatch.setattr("api.services.embedding.get_embedder", lambda: fake_embedder_384)


TEXT = "Experienced engineer with 5 years of python and sql. Bachelor degree."


def _post(client, h, **kw):
    data = {"name": "Ann"}
    files = None
    if "text" in kw:
        data["resume_text"] = kw["text"]
    if "file" in kw:
        files = {"resume": kw["file"]}
    return client.post("/candidates", data=data, files=files, headers=h)


def _count(session):
    session.expire_all()
    return session.query(Candidate).count()


def test_candidate_creates_profile_from_text(session, client):
    _user(session, "a@x.com")
    r = _post(client, _hdr(client, "a@x.com"), text=TEXT)
    assert r.status_code == 201
    d = r.json()
    assert "python" in d["skills"] and d["used_fallback"] is True
    assert set(d) == {"id", "name", "skills", "experience_years", "education_level",
                      "used_fallback"}
    session.expire_all()
    assert len(session.get(Candidate, d["id"]).embedding) == 384


def test_second_profile_409(session, client):
    _user(session, "a@x.com")
    h = _hdr(client, "a@x.com")
    assert _post(client, h, text=TEXT).status_code == 201
    assert _post(client, h, text=TEXT).status_code == 409
    assert _count(session) == 1


def test_upload_txt_file(session, client):
    _user(session, "a@x.com")
    r = _post(client, _hdr(client, "a@x.com"), file=("r.txt", TEXT.encode(), "text/plain"))
    assert r.status_code == 201 and "python" in r.json()["skills"]


def test_upload_pdf_and_docx(session, client):
    import docx
    import fitz

    _user(session, "a@x.com")
    _user(session, "b@x.com")
    pdf = fitz.open()
    pdf.new_page().insert_text((72, 72), "Engineer with python and sql skills")
    r = _post(client, _hdr(client, "a@x.com"),
              file=("r.pdf", pdf.tobytes(), "application/pdf"))
    assert r.status_code == 201 and "python" in r.json()["skills"]
    d = docx.Document()
    d.add_paragraph("Engineer with python and sql skills")
    buf = io.BytesIO()
    d.save(buf)
    r = _post(client, _hdr(client, "b@x.com"), file=("r.docx", buf.getvalue(), "application/x"))
    assert r.status_code == 201 and "python" in r.json()["skills"]


@pytest.mark.parametrize(
    "file",
    [
        ("r.exe", b"hello python", "application/octet-stream"),
        ("r.md", b"hello python", "text/plain"),
        ("r", b"hello python", "text/plain"),
        ("r.pdf", b"just plain text, not a pdf", "application/pdf"),
        ("r.docx", b"just plain text, not a docx", "application/x"),
        ("r.txt", b"\xff\xfe\xfa bad utf8 \x80", "text/plain"),
        ("r.txt", b"   \n  ", "text/plain"),
        ("r.txt", b"", "text/plain"),
    ],
)
def test_bad_files_422_nothing_persisted(session, client, file):
    _user(session, "a@x.com")
    r = _post(client, _hdr(client, "a@x.com"), file=file)
    assert r.status_code == 422 and r.json()["detail"]
    assert _count(session) == 0


def test_unsupported_suffix_422_nothing_persisted(session, client):
    _user(session, "a@x.com")
    r = _post(client, _hdr(client, "a@x.com"), file=("r.exe", b"x", "application/x"))
    assert r.status_code == 422 and _count(session) == 0


def test_empty_text_422(session, client):
    _user(session, "a@x.com")
    h = _hdr(client, "a@x.com")
    assert _post(client, h, text="   ").status_code == 422
    assert _post(client, h).status_code == 422  # neither
    both = client.post("/candidates", data={"name": "A", "resume_text": TEXT},
                       files={"resume": ("r.txt", TEXT.encode(), "text/plain")}, headers=h)
    assert both.status_code == 422
    assert _post(client, h, text="x" * 20001).status_code == 422
    assert _count(session) == 0


@pytest.mark.parametrize("name", ["r.pdf", "r.docx"])
def test_oversized_file_422(session, client, name):
    _user(session, "a@x.com")
    big = b"%PDF-1.4 " + b"a" * (5 * 1024 * 1024 + 1 - 9)
    assert len(big) == 5 * 1024 * 1024 + 1
    r = _post(client, _hdr(client, "a@x.com"), file=(name, big, "application/octet-stream"))
    assert r.status_code == 422 and "size limit" in r.json()["detail"]
    assert _count(session) == 0


def _upload_dirs():
    import os
    import tempfile

    return {d for d in os.listdir(tempfile.gettempdir()) if d.startswith("fairmatch-upload-")}


def test_failed_uploads_leave_no_temp_dirs(session, client):
    import zipfile

    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("a.txt", "x")
    _user(session, "a@x.com")
    h = _hdr(client, "a@x.com")
    before = _upload_dirs()
    for file in [
        ("r.pdf", b"just plain text, not a pdf", "application/pdf"),
        ("r.docx", z.getvalue(), "application/x"),
        ("r.docx", b"PK\x03\x04 truncated", "application/x"),
        ("r.txt", b"\xff\xfe bad", "text/plain"),
        ("r.txt", b"nul \x00 byte", "text/plain"),
    ]:
        assert _post(client, h, file=file).status_code == 422
    assert _upload_dirs() == before


def test_nul_rejected_422(session, client):
    _user(session, "a@x.com")
    _user(session, "adm@x.com", "admin")
    h = _hdr(client, "a@x.com")
    r = client.post("/candidates", data={"name": "A\x00b", "resume_text": TEXT}, headers=h)
    assert r.status_code == 422
    assert _post(client, h, text="python \x00 sql").status_code == 422
    assert _post(client, h, file=("r.txt", b"python \x00 sql", "text/plain")).status_code == 422
    assert _count(session) == 0
    cid = _post(client, h, text=TEXT).json()["id"]
    r = client.put(f"/candidates/{cid}/demographics", json={"group_label": "a\x00b"},
                   headers=_hdr(client, "adm@x.com"))
    assert r.status_code == 422


def test_huge_ids_and_offsets_422_not_500(session, client):
    _user(session, "adm@x.com", "admin")
    ha = _hdr(client, "adm@x.com")
    for url in (f"/candidates/{2**70}", f"/candidates/{2**70}/demographics",
                "/candidates?offset=" + "9" * 50):
        r = client.get(url, headers=ha)
        assert r.status_code == 422 and isinstance(r.json()["detail"], str)
        assert "9999999" not in r.text and str(2**70) not in r.text


def test_enqueue_failure_still_201(session, client, monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("redis down")

    monkeypatch.setattr("api.routers.candidates.embed_profile.delay", boom)
    _user(session, "a@x.com")
    r = _post(client, _hdr(client, "a@x.com"), text=TEXT)
    assert r.status_code == 201
    session.expire_all()
    assert session.get(Candidate, r.json()["id"]).embedding is None


def test_admin_can_create_profile(session, client):
    _user(session, "adm@x.com", "admin")
    assert _post(client, _hdr(client, "adm@x.com"), text=TEXT).status_code == 201


def test_candidate_cannot_list_candidates_403(session, client):
    _user(session, "a@x.com")
    h = _hdr(client, "a@x.com")
    _post(client, h, text=TEXT)
    assert client.get("/candidates", headers=h).status_code == 403


def test_candidate_cannot_read_other_candidate_403(session, client):
    _user(session, "a@x.com")
    _user(session, "b@x.com")
    ra = _post(client, _hdr(client, "a@x.com"), text=TEXT)
    r = client.get(f"/candidates/{ra.json()['id']}", headers=_hdr(client, "b@x.com"))
    assert r.status_code == 403 and "python" not in r.text


def test_candidate_cannot_read_demographics_403(session, client):
    _user(session, "a@x.com")
    h = _hdr(client, "a@x.com")
    cid = _post(client, h, text=TEXT).json()["id"]
    assert client.get(f"/candidates/{cid}/demographics", headers=h).status_code == 403
    r = client.put(f"/candidates/{cid}/demographics", json={"group_label": "g"}, headers=h)
    assert r.status_code == 403


def test_admin_sets_and_reads_demographics(session, client):
    _user(session, "a@x.com")
    _user(session, "adm@x.com", "admin")
    cid = _post(client, _hdr(client, "a@x.com"), text=TEXT).json()["id"]
    ha = _hdr(client, "adm@x.com")
    assert client.get(f"/candidates/{cid}/demographics", headers=ha).status_code == 404
    r = client.put(f"/candidates/{cid}/demographics", json={"group_label": "A"}, headers=ha)
    assert r.status_code == 200
    client.put(f"/candidates/{cid}/demographics", json={"group_label": "B"}, headers=ha)
    r = client.get(f"/candidates/{cid}/demographics", headers=ha)
    assert r.json() == {"candidate_id": cid, "group_label": "B"}
    for bad in ("", "  ", "x" * 65):
        assert client.put(f"/candidates/{cid}/demographics", json={"group_label": bad},
                          headers=ha).status_code == 422
    assert client.put("/candidates/999/demographics", json={"group_label": "A"},
                      headers=ha).status_code == 404
    session.expire_all()
    assert session.get(CandidateDemographics, cid).group_label == "B"


def test_candidate_out_has_no_demographics_field(session, client):
    _user(session, "a@x.com")
    _user(session, "adm@x.com", "admin")
    h = _hdr(client, "a@x.com")
    cid = _post(client, h, text=TEXT).json()["id"]
    ha = _hdr(client, "adm@x.com")
    client.put(f"/candidates/{cid}/demographics", json={"group_label": "secret"}, headers=ha)
    for r in (client.get("/candidates/me", headers=h), client.get(f"/candidates/{cid}", headers=ha),
              client.get("/candidates", headers=ha)):
        assert "secret" not in r.text and "group" not in r.text and "demographic" not in r.text
    assert len(client.get("/candidates?limit=1&offset=0", headers=ha).json()) == 1
    assert client.get("/candidates?limit=0", headers=ha).status_code == 422
    assert client.get("/candidates/999", headers=ha).status_code == 404


def test_get_me_without_profile_404(session, client):
    _user(session, "a@x.com")
    assert client.get("/candidates/me", headers=_hdr(client, "a@x.com")).status_code == 404
    assert client.get("/candidates/me").status_code == 401


def test_embed_profile_task_stores_vector_and_is_idempotent(session):
    from api.worker import embed_profile

    u = _user(session, "a@x.com")
    c = Candidate(user_id=u.id, name="A", resume_text=TEXT, skills=[], experience_years=1.0,
                  education_level=1)
    o = Opportunity(title="t", posting_text="python", required_skills=[], capacity=1,
                    min_experience_years=0, min_education_level=0)
    session.add_all([c, o])
    session.commit()
    embed_profile.delay("candidate", c.id)
    embed_profile.delay("opportunity", o.id)
    session.expire_all()
    first = list(session.get(Candidate, c.id).embedding)
    assert len(first) == 384 and len(session.get(Opportunity, o.id).embedding) == 384
    embed_profile.delay("candidate", c.id)
    session.expire_all()
    assert list(session.get(Candidate, c.id).embedding) == first
    embed_profile.delay("candidate", 9999)  # row gone: no-op
    embed_profile.delay("bogus", 1)


def test_embed_profile_survives_embedder_failure(session, monkeypatch, caplog):
    from api.worker import embed_profile

    def boom():
        raise RuntimeError("no model")

    monkeypatch.setattr("api.services.embedding.get_embedder", boom)
    u = _user(session, "a@x.com")
    c = Candidate(user_id=u.id, name="A", resume_text=TEXT, skills=[], experience_years=1.0,
                  education_level=1)
    session.add(c)
    session.commit()
    with caplog.at_level(logging.ERROR):
        embed_profile.delay("candidate", c.id)
    session.expire_all()
    assert session.get(Candidate, c.id).embedding is None
    assert "embedding failed" in caplog.text
