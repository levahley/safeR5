"""Label-blind deterministic views; no input mutation."""

from .schemas import LossConfig
from .util import digest


def keep_event(event, loss: LossConfig, seed):
    if loss.kind == "none":
        return True
    inside = (loss.start is None or loss.start <= event.event_time < loss.end)
    if loss.kind == "source":
        return not (event.source_type == loss.source and inside)
    if loss.kind == "interval":
        return not inside
    if loss.rate <= 0:
        return True
    if loss.rate >= 1:
        return False
    return int(digest([seed, event.event_id, "random-loss-v1"]), 16) / 2**256 >= loss.rate


def iter_perturbed(events, loss, seed):
    for event in events:
        if keep_event(event, loss, seed):
            yield event


def perturb(events, loss, seed):
    kept = list(iter_perturbed(events, loss, seed))
    return kept, {"version": "1", "seed": seed, "config": loss.model_dump(mode="json"),
                  "config_hash": digest(loss.model_dump(mode="json")), "input_count": len(events),
                  "retained_count": len(kept), "removed_count": len(events) - len(kept),
                  "retained_ids_hash": digest([e.event_id for e in kept])}
