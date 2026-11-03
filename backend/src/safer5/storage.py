"""Managed IDs, transactional metadata and streaming Parquet storage."""

import json
import io
import shutil
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from .schemas import Event, RawRef, SOURCES
from .util import atomic_json, canonical, digest, file_hash, managed_id, now

PARQUET_SCHEMA = pa.schema([(x, pa.string()) for x in ("event_id", "event_time", "source_type", "host_id", "user_id", "record")])


def write_parquet(path, events):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    count, buffer = 0, []
    with pq.ParquetWriter(path, PARQUET_SCHEMA, compression="zstd") as writer:
        for event in events:
            data = event.model_dump(mode="json") if isinstance(event, Event) else event
            buffer.append({**{k: data.get(k) for k in PARQUET_SCHEMA.names[:-1]}, "record": canonical(data)})
            count += 1
            if len(buffer) >= 5000:
                writer.write_table(pa.Table.from_pylist(buffer, schema=PARQUET_SCHEMA))
                buffer.clear()
        if buffer:
            writer.write_table(pa.Table.from_pylist(buffer, schema=PARQUET_SCHEMA))
    return count


def read_jsonl(path):
    with Path(path).open(encoding="utf-8") as stream:
        for line in stream:
            yield Event.model_validate_json(line)


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        for child in ("datasets", "experiments", "staging", "models"):
            (self.root / child).mkdir(parents=True, exist_ok=True)
        self.db_path = self.root / "metadata.sqlite3"
        with self.db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY, hash TEXT UNIQUE, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    @contextmanager
    def db(self):
        db = sqlite3.connect(self.db_path, timeout=15)
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def dataset_path(self, value):
        return self.root / "datasets" / managed_id(value)

    def experiment_path(self, value):
        return self.root / "experiments" / managed_id(value)

    def dataset(self, value):
        managed_id(value)
        with self.db() as db:
            row = db.execute("SELECT payload FROM datasets WHERE id=?", (value,)).fetchone()
        if row is None:
            raise FileNotFoundError("Veri kümesi bulunamadı.")
        return json.loads(row[0])

    def datasets(self):
        with self.db() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM datasets ORDER BY rowid DESC")]

    def register_lab(self, directory):
        directory = Path(directory)
        manifest = json.loads((directory / "manifest.json").read_text())
        identity = manifest["input_hash"]
        with self.db() as db:
            row = db.execute("SELECT payload FROM datasets WHERE hash=?", (identity,)).fetchone()
        if row:
            return json.loads(row[0])
        identifier = identity[:32]
        target = self.dataset_path(identifier)
        temp = self.root / "staging" / uuid.uuid4().hex
        shutil.copytree(directory, temp)
        try:
            for split in manifest["splits"]:
                write_parquet(temp / split / "events.parquet", read_jsonl(temp / split / "events.jsonl"))
            data = {"id": identifier, "name": "Hazır laboratuvar", "created_at": now(),
                    "event_count": manifest["event_count"], "source_counts": manifest["source_counts"],
                    "input_hash": identity, "profile": manifest["profile"], "seed": manifest["seed"], "manifest": manifest}
            if not target.exists():
                temp.rename(target)
            with self.db() as db:
                db.execute("INSERT OR IGNORE INTO datasets VALUES(?,?,?)", (identifier, identity, canonical(data)))
            return data
        finally:
            shutil.rmtree(temp, ignore_errors=True)

    def import_jsonl(self, name, content):
        if len(content.encode()) > 20 * 1024 * 1024:
            raise ValueError("İçe aktarma sınırı 20 MiB.")
        identity = digest(content)
        identifier = identity[:32]
        with self.db() as db:
            row = db.execute("SELECT payload FROM datasets WHERE hash=?", (identity,)).fetchone()
        if row:
            return json.loads(row[0])
        temp = self.root / "staging" / uuid.uuid4().hex
        (temp / "test").mkdir(parents=True)
        raw = temp / "test" / "raw.jsonl"
        raw.write_text(content, encoding="utf-8")
        raw_hash = file_hash(raw)
        counts, seen, rejected = dict.fromkeys(SOURCES, 0), set(), 0
        with (temp / "test" / "events.jsonl").open("w") as output, (temp / "quarantine.jsonl").open("w") as quarantine:
            for line_number, line in enumerate(io.StringIO(content, newline=None), 1):
                try:
                    if len(line) > 65536:
                        raise ValueError("Satır çok uzun")
                    event = Event.model_validate_json(line)
                    event.raw_ref = RawRef(file_id=identity, line=line_number, sha256=raw_hash)
                    # Stable identity belongs to this source file and original physical line.
                    event.event_id = digest([identity, line_number, event.event_id])[:32]
                    if event.event_id in seen:
                        continue
                    seen.add(event.event_id)
                    counts[event.source_type] += 1
                    output.write(canonical(event.model_dump(mode="json")) + "\n")
                except ValueError:
                    rejected += 1
                    quarantine.write(canonical({"line": line_number, "reason": "invalid_event", "raw": line[:65536]}) + "\n")
        if not seen:
            shutil.rmtree(temp, ignore_errors=True)
            raise ValueError("İçe aktarılan dosyada geçerli olay bulunamadı.")
        write_parquet(temp / "test" / "events.parquet", read_jsonl(temp / "test" / "events.jsonl"))
        manifest = {"splits": {"test": {"event_count": len(seen), "source_counts": counts}}, "input_hash": identity,
                    "synthetic": False, "ground_truth": "unknown"}
        atomic_json(temp / "manifest.json", manifest)
        data = {"id": identifier, "name": name, "created_at": now(), "event_count": len(seen), "source_counts": counts,
                "input_hash": identity, "profile": "import", "seed": None, "rejected_count": rejected, "manifest": manifest}
        target = self.dataset_path(identifier)
        if not target.exists():
            temp.rename(target)
        else:
            shutil.rmtree(temp)
        with self.db() as db:
            db.execute("INSERT OR IGNORE INTO datasets VALUES(?,?,?)", (identifier, identity, canonical(data)))
        return data

    def iter_events(self, identifier, split="test", sources=None, path=None):
        path = Path(path) if path else self.dataset_path(identifier) / split / "events.parquet"
        if not path.exists():
            return
        with duckdb.connect(config={"threads": 1, "memory_limit": "256MB"}) as db:
            query, params = "SELECT record FROM read_parquet(?)", [str(path)]
            if sources is not None:
                if not sources:
                    return
                query += " WHERE source_type IN (" + ",".join("?" for _ in sources) + ")"
                params.extend(sources)
            cursor = db.execute(query, params)
            while rows := cursor.fetchmany(2000):
                for row in rows:
                    yield Event.model_validate_json(row[0])

    def events(self, identifier, split="test", sources=None, offset=0, limit=50, q="", path=None):
        if not 0 <= offset or not 1 <= limit <= 1000:
            raise ValueError("Geçersiz sayfalama.")
        path = Path(path) if path else self.dataset_path(identifier) / split / "events.parquet"
        clauses, params = [], [str(path)]
        if sources is not None:
            if not sources:
                return {"items": [], "total": 0}
            clauses.append("source_type IN (" + ",".join("?" for _ in sources) + ")")
            params.extend(sources)
        if q:
            clauses.append("contains(lower(record),lower(?))")
            params.append(q)
        base = " FROM read_parquet(?)" + (" WHERE " + " AND ".join(clauses) if clauses else "")
        with duckdb.connect(config={"threads": 1, "memory_limit": "256MB"}) as db:
            total = db.execute("SELECT count(*)" + base, params).fetchone()[0]
            items = db.execute("SELECT record" + base + " ORDER BY event_time,event_id LIMIT ? OFFSET ?", params + [limit, offset]).fetchall()
        return {"items": [json.loads(x[0]) for x in items], "total": total}

    def put(self, table, value):
        if table not in ("jobs", "experiments"):
            raise ValueError("Geçersiz tablo.")
        with self.db() as db:
            db.execute(f"INSERT OR REPLACE INTO {table} VALUES(?,?)", (value["id"], canonical(value)))

    def get(self, table, identifier):
        managed_id(identifier)
        if table not in ("jobs", "experiments"):
            raise ValueError("Geçersiz tablo.")
        with self.db() as db:
            row = db.execute(f"SELECT payload FROM {table} WHERE id=?", (identifier,)).fetchone()
        if row is None:
            raise FileNotFoundError("Kayıt bulunamadı.")
        return json.loads(row[0])

    def list(self, table):
        if table not in ("jobs", "experiments"):
            raise ValueError("Geçersiz tablo.")
        with self.db() as db:
            return [json.loads(x[0]) for x in db.execute(f"SELECT payload FROM {table} ORDER BY json_extract(payload,'$.created_at') DESC, rowid DESC LIMIT 100")]

    def active_jobs(self):
        with self.db() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM jobs WHERE json_extract(payload,'$.status') IN ('queued','running')")]
