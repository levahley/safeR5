"""Loopback-only single-user API and same-origin production UI."""

import json
import os
from contextlib import asynccontextmanager
from importlib.metadata import version
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from . import __version__
from . import wire
from .jobs import JobManager
from .reports import report_bytes
from .schemas import LabConfig, RunConfig, Source
from .storage import Store
from .util import file_hash, managed_id


class ImportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    content: str = Field(max_length=20 * 1024 * 1024)


def create_app(data_root=None):
    root = Path(data_root or os.environ.get("SAFER5_DATA_DIR", Path(__file__).resolve().parents[3] / "data"))
    store = Store(root)

    @asynccontextmanager
    async def lifespan(app):
        app.state.jobs = JobManager(store)
        yield
        app.state.jobs.close()

    app = FastAPI(title="safeR5", version=__version__, lifespan=lifespan)
    app.state.store = store
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])

    @app.middleware("http")
    async def local_boundary(request: Request, call_next):
        origin = request.headers.get("origin")
        allowed = {"http://127.0.0.1:8765", "http://localhost:8765", "http://127.0.0.1:5173", "http://localhost:5173", "http://testserver"}
        local_origin = origin == str(request.base_url).rstrip("/") and urlsplit(origin).hostname in {"127.0.0.1", "localhost"}
        if origin and origin not in allowed and not local_origin:
            return JSONResponse({"detail": "Bu kaynak yerel API erişimine izinli değil."}, status_code=403)
        if request.url.path.startswith("/api/") and request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"detail": "Siteler arası yerel API isteği reddedildi."}, status_code=403)
        try:
            length = int(request.headers.get("content-length", "0"))
            if length < 0:
                raise ValueError()
        except ValueError:
            return JSONResponse({"detail": "İstek boyutu başlığı geçersiz."}, status_code=400)
        if length > 20_000_000:
            return JSONResponse({"detail": "İstek boyutu sınırı aşıldı."}, status_code=413)
        if request.method in {"POST", "PUT", "PATCH"}:
            size, chunks = 0, []
            async for chunk in request.stream():
                size += len(chunk)
                if size > 20_000_000:
                    return JSONResponse({"detail": "İstek boyutu sınırı aşıldı."}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'"
        return response

    @app.exception_handler(FileNotFoundError)
    async def missing(request, exc):
        return JSONResponse({"detail": "İstenen kaynak bulunamadı."}, status_code=404)

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"detail": "Girdi geçersiz veya kaynak sınırı aşıldı."}, status_code=400)

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok", "version": __version__}

    @app.get("/api/v1/overview", response_model=wire.Overview)
    def overview():
        datasets, experiments, jobs = store.datasets(), store.list("experiments"), store.list("jobs")
        return {"datasets": datasets, "experiments": [summary(e) for e in experiments], "jobs": jobs,
                "stats": {"datasets": len(datasets), "experiments": len(experiments), "events": sum(d["event_count"] for d in datasets)}}

    @app.get("/api/v1/datasets", response_model=list[wire.Dataset])
    def datasets():
        return store.datasets()

    @app.get("/api/v1/datasets/{identifier}", response_model=wire.Dataset)
    def dataset(identifier: str):
        return store.dataset(identifier)

    @app.post("/api/v1/lab/generate", status_code=202, response_model=wire.Job)
    def generate(config: LabConfig, request: Request):
        return request.app.state.jobs.submit("lab", config.model_dump(mode="json"))

    @app.post("/api/v1/datasets/import", status_code=201, response_model=wire.Dataset)
    def import_data(config: ImportRequest):
        return store.import_jsonl(config.name, config.content)

    @app.post("/api/v1/experiments", status_code=202, response_model=wire.Job)
    def run(config: RunConfig, request: Request):
        if config.dataset_id:
            store.dataset(config.dataset_id)
        return request.app.state.jobs.submit("experiment", config.model_dump(mode="json"))

    @app.get("/api/v1/jobs", response_model=list[wire.Job])
    def jobs():
        return store.list("jobs")

    @app.get("/api/v1/jobs/{identifier}", response_model=wire.Job)
    def job(identifier: str):
        return store.get("jobs", identifier)

    @app.post("/api/v1/jobs/{identifier}/cancel", response_model=wire.Job)
    def cancel(identifier: str, request: Request):
        return request.app.state.jobs.cancel(identifier)

    @app.get("/api/v1/experiments", response_model=list[wire.ExperimentSummary])
    def experiments():
        return [summary(e) for e in store.list("experiments")]

    @app.get("/api/v1/experiments/{identifier}", response_model=wire.Experiment)
    def experiment(identifier: str):
        return store.get("experiments", identifier)

    @app.get("/api/v1/experiments/{identifier}/events", response_model=wire.EventPage)
    def events(identifier: str, offset: int = Query(0, ge=0, le=1000000), limit: int = Query(50, ge=1, le=1000), source: Source | None = None, q: str = Query("", max_length=200)):
        store.get("experiments", identifier)
        return store.events(identifier, offset=offset, limit=limit, sources=[source] if source else None, q=q,
                            path=store.experiment_path(identifier) / "observed.parquet")

    @app.get("/api/v1/experiments/{identifier}/evidence", response_model=wire.Evidence)
    def evidence(identifier: str, event_id: str):
        managed_id(event_id)
        result = store.get("experiments", identifier)
        # Query observed Parquet only, then fetch original source line. Hidden test records are not exposed here.
        import duckdb
        with duckdb.connect(config={"threads": 1, "memory_limit": "128MB"}) as db:
            row = db.execute("SELECT record FROM read_parquet(?) WHERE event_id=?", [str(store.experiment_path(identifier) / "observed.parquet"), event_id]).fetchone()
        if row is None:
            raise FileNotFoundError()
        event = json.loads(row[0])
        ref = event.get("raw_ref")
        if ref is None:
            raise FileNotFoundError()
        raw_path = store.dataset_path(result["dataset_id"]) / "test/raw.jsonl"
        if file_hash(raw_path) != ref["sha256"]:
            raise HTTPException(409, "Ham delil checksum doğrulaması başarısız.")
        with raw_path.open(encoding="utf-8") as stream:
            raw = next((line.rstrip("\n") for n, line in enumerate(stream, 1) if n == ref["line"]), None)
        if raw is None:
            raise FileNotFoundError()
        return {"event": event, "raw": raw, "reference": ref}

    @app.get("/api/v1/experiments/{identifier}/report")
    def report(identifier: str, format: Literal["json", "csv", "markdown", "html"] = "json"):
        result = store.get("experiments", identifier)
        types = {"json": "application/json", "csv": "text/csv; charset=utf-8", "markdown": "text/markdown; charset=utf-8", "html": "text/html; charset=utf-8"}
        extension = {"markdown": "md"}.get(format, format)
        return Response(report_bytes(result, format), media_type=types[format], headers={"Content-Disposition": f'attachment; filename="safeR5-{identifier}.{extension}"'})

    @app.get("/api/v1/models")
    def models():
        return [{"experiment_id": e["id"], **e["provenance"]["model"]} for e in store.list("experiments")]

    @app.get("/api/v1/settings", response_model=wire.Settings)
    def settings():
        return {"version": __version__, "data_directory": str(root.resolve()),
                "limits": {"import_bytes": 20000000, "lab_events_per_split": 1000000, "page_events": 1000, "workers": 1, "graph_event_nodes": 120},
                "dependencies": {name: version(name) for name in ("fastapi", "duckdb", "scikit-learn", "pyarrow", "pydantic")},
                "ait": {"status": "fixture_verified", "record_url": "https://zenodo.org/records/19483937", "note": "Yerel AIT arşiv adaptörü CLI ile kullanılabilir; gerçek büyük arşiv üstünde doğrulanmadı."}}

    frontend = Path(os.environ.get("SAFER5_FRONTEND_DIR", Path(__file__).resolve().parents[3] / "frontend/dist"))
    if frontend.exists():
        app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")

        @app.get("/")
        def index():
            return FileResponse(frontend / "index.html")
    return app


def summary(result):
    return {k: result[k] for k in ("id", "name", "dataset_id", "created_at", "event_count", "retained_count", "loss_kind", "status")}
