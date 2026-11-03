import json

import pytest

from safer5.correlation import correlate
from safer5.detection import analyze, fit_models
from safer5.evaluation import evaluate
from safer5.lab import generate_lab
from safer5.perturbation import perturb
from safer5.schemas import Event, LabConfig, LossConfig
from safer5.storage import read_jsonl


@pytest.fixture(scope="module")
def lab(tmp_path_factory):
    root = tmp_path_factory.mktemp("analysis")
    generate_lab(root, LabConfig(seed=51, n_events=900))
    train = list(read_jsonl(root / "train/events.jsonl"))
    validation = list(read_jsonl(root / "validation/events.jsonl"))
    test = list(read_jsonl(root / "test/events.jsonl"))
    truth = json.loads((root / "test/truth.json").read_text())
    models = fit_models(iter(train), iter(validation), 51)
    return root, train, validation, test, truth, models


def test_loss_boundaries_determinism_and_immutable_input(lab):
    _, _, _, events, _, _ = lab
    original = [e.model_dump() for e in events]
    zero, m = perturb(events, LossConfig(kind="random", rate=0), 1)
    assert zero == events and m["removed_count"] == 0
    empty, m = perturb(events, LossConfig(kind="random", rate=1), 1)
    assert empty == [] and m["retained_count"] == 0
    a, _ = perturb(events, LossConfig(kind="random", rate=.4), 42)
    b, _ = perturb(events, LossConfig(kind="random", rate=.4), 42)
    assert a == b and 0.3 < 1 - len(a) / len(events) < 0.5
    assert [e.model_dump() for e in events] == original
    outage, _ = perturb(events, LossConfig(kind="source", source="auth"), 1)
    assert all(e.source_type != "auth" for e in outage)
    interval, _ = perturb(events, LossConfig(kind="interval", start=events[0].event_time, end=events[-1].event_time), 1)
    assert len(interval) <= 1


def test_truth_is_not_detector_input_and_model_frozen(lab):
    root, train, validation, events, truth, models = lab
    before = models.manifest()
    first = analyze(iter(events), models)
    (root / "test/truth.json").unlink()
    assert analyze(iter(events), models) == first
    changed_truth = {**truth, "steps": []}
    assert evaluate(events, first["alerts"], changed_truth)["steps_total"] == 0
    assert models.manifest() == before
    assert {a["method"] for a in first["alerts"]} == {"rules", "iforest"}
    assert models.manifest()["training_hash"] != models.manifest()["validation_hash"]
    assert fit_models(iter(train), iter(validation), 51).manifest() == before
    kept, _ = perturb(events, LossConfig(kind="source", source="dns"), 1)
    reduced = analyze(iter(kept), models)
    assert reduced["source_health"]["dns"] == "missing"
    assert models.manifest() == before
    with pytest.raises(ValueError):
        Event.model_validate({**events[0].model_dump(), "is_attack": True})


def test_evaluation_exact_tiny_case_and_invisible_steps():
    events = [Event(event_id=str(i) * 32, event_time=f"2026-01-01T00:{(i-1)*5:02d}:00Z", source_type="auth", host_id="h", user_id="u", action="login") for i in range(1, 4)]
    truth = {"steps": [
        {"id": "s1", "host_id": "h", "user_id": "u", "start": "2026-01-01T00:00:00Z", "end": "2026-01-01T00:01:00Z", "event_ids": [events[0].event_id]},
        {"id": "s2", "host_id": "h", "user_id": "u", "start": "2026-01-01T00:00:00Z", "end": "2026-01-01T00:01:00Z", "event_ids": ["9" * 32]}],
        "normal_event_ids": [events[1].event_id, events[2].event_id]}
    alerts = [{"evidence_ids": [events[0].event_id], "host_id": "h", "user_id": "u", "event_time": "2026-01-01T00:00:30Z"},
              {"evidence_ids": [events[1].event_id], "host_id": "h", "user_id": "u", "event_time": "2026-01-01T00:05:30Z"}]
    metrics = evaluate(events, alerts, truth)
    assert metrics["attack_step_recall"] == .5
    assert metrics["evidence_coverage"] == .5
    assert metrics["false_positive_rate"] == .5
    assert metrics["normal_windows"] == 2
    assert metrics["false_positive_windows"] == 1
    assert metrics["detection_delay_seconds"] == 30
    observed_only = evaluate(events[:2], alerts, truth)
    assert observed_only["normal_events"] == 1
    assert observed_only["false_positive_rate"] == 1
    empty = evaluate([], [], truth)
    assert empty["steps_total"] == 2 and empty["attack_step_recall"] == 0
    assert empty["evidence_coverage"] == 0
    assert evaluate([], [], {"steps": [], "normal_event_ids": []})["attack_step_recall"] is None
    assert evaluate(events, [], None)["status"] == "no_ground_truth"


def test_ip_and_pid_alone_do_not_create_causal_edges():
    events = [Event(event_id=str(i)*32, event_time="2026-01-01T00:00:00Z", source_type="audit", host_id=f"h{i}", user_id=f"u{i}", action="process_start", process_id=10, src_ip="10.0.0.1") for i in range(1, 3)]
    alerts = [{"id":str(i),"evidence_ids":[e.event_id],"host_id":e.host_id,"user_id":e.user_id,"event_time":e.event_time.isoformat()} for i,e in enumerate(events)]
    incidents, graph = correlate(alerts, events)
    assert len(incidents) == 2
    assert all(edge["relation"] not in {"same_ip", "same_pid", "causes"} for edge in graph["edges"])
    assert all(edge["evidence_ids"] for edge in graph["edges"])


def test_exact_loss_endpoints_do_not_depend_on_hash_float_rounding(monkeypatch):
    monkeypatch.setattr("safer5.perturbation.digest",lambda _:"f"*64)
    event=Event(event_id="a"*32,event_time="2026-01-01T00:00:00Z",source_type="auth",host_id="h",action="login")
    kept,_=perturb([event],LossConfig(kind="random",rate=1),1)
    assert kept==[]
    kept,_=perturb([event],LossConfig(kind="random",rate=0),1)
    assert kept==[event]
