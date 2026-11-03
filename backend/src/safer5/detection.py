"""Frozen source-window models. No ground-truth dependency or identity features."""

from collections import Counter, defaultdict
from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.impute import SimpleImputer
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from .correlation import correlate
from .schemas import SOURCES
from .util import canonical, digest

FEATURE_VERSION = "window-300s-v1"
RULE_VERSION = "rules-v1"


def aggregate(events):
    windows, counts, evidence = {}, Counter(), {}
    hasher_parts = []
    for e in events:
        counts[e.source_type] += 1
        key = (e.source_type, e.host_id, e.user_id, int(e.event_time.timestamp() // 300))
        if key not in windows:
            windows[key] = {"count": 0, "failures": 0, "successes": 0, "privileged": 0,
                            "archive": 0, "remote": 0, "dns_length": 0., "bytes": 0., "destinations": set(),
                            "ids": [], "last": e.event_time.isoformat(), "events": [], "witnesses": defaultdict(list)}
        w = windows[key]
        w["count"] += 1
        w["failures"] += e.result == "failure"
        w["successes"] += e.result == "success"
        w["privileged"] += bool(e.privileged)
        w["archive"] += e.action == "archive"
        w["remote"] += e.action == "remote_exec"
        w["dns_length"] += len(e.dns_query or "")
        w["bytes"] += e.bytes_out or 0
        if e.dst_ip:
            w["destinations"].add(e.dst_ip)
        w["last"] = max(w["last"], max(e.event_time, e.observed_time or e.event_time).isoformat())
        categories = []
        if e.source_type == "auth":
            categories.append(e.result)
        if e.privileged:
            categories.append("privileged")
        if e.action in ("archive", "remote_exec"):
            categories.append(e.action)
        if len(e.dns_query or "") > 45:
            categories.append("long_dns")
        for category in categories:
            witness = w["witnesses"][category]
            witness.append(e)
            if category == "failure":
                witness.sort(key=lambda item:(item.event_time,item.event_id))
                del witness[5:]
            elif category == "success":
                witness.sort(key=lambda item:(item.event_time,item.event_id))
                del witness[:-1]
            elif len(witness) > 20:
                witness.pop(0)
        # Deterministic bounded sample. Retain diagnostically relevant records first.
        priority = (e.result == "failure" or bool(e.privileged) or e.action in ("archive", "remote_exec") or len(e.dns_query or "") > 45)
        if len(w["events"]) < 20:
            w["events"].append(e)
        elif priority:
            w["events"][-1] = e
        w["ids"] = [x.event_id for x in w["events"]]
        # Incremental canonical input checksum, O(1) additional memory.
        if not hasher_parts:
            import hashlib
            hasher_parts.append(hashlib.sha256())
        hasher_parts[0].update(canonical(e.model_dump(mode="json")).encode())
    for w in windows.values():
        for e in w["events"]:
            evidence[e.event_id] = e
        for items in w["witnesses"].values():
            for e in items:
                evidence[e.event_id] = e
    checksum = hasher_parts[0].hexdigest() if hasher_parts else digest([])
    return windows, counts, evidence, checksum


def features(window):
    n = window["count"]
    return [np.log1p(n), window["failures"] / n, window["privileged"] / n,
            window["archive"] / n, window["remote"] / n, window["dns_length"] / n,
            np.log1p(window["bytes"] / n), len(window["destinations"])]


@dataclass
class ModelBundle:
    models: dict
    thresholds: dict
    metadata: dict

    def manifest(self):
        return {**self.metadata, "thresholds": dict(self.thresholds)}


def fit_models(training, validation, seed):
    train, _, _, train_hash = aggregate(training)
    val, _, _, val_hash = aggregate(validation)
    models, thresholds = {}, {}
    for source in SOURCES:
        x = np.array([features(w) for key, w in train.items() if key[0] == source])
        calibration = np.array([features(w) for key, w in val.items() if key[0] == source])
        if len(x) < 8:
            continue
        pipeline = make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                                 IsolationForest(n_estimators=64, random_state=seed, n_jobs=1, contamination="auto"))
        pipeline.fit(x)
        # Quantile on a disjoint validation split, never perturbed/test data.
        scores = -pipeline.score_samples(calibration if len(calibration) else x)
        thresholds[source] = float(np.quantile(scores, .95))
        models[source] = pipeline
    import sklearn
    metadata = {"seed": seed, "feature_version": FEATURE_VERSION, "rule_version": RULE_VERSION,
                "training_hash": train_hash, "validation_hash": val_hash, "sklearn_version": sklearn.__version__,
                "score_policy": "source models; union of alerts; uncalibrated negative score_samples",
                "window_seconds": 300, "threshold_policy": "validation 95th percentile"}
    metadata["model_hash"] = digest({**metadata, "thresholds": thresholds,
        "trees": {s: digest([t.tree_.threshold.tolist() for t in p[-1].estimators_]) for s, p in models.items()}})
    return ModelBundle(models, thresholds, metadata)


def analyze(events, bundle):
    windows, counts, evidence, _ = aggregate(events)
    alerts = []
    scores = {}
    for source, pipeline in bundle.models.items():
        keys = [key for key in windows if key[0] == source]
        if keys:
            values = -pipeline.score_samples(np.array([features(windows[key]) for key in keys]))
            scores.update(zip(keys, map(float, values)))

    def alert(key, w, method, rule, message, score=None, witness=None):
        ids = list(dict.fromkeys(e.event_id for e in witness))[:20] if witness is not None else w["ids"][:20]
        alerts.append({"id": digest([key, method, rule, ids])[:32], "method": method, "rule_id": rule,
                       "message": message, "severity": "high" if method == "rules" else "medium",
                       "evidence_ids": ids, "host_id": key[1], "user_id": key[2], "event_time": w["last"], "score": score})

    auth_groups = defaultdict(list)
    for key, w in sorted(windows.items(), key=lambda item: str(item[0])):
        source = key[0]
        if source == "auth":
            auth_groups[(key[2], key[3])].append((key, w))
            for success in sorted(w["witnesses"]["success"], key=lambda e:e.event_time):
                failures = sorted((e for e in w["witnesses"]["failure"] if e.event_time < success.event_time), key=lambda e:e.event_time)
                if len(failures) >= 5:
                    alert(key, w, "rules", "auth-burst", "En az beş başarısız girişin ardından aynı pencerede başarılı giriş gözlendi.", witness=failures[:5]+[success])
                    break
        if source == "audit" and (w["privileged"] >= 2 or w["remote"] >= 2 or w["archive"] >= 3):
            witness = []
            for category, minimum in (("privileged",2),("remote_exec",2),("archive",3)):
                if len(w["witnesses"][category]) >= minimum:
                    witness.extend(w["witnesses"][category][:minimum])
            alert(key, w, "rules", "audit-context", "Ayrıcalıklı işlem, uzak çalıştırma veya toplu arşivleme örüntüsü; normal bakım da olabilir.",witness=witness)
        if source == "dns" and len(w["witnesses"]["long_dns"]) >= 8:
            alert(key, w, "rules", "dns-pattern", "En az sekiz uzun sorgu adıyla yoğun DNS örüntüsü; tek başına veri sızıntısı kanıtı değildir.",witness=w["witnesses"]["long_dns"][:8])
        if source in bundle.models:
            score = scores[key]
            if score > bundle.thresholds[source]:
                alert(key, w, "iforest", "source-window", "Bu kaynak/zaman penceresi normal eğitim örüntülerinden ayrılıyor; skor olasılık değildir.", score)
    for groups in auth_groups.values():
        if len({key[1] for key, w in groups}) >= 3:
            # Each host has its own observed evidence; no cross-host causal assertion.
            for key, w in groups:
                alert(key, w, "rules", "multi-target", "Aynı kullanıcı kısa sürede birden çok host üzerinde oturum açtı; bağlam incelenmeli.")
    incidents, graph = correlate(alerts, evidence.values())
    return {"event_count": sum(counts.values()), "source_counts": {s: counts[s] for s in SOURCES},
            "alerts": alerts, "incidents": incidents, "graph": graph,
            "source_health": {s: "observed" if counts[s] else "missing" for s in SOURCES}}
