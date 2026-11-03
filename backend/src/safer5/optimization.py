"""Exhaustive validation-only selection, then frozen independent-test evaluation."""

import itertools
import random

from .detection import analyze
from .evaluation import evaluate
from .schemas import SOURCES
from .util import canonical


def source_costs(factory):
    costs = dict.fromkeys(SOURCES, 0)
    for event in factory():
        costs[event.source_type] += len(canonical(event.model_dump(mode="json")).encode("utf-8")) + 1
    return costs


def optimize(validation_factory, validation_truth, test_factory, test_truth, bundle, budget_fraction, max_fpr, seed, check=lambda: None):
    costs = source_costs(validation_factory)
    budget = int(sum(costs.values()) * budget_fraction)
    candidates = []
    cached = {}
    for length in range(4):
        for subset in itertools.combinations(sorted(SOURCES), length):
            check()
            result = analyze((e for e in validation_factory() if e.source_type in subset), bundle)
            metrics = evaluate((e for e in validation_factory() if e.source_type in subset), result["alerts"], validation_truth)
            cost = sum(costs[s] for s in subset)
            candidate = {"sources": list(subset), "cost_bytes": cost, "recall": metrics["attack_step_recall"],
                         "false_positive_rate": metrics["false_positive_rate"],
                         "feasible": cost <= budget and (metrics["false_positive_rate"] or 0) <= max_fpr}
            candidates.append(candidate)
            cached[subset] = candidate
    eligible = [c for c in candidates if c["feasible"]]
    recommendation = max(eligible, key=lambda c: (c["recall"] or 0, -(c["false_positive_rate"] or 0), -c["cost_bytes"]))
    # Test labels are first used below, after sources have been selected and frozen.
    chosen = recommendation["sources"]
    independent = analyze((e for e in test_factory() if e.source_type in chosen), bundle)
    independent_metrics = evaluate((e for e in test_factory() if e.source_type in chosen), independent["alerts"], test_truth)
    test_costs = source_costs(test_factory)
    cheapest, remaining = [], budget
    for source in sorted(SOURCES, key=costs.get):
        if costs[source] <= remaining:
            cheapest.append(source)
            remaining -= costs[source]
    methods = [("Tüm kaynaklar (kısıtsız referans)", list(sorted(SOURCES))), ("En düşük maliyet önce", sorted(cheapest)),
               ("safeR5 doğrulama önerisi", chosen), ("Tam arama (doğrulama)", chosen)]
    for i in range(3):
        methods.append((f"Rastgele uygun altküme · seed {seed+i}", random.Random(seed+i).choice(eligible)["sources"]))
    comparisons, tested = [], {}
    for method, subset in methods:
        check()
        key = tuple(sorted(subset))
        if key not in tested:
            result = analyze((e for e in test_factory() if e.source_type in subset), bundle)
            tested[key] = evaluate((e for e in test_factory() if e.source_type in subset), result["alerts"], test_truth)
        candidate = cached[key]
        comparisons.append({"method": method, "sources": subset, "validation_recall": candidate["recall"],
                            "test_recall": tested[key]["attack_step_recall"], "cost_bytes": candidate["cost_bytes"],
                            "within_budget": candidate["cost_bytes"] <= budget})
    return {"budget_bytes": budget, "budget_fraction": budget_fraction,
            "cost_unit": "Doğrulama aralığındaki normalize UTF-8 olay byte sayısı (ZIP/ağ byte değildir)",
            "validation_dataset_hash": bundle.metadata["validation_hash"], "recommended_sources": chosen,
            "candidates": candidates, "comparisons": comparisons, "independent_test": independent_metrics,
            "actual_test_cost_bytes": sum(test_costs[s] for s in chosen), "estimated_cost_bytes": recommendation["cost_bytes"],
            "policy": "8 altküme yalnızca doğrulamada; bütçe/FPR sınırı; en yüksek adım yakalama, sonra düşük FPR ve maliyet. Test seçimi değiştirmez."}
