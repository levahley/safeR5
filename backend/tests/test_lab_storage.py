import hashlib
import json

import pytest

from safer5.lab import generate_lab, validate_lab
from safer5.schemas import Event, LabConfig
from safer5.storage import Store


def test_seed_reproducibility_splits_and_truth_boundary(tmp_path):
    a = generate_lab(tmp_path / "a", LabConfig(seed=42, n_events=600))
    b = generate_lab(tmp_path / "b", LabConfig(seed=42, n_events=600))
    c = generate_lab(tmp_path / "c", LabConfig(seed=43, n_events=600))
    assert a["input_hash"] == b["input_hash"]
    assert a["input_hash"] != c["input_hash"]
    assert validate_lab(tmp_path / "a" / "manifest.json")["valid"]
    manifests = json.loads((tmp_path / "a" / "manifest.json").read_text())
    assert set(manifests["splits"]) == {"train", "validation", "test"}
    for split in manifests["splits"]:
        records = [json.loads(x) for x in (tmp_path / "a" / split / "events.jsonl").read_text().splitlines()]
        assert set(x["source_type"] for x in records) == {"auth", "audit", "dns"}
        assert all(not {"is_attack", "attack_step", "family", "malicious"} & x.keys() for x in records)
        assert all(Event.model_validate(x).event_time.utcoffset().total_seconds() == 0 for x in records)
    truth = json.loads((tmp_path / "a" / "test" / "truth.json").read_text())
    assert set(s["family"] for s in truth["steps"]) == {"account", "lateral", "exfiltration"}
    train_truth = json.loads((tmp_path / "a" / "train" / "truth.json").read_text())
    assert train_truth["steps"] == []


def test_storage_idempotency_bad_rows_and_pagination(tmp_path):
    store = Store(tmp_path / "managed")
    dataset = generate_lab(tmp_path / "lab", LabConfig(n_events=300))
    first = store.register_lab(tmp_path / "lab")
    second = store.register_lab(tmp_path / "lab")
    assert first["id"] == second["id"]
    assert len(store.datasets()) == 1
    page = store.events(first["id"], "test", limit=7)
    assert len(page["items"]) == 7
    assert page["total"] == dataset["splits"]["test"]["event_count"]
    before = hashlib.sha256((tmp_path / "lab" / "test" / "events.jsonl").read_bytes()).hexdigest()
    assert store.events(first["id"], "test", sources=["dns"], limit=4)["total"] > 0
    assert hashlib.sha256((tmp_path / "lab" / "test" / "events.jsonl").read_bytes()).hexdigest() == before
    content = json.dumps(page["items"][0]) + '\n{"bad":true}\nnot-json\n'
    imported = store.import_jsonl("yerel", content)
    assert imported["event_count"] == 1
    assert imported["rejected_count"] == 2
    assert store.import_jsonl("yerel", content)["id"] == imported["id"]
    assert list((store.root / "datasets" / imported["id"]).glob("quarantine*"))


def test_event_timezone_missing_values_and_bad_ids(tmp_path):
    raw = {"event_id": "a" * 32, "event_time": "2026-01-01T03:00:00+03:00", "source_type": "auth", "host_id": "h", "action": "login"}
    event = Event.model_validate(raw)
    assert event.event_time.hour == 0
    assert event.bytes_out is None
    with pytest.raises(ValueError):
        Event.model_validate({**raw, "event_time": "2026-01-01T00:00:00"})
    store = Store(tmp_path)
    with pytest.raises(ValueError):
        store.dataset_path("../../etc/passwd")
    with pytest.raises(ValueError):
        LabConfig(n_events=1000001)


def test_lab_organization_and_time_range_are_configurable(tmp_path):
    from datetime import datetime,timedelta
    from safer5.storage import read_jsonl
    config=LabConfig(n_events=300,users=12,hosts=7,start="2026-03-01T03:00:00+03:00",duration_hours=2)
    manifest=generate_lab(tmp_path,config)
    assert manifest["config"]["users"]==12 and manifest["config"]["hosts"]==7
    for index,split in enumerate(("train","validation","test")):
        start=datetime.fromisoformat("2026-03-01T00:00:00+00:00")+timedelta(days=2*index)
        events=list(read_jsonl(tmp_path / split / "events.jsonl"))
        assert all(start<=e.event_time<start+timedelta(hours=2) for e in events)
        assert all(int(e.host_id.split("-")[-1])<7 and int(e.user_id[1:])<12 for e in events)
    with pytest.raises(ValueError):
        LabConfig(hosts=2)
    import ipaddress
    generate_lab(tmp_path / "large-organization",LabConfig(n_events=300,hosts=256,users=256))
    for event in read_jsonl(tmp_path / "large-organization/test/events.jsonl"):
        assert ipaddress.ip_address(event.src_ip).is_private
