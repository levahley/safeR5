"""Seeded synthetic organization; answer files never enter event fields."""

import json
import random
from datetime import datetime, timedelta
from pathlib import Path

from .schemas import Event, LabConfig, SOURCES
from .util import atomic_json, canonical, digest, file_hash


def generate_lab(root: Path, config: LabConfig):
    root.mkdir(parents=True, exist_ok=True)
    manifest = {"generator_version": "1", "profile": config.profile, "seed": config.seed,
                "config": config.model_dump(mode="json"), "splits": {}, "synthetic": True}
    for number, split in enumerate(("train", "validation", "test")):
        rng = random.Random(config.seed + number * 100003)
        base = config.start + timedelta(days=number * 2)
        duration_seconds = config.duration_hours * 3600
        directory = root / split
        directory.mkdir(exist_ok=True)
        events, steps = [], []
        users = [f"u{i:02d}" for i in range(config.users)]
        hosts = [f"node-{i:02d}" for i in range(config.hosts)]

        def record(source, seconds, host=None, user=None, **kwargs):
            host, user = host or rng.choice(hosts), user or rng.choice(users)
            t = base + timedelta(seconds=seconds)
            item = {"event_time": t.isoformat(), "source_type": source, "host_id": host,
                    "user_id": user, "session_id": f"s-{digest([host, user, int(seconds // 300)])[:16]}",
                    "event_type": {"auth": "authentication", "audit": "process", "dns": "query"}[source],
                    "action": {"auth": "login", "audit": "process_start", "dns": "dns_query"}[source],
                    "result": "success", "src_ip": f"10.20.{hosts.index(host)//240}.{hosts.index(host)%240 + 10}"}
            if source == "auth":
                item["result"] = "failure" if rng.random() < 0.09 else "success"
                item["dst_ip"] = f"10.30.0.{rng.randint(10, 14)}"
            elif source == "audit":
                item.update(process_id=rng.randint(1000, 5000), parent_process_id=rng.randint(100, 800),
                            process_start_time=t.isoformat(), privileged=rng.random() < 0.015)
                item["action"] = rng.choice(["process_start"] * 8 + ["backup", "update", "archive"])
            else:
                item["dns_query"] = rng.choice(["api", "backup", "updates", "cdn", "service"]) + ".example.test"
                item["bytes_out"] = rng.randint(40, 900)
            item.update(kwargs)
            item["event_id"] = digest([config.seed, split, len(events), item])[:32]
            events.append(item)
            return item

        if split != "train" and config.include_attacks:
            for family_index, family in enumerate(("account", "lateral", "exfiltration")):
                start = int(duration_seconds * (1/6 + family_index/4)) + rng.randint(0, 60)
                host, user = rng.choice(hosts), rng.choice(users)
                session = "s-" + digest([config.seed, split, family_index, start])[:16]

                def step(source, items):
                    steps.append({"id": digest([split, family, source, config.seed])[:32], "family": family,
                                  "host_id": host, "user_id": user, "start": items[0]["event_time"],
                                  "end": items[-1]["event_time"], "event_ids": [x["event_id"] for x in items]})

                if family == "account":
                    items = [record("auth", start + i * 5, host, user, result="failure", session_id=session) for i in range(8)]
                    items.append(record("auth", start + 45, host, user, result="success", session_id=session))
                    step("auth", items)
                    step("audit", [record("audit", start + 50 + i * 5, host, user, action="privilege", privileged=True, session_id=session) for i in range(2)])
                elif family == "lateral":
                    step("auth", [record("auth", start + i * 15, hosts[i], user, session_id=session) for i in range(4)])
                    step("audit", [record("audit", start + 65 + i * 5, host, user, action="remote_exec", privileged=True, session_id=session) for i in range(3)])
                else:
                    step("audit", [record("audit", start + i * 4, host, user, action="archive", session_id=session) for i in range(3)])
                    items = [record("dns", start + 20 + i * 3, host, user,
                                    dns_query="".join(rng.choices("abcdef0123456789", k=rng.randint(50, 80))) + ".example.test",
                                    bytes_out=rng.randint(900, 1800), session_id=session) for i in range(14)]
                    step("dns", items)
        # Hard negatives: legitimate maintenance and bulk DNS share the attack feature space.
        host, user = rng.choice(hosts), rng.choice(users)
        nuisance = int(duration_seconds * (5/12)) + rng.randint(0, 30)
        session = "s-" + digest([config.seed, split, nuisance, "session"] )[:16]
        for i in range(3):
            record("auth", nuisance + i * 8, host, user, result="failure", session_id=session)
        record("auth", nuisance + 30, host, user, result="success", session_id=session)
        for i in range(3):
            record("audit", nuisance + 35 + i * 3, host, user, action="archive", privileged=i < 2, session_id=session)
        for i in range(12):
            record("dns", nuisance + 50 + i * 2, host, user, session_id=session,
                   dns_query="".join(rng.choices("abcdef0123456789", k=55)) + ".updates.example.test", bytes_out=1200)
        remaining = config.n_events - len(events)
        for i in range(remaining):
            source = SOURCES[i % 3]
            seconds = rng.uniform(0, duration_seconds)
            # Realistic nuisance variation shares identities and actions with injected behavior.
            record(source, seconds)
        events.sort(key=lambda x: (x["event_time"], x["event_id"]))
        file_id = digest([config.seed, split, "source-v1"])
        raw_path = directory / "raw.jsonl"
        with raw_path.open("w", encoding="utf-8") as stream:
            for event in events:
                stream.write(canonical(event) + "\n")
        checksum = file_hash(raw_path)
        counts = dict.fromkeys(SOURCES, 0)
        with (directory / "events.jsonl").open("w", encoding="utf-8") as stream:
            for line, item in enumerate(events, 1):
                event = Event.model_validate({**item, "raw_ref": {"file_id": file_id, "line": line, "sha256": checksum}})
                stream.write(canonical(event.model_dump(mode="json")) + "\n")
                counts[event.source_type] += 1
        attack_ids = {event_id for step in steps for event_id in step["event_ids"]}
        attack_windows = sorted({(e["source_type"],e["host_id"],e["user_id"],int(datetime.fromisoformat(e["event_time"]).timestamp()//300)) for e in events if e["event_id"] in attack_ids})
        atomic_json(directory / "truth.json", {"steps": steps, "normal_event_ids": [e["event_id"] for e in events if e["event_id"] not in attack_ids], "attack_windows":attack_windows,"coverage": "complete_synthetic"})
        manifest["splits"][split] = {"event_count": len(events), "source_counts": counts,
            "events_hash": file_hash(directory / "events.jsonl"), "raw_hash": checksum, "file_id": file_id}
    manifest["input_hash"] = digest(manifest["splits"])
    manifest["event_count"] = sum(x["event_count"] for x in manifest["splits"].values())
    manifest["source_counts"] = {s: sum(x["source_counts"][s] for x in manifest["splits"].values()) for s in SOURCES}
    atomic_json(root / "manifest.json", manifest)
    return manifest


def validate_lab(path):
    path = Path(path)
    manifest = json.loads(path.read_text())
    issues = []
    for split, info in manifest["splits"].items():
        directory = path.parent / split
        if file_hash(directory / "events.jsonl") != info["events_hash"]:
            issues.append(f"{split}: events checksum")
        if file_hash(directory / "raw.jsonl") != info["raw_hash"]:
            issues.append(f"{split}: raw checksum")
        ids = set()
        with (directory / "events.jsonl").open() as stream:
            for line in stream:
                event = Event.model_validate_json(line)
                if event.event_id in ids:
                    issues.append(f"{split}: duplicate event")
                ids.add(event.event_id)
        truth = json.loads((directory / "truth.json").read_text())
        for step in truth["steps"]:
            if not set(step["event_ids"]) <= ids:
                issues.append(f"{split}: truth mismatch")
    return {"valid": not issues, "issues": issues, "input_hash": manifest["input_hash"]}
