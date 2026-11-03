"""Archive boundary and original-line attribution tests, using small handmade data."""

import hashlib
import json
import stat
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from safer5.ait import import_ait_archive


def archive_at(tmp_path, members):
    archive = tmp_path / "input.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as handle:
        for name, value in members.items():
            handle.writestr(name, value)
    return archive


def records(path):
    return [json.loads(line) for line in Path(path).read_text().splitlines()]


def test_maps_labels_before_dropping_bad_or_out_of_window_lines(tmp_path):
    # Removing original-line mapping would attribute line 3's attack to line 2.
    raw = (
        "not a parseable log\n"
        "2022-01-24T03:00:00Z server sshd[22]: Accepted password for alice from 192.0.2.1 port 22 ssh2\n"
        "2022-01-24T03:01:00Z server sshd[23]: Failed password for alice from 192.0.2.2 port 22 ssh2\n"
        "2022-01-26T03:01:00Z server sshd[24]: Accepted password for alice from 192.0.2.1 port 22 ssh2\n"
    )
    archive = archive_at(tmp_path, {
        "russellmitchell/dataset.yml": "start: 2022-01-21T00:00:00Z\nend: 2022-01-25T00:00:00Z\n",
        "russellmitchell/gather/server/logs/auth.log": raw,
        "russellmitchell/labels/server/logs/auth.log": json.dumps(
            {"line": 3, "labels": ["password_attack"], "rules": {"password_attack": ["answer"]}}
        ) + "\n",
    })
    before = archive.read_bytes()
    manifest = import_ait_archive(archive, tmp_path / "result")
    events, truth = records(manifest["events_path"]), records(manifest["truth_path"])
    assert [event["raw_ref"]["line"] for event in events] == [2, 3]
    assert [row["is_attack"] for row in truth] == [False, True]
    assert truth[1]["labels"] == ["password_attack"]
    assert events[0]["result"] == "success"
    assert events[1]["result"] == "failure"
    assert events[0]["src_ip"] == "192.0.2.1"
    assert events[0]["raw_ref"]["sha256"] == hashlib.sha256(raw.encode()).hexdigest()
    assert archive.read_bytes() == before
    assert manifest["archive"]["sha256"] == hashlib.sha256(before).hexdigest()
    assert not any(key in event for event in events for key in ("labels", "is_attack", "rules"))
    assert "password_attack" not in Path(manifest["events_path"]).read_text()
    assert manifest["diagnostics"]["unparsed_lines"] == 1
    assert manifest["diagnostics"]["outside_window_events"] == 1
    assert manifest["simulation_window"] == ["2022-01-21T00:00:00Z", "2022-01-25T00:00:00Z"]


def test_groups_audit_records_by_file_and_audit_id_with_all_refs(tmp_path):
    # Grouping only contiguous rows loses EXECVE evidence and line 3's label.
    raw = (
        'type=SYSCALL msg=audit(1642999060.603:2226): arch=c000003e syscall=59 success=yes pid=27950 ppid=12 uid=33 euid=0 ses=9\n'
        'type=USER_AUTH msg=audit(1642999060.604:2227): pid=18 uid=33 ses=10 res=failed\n'
        'type=EXECVE msg=audit(1642999060.603:2226): argc=1 a0="/bin/su"\n'
    )
    archive = archive_at(tmp_path, {
        "gather/intranet/logs/audit/audit.log": raw,
        "labels/intranet/logs/audit/audit.log": '{"line":3,"labels":["escalate"],"rules":{}}\n',
        "gather/intranet/logs/audit/audit.log.1": raw.splitlines()[0] + "\n",
    })
    manifest = import_ait_archive(archive, tmp_path / "result")
    events = records(manifest["events_path"])
    provenance = records(manifest["provenance_path"])
    grouped = next(row for row in provenance if len(row["raw_refs"]) == 2)
    event = next(row for row in events if row["event_id"] == grouped["event_id"])
    truth = next(row for row in records(manifest["truth_path"]) if row["event_id"] == event["event_id"])
    assert len(events) == 3
    assert [ref["line"] for ref in grouped["raw_refs"]] == [1, 3]
    assert truth["is_attack"] is True
    assert truth["labels"] == ["escalate"]
    assert truth["raw_refs"] == grouped["raw_refs"]
    assert event["process_id"] == 27950
    assert event["parent_process_id"] == 12
    assert event["privileged"] is True
    assert event["session_id"] is not None
    assert event["event_time"] == "2022-01-24T04:37:40.603000Z"


def test_unlabeled_file_is_unknown_and_answer_files_never_enter_events(tmp_path):
    line = "2022-01-24T03:00:00Z server sshd[22]: Accepted password for alice from 192.0.2.1 port 22 ssh2\n"
    archive = archive_at(tmp_path, {
        "gather/server/logs/auth.log": line,
        "gather/attacker_0/logs/auth.log": line,
        "gather/server/logs/answers.log": line,
        "processing/script.py": "raise Exception('do not execute')",
        "rules/attack.json": "{}",
        "gather/server/logs/unknown.log": "opaque unsupported data\n",
    })
    manifest = import_ait_archive(archive, tmp_path / "result")
    assert manifest["event_count"] == 1
    truth = records(manifest["truth_path"])
    assert truth[0]["is_attack"] is None
    assert truth[0]["coverage"] == "unknown"
    assert manifest["diagnostics"]["excluded_files"] == 4
    assert manifest["diagnostics"]["unsupported_files"] == 1
    assert not list(Path(manifest["raw_directory"]).rglob("*.py"))


@pytest.mark.parametrize("name", ["../escape", "/escape", "C:/escape", "gather/../escape", "gather\\escape"])
def test_rejects_unsafe_paths_atomically(tmp_path, name):
    # Accepting these names can escape extraction roots on supported platforms.
    archive = archive_at(tmp_path, {name: "payload"})
    with pytest.raises(ValueError, match="(?i)path|yol"):
        import_ait_archive(archive, tmp_path / "result")
    assert not (tmp_path / "result").exists()
    assert not (tmp_path / "escape").exists()


def test_rejects_symlinks_and_does_not_leave_partial_result(tmp_path):
    archive = tmp_path / "input.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        link = zipfile.ZipInfo("gather/server/logs/auth.log")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        handle.writestr(link, "/etc/passwd")
    with pytest.raises(ValueError, match="(?i)symlink|link"):
        import_ait_archive(archive, tmp_path / "result")
    assert not (tmp_path / "result").exists()


def test_rejects_expansion_budget_even_for_excluded_files(tmp_path):
    archive = archive_at(tmp_path, {"processing/answer.txt": "x" * 101})
    with pytest.raises(ValueError, match="(?i)size|boyut|limit"):
        import_ait_archive(archive, tmp_path / "result", max_uncompressed_bytes=100)
    assert not (tmp_path / "result").exists()


def test_invalid_labels_cannot_silently_turn_attacks_into_normal(tmp_path):
    archive = archive_at(tmp_path, {
        "gather/server/logs/auth.log": "2022-01-24T03:00:00Z server sshd[22]: Failed password for alice from 192.0.2.1 port 22 ssh2\n",
        "labels/server/logs/auth.log": '{"line":0,"labels":["attack"]}\n',
    })
    with pytest.raises(ValueError, match="(?i)label|etiket"):
        import_ait_archive(archive, tmp_path / "result")
    assert not (tmp_path / "result").exists()


def test_content_change_changes_evidence_ids_but_labels_do_not(tmp_path):
    # IDs must distinguish different immutable raw files, never encode answers.
    log_name = "gather/server/logs/auth.log"
    label_name = "labels/server/logs/auth.log"
    line = "2022-01-24T03:00:00Z server sshd[22]: Failed password for alice from 192.0.2.1 port 22 ssh2\n"
    archive = archive_at(tmp_path, {log_name: line, label_name: ""})
    first = import_ait_archive(archive, tmp_path / "first")
    archive = archive_at(tmp_path, {log_name: line, label_name: '{"line":1,"labels":["attack"]}\n'})
    second = import_ait_archive(archive, tmp_path / "second")
    assert records(first["events_path"]) == records(second["events_path"])
    assert records(first["truth_path"])[0]["is_attack"] is False
    assert records(second["truth_path"])[0]["is_attack"] is True
    archive = archive_at(tmp_path, {log_name: line.replace("sshd[22]", "sshd[23]"), label_name: ""})
    third = import_ait_archive(archive, tmp_path / "third")
    assert records(first["events_path"])[0]["event_id"] != records(third["events_path"])[0]["event_id"]
    assert records(first["events_path"])[0]["raw_ref"]["file_id"] != records(third["events_path"])[0]["raw_ref"]["file_id"]


def test_parses_dns_query_without_inventing_resolver_address(tmp_path):
    # Query tokens are features; unknown destination and result stay unknown.
    archive = archive_at(tmp_path, {"gather/resolver/logs/bind9/queries.log":
        "2022-01-24T03:00:00+00:00 resolver named[22]: client @0x1 192.0.2.8#555 (Demo.Example.Test): query: Demo.Example.Test IN A + (192.0.2.53)\n"})
    manifest = import_ait_archive(archive, tmp_path / "result")
    event = records(manifest["events_path"])[0]
    assert event["source_type"] == "dns"
    assert event["dns_query"] == "demo.example.test"
    assert event["src_ip"] == "192.0.2.8"
    assert event["dst_ip"] is None
    assert event["result"] is None
    assert event["privileged"] is None


def test_limits_label_count_to_bound_import_index(tmp_path, monkeypatch):
    # Tiny compressed labels can otherwise produce an unbounded SQLite index.
    import safer5.ait as adapter
    monkeypatch.setattr(adapter, "MAX_LABELS", 1, raising=False)
    archive = archive_at(tmp_path, {
        "gather/server/logs/auth.log": "unsupported\nunsupported\n",
        "labels/server/logs/auth.log": '{"line":1,"labels":["x"]}\n{"line":2,"labels":["x"]}\n',
    })
    with pytest.raises(ValueError, match="(?i)label.*limit"):
        import_ait_archive(archive, tmp_path / "result")
    assert not (tmp_path / "result").exists()


def test_oversized_line_and_compression_bomb_are_rejected(tmp_path, monkeypatch):
    import safer5.ait as adapter
    monkeypatch.setattr(adapter, "MAX_LINE_BYTES", 32)
    archive = archive_at(tmp_path, {"gather/server/logs/auth.log": "x" * 33})
    with pytest.raises(ValueError, match="(?i)line.*limit"):
        import_ait_archive(archive, tmp_path / "result")
    archive = archive_at(tmp_path, {"gather/server/logs/auth.log": "x" * 1_000_000})
    with pytest.raises(ValueError, match="(?i)ratio.*limit"):
        import_ait_archive(archive, tmp_path / "result")
    assert not (tmp_path / "result").exists()


def test_duplicate_member_and_existing_destination_do_not_overwrite(tmp_path):
    archive = tmp_path / "input.zip"
    with zipfile.ZipFile(archive, "w") as handle:
        handle.writestr("gather/server/logs/auth.log", "a")
        handle.writestr("gather/server/logs/AUTH.log", "b")
    with pytest.raises(ValueError, match="(?i)duplicate.*path"):
        import_ait_archive(archive, tmp_path / "result")
    destination = tmp_path / "existing"
    destination.mkdir()
    (destination / "keep.txt").write_text("original")
    with pytest.raises(ValueError, match="(?i)destination.*exists"):
        import_ait_archive(archive, destination)
    assert (destination / "keep.txt").read_text() == "original"


def test_normalized_rows_validate_against_backend_event_contract(tmp_path):
    from safer5.schemas import Event
    archive = archive_at(tmp_path, {"gather/server/logs/auth.log":
        "2022-01-24T03:00:00Z server sshd[22]: Accepted password for alice from 192.0.2.1 port 22 ssh2\n"})
    manifest = import_ait_archive(archive, tmp_path / "result")
    event = Event.model_validate(records(manifest["events_path"])[0])
    assert event.schema_version == "1"


def test_labels_on_dropped_rows_are_counted_before_filtering(tmp_path):
    # Invisible labeled evidence must be disclosed, never silently counted normal.
    archive = archive_at(tmp_path, {
        "dataset.yml": "start: 2022-01-21T00:00:00Z\nend: 2022-01-25T00:00:00Z\n",
        "gather/server/logs/auth.log": "bad row\n2022-01-26T03:00:00Z server sshd[22]: Failed password for alice from 192.0.2.1 port 22 ssh2\n",
        "labels/server/logs/auth.log": '{"line":1,"labels":["a"]}\n{"line":2,"labels":["b"]}\n',
    })
    manifest = import_ait_archive(archive, tmp_path / "result")
    assert manifest["event_count"] == 0
    assert manifest["diagnostics"]["labeled_unparsed_lines"] == 1
    assert manifest["diagnostics"]["labeled_outside_window_lines"] == 1


def test_audit_missing_privilege_is_unknown(tmp_path):
    archive = archive_at(tmp_path, {"gather/server/logs/audit/audit.log":
        'type=USER_AUTH msg=audit(1642999060.603:2226): pid=27950 uid=33 msg=\'op=PAM:authentication acct="jhall" res=success\'\n'})
    manifest = import_ait_archive(archive, tmp_path / "result")
    event = records(manifest["events_path"])[0]
    assert event["privileged"] is None
    assert event["result"] == "success"


@pytest.mark.parametrize("count,size,message", [(10001, 0, "file count limit"), (0, 32 * 1024**2, "directory size limit")])
def test_limits_zip_directory_before_loading_member_metadata(tmp_path, count, size, message):
    # zipfile itself allocates the full central directory before infolist checks.
    archive = tmp_path / "input.zip"
    archive.write_bytes(struct.pack("<4s4H2IH", b"PK\x05\x06", 0, 0, count, count, size, 0, 0))
    with pytest.raises(ValueError, match=message):
        import_ait_archive(archive, tmp_path / "result")
    assert not (tmp_path / "result").exists()


def test_module_cli_imports_local_archive_and_reports_failure(tmp_path):
    archive = archive_at(tmp_path, {"gather/server/logs/auth.log":
        "2022-01-24T03:00:00Z server sshd[22]: Accepted password for alice from 192.0.2.1 port 22 ssh2\n"})
    command = [sys.executable, "-m", "safer5.ait", "--archive", str(archive), "--destination", str(tmp_path / "result")]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=20)
    assert completed.returncode == 0
    assert json.loads(completed.stdout)["event_count"] == 1
    assert (tmp_path / "result" / "manifest.json").is_file()
    repeated = subprocess.run(command, capture_output=True, text=True, timeout=20)
    assert repeated.returncode == 2
    assert "Traceback" not in repeated.stderr


@pytest.mark.parametrize("raw", [
    "type=" + "X" * 201 + " msg=audit(1642999060.603:2226): uid=1\n",
    "type=USER_AUTH msg=audit(1642999060.603:2226): op=" + "x" * 201 + " uid=1\n",
])
def test_oversized_audit_fields_are_diagnosed_instead_of_emitting_invalid_events(tmp_path, raw):
    archive = archive_at(tmp_path, {"gather/server/logs/audit/audit.log": raw})
    manifest = import_ait_archive(archive, tmp_path / "result")
    assert manifest["event_count"] == 0
    assert manifest["diagnostics"]["unparsed_lines"] == 1


def test_manifest_records_effective_budget_and_retained_original_bytes(tmp_path):
    raw = "2022-01-24T03:00:00Z server sshd[22]: Accepted password for alice from 192.0.2.1 port 22 ssh2\n"
    archive = archive_at(tmp_path, {"gather/server/logs/auth.log": raw})
    manifest = import_ait_archive(archive, tmp_path / "result", max_uncompressed_bytes=500)
    assert manifest["limits"]["max_uncompressed_bytes"] == 500
    assert Path(manifest["files"][0]["path"]).read_bytes() == raw.encode()
    assert json.loads((tmp_path / "result" / "manifest.json").read_text()) == manifest
