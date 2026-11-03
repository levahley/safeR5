"""Transactional experiments; immutable inputs and separate evaluation boundary."""

import json
import os
import pickle
try:
    import resource
except ImportError:  # Windows: memory sampling unavailable without an optional native monitor.
    resource = None
import shutil
import sys
import time
import uuid

from .detection import analyze, fit_models
from .evaluation import evaluate
from .lab import generate_lab
from .optimization import optimize
from .perturbation import iter_perturbed
from .schemas import LabConfig, RunConfig
from .storage import write_parquet
from .util import atomic_json, digest, file_hash, now, source_hash


def run_experiment(store, config: RunConfig, progress=lambda stage, percent: None, cancelled=lambda: False):
    started = time.perf_counter()
    identifier = uuid.uuid4().hex
    staging = store.root / "staging" / identifier
    staging.mkdir()

    def check():
        if cancelled():
            raise InterruptedError("Deney iptal edildi.")

    def phase(label, percent):
        check()
        progress(label, percent)

    try:
        phase("Veri kümesi hazırlanıyor", 5)
        if config.dataset_id is None:
            generated = staging / "generated"
            generate_lab(generated, LabConfig(seed=config.seed))
            dataset = store.register_lab(generated)
            shutil.rmtree(generated)
        else:
            dataset = store.dataset(config.dataset_id)
        dataset_id = dataset["id"]
        config = config.model_copy(update={"dataset_id": dataset_id})
        dataset_path = store.dataset_path(dataset_id)
        has_splits = (dataset_path / "train/events.parquet").exists() and (dataset_path / "validation/events.parquet").exists()
        training_id = dataset_id
        if not has_splits:
            reference = staging / "reference"
            generate_lab(reference, LabConfig(seed=17, n_events=1200, include_attacks=False))
            training_id = store.register_lab(reference)["id"]
            shutil.rmtree(reference)
        phase("Normal eğitim ve bağımsız doğrulama", 15)
        bundle = fit_models(store.iter_events(training_id, "train"), store.iter_events(training_id, "validation"), config.seed)
        # Only app-generated models are serialized; never accept uploaded executable models.
        model_path = staging / "model.pkl"
        with model_path.open("wb") as stream:
            pickle.dump(bundle, stream)
        model_manifest = {**bundle.manifest(), "artifact_sha256": file_hash(model_path)}
        atomic_json(staging / "model_manifest.json", model_manifest)
        truth_path = dataset_path / "test/truth.json"
        truth = json.loads(truth_path.read_text()) if truth_path.exists() else None
        def baseline_factory():
            return store.iter_events(dataset_id, "test", sources=config.sources)
        phase("Tam kayıtlar analiz ediliyor", 30)
        baseline = analyze(baseline_factory(), bundle)
        baseline["metrics"] = evaluate(baseline_factory(), baseline["alerts"], truth)
        baseline["method_metrics"] = {method:evaluate(baseline_factory(),[a for a in baseline["alerts"] if a["method"]==method],truth) for method in ("rules","iforest")}
        phase("Kayıp görünümü oluşturuluyor", 45)

        def retained():
            for index, event in enumerate(iter_perturbed(baseline_factory(), config.loss, config.seed)):
                if index % 500 == 0:
                    check()
                yield event

        retained_path = staging / "observed.parquet"
        count = write_parquet(retained_path, retained())
        def reduced_factory():
            return store.iter_events(dataset_id, path=retained_path)
        phase("Dondurulmuş modelle kayıplı analiz", 55)
        perturbed = analyze(reduced_factory(), bundle)
        perturbed["metrics"] = evaluate(reduced_factory(), perturbed["alerts"], truth)
        perturbed["method_metrics"] = {method:evaluate(reduced_factory(),[a for a in perturbed["alerts"] if a["method"]==method],truth) for method in ("rules","iforest")}
        phase("Kaynak altkümeleri doğrulanıyor", 65)
        if has_splits and truth is not None:
            validation_truth = json.loads((dataset_path / "validation/truth.json").read_text())
            optimization = optimize(lambda: store.iter_events(dataset_id, "validation"), validation_truth,
                lambda: store.iter_events(dataset_id, "test"), truth, bundle,
                config.budget_fraction, config.max_false_positive_rate, config.seed, check)
        else:
            optimization = {"budget_bytes": 0, "budget_fraction": config.budget_fraction, "cost_unit": "UTF-8 olay byte",
                "validation_dataset_hash": bundle.metadata["validation_hash"], "recommended_sources": [], "candidates": [],
                "comparisons": [], "independent_test": evaluate([], [], None), "actual_test_cost_bytes": 0,
                "estimated_cost_bytes": 0, "policy": "Etiketli bağımsız doğrulama/test bölmesi yok: kaynak önerisi hesaplanmadı."}
        phase("Sonuç ve rapor manifesti", 95)
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss if resource else None
        elapsed = time.perf_counter() - started
        result = {"id": identifier, "name": config.name, "dataset_id": dataset_id, "created_at": now(),
            "event_count": baseline["event_count"], "retained_count": count, "loss_kind": config.loss.kind,
            "status": "succeeded", "config": config.model_dump(mode="json"), "baseline": baseline, "perturbed": perturbed,
            "optimization": optimization, "provenance": {"input_hash": dataset["input_hash"],
                "test_hash": dataset["manifest"]["splits"]["test"].get("events_hash", dataset["input_hash"]),
                "source_hash": source_hash(), "config_hash": digest(config.model_dump(mode="json")),
                "model": model_manifest, "seed": config.seed, "product_version": "0.1.0",
                "synthetic": dataset["manifest"].get("synthetic", False), "reference_training": not has_splits,
                "reproduce": "python -m safer5 experiment run --config <exported-config.json>"},
            "performance": {"seconds": elapsed, "processed_test_events": baseline["event_count"],
                "events_per_second": baseline["event_count"] / elapsed,
                "process_peak_rss_bytes": (usage if sys.platform == "darwin" else usage * 1024) if usage is not None else None,
                "rss_scope": "Process lifetime high-water mark; includes runtime/models and previous jobs",
                "python": sys.version.split()[0], "platform": sys.platform},
            "loss_manifest": {"version": "1", "seed": config.seed, "kind": config.loss.kind,
                "config": config.loss.model_dump(mode="json"), "input_count": baseline["event_count"],
                "retained_count": count, "removed_count": baseline["event_count"] - count,
                "observed_hash": file_hash(retained_path), "input_hash": dataset["input_hash"]}}
        atomic_json(staging / "result.json", result)
        atomic_json(staging / "config.json", config.model_dump(mode="json"))
        check()
        return {**result, "_staging": str(staging)}
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


def publish_experiment(store, result):
    data = {k: v for k, v in result.items() if not k.startswith("_")}
    staging = result.get("_staging")
    if staging:
        os.replace(staging, store.experiment_path(data["id"]))
        store.put("experiments", data)
    return data
