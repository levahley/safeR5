"""Read-only, bounded event neighborhoods for an existing experiment."""

from collections import defaultdict
from datetime import timedelta

import duckdb

from .schemas import Event
from .storage import EVENT_TIME, event_selection, experiment_event_scope
from .util import digest
from .wire import EventMap, MapEdge, MapFocus, MapNode

CONTEXT_SECONDS = 120
RECORD_LIMIT = 24
ENTITY_LIMITS = {"host": 4, "user": 4, "session": 4, "process": 6}
SOURCE_ANGLES = {"auth": -90, "audit": 30, "dns": 150}
RISK_ORDER = {"unflagged": 0, "medium": 1, "high": 2}


def event_records(db, selection, ids=None, limit=RECORD_LIMIT, latest=False):
    base, params = selection
    if ids is not None:
        base += " AND event_id = ANY(?)"
        params = params + [ids]
    order = "DESC" if latest else "ASC"
    rows = db.execute(f"SELECT record{base} ORDER BY {EVENT_TIME} {order}, event_id LIMIT ?", params + [limit])
    return [Event.model_validate_json(row[0]) for row in rows.fetchall()]


def context_records(db, selection, reference, witness_ids):
    base, params = selection
    time = reference.event_time
    span = timedelta(seconds=CONTEXT_SECONDS)
    rows = db.execute(
        f"""SELECT record{base}
        AND (event_id = ANY(?) OR {EVENT_TIME} BETWEEN ? AND ?)
        ORDER BY CASE WHEN event_id = ANY(?) THEN 0
                      WHEN host_id = ? AND user_id IS NOT DISTINCT FROM ?
                           AND json_extract_string(record, '$.session_id') = ? THEN 1
                      WHEN host_id = ? AND user_id IS NOT DISTINCT FROM ? THEN 2
                      WHEN host_id = ? THEN 3 ELSE 4 END,
                 ABS(date_diff('microseconds', {EVENT_TIME}, ?)), event_id LIMIT ?""",
        params + [witness_ids, time - span, time + span, witness_ids, reference.host_id, reference.user_id,
                  reference.session_id, reference.host_id, reference.user_id, reference.host_id, time, RECORD_LIMIT],
    )
    return [Event.model_validate_json(row[0]) for row in rows.fetchall()]


def session_key(event):
    return (event.host_id, event.user_id, event.session_id) if event.session_id else None


def entities(event):
    yield ("host", event.host_id, event.host_id, "observed_on")
    if event.user_id:
        yield ("user", event.user_id, event.user_id, "observed_user")
    if key := session_key(event):
        yield ("session", key, event.session_id, "observed_session")
    if event.process_id is not None:
        # A PID is reusable. Without its start time, limit the process identity to this record.
        key = (event.host_id, event.process_id,
               event.process_start_time.isoformat() if event.process_start_time else event.event_id)
        yield ("process", key, f"PID {event.process_id}", "recorded_process")


def risk_by_event(alerts, record_ids):
    risks = {}
    for alert in alerts:
        severity = alert["severity"]
        for event_id in alert["evidence_ids"]:
            if event_id in record_ids and RISK_ORDER[severity] > RISK_ORDER[risks.get(event_id, "unflagged")]:
                risks[event_id] = severity
    return risks


def make_graph(focus, alarm, reference, records, observed, alerts, observed_alerts, view):
    observed_ids = set(observed)
    visible = {event.event_id: event for event in records} if view == "baseline" else observed
    risks = risk_by_event(alerts, visible)
    is_alarm = focus.kind == "alert"
    center_id = f"{focus.kind}:{focus.id}"
    center_missing = focus.id not in (observed_alerts if is_alarm else observed_ids)

    # Assign angles before removing missing records, so surviving nodes never move between views.
    outer = defaultdict(list)
    memberships, descriptions, counts = defaultdict(list), {}, defaultdict(int)
    for event in records:
        if is_alarm or event.event_id != focus.id:
            outer[event.source_type].append(event)
        for kind, key, label, relation in entities(event):
            node_id = f"{kind}:{digest(key)[:32]}"
            if node_id not in descriptions:
                if counts[kind] >= ENTITY_LIMITS[kind]:
                    continue
                descriptions[node_id] = (kind, label, relation)
                counts[kind] += 1
            memberships[node_id].append(event.event_id)

    nodes, edges = [], []

    def add_event(event, angle=None, lane=0):
        nodes.append(MapNode(id=f"event:{event.event_id}", kind="event", label=event.action,
                             angle=angle, lane=lane, time=event.event_time.isoformat(), sources=[event.source_type],
                             risk=risks.get(event.event_id, "unflagged"), event_id=event.event_id,
                             evidence_ids=[event.event_id], missing=event.event_id not in observed_ids))
        if angle is None:
            return
        distance = None
        event_ids = [event.event_id]
        if is_alarm and event.event_id in alarm["evidence_ids"]:
            relation = "alarm_evidence"
        else:
            if reference.event_id not in visible:
                return
            relation = "observed_session" if session_key(reference) and session_key(event) == session_key(reference) else "time_proximity"
            event_ids.append(reference.event_id)
            if relation == "time_proximity":
                distance = abs((event.event_time - reference.event_time).total_seconds())
        edges.append(MapEdge(source=center_id, target=f"event:{event.event_id}", relation=relation,
                             evidence_ids=event_ids, distance_seconds=distance,
                             missing=center_missing or any(event_id not in observed_ids for event_id in event_ids)))

    if is_alarm:
        witnesses = [eid for eid in alarm["evidence_ids"] if eid in visible]
        nodes.append(MapNode(id=center_id, kind="alert", label=alarm["rule_id"], angle=None,
                             time=alarm["event_time"], sources=sorted({visible[eid].source_type for eid in witnesses}),
                             risk=alarm["severity"], evidence_ids=witnesses, missing=center_missing,
                             message=alarm["message"]))
    else:
        add_event(visible[focus.id])

    for source, center_angle in SOURCE_ANGLES.items():
        ring = outer[source]
        for index, event in enumerate(ring):
            if event.event_id in visible:
                # Each log source occupies a fixed 120-degree sector with space between sectors.
                angle = center_angle + 100 * ((index + 0.5) / len(ring) - 0.5)
                lane = (-1, 1)[index % 2] if len(ring) > 10 else 0
                add_event(visible[event.event_id], angle, lane)

    for index, (node_id, (kind, label, relation)) in enumerate(descriptions.items()):
        supporting = [eid for eid in memberships[node_id] if eid in visible]
        if not supporting:
            continue
        records_for_entity = [visible[eid] for eid in supporting]
        nodes.append(MapNode(
            id=node_id, kind=kind, label=label, angle=-90 + 360 * index / len(descriptions),
            time=max(event.event_time for event in records_for_entity).isoformat(),
            sources=sorted({event.source_type for event in records_for_entity}),
            risk=max((risks.get(eid, "unflagged") for eid in supporting), key=RISK_ORDER.__getitem__),
            evidence_ids=supporting, missing=observed_ids.isdisjoint(supporting),
        ))
        for eid in supporting:
            edges.append(MapEdge(source=node_id, target=f"event:{eid}", relation=relation,
                                 evidence_ids=[eid], missing=eid not in observed_ids))
    return EventMap(status="ready", focus=focus, nodes=nodes, edges=edges)


def build_event_map(store, result, view, focus, source, q, start, end):
    scopes = {side: experiment_event_scope(store, result, side) for side in ("baseline", "perturbed")}
    unfiltered = {side: event_selection(*scope) for side, scope in scopes.items()}
    filtered = {
        side: event_selection(*experiment_event_scope(store, result, side, source), q, start, end)
        for side in scopes
    }
    alerts = {side: {alert["id"]: alert for alert in result[side]["alerts"]} for side in scopes}
    other = "perturbed" if view == "baseline" else "baseline"
    has_filters = bool(source or q or start or end)

    with duckdb.connect(config={"threads": 1, "memory_limit": "256MB"}) as db:
        if focus is None:
            # Prefer an alarm shared by both results, then a matching retained record.
            shared_alarm = next((alert for alert in alerts["perturbed"].values()
                                 if alert["id"] in alerts["baseline"] and alert["severity"] == "high"
                                 and alert["evidence_ids"]), None) if not has_filters else None
            if shared_alarm:
                focus = MapFocus(kind="alert", id=shared_alarm["id"])
            else:
                first = event_records(db, filtered["perturbed"], limit=1)
                if not first and view == "baseline":
                    first = event_records(db, filtered["baseline"], limit=1)
                if not first:
                    return EventMap(status="empty", focus=None, nodes=[], edges=[])
                focus = MapFocus(kind="event", id=first[0].event_id)

        alarm = None
        if focus.kind == "alert":
            alarm = alerts[view].get(focus.id)
            if alarm is None:
                if focus.id not in alerts[other]:
                    raise FileNotFoundError()
                return EventMap(status="missing", focus=focus, nodes=[], edges=[])
            witnesses = alarm["evidence_ids"]
            anchor_rows = event_records(db, filtered[view], witnesses, limit=1, latest=True)
            if has_filters and not anchor_rows:
                return EventMap(status="filtered", focus=focus, nodes=[], edges=[])
            reference = anchor_rows[0] if anchor_rows else None
        else:
            witnesses = [focus.id]
            found = event_records(db, unfiltered[view], witnesses, limit=1)
            if not found:
                if not event_records(db, unfiltered[other], witnesses, limit=1):
                    raise FileNotFoundError()
                return EventMap(status="missing", focus=focus, nodes=[], edges=[])
            reference = found[0]
            if has_filters and not event_records(db, filtered[view], witnesses, limit=1):
                return EventMap(status="filtered", focus=focus, nodes=[], edges=[])

        # The baseline supplies shared geometry. Lossy details are read only from observed Parquet.
        records = context_records(db, filtered["baseline"], reference, witnesses) if reference else []
        observed_records = event_records(db, unfiltered["perturbed"], [event.event_id for event in records])
        observed = {event.event_id: event for event in observed_records}

    # Alerts with no available witness can still serve as a center without any surrounding records.
    return make_graph(focus, alarm, reference, records, observed, alerts[view].values(), alerts["perturbed"], view)
