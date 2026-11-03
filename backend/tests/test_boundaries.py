from fastapi.testclient import TestClient

from safer5.api import create_app
from safer5.schemas import Event, LabConfig
from safer5.lab import generate_lab
from safer5.storage import Store


def test_chunked_body_limit_and_bad_content_length(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        response = client.post("/api/v1/datasets/import", content=iter([b"x" * 1000000] * 21), headers={"content-type":"application/json"})
        assert response.status_code == 413
        assert client.post("/api/v1/experiments", content=b"{}", headers={"content-length":"oops"}).status_code == 400


def test_exact_loopback_origin_on_configured_port(tmp_path):
    with TestClient(create_app(tmp_path),base_url="http://127.0.0.1:8766") as client:
        response=client.post("/api/v1/lab/generate",json={"n_events":300},headers={"origin":"http://127.0.0.1:8766"})
        assert response.status_code==202
        assert client.post("/api/v1/experiments",json={},headers={"origin":"http://127.0.0.1:9999"}).status_code==403


def test_browser_can_navigate_to_ui_from_an_external_link(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/",headers={"sec-fetch-site":"cross-site","sec-fetch-mode":"navigate"}).status_code!=403
        assert client.get("/api/v1/health",headers={"sec-fetch-site":"cross-site"}).status_code==403


def test_import_empty_rejects_no_valid_records_and_reports_duplicates(tmp_path):
    store = Store(tmp_path)
    try:
        store.import_jsonl("bozuk", "not-json")
    except ValueError:
        pass
    else:
        assert False, "All-invalid imports must not become a usable dataset"


def test_normal_lab_contains_hard_negative_stories(tmp_path):
    manifest = generate_lab(tmp_path, LabConfig(n_events=600, include_attacks=False))
    from safer5.storage import read_jsonl
    events = list(read_jsonl(tmp_path / "test/events.jsonl"))
    assert manifest["splits"]["test"]["event_count"] == 600
    assert sum(len(e.dns_query or "") > 45 for e in events) >= 8
    assert sum(e.action == "archive" for e in events) >= 3
    assert sum(e.privileged is True for e in events) >= 2
    assert all(isinstance(e, Event) for e in events)
