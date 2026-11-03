import json

import pytest

from safer5.schemas import Event
from safer5.storage import Store


def row(i=1, source="auth", **kw):
    return Event(event_id=str(i)*32,event_time="2026-01-01T00:00:00Z",source_type=source,host_id="h",action="login",**kw).model_dump(mode="json")


def test_unicode_separators_cannot_create_phantom_physical_lines(tmp_path):
    store = Store(tmp_path)
    for separator in ("\u2028", "\u2029", "\x85", "\x0b"):
        content = json.dumps(row()) + separator + json.dumps(row(2,"dns")) + "\n"
        with pytest.raises(ValueError):
            store.import_jsonl("ayraç", content)
    assert store.datasets() == []


def test_unicode_separator_inside_json_string_preserves_original_line(tmp_path):
    store = Store(tmp_path)
    data = row(source="dns",dns_query="hello\u2028world.example.test")
    content = json.dumps(data, ensure_ascii=False) + "\n" + json.dumps(row(2)) + "\n"
    imported = store.import_jsonl("normal",content)
    events = store.events(imported["id"])["items"]
    assert imported["event_count"] == 2
    assert sorted(e["raw_ref"]["line"] for e in events) == [1,2]
    assert next(e for e in events if e["source_type"]=="dns")["dns_query"] == data["dns_query"]
