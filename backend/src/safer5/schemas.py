"""Analysis input explicitly excludes truth/labels and unknown fields."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Source = Literal["auth", "audit", "dns"]
SOURCES = ("auth", "audit", "dns")


class RawRef(BaseModel):
    file_id: str = Field(max_length=200)
    line: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")


class Event(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(pattern=r"^[a-f0-9]{32,64}$")
    event_time: datetime
    observed_time: datetime | None = None
    source_type: Source
    host_id: str = Field(max_length=200)
    user_id: str | None = Field(default=None, max_length=200)
    session_id: str | None = Field(default=None, max_length=200)
    event_type: str = Field(default="event", max_length=200)
    action: str = Field(max_length=200)
    result: str | None = Field(default=None, max_length=200)
    process_id: int | None = Field(default=None, ge=0)
    parent_process_id: int | None = Field(default=None, ge=0)
    process_start_time: datetime | None = None
    src_ip: str | None = Field(default=None, max_length=100)
    dst_ip: str | None = Field(default=None, max_length=100)
    dns_query: str | None = Field(default=None, max_length=4096)
    bytes_out: int | None = Field(default=None, ge=0)
    privileged: bool | None = None
    raw_ref: RawRef | None = None
    parser_version: str = "1"
    schema_version: str = "1"

    @field_validator("event_time", "observed_time", "process_start_time")
    @classmethod
    def utc(cls, value):
        if value is not None:
            if value.tzinfo is None:
                raise ValueError("Saat dilimi gereklidir.")
            return value.astimezone(timezone.utc)
        return None


class LabConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile: Literal["demo"] = "demo"
    seed: int = Field(default=42, ge=0, le=2147483647)
    n_events: int = Field(default=2400, ge=300, le=1000000)
    include_attacks: bool = True
    users: int = Field(default=8, ge=2, le=256)
    hosts: int = Field(default=4, ge=4, le=256)
    start: datetime = datetime(2026, 1, 1, tzinfo=timezone.utc)
    duration_hours: float = Field(default=12, ge=1, le=24)

    @field_validator("start")
    @classmethod
    def utc(cls, value):
        return Event.utc(value)


class LossConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["none", "random", "source", "interval"] = "none"
    rate: float = Field(default=0.3, ge=0, le=1)
    source: Source | None = None
    start: datetime | None = None
    end: datetime | None = None

    @field_validator("start", "end")
    @classmethod
    def utc(cls, value):
        return Event.utc(value)

    @model_validator(mode="after")
    def interval(self):
        if self.kind == "source" and self.source is None:
            raise ValueError("Kesilecek kayıt kaynağını seçin.")
        if self.kind == "interval" and (self.start is None or self.end is None):
            raise ValueError("Zaman kaybı için başlangıç ve bitiş gerekli.")
        if (self.start is None) != (self.end is None):
            raise ValueError("Başlangıç ve bitiş birlikte verilmelidir.")
        if self.start and self.start >= self.end:
            raise ValueError("Bitiş başlangıçtan sonra olmalıdır.")
        return self


class RunConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    dataset_id: str | None = Field(default=None, pattern=r"^[a-f0-9]{32,64}$")
    name: str = Field(default="Demo deneyi", min_length=1, max_length=120)
    seed: int = Field(default=42, ge=0, le=2147483647)
    sources: list[Source] = Field(default_factory=lambda: list(SOURCES), max_length=3)
    loss: LossConfig = Field(default_factory=LossConfig)
    budget_fraction: float = Field(default=0.7, ge=0, le=1)
    max_false_positive_rate: float = Field(default=1, ge=0, le=1)

    @field_validator("sources")
    @classmethod
    def unique(cls, value):
        return sorted(set(value))
