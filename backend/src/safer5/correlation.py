"""Bounded observed-evidence graph. Shared IP or PID does not imply a cause."""

from collections import defaultdict
from datetime import datetime

import networkx as nx

from .util import digest


def correlate(alerts, events):
    by_id = {e.event_id: e for e in events}
    graph, buckets = nx.DiGraph(), defaultdict(list)
    for alert in alerts:
        # A case is an entity/time grouping, never a claim of attribution.
        window = int(datetime.fromisoformat(alert["event_time"]).timestamp() // 300)
        buckets[(alert["host_id"], alert["user_id"], window)].append(alert)
    incidents = []
    for (host, user, _), group in buckets.items():
        ids = sorted({eid for a in group for eid in a["evidence_ids"] if eid in by_id})
        incidents.append({"id": digest([a["id"] for a in group])[:32], "alert_ids": [a["id"] for a in group],
                          "evidence_ids": ids, "host_id": host, "user_id": user,
                          "start": min(a["event_time"] for a in group), "end": max(a["event_time"] for a in group),
                          "summary": "Gözlenen delillere göre aynı varlık ve zaman penceresindeki şüpheli örüntüler."})
    evidence = sorted({eid for a in alerts for eid in a["evidence_ids"] if eid in by_id})[:120]
    for eid in evidence:
        e = by_id[eid]
        graph.add_node(eid, label=f"{e.source_type} · {e.action}", kind="event")
        host = "host:" + e.host_id
        graph.add_node(host, label=e.host_id, kind="host")
        graph.add_edge(host, eid, relation="observed_on", evidence_ids=[eid], uncertainty="Gözlenen kayıt; nedensellik iddiası yok.")
        if e.session_id:
            # Host scopes sessions, preventing cross-host PID/session reuse merging.
            sid = "session:" + digest([e.host_id, e.user_id, e.session_id])[:20]
            graph.add_node(sid, label=e.session_id, kind="session")
            graph.add_edge(sid, eid, relation="same_observed_session", evidence_ids=[eid], uncertainty="Kayıtta belirtilen oturum ilişkisi.")
    return incidents, {"nodes": [{"id": n, **attrs} for n, attrs in graph.nodes(data=True)],
                       "edges": [{"source": u, "target": v, **attrs} for u, v, attrs in graph.edges(data=True)]}
