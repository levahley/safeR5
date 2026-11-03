"""Run real workload/repetition measurements; never set target accuracy values."""

import argparse
import json
import platform
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT / "backend/src"))

from safer5.detection import analyze, fit_models  # noqa:E402
from safer5.evaluation import evaluate  # noqa:E402
from safer5.experiments import publish_experiment, run_experiment  # noqa:E402
from safer5.lab import generate_lab  # noqa:E402
from safer5.schemas import LabConfig, RunConfig  # noqa:E402
from safer5.storage import Store  # noqa:E402
from safer5.util import atomic_json, source_hash, now  # noqa:E402


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--n-events",type=int,default=100000)
    parser.add_argument("--output",type=Path,default=ROOT / "artifacts/validation")
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    store=Store(ROOT / "data/validation")
    generated=ROOT / "work/performance-lab"
    t=time.perf_counter()
    manifest=generate_lab(generated,LabConfig(seed=89,n_events=args.n_events))
    generation=time.perf_counter()-t
    t=time.perf_counter()
    dataset=store.register_lab(generated)
    ingestion=time.perf_counter()-t
    print(f"Generated and stored {manifest['event_count']} actual records",flush=True)
    t=time.perf_counter()
    bundle=fit_models(store.iter_events(dataset["id"],"train"),store.iter_events(dataset["id"],"validation"),89)
    training=time.perf_counter()-t
    t=time.perf_counter()
    analyzed=analyze(store.iter_events(dataset["id"]),bundle)
    analysis=time.perf_counter()-t
    assert analyzed["event_count"]==args.n_events
    truth=json.loads((store.dataset_path(dataset["id"])/"test/truth.json").read_text())
    metrics=evaluate(store.iter_events(dataset["id"]),analyzed["alerts"],truth)
    queries=[]
    for source in (None,"auth","dns"):
        t=time.perf_counter()
        page=store.events(dataset["id"],sources=[source] if source else None,limit=50)
        queries.append({"source":source,"seconds":time.perf_counter()-t,"matched_events":page["total"]})
    try:
        import resource
        rss=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        rss=rss if sys.platform=="darwin" else rss*1024
    except ImportError:
        rss=None
    performance={"created_at":now(),"source_hash":source_hash(),"seed":89,"configuration":manifest["config"],
        "actual_generated_and_ingested_records":manifest["event_count"],"actual_analyzed_test_records":analyzed["event_count"],
        "rejected_records":0,"duplicate_records":0,"generation_seconds":generation,"ingestion_seconds":ingestion,
        "ingestion_events_per_second":manifest["event_count"]/ingestion,"feature_and_model_training_seconds":training,
        "test_feature_and_analysis_seconds":analysis,"analysis_events_per_second":args.n_events/analysis,
        "process_peak_rss_bytes":rss,"query_measurements":queries,"model_manifest":bundle.manifest(),"metrics":metrics,
        "hardware":{"platform":platform.platform(),"machine":platform.machine(),"processor":platform.processor(),"python":platform.python_version()},
        "scope":"Synthetic workload; independently generated events, no repeated-row expansion. Process lifetime RSS. Timing is one local run, not an SLA."}
    atomic_json(args.output / "performance.json",performance)
    print(f"100k profile done: {analysis:.3f}s analysis",flush=True)
    runs=[]
    for seed in (42,43,44):
        directory=ROOT / "work" / f"repeat-{seed}"
        generate_lab(directory,LabConfig(seed=seed,n_events=900))
        small=store.register_lab(directory)
        for loss in ({"kind":"none"},{"kind":"random","rate":.5},{"kind":"source","source":"dns"}):
            config=RunConfig(dataset_id=small["id"],seed=seed,loss=loss)
            result=publish_experiment(store,run_experiment(store,config))
            runs.append({"seed":seed,"loss":loss,"experiment_id":result["id"],"provenance":result["provenance"],
                "baseline":result["baseline"]["metrics"],"perturbed":result["perturbed"]["metrics"],
                "recommended_sources":result["optimization"]["recommended_sources"],"independent_test":result["optimization"]["independent_test"]})
        print(f"Seed {seed}:3 full independent experiments saved",flush=True)
    aggregates=[]
    for kind in ("none","random","source"):
        values=[r["perturbed"]["attack_step_recall"] for r in runs if r["loss"]["kind"]==kind]
        aggregates.append({"loss_kind":kind,"n_seeds":len(values),"mean_step_recall":statistics.mean(values),"population_stddev":statistics.pstdev(values),"values":values})
    atomic_json(args.output / "repetitions.json",{"created_at":now(),"source_hash":source_hash(),"runs":runs,"aggregates":aggregates,
        "uncertainty":"Descriptive seed variability in synthetic instances of the same3families; not independent real campaigns and no inferential confidence interval."})
    print(json.dumps({"performance":str(args.output / "performance.json"),"repetitions":str(args.output / "repetitions.json")}))


if __name__=="__main__":
    main()
