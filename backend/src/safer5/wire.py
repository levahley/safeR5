"""Typed response contracts, also used to generate browser TypeScript types."""

from typing import Literal

from pydantic import BaseModel

from .schemas import Event, RunConfig, Source, RawRef


class Dataset(BaseModel):
    id: str
    name: str
    created_at: str
    event_count: int
    source_counts: dict[Source, int]
    input_hash: str
    profile: str
    seed: int | None
    manifest: dict
    rejected_count: int = 0


class Job(BaseModel):
    id: str
    kind: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled", "interrupted"]
    stage: str
    progress: float
    created_at: str
    updated_at: str
    result_id: str | None
    error: str | None
    config: dict


class Metrics(BaseModel):
    attack_step_recall: float | None
    false_positive_rate: float | None
    evidence_coverage: float | None
    detection_delay_seconds: float | None
    steps_detected: int
    steps_total: int
    false_positives: int
    normal_events: int
    alerts_total: int
    false_positive_windows: int
    normal_windows: int
    evidence_flag_rate: float | None
    status: Literal["measured", "no_ground_truth", "empty"]


class Alert(BaseModel):
    id: str
    method: Literal["rules", "iforest"]
    rule_id: str
    message: str
    severity: Literal["medium", "high"]
    evidence_ids: list[str]
    host_id: str
    user_id: str | None
    event_time: str
    score: float | None


class Incident(BaseModel):
    id: str
    alert_ids: list[str]
    evidence_ids: list[str]
    host_id: str
    user_id: str | None
    start: str
    end: str
    summary: str


class Node(BaseModel):
    id: str
    label: str
    kind: Literal["event", "host", "user", "session"]


class Edge(BaseModel):
    source: str
    target: str
    relation: str
    evidence_ids: list[str]
    uncertainty: str


class Graph(BaseModel):
    nodes: list[Node]
    edges: list[Edge]


class Analysis(BaseModel):
    event_count: int
    source_counts: dict[Source, int]
    alerts: list[Alert]
    incidents: list[Incident]
    metrics: Metrics
    method_metrics: dict[str, Metrics]
    graph: Graph
    source_health: dict[Source, str]


class Candidate(BaseModel):
    sources: list[Source]
    cost_bytes: int
    recall: float | None
    false_positive_rate: float | None
    feasible: bool


class Comparison(BaseModel):
    method: str
    sources: list[Source]
    validation_recall: float | None
    test_recall: float | None
    cost_bytes: int
    within_budget: bool


class Optimization(BaseModel):
    budget_bytes: int
    budget_fraction: float
    cost_unit: str
    validation_dataset_hash: str
    recommended_sources: list[Source]
    candidates: list[Candidate]
    comparisons: list[Comparison]
    independent_test: Metrics
    actual_test_cost_bytes: int
    estimated_cost_bytes: int
    policy: str


class ExperimentSummary(BaseModel):
    id: str
    name: str
    dataset_id: str
    created_at: str
    event_count: int
    retained_count: int
    loss_kind: str
    status: Literal["succeeded"]


class Experiment(ExperimentSummary):
    config: RunConfig
    baseline: Analysis
    perturbed: Analysis
    optimization: Optimization
    provenance: dict
    performance: dict
    loss_manifest: dict


class Overview(BaseModel):
    datasets: list[Dataset]
    experiments: list[ExperimentSummary]
    jobs: list[Job]
    stats: dict[str, int]


class Evidence(BaseModel):
    event: Event
    raw: str
    reference: RawRef


class EventPage(BaseModel):
    items: list[Event]
    total: int


class AitSetting(BaseModel):
    status: str
    record_url: str
    note: str


class Settings(BaseModel):
    version: str
    data_directory: str
    limits: dict[str, int]
    dependencies: dict[str, str]
    ait: AitSetting
