"""One persistent worker, cooperative cancellation and restart recovery."""

import queue
import shutil
import threading
import uuid

from .experiments import publish_experiment, run_experiment
from .lab import generate_lab
from .schemas import LabConfig, RunConfig
from .util import now

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted"}


class JobManager:
    def __init__(self, store, start=True, runner=None):
        self.store, self.runner = store, runner
        self.lock, self.queue = threading.RLock(), queue.Queue()
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._work, daemon=True, name="safeR5-worker")
        for job in store.active_jobs():
            if job["status"] in ("queued", "running"):
                job.update(status="interrupted", stage="Önceki oturumda kesildi; yeniden başlatabilirsiniz.", updated_at=now())
                store.put("jobs", job)
        # Recover a completed atomic directory if metadata commit was interrupted.
        import json
        for directory in (store.root / "experiments").iterdir():
            if (directory / "result.json").exists():
                store.put("experiments", json.loads((directory / "result.json").read_text()))
        if start:
            self.start()

    def start(self):
        if not self.thread.is_alive():
            self.thread.start()

    def submit(self, kind, config):
        with self.lock:
            if len(self.store.active_jobs()) >= 10:
                raise ValueError("İş kuyruğu dolu; çalışan işin bitmesini bekleyin.")
            job = {"id": uuid.uuid4().hex, "kind": kind, "status": "queued", "stage": "Sırada", "progress": 0,
                   "created_at": now(), "updated_at": now(), "result_id": None, "error": None, "config": config}
            self.store.put("jobs", job)
            self.queue.put(job["id"])
            return job

    def cancel(self, identifier):
        with self.lock:
            job = self.store.get("jobs", identifier)
            if job["status"] not in TERMINAL:
                job.update(status="cancelled", stage="İptal edildi", updated_at=now())
                self.store.put("jobs", job)
            return job

    def _work(self):
        while True:
            identifier = self.queue.get()
            if identifier is None:
                return
            with self.lock:
                job = self.store.get("jobs", identifier)
                if job["status"] in TERMINAL:
                    continue
                job.update(status="running", stage="Başlatılıyor", updated_at=now())
                self.store.put("jobs", job)

            def cancelled():
                return self.stop.is_set() or self.store.get("jobs", identifier)["status"] == "cancelled"

            def progress(stage, percent):
                with self.lock:
                    current = self.store.get("jobs", identifier)
                    if current["status"] == "running":
                        current.update(stage=stage, progress=percent, updated_at=now())
                        self.store.put("jobs", current)

            result = None
            try:
                if job["kind"] == "lab":
                    temp = self.store.root / "staging" / (identifier + "-lab")
                    try:
                        progress("Sentetik kayıtlar üretiliyor", 20)
                        generate_lab(temp, LabConfig.model_validate(job["config"]))
                        if cancelled():
                            raise InterruptedError()
                        result = self.store.register_lab(temp)
                    finally:
                        shutil.rmtree(temp, ignore_errors=True)
                elif self.runner:
                    result = self.runner(job["config"], progress, cancelled)
                else:
                    result = run_experiment(self.store, RunConfig.model_validate(job["config"]), progress, cancelled)
                with self.lock:
                    if cancelled():
                        raise InterruptedError()
                    if result.get("_staging"):
                        publish_experiment(self.store, result)
                    job.update(status="succeeded", progress=100, stage="Tamamlandı", result_id=result["id"], updated_at=now())
                    self.store.put("jobs", job)
            except InterruptedError:
                if result and result.get("_staging"):
                    shutil.rmtree(result["_staging"], ignore_errors=True)
                with self.lock:
                    current = self.store.get("jobs", identifier)
                    current.update(status="cancelled" if current["status"] == "cancelled" else "interrupted",
                                   stage="İş durduruldu; kısmi sonuç yayımlanmadı.", updated_at=now())
                    self.store.put("jobs", current)
            except Exception as exc:
                # Detailed type only in local state; no raw log content or paths in user-facing errors.
                job.update(status="failed", stage="İş başarısız", error=f"İş tamamlanamadı ({type(exc).__name__}). Girdiyi ve veri durumunu kontrol edin.", updated_at=now())
                self.store.put("jobs", job)

    def close(self):
        self.stop.set()
        self.queue.put(None)
        if self.thread.is_alive():
            self.thread.join(timeout=30)
