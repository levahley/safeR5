import threading
import time

from fastapi.testclient import TestClient

from safer5.api import create_app
from safer5.jobs import JobManager
from safer5.reports import report_bytes
from safer5.schemas import LabConfig, RunConfig
from safer5.storage import Store


def wait_job(client, identifier):
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        job = client.get(f"/api/v1/jobs/{identifier}").json()
        if job["status"] not in ("queued", "running"):
            return job
        time.sleep(.03)
    raise AssertionError("Job did not terminate")


def test_real_pipeline_reports_pagination_and_persistence(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/v1/health").json()["status"] == "ok"
        created = client.post("/api/v1/lab/generate", json=LabConfig(n_events=300).model_dump(mode="json"))
        assert created.status_code == 202
        dataset_job = wait_job(client, created.json()["id"])
        assert dataset_job["status"] == "succeeded", dataset_job
        run = client.post("/api/v1/experiments", json=RunConfig(dataset_id=dataset_job["result_id"], loss={"kind":"source","source":"dns"}).model_dump(mode="json"))
        assert run.status_code == 202
        job = wait_job(client, run.json()["id"])
        assert job["status"] == "succeeded", job
        result = client.get(f'/api/v1/experiments/{job["result_id"]}').json()
        assert result["baseline"]["source_counts"]["dns"] > 0
        assert result["perturbed"]["source_counts"]["dns"] == 0
        assert result["perturbed"]["metrics"]["steps_total"] == 6
        assert set(result["baseline"]["method_metrics"]) == {"rules", "iforest"}
        opt = result["optimization"]
        assert len(opt["candidates"]) == 8
        selected = [c for c in opt["candidates"] if c["sources"] == opt["recommended_sources"]][0]
        assert selected["cost_bytes"] <= opt["budget_bytes"]
        assert selected["feasible"]
        assert selected["recall"] == max(c["recall"] or 0 for c in opt["candidates"] if c["feasible"])
        assert opt["validation_dataset_hash"] != result["provenance"]["test_hash"]
        assert len(opt["comparisons"]) >= 5
        page = client.get(f'/api/v1/experiments/{result["id"]}/events?limit=4').json()
        assert len(page["items"]) == 4
        eid = page["items"][0]["event_id"]
        evidence = client.get(f'/api/v1/experiments/{result["id"]}/evidence?event_id={eid}')
        assert evidence.status_code == 200
        assert evidence.json()["raw"]
        for fmt in ("json", "csv", "markdown", "html"):
            response = client.get(f'/api/v1/experiments/{result["id"]}/report?format={fmt}')
            assert response.status_code == 200
            assert len(response.content) > 100
        assert client.get(f'/api/v1/experiments/{result["id"]}/events?limit=1001').status_code == 422
        assert client.get("/api/v1/datasets/../../../etc/passwd").status_code != 200
        assert client.post("/api/v1/experiments", json={"loss":{"kind":"interval"}}).status_code == 422
    with TestClient(create_app(tmp_path)) as client:
        assert client.get("/api/v1/overview").json()["stats"]["experiments"] == 1


def test_job_cancellation_failure_restart_and_no_partial_success(tmp_path):
    store = Store(tmp_path)
    manager = JobManager(store, start=False)
    job = manager.submit("experiment", RunConfig().model_dump(mode="json"))
    assert manager.cancel(job["id"])["status"] == "cancelled"
    active = manager.submit("experiment", {})
    active["status"] = "running"
    store.put("jobs", active)
    manager2 = JobManager(store, start=False)
    assert store.get("jobs", active["id"])["status"] == "interrupted"
    failed = manager2.submit("experiment", {"dataset_id":"a"*32})
    manager2.start()
    deadline = time.monotonic() + 10
    while store.get("jobs", failed["id"])["status"] in ("queued", "running") and time.monotonic() < deadline:
        time.sleep(.02)
    assert store.get("jobs", failed["id"])["status"] == "failed"
    assert list((tmp_path / "experiments").iterdir()) == []
    manager2.close()
    assert not manager2.thread.is_alive()


def test_cancel_running_job_closes_cleanly(tmp_path):
    store = Store(tmp_path)
    gate, started = threading.Event(), threading.Event()

    def runner(config, progress, cancelled):
        started.set()
        gate.wait(2)
        if cancelled():
            raise InterruptedError()
        return {"id":"a"*32}

    manager = JobManager(store, runner=runner)
    job = manager.submit("experiment", {})
    assert started.wait(2)
    manager.cancel(job["id"])
    gate.set()
    manager.close()
    assert store.get("jobs", job["id"])["status"] == "cancelled"


def test_origin_and_report_escaping(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        assert client.post("/api/v1/experiments", json={}, headers={"origin":"https://evil.test"}).status_code == 403
        assert client.get("/api/v1/health", headers={"host":"evil.test"}).status_code == 400
        assert client.post("/api/v1/datasets/import", json={"name":"bad","content":"x"*20000001}).status_code == 413
    result = {"name":"<script>alert(1)</script>","id":"a"*32,"config":{},"baseline":{"metrics":{}},"perturbed":{"metrics":{}},"optimization":{},"provenance":{},"performance":{}}
    assert b"<script>alert" not in report_bytes(result,"html")
    assert b"<script>alert" not in report_bytes(result,"markdown")
    result["name"] = "=HYPERLINK(1)"
    assert "'=HYPERLINK" in report_bytes(result,"csv").decode()
