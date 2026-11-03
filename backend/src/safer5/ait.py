"""Bounded, local-only AIT ZIP adapter; answers never enter detector events.

Only documented audit records and a deliberately small RFC3339 syslog subset
are supported. No archive code, model, YAML tag, shell text or network is run.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import shutil
import sqlite3
import stat
import struct
import tempfile
import zipfile
import zlib
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path, PurePosixPath

PARSER_VERSION = "ait-local-1"
DEFAULT_MAX_UNCOMPRESSED_BYTES = 1024**3
MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_FILES = 10_000
MAX_LINE_BYTES = 1024**2
MAX_EVENTS = 1_000_000
MAX_LABELS = 2_000_000
MAX_GROUP_LINES = 1_024
MAX_COMPRESSION_RATIO = 500
MAX_DIRECTORY_BYTES = 16 * 1024**2
RECORD_URL = "https://zenodo.org/records/19483937"
CANDIDATE_MD5 = "abb43a46c70939ad9f98669e3510d2b7"

_AUDIT = re.compile(r"(?:^|\s)type=([A-Z0-9_]{1,200})\s+msg=audit\((\d{1,12}(?:\.\d{1,9})?):(\d{1,20})\):")
_SYSCALL_FIELDS = re.compile(r'(?<!\w)([a-z_]+)=(?:"([^"\n]*)"|([^\s\'"=]+))')
_SYSLOG = re.compile(
    r"^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d))\s+"
    r"\S+\s+([\w./-]+)(?:\[(\d+)\])?:\s*(.*)$"
)
_AUTH = re.compile(
    r"\b(Accepted|Failed) (?:password|publickey) for (?:invalid user )?(\S+) from (\S+)\b"
)
_QUERY = re.compile(r"\bclient\s+(?:@\S+\s+)?(\S+)#\d+.*?\bquery:\s+(\S+)\s+IN\s+\w+")
_DENIED = re.compile(r"attacker|answer|attack|ground.?truth|scenario|label|\.py(?:$|\.)|\.sh(?:$|\.)", re.I)


class ArchiveImportError(ValueError):
    """User-supplied archive is unsafe, ambiguous, corrupt, or exceeds a limit."""


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _json_line(handle, value):
    handle.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n")


def _utc(value: str) -> datetime:
    timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("Timestamp timezone is required")
    return timestamp.astimezone(UTC)


def _iso(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _ip(value: str | None) -> str | None:
    try:
        return str(ipaddress.ip_address(value)) if value else None
    except ValueError:
        return None


def _number(value: str | None) -> int | None:
    try:
        result = int(value) if value is not None else None
        return result if result is not None and 0 <= result < 2**63 else None
    except ValueError:
        return None


def _directory_bound(archive: Path):
    """Bound ZIP metadata before ZipFile allocates its central-directory list."""
    size = archive.stat().st_size
    with archive.open("rb") as source:
        source.seek(max(0, size - 65557))
        tail = source.read(65557)
        index = tail.rfind(b"PK\x05\x06")
        if index < 0 or index + 22 > len(tail):
            raise ArchiveImportError("Invalid ZIP directory")
        _, disk, cd_disk, disk_count, count, cd_size, cd_offset, comment = struct.unpack(
            "<4s4H2IH", tail[index:index + 22],
        )
        if index + 22 + comment != len(tail) or disk or cd_disk or disk_count != count:
            raise ArchiveImportError("Unsupported ZIP directory layout")
        if count == 65535 or cd_size == 0xFFFFFFFF or cd_offset == 0xFFFFFFFF:
            position = size - len(tail) + index
            if position < 20:
                raise ArchiveImportError("Invalid ZIP64 directory")
            source.seek(position - 20)
            locator = source.read(20)
            signature, disk, offset, disks = struct.unpack("<4sIQI", locator)
            if signature != b"PK\x06\x07" or disk or disks != 1 or offset > size - 56:
                raise ArchiveImportError("Unsupported ZIP64 directory layout")
            source.seek(offset)
            values = struct.unpack("<4sQHHIIQQQQ", source.read(56))
            signature, record_size, _, _, disk, cd_disk, disk_count, count, cd_size, cd_offset = values
            if signature != b"PK\x06\x06" or record_size < 44 or disk or cd_disk or disk_count != count:
                raise ArchiveImportError("Unsupported ZIP64 directory layout")
        if count > MAX_FILES:
            raise ArchiveImportError("Archive file count limit exceeded")
        if cd_size > MAX_DIRECTORY_BYTES:
            raise ArchiveImportError("Archive directory size limit exceeded")
        if cd_offset + cd_size > size:
            raise ArchiveImportError("Invalid ZIP directory bounds")


def _preflight(handle: zipfile.ZipFile, maximum: int) -> dict[str, zipfile.ZipInfo]:
    members = handle.infolist()
    if len(members) > MAX_FILES:
        raise ArchiveImportError("Archive file count limit exceeded")
    entries, names, expanded = {}, set(), 0
    for member in members:
        name = member.filename
        path = PurePosixPath(name)
        if (
            member.orig_filename != name or "\x00" in name or "\\" in name or path.is_absolute()
            or not name or len(name) > 1024 or ":" in name or len(path.parts) > 64
            or any(part in {"", ".", ".."} for part in name.rstrip("/").split("/"))
        ):
            raise ArchiveImportError("Unsafe archive path")
        key = name.rstrip("/").casefold()
        if key in names:
            raise ArchiveImportError("Duplicate archive path")
        names.add(key)
        mode = stat.S_IFMT(member.external_attr >> 16)
        if mode == stat.S_IFLNK:
            raise ArchiveImportError("Archive symlink is forbidden")
        if mode not in {0, stat.S_IFREG, stat.S_IFDIR}:
            raise ArchiveImportError("Archive special file is forbidden")
        if member.flag_bits & 1:
            raise ArchiveImportError("Encrypted archive is unsupported")
        if member.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}:
            raise ArchiveImportError("Unsupported archive compression")
        expanded += member.file_size
        if expanded > maximum or member.file_size > maximum:
            raise ArchiveImportError("Archive expanded size limit exceeded")
        if member.file_size > max(1, member.compress_size) * MAX_COMPRESSION_RATIO:
            raise ArchiveImportError("Archive compression ratio limit exceeded")
        if not member.is_dir():
            entries[name] = member
    return entries


def _layout(name: str):
    """Allow either <root>/gather or gather, with one unambiguous root."""
    parts = PurePosixPath(name).parts
    offset = 0 if parts[0] in {"gather", "labels"} else 1
    if len(parts) < offset + 4 or parts[offset] not in {"gather", "labels"}:
        return None
    if parts[offset + 2] != "logs":
        return None
    return "/".join(parts[:offset]), parts[offset], parts[offset + 1], "/".join(parts[offset + 3:])


def _source(log_path: str) -> str | None:
    if re.fullmatch(r"auth\.log(?:\.\d+)?", log_path) or re.fullmatch(r"secure(?:\.\d+)?", log_path):
        return "auth"
    if re.fullmatch(r"(?:audit/)?audit\.log(?:\.\d+)?", log_path):
        return "audit"
    if re.fullmatch(r"(?:bind9/|bind/|named/)?(?:queries|query|named|dns)\.log(?:\.\d+)?", log_path):
        return "dns"
    return None


def _copy_member(handle, member, destination: Path, budget: dict) -> tuple[str, int]:
    sha, size = hashlib.sha256(), 0
    with handle.open(member) as source, destination.open("xb") as target:
        while block := source.read(1024**2):
            size += len(block)
            budget["read"] += len(block)
            if budget["read"] > budget["maximum"] or size > member.file_size:
                raise ArchiveImportError("Actual archive expanded size limit exceeded")
            sha.update(block)
            target.write(block)
    if size != member.file_size:
        raise ArchiveImportError("Archive member size mismatch")
    return sha.hexdigest(), size


def _lines(path: Path):
    with path.open("rb") as handle:
        line_number = 0
        while raw := handle.readline(MAX_LINE_BYTES + 1):
            line_number += 1
            if len(raw) > MAX_LINE_BYTES:
                raise ArchiveImportError("Log line size limit exceeded")
            yield line_number, raw


def _labels(connection, path: Path, file_id: str, budget: dict) -> int:
    maximum = 0
    for number, raw in _lines(path):
        if not raw.strip():
            continue
        budget["labels"] = budget.get("labels", 0) + 1
        if budget["labels"] > MAX_LABELS:
            raise ArchiveImportError("Label count limit exceeded")
        try:
            row = json.loads(raw)
            line, labels = row["line"], row["labels"]
            if (
                type(line) is not int or line < 1 or not isinstance(labels, list)
                or not labels or len(labels) > 128
                or any(not isinstance(label, str) or not label or len(label) > 256 for label in labels)
            ):
                raise ValueError("Invalid label")
            connection.execute("INSERT INTO labels VALUES (?,?,?)", (file_id, line, json.dumps(sorted(set(labels)))))
            maximum = max(maximum, line)
        except (UnicodeDecodeError, ValueError, KeyError, TypeError, sqlite3.IntegrityError) as error:
            raise ArchiveImportError(f"Invalid label record at line {number}") from error
    return maximum


def _window(handle, entries, root, budget, stage):
    name = (root + "/" if root else "") + "dataset.yml"
    if name not in entries:
        return None
    if entries[name].file_size > MAX_LINE_BYTES:
        raise ArchiveImportError("dataset.yml size limit exceeded")
    path = stage / "dataset.yml"
    _copy_member(handle, entries[name], path, budget)
    values = {}
    for _, raw in _lines(path):
        # Scalar parsing only: never load YAML objects, includes, or tags.
        match = re.fullmatch(rb"\s*(start|end)(?:_time)?\s*:\s*['\"]?([^'\"#\r\n]+)['\"]?\s*(?:#.*)?[\r\n]*", raw)
        if match:
            try:
                values[match[1].decode()] = _utc(match[2].decode().strip())
            except (UnicodeDecodeError, ValueError):
                return None
    if values.keys() == {"start", "end"} and values["start"] < values["end"]:
        return values["start"], values["end"]
    return None


def _event(host: str, source: str, timestamp: datetime) -> dict:
    return {
        "event_id": None, "event_time": _iso(timestamp), "observed_time": None, "source_type": source,
        "host_id": _digest("host:" + host)[:32], "user_id": None, "session_id": None,
        "event_type": source, "action": None, "result": None, "process_id": None, "parent_process_id": None,
        "process_start_time": None, "src_ip": None, "dst_ip": None, "dns_query": None,
        "bytes_out": None, "privileged": None, "raw_ref": None,
        "parser_version": PARSER_VERSION, "schema_version": "1",
    }


def _parse(text: str, source: str, host: str):
    if source == "audit":
        audit = _AUDIT.search(text)
        if audit is None:
            return None
        epoch = Decimal(audit[2])
        timestamp = datetime.fromtimestamp(int(epoch), UTC).replace(microsecond=int((epoch % 1) * 1_000_000))
        event = _event(host, source, timestamp)
        fields = {match[1]: match[2] if match[2] is not None else match[3] for match in _SYSCALL_FIELDS.finditer(text)}
        action = fields.get("op") or fields.get("syscall") or audit[1].lower()
        if len(action) > 200:
            return None
        event.update(
            event_type=audit[1].lower(), action=action,
            process_id=_number(fields.get("pid")), parent_process_id=_number(fields.get("ppid")),
            privileged=(fields["euid"] == "0") if _number(fields.get("euid")) is not None else None,
            src_ip=_ip(fields.get("addr")),
        )
        user = fields.get("acct") or fields.get("uid")
        if user is not None:
            event["user_id"] = _digest("user:" + user)[:32]
        if fields.get("ses") not in {None, "4294967295", "-1"}:
            event["session_id"] = _digest("session:" + host + ":" + fields["ses"])[:32]
        result = fields.get("res") or fields.get("success")
        event["result"] = "success" if result in {"success", "yes"} else "failure" if result in {"failed", "no"} else None
        return audit[2] + ":" + audit[3], event
    syslog = _SYSLOG.fullmatch(text.rstrip("\r\n"))
    if syslog is None:
        return None
    event = _event(host, source, _utc(syslog[1]))
    event["process_id"] = _number(syslog[3])
    if source == "auth":
        match = _AUTH.search(syslog[4])
        if match is None or syslog[2] not in {"sshd", "/usr/sbin/sshd"}:
            return None
        event.update(
            event_type="login", action="login", result="success" if match[1] == "Accepted" else "failure",
            user_id=_digest("user:" + match[2])[:32], src_ip=_ip(match[3]),
        )
    else:
        match = _QUERY.search(syslog[4])
        if match is None:
            return None
        query = match[2].rstrip(".")
        if len(query) > 253:
            return None
        event.update(event_type="dns_query", action="query", src_ip=_ip(match[1]), dns_query=query.lower())
    return None, event


def _merge(left: dict, right: dict) -> dict:
    for key in ("process_id", "parent_process_id", "user_id", "session_id", "result", "src_ip"):
        if left[key] is None:
            left[key] = right[key]
    privilege_values = (left["privileged"], right["privileged"])
    left["privileged"] = True if True in privilege_values else False if False in privilege_values else None
    return left


def _parse_file(connection, metadata, path, covered, window, diagnostics):
    line_count = 0
    for line, raw in _lines(path):
        line_count = line
        # Original physical-line lookup precedes parsing, filtering, and grouping.
        file_id = metadata["file_id"]
        found = connection.execute("SELECT labels FROM labels WHERE file_id=? AND line=?", (file_id, line)).fetchone()
        labels = json.loads(found[0]) if found else []
        try:
            parsed = _parse(raw.decode("utf-8"), metadata["source_type"], metadata["host"])
        except (UnicodeDecodeError, ValueError, OverflowError, OSError):
            parsed = None
        if parsed is None:
            diagnostics["unparsed_lines"] += 1
            diagnostics["labeled_unparsed_lines"] += int(bool(labels))
            continue
        group, event = parsed
        timestamp = _utc(event["event_time"])
        if window and not window[0] <= timestamp < window[1]:
            diagnostics["outside_window_events"] += 1
            diagnostics["labeled_outside_window_lines"] += int(bool(labels))
            continue
        key = "audit:" + group if group else "line:" + str(line)
        event_id = _digest(file_id + ":" + key)[:32]
        ref = {"file_id": file_id, "line": line, "sha256": metadata["sha256"]}
        event.update(event_id=event_id, raw_ref=ref)
        previous = connection.execute("SELECT event,refs,labels FROM events WHERE id=?", (event_id,)).fetchone()
        if previous:
            refs = json.loads(previous[1])
            if len(refs) >= MAX_GROUP_LINES:
                raise ArchiveImportError("Audit group line limit exceeded")
            refs.append(ref)
            event = _merge(json.loads(previous[0]), event)
            labels = sorted(set(json.loads(previous[2])) | set(labels))
            connection.execute("UPDATE events SET event=?,refs=?,labels=? WHERE id=?", (
                json.dumps(event), json.dumps(refs), json.dumps(labels), event_id,
            ))
        else:
            if diagnostics["parsed_events"] >= MAX_EVENTS:
                raise ArchiveImportError("Event count limit exceeded")
            diagnostics["parsed_events"] += 1
            connection.execute("INSERT INTO events VALUES (?,?,?,?,?)", (
                event_id, json.dumps(event), json.dumps([ref]), json.dumps(labels), int(covered),
            ))
    metadata["line_count"] = line_count


def import_ait_archive(
    archive: Path, destination: Path, *, max_uncompressed_bytes: int = DEFAULT_MAX_UNCOMPRESSED_BYTES,
) -> dict:
    """Import a caller-selected local ZIP into a new, atomically completed folder.

    Returned paths refer to the completed destination. The caller must keep
    truth/provenance outside detector input. Unsupported formats are reported,
    never silently reinterpreted as normal events. No remote download occurs.
    """
    archive, destination = Path(archive), Path(destination)
    if type(max_uncompressed_bytes) is not int or max_uncompressed_bytes <= 0:
        raise ArchiveImportError("Positive archive size limit is required")
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ArchiveImportError("Archive is not a regular file or exceeds size limit")
    _directory_bound(archive)
    if destination.exists() or destination.is_symlink():
        raise ArchiveImportError("Destination already exists")
    destination = destination.absolute()
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=".ait-", dir=destination.parent))
    try:
        return _import(archive, destination, stage, max_uncompressed_bytes)
    except (zipfile.BadZipFile, RuntimeError, UnicodeDecodeError, zlib.error, EOFError) as error:
        raise ArchiveImportError("Corrupt or unsupported archive") from error
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def _import(archive, destination, stage, maximum):
    sha, md5 = hashlib.sha256(), hashlib.md5(usedforsecurity=False)
    with archive.open("rb") as source:
        while block := source.read(1024**2):
            sha.update(block)
            md5.update(block)
    archive_meta = {"name": archive.name, "size_bytes": archive.stat().st_size, "sha256": sha.hexdigest(), "md5": md5.hexdigest()}
    raw_dir, answers_dir = stage / "raw", stage / "answers"
    raw_dir.mkdir()
    answers_dir.mkdir()
    budget = {"read": 0, "maximum": maximum}
    diagnostics = dict(unparsed_lines=0, outside_window_events=0, labeled_unparsed_lines=0,
                       labeled_outside_window_lines=0, excluded_files=0, unsupported_files=0, parsed_events=0)
    files, skipped, root = [], [], None
    sources = {"auth": 0, "audit": 0, "dns": 0}
    connection = sqlite3.connect(stage / "import.sqlite")
    try:
        connection.execute("CREATE TABLE labels (file_id TEXT,line INTEGER,labels TEXT,PRIMARY KEY(file_id,line))")
        connection.execute("CREATE TABLE events (id TEXT PRIMARY KEY,event TEXT,refs TEXT,labels TEXT,covered INTEGER)")
        with zipfile.ZipFile(archive) as handle:
            entries = _preflight(handle, maximum)
            selected = []
            for name, member in entries.items():
                layout = _layout(name)
                if layout and layout[1] == "gather" and not _DENIED.search(layout[2] + "/" + layout[3]):
                    source = _source(layout[3])
                    if source:
                        if root is not None and root != layout[0]:
                            raise ArchiveImportError("Ambiguous multiple AIT roots")
                        root = layout[0]
                        selected.append((name, member, layout, source))
                    else:
                        diagnostics["unsupported_files"] += 1
                        skipped.append({"name": name, "reason": "unsupported_log_format"})
                elif layout and layout[1] == "labels":
                    # Answers are read only through exact corresponding log paths below.
                    continue
                elif PurePosixPath(name).name != "dataset.yml":
                    diagnostics["excluded_files"] += 1
                    skipped.append({"name": name, "reason": "outside_detector_allowlist"})
            window = _window(handle, entries, root or "", budget, stage)
            for name, member, layout, source in sorted(selected):
                raw_path = raw_dir / (_digest("member:" + name)[:32] + ".part")
                checksum, size = _copy_member(handle, member, raw_path, budget)
                file_id = _digest("file:" + name + ":" + checksum)[:32]
                completed_raw = raw_dir / (file_id + ".log")
                raw_path.rename(completed_raw)
                raw_path = completed_raw
                metadata = {"file_id": file_id, "original_name": name, "sha256": checksum, "size_bytes": size,
                            "source_type": source, "host": layout[2], "path": str(destination / "raw" / raw_path.name)}
                label_name = (layout[0] + "/" if layout[0] else "") + "labels/" + layout[2] + "/logs/" + layout[3]
                covered = label_name in entries
                max_label_line = 0
                if covered:
                    label_path = answers_dir / (file_id + ".jsonl")
                    label_sha, _ = _copy_member(handle, entries[label_name], label_path, budget)
                    max_label_line = _labels(connection, label_path, file_id, budget)
                    metadata["label_file"] = {"original_name": label_name, "sha256": label_sha,
                                              "path": str(destination / "answers" / label_path.name)}
                _parse_file(connection, metadata, raw_path, covered, window, diagnostics)
                if max_label_line > metadata["line_count"]:
                    raise ArchiveImportError("Label line exceeds original log line count")
                files.append(metadata)
        events_path, truth_path, provenance_path = (stage / name for name in ("events.jsonl", "truth.jsonl", "provenance.jsonl"))
        with events_path.open("x") as events, truth_path.open("x") as truth, provenance_path.open("x") as provenance:
            for event_id, event_json, refs_json, labels_json, covered in connection.execute("SELECT * FROM events ORDER BY rowid"):
                event, refs, labels = json.loads(event_json), json.loads(refs_json), json.loads(labels_json)
                _json_line(events, event)
                sources[event["source_type"]] += 1
                _json_line(truth, {"event_id": event_id, "is_attack": bool(labels) if covered else None,
                                   "labels": labels, "coverage": "ait_mirrored_labels" if covered else "unknown", "raw_refs": refs})
                _json_line(provenance, {"event_id": event_id, "raw_refs": refs})
    finally:
        connection.close()
    (stage / "import.sqlite").unlink()
    manifest = {
        "status": "complete", "parser_version": PARSER_VERSION, "archive": archive_meta,
        "record_url": RECORD_URL, "record_version": "v2_1", "real_archive_verified": False,
        "record_license": "CC-BY-NC-SA-4.0", "metadata_checked_at": "2026-10-17",
        "candidate_checksum_match": archive_meta["md5"] == CANDIDATE_MD5,
        "events_path": str(destination / "events.jsonl"), "truth_path": str(destination / "truth.jsonl"),
        "provenance_path": str(destination / "provenance.jsonl"), "raw_directory": str(destination / "raw"),
        "event_count": sum(sources.values()), "source_counts": sources, "files": files,
        "skipped_files": skipped, "diagnostics": diagnostics,
        "limits": {"max_archive_bytes": MAX_ARCHIVE_BYTES, "max_uncompressed_bytes": maximum,
                   "max_files": MAX_FILES, "max_directory_bytes": MAX_DIRECTORY_BYTES,
                   "max_line_bytes": MAX_LINE_BYTES, "max_events": MAX_EVENTS, "max_labels": MAX_LABELS,
                   "max_audit_group_lines": MAX_GROUP_LINES, "max_compression_ratio": MAX_COMPRESSION_RATIO},
        "simulation_window": [_iso(value) for value in window] if window else None,
        "warnings": ["Gerçek AIT arşiviyle doğrulanmadı; desteklenmeyen kayıtlar tanı sayılarında gösterilir."]
        + ([] if window else ["Simülasyon zaman aralığı doğrulanamadı; zaman filtresi uygulanmadı."]),
    }
    (stage / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    if destination.exists():
        raise ArchiveImportError("Destination already exists")
    stage.rename(destination)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description="safeR5 — yerel AIT ZIP içe aktarma")
    parser.add_argument("--archive", type=Path, required=True, help="Kullanıcının indirdiği yerel ZIP")
    parser.add_argument("--destination", type=Path, required=True, help="Henüz var olmayan çıktı klasörü")
    parser.add_argument("--max-uncompressed-bytes", type=int, default=DEFAULT_MAX_UNCOMPRESSED_BYTES)
    arguments = parser.parse_args(argv)
    try:
        manifest = import_ait_archive(
            arguments.archive, arguments.destination, max_uncompressed_bytes=arguments.max_uncompressed_bytes,
        )
    except (ValueError, OSError) as error:
        parser.exit(2, f"AIT içe aktarma başarısız: {error}\n")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
