import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from safer5.detection import fit_models
from safer5.lab import generate_lab
from safer5.optimization import optimize
from safer5.schemas import LabConfig
from safer5.storage import read_jsonl


def cli(*args):
    env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")}
    return subprocess.run([sys.executable, "-m", "safer5", *map(str, args)], env=env, capture_output=True, text=True, timeout=60)


def test_cli_lab_validate_experiment_evaluate_and_export(tmp_path):
    root = tmp_path / "boşluk Türkçe"
    out = cli("--root", root, "lab", "generate", "--seed", 29, "--n-events", 300)
    assert out.returncode == 0, out.stderr
    dataset = json.loads(out.stdout)
    check = cli("lab", "validate", "--manifest", root / "datasets" / dataset["id"] / "manifest.json")
    assert check.returncode == 0, check.stderr
    assert json.loads(check.stdout)["valid"]
    config = tmp_path / "config.json"
    config.write_text(json.dumps({"dataset_id":dataset["id"],"loss":{"kind":"random","rate":1}}))
    run = cli("--root", root, "experiment", "run", "--config", config)
    assert run.returncode == 0, run.stderr
    experiment = json.loads(run.stdout)
    evaluation = cli("--root", root, "evaluate", "--experiment", experiment["id"])
    assert evaluation.returncode == 0, evaluation.stderr
    metrics = json.loads(evaluation.stdout)
    assert metrics["perturbed"]["steps_total"] == 6
    assert metrics["perturbed"]["attack_step_recall"] == 0
    export = cli("--root", root, "report", "--experiment", experiment["id"], "--format", "html", "--output", tmp_path / "rapor.html")
    assert export.returncode == 0
    assert (tmp_path / "rapor.html").read_text().startswith("<!doctype html>")


def test_selection_does_not_change_when_test_answers_change(tmp_path):
    generate_lab(tmp_path, LabConfig(n_events=300))
    def factory(split):
        return list(read_jsonl(tmp_path / split / "events.jsonl"))
    train, validation, test = factory("train"), factory("validation"), factory("test")
    validation_truth = json.loads((tmp_path / "validation/truth.json").read_text())
    test_truth = json.loads((tmp_path / "test/truth.json").read_text())
    bundle = fit_models(iter(train), iter(validation), 1)
    a = optimize(lambda:iter(validation), validation_truth, lambda:iter(test), test_truth, bundle, .5, 1, 1)
    b = optimize(lambda:iter(validation), validation_truth, lambda:iter(test), {"steps":[],"normal_event_ids":[]}, bundle, .5, 1, 1)
    assert a["recommended_sources"] == b["recommended_sources"]
    assert a["candidates"] == b["candidates"]
    assert b["independent_test"]["attack_step_recall"] is None
    for c in a["candidates"]:
        if c["feasible"]:
            assert c["cost_bytes"] <= a["budget_bytes"]


@pytest.mark.parametrize("rate", [0, .5, 1])
def test_no_false_success_for_cli_invalid_path(rate, tmp_path):
    result = cli("--root", tmp_path, "evaluate", "--experiment", "../secrets")
    assert result.returncode != 0
    assert "Traceback" not in result.stderr
