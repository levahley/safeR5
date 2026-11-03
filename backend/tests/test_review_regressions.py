from datetime import datetime, timedelta, timezone

from safer5.detection import ModelBundle, analyze
from safer5.jobs import JobManager
from safer5.schemas import Event
from safer5.storage import Store
from safer5.util import now


def auth(i, success=False, observed=None):
    return Event(event_id=f"{i:032x}", event_time=datetime(2026,1,1,tzinfo=timezone.utc)+timedelta(seconds=i),
                 observed_time=observed, source_type="auth",host_id="h",user_id="u",action="login",result="success" if success else "failure")


def test_auth_rule_requires_success_after_failures_with_sufficient_witness():
    bundle = ModelBundle({}, {}, {})
    reverse = [auth(1,True)] + [auth(i) for i in range(2,8)]
    assert not [a for a in analyze(reverse,bundle)["alerts"] if a["rule_id"]=="auth-burst"]
    events = [auth(i,True) for i in range(1,22)]+[auth(i) for i in range(22,28)]+[auth(28,True)]
    alert = next(a for a in analyze(events,bundle)["alerts"] if a["rule_id"]=="auth-burst")
    witness = [e for e in events if e.event_id in alert["evidence_ids"]]
    assert sum(e.result=="failure" for e in witness) >=5
    assert any(e.result=="success" and e.event_time>min(f.event_time for f in witness if f.result=="failure") for e in witness)


def test_valid_auth_trigger_survives_later_failures_and_unordered_input():
    events=[auth(i) for i in range(1,6)]+[auth(6,True)]+[auth(i) for i in range(7,33)]
    for sequence in (events,list(reversed(events))):
        result=analyze(sequence,ModelBundle({}, {}, {}))
        alarm=next((a for a in result["alerts"] if a["rule_id"]=="auth-burst"),None)
        assert alarm is not None
        assert {e.event_id for e in events[:6]}<=set(alarm["evidence_ids"])


def test_rule_does_not_claim_unrelated_event_as_support():
    events = [Event(event_id=f"{i:032x}",event_time="2026-01-01T00:00:00Z",source_type="audit",host_id="h",user_id="u",action="archive" if i<4 else "process_start") for i in range(1,5)]
    alert = next(a for a in analyze(events,ModelBundle({}, {}, {}))["alerts"] if a["rule_id"]=="audit-context")
    assert events[3].event_id not in alert["evidence_ids"]


def test_alert_cannot_predate_evidence_arrival():
    events = [auth(i, observed="2026-01-01T01:00:00Z") for i in range(1,7)]+[auth(7,True,observed="2026-01-01T01:00:00Z")]
    alert = next(a for a in analyze(events,ModelBundle({}, {}, {}))["alerts"] if a["rule_id"]=="auth-burst")
    assert datetime.fromisoformat(alert["event_time"])>=datetime.fromisoformat("2026-01-01T01:00:00+00:00")


def test_recovery_includes_active_jobs_older_than_ui_history(tmp_path):
    store = Store(tmp_path)
    old = {"id":"a"*32,"status":"running","updated_at":now()}
    store.put("jobs",old)
    for i in range(110):
        store.put("jobs",{"id":f"{i:032x}","status":"succeeded"})
    manager = JobManager(store,start=False)
    assert store.get("jobs",old["id"])["status"]=="interrupted"
    manager.close()


def test_history_uses_creation_time_after_metadata_recovery(tmp_path):
    store=Store(tmp_path)
    newer={"id":"a"*32,"created_at":"2026-02-01T00:00:00+00:00"}
    older={"id":"b"*32,"created_at":"2026-01-01T00:00:00+00:00"}
    store.put("experiments",newer)
    store.put("experiments",older)
    assert store.list("experiments")[0]["id"]==newer["id"]
