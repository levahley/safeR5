from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from safer5.api import create_app
from test_api_jobs import wait_job


def test_dns_outage_keeps_shared_event_positions_and_scopes_raw_evidence(tmp_path):
    with TestClient(create_app(tmp_path)) as client:
        dataset = wait_job(client, client.post("/api/v1/lab/generate", json={"n_events": 300}).json()["id"])
        job = client.post("/api/v1/experiments", json={
            "dataset_id": dataset["result_id"], "sources": ["auth", "audit", "dns"],
            "loss": {"kind": "source", "source": "dns"},
        }).json()
        run = wait_job(client, job["id"])
        assert run["status"] == "succeeded", run
        experiment = "/api/v1/experiments/" + run["result_id"]
        result = client.get(experiment).json()
        complete = client.get(experiment + "/events", params={"view": "baseline", "limit": 300}).json()
        reduced = client.get(experiment + "/events", params={"limit": 300}).json()
        assert complete["total"] == 300 == result["baseline"]["event_count"]
        assert reduced["total"] == result["perturbed"]["event_count"] < 300
        assert result["perturbed"]["metrics"]["alerts_total"] == len(result["perturbed"]["alerts"])
        assert all(event["source_type"] != "dns" for event in reduced["items"])

        # The generator creates a benign clustered maintenance session with all three sources.
        dns = next(event for event in complete["items"] if (event["dns_query"] or "").endswith(".updates.example.test"))
        auth = next(event for event in complete["items"] if event["session_id"] == dns["session_id"] and event["source_type"] == "auth")
        assert set(complete["missing_event_ids"]) == {e["event_id"] for e in complete["items"] if e["source_type"] == "dns"}
        assert reduced["missing_event_ids"] == []
        focus = {"focus_kind": "event", "focus_id": auth["event_id"]}
        before = client.get(experiment + "/event-map", params={**focus, "view": "baseline"}).json()
        after = client.get(experiment + "/event-map", params=focus).json()
        assert before["status"] == after["status"] == "ready"
        full_nodes = {n["id"]: n for n in before["nodes"]}
        kept_nodes = {n["id"]: n for n in after["nodes"]}
        dns_node = next(n for n in before["nodes"] if n["event_id"] == dns["event_id"])
        assert dns_node["missing"] and dns_node["id"] not in kept_nodes
        assert before["focus"] == after["focus"] == {"kind": "event", "id": auth["event_id"]}
        assert any(n["kind"] == "process" for n in after["nodes"])
        assert {n["kind"] for n in after["nodes"]} >= {"event", "host", "user", "session", "process"}
        assert all(
            (full_nodes[key]["angle"], full_nodes[key]["lane"]) == (node["angle"], node["lane"])
            for key, node in kept_nodes.items()
        )
        assert all("dns" not in n["sources"] and not n["missing"] for n in after["nodes"])
        assert all(edge["source"] in kept_nodes and edge["target"] in kept_nodes for edge in after["edges"])
        assert all(dns["event_id"] not in edge["evidence_ids"] for edge in after["edges"])
        assert any(edge["missing"] and dns["event_id"] in edge["evidence_ids"] for edge in before["edges"])
        by_id = {event["event_id"]: event for event in complete["items"]}
        assert any(edge["relation"] == "observed_session" and dns["event_id"] in edge["evidence_ids"] for edge in before["edges"])
        possible_edges = [edge for edge in before["edges"] if edge["relation"] == "time_proximity"]
        assert possible_edges
        for edge in possible_edges:
            event_id, reference_id = edge["evidence_ids"]
            left, right = by_id[event_id], by_id[reference_id]
            distance = abs((datetime.fromisoformat(left["event_time"]) - datetime.fromisoformat(right["event_time"])).total_seconds())
            assert distance == edge["distance_seconds"] <= 120
            assert left["session_id"] != right["session_id"]

        missing = client.get(experiment + "/event-map", params={"focus_kind": "event", "focus_id": dns["event_id"]}).json()
        assert missing == {"status": "missing", "focus": {"kind": "event", "id": dns["event_id"]}, "nodes": [], "edges": []}
        dns_alert = next(a for a in result["baseline"]["alerts"] if a["rule_id"] == "dns-pattern")
        alarm_focus = {"focus_kind": "alert", "focus_id": dns_alert["id"]}
        alert_map = client.get(experiment + "/event-map", params={**alarm_focus, "view": "baseline"}).json()
        assert alert_map["nodes"][0]["kind"] == "alert" and alert_map["nodes"][0]["missing"]
        assert any(edge["relation"] == "alarm_evidence" and edge["missing"] for edge in alert_map["edges"])
        assert client.get(experiment + "/event-map", params=alarm_focus).json()["status"] == "missing"
        for event in (dns, auth):
            response = client.get(experiment + "/evidence", params={"view": "baseline", "event_id": event["event_id"]})
            assert response.status_code == 200
            assert event["event_id"] in response.json()["raw"]
        assert client.get(experiment + "/evidence", params={"event_id": dns["event_id"]}).status_code == 404
        assert client.get(experiment + "/evidence", params={"event_id": auth["event_id"]}).status_code == 200

        # An alarm neighborhood uses a witness inside the filter as its time and session reference.
        auth_alarm = next(a for a in result["perturbed"]["alerts"] if a["rule_id"] == "auth-burst")
        witness_order = sorted(auth_alarm["evidence_ids"], key=lambda eid: by_id[eid]["event_time"])
        greatest, expected_reference = witness_order[-1], witness_order[-2]
        alarm_filters = {"focus_kind": "alert", "focus_id": auth_alarm["id"], "end": by_id[greatest]["event_time"]}
        for view in ("baseline", "perturbed"):
            filtered_alarm = client.get(experiment + "/event-map", params={**alarm_filters, "view": view}).json()
            visible = {node["event_id"] for node in filtered_alarm["nodes"]}
            assert greatest not in visible
            contexts = [edge for edge in filtered_alarm["edges"]
                        if edge["source"] == f"alert:{auth_alarm['id']}" and edge["relation"] != "alarm_evidence"]
            assert contexts
            assert all(expected_reference in edge["evidence_ids"] and set(edge["evidence_ids"]) <= visible for edge in contexts)

        start = datetime.fromisoformat(auth["event_time"])
        end = start + timedelta(seconds=1)
        filters = {"source": "auth", "q": auth["event_id"], "start": start.isoformat(), "end": end.isoformat()}
        filtered_page = client.get(experiment + "/events", params=filters).json()
        filtered_map = client.get(experiment + "/event-map", params=filters).json()
        assert [e["event_id"] for e in filtered_page["items"]] == [auth["event_id"]]
        assert {n["event_id"] for n in filtered_map["nodes"] if n["kind"] == "event"} == {auth["event_id"]}
        assert client.get(experiment + "/events", params={"end": start.isoformat(), "q": auth["event_id"]}).json()["total"] == 0
        assert client.get(experiment + "/events", params={"start": end.isoformat(), "end": start.isoformat()}).status_code == 422

        scoped_job = client.post("/api/v1/experiments", json={"dataset_id": dataset["result_id"], "sources": ["auth"]}).json()
        scoped = "/api/v1/experiments/" + wait_job(client, scoped_job["id"])["result_id"]
        assert client.get(scoped + "/events", params={"view": "baseline", "source": "dns"}).json()["total"] == 0
        assert client.get(scoped + "/evidence", params={"view": "baseline", "event_id": dns["event_id"]}).status_code == 404
