"""Evaluator alone may consume answers. Invisible steps stay in the denominator."""

from datetime import datetime
from statistics import mean


def evaluate(events, alerts, truth):
    # A compact ID/time/entity projection avoids retaining raw log contents.
    observed = {e.event_id: (e.host_id, e.user_id, e.event_time, (e.source_type,e.host_id,e.user_id,int(e.event_time.timestamp()//300))) for e in events}
    base = {"alerts_total": len(alerts), "steps_detected": 0, "steps_total": 0,
            "false_positives": 0, "normal_events": 0, "attack_step_recall": None,
            "false_positive_rate": None, "evidence_coverage": None, "detection_delay_seconds": None,
            "false_positive_windows":0,"normal_windows":0,"evidence_flag_rate":None,
            "status": "empty" if not observed else "measured"}
    if truth is None:
        return {**base, "status": "no_ground_truth"}
    steps = truth.get("steps", [])
    normal = set(truth.get("normal_event_ids", []))
    flagged = {eid for alert in alerts for eid in alert["evidence_ids"] if eid in observed}
    detected, visible, delays = 0, 0, []
    for step in steps:
        ids = set(step["event_ids"])
        visible += bool(ids & observed.keys())
        matches = []
        for alert in alerts:
            evidence = ids & set(alert["evidence_ids"]) & observed.keys()
            # Matched evidence must have this step's user; host may differ for lateral movement.
            evidence = {eid for eid in evidence if observed[eid][1] == step.get("user_id")}
            if evidence and datetime.fromisoformat(alert["event_time"]) >= datetime.fromisoformat(step["start"]):
                matches.append(alert)
        if matches:
            detected += 1
            earliest = min(datetime.fromisoformat(a["event_time"]) for a in matches)
            delays.append(max(0., (earliest - datetime.fromisoformat(step["start"])).total_seconds()))
    false = len(flagged & normal)
    normal_count = len(normal & observed.keys())
    windows = {}
    for eid, value in observed.items():
        windows.setdefault(value[3],set()).add(eid)
    attack_windows = {tuple(k) for k in truth.get("attack_windows", [])}
    normal_windows = {key for key,ids in windows.items() if ids <= normal and key not in attack_windows}
    flagged_windows = {observed[eid][3] for eid in flagged}
    false_windows = len(flagged_windows & normal_windows)
    return {**base, "steps_detected": detected, "steps_total": len(steps), "false_positives": false,
            "normal_events": normal_count, "attack_step_recall": detected / len(steps) if steps else None,
            "false_positive_rate": false_windows / len(normal_windows) if normal_windows else None,
            "false_positive_windows":false_windows,"normal_windows":len(normal_windows),
            "evidence_flag_rate":false/normal_count if normal_count else None,
            "evidence_coverage": visible / len(steps) if steps else None,
            "detection_delay_seconds": mean(delays) if delays else None}
