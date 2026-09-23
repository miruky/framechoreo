"""Source allowlists and export approval prevent accidental field inclusion."""

import json

import pandas as pd
import pytest

from framechoreo import DataStory


def test_source_allowlist_removes_fields_before_any_snapshot(tmp_path):
    original = pd.DataFrame(
        {"order": [1, 2], "amount": [10, 20], "private_note": ["secret-a", "secret-b"]}
    )
    story = DataStory()
    source = story.table(original, name="Orders", include_columns=["order", "amount"])
    result = source.filter_rows([True, False])
    manifest = story.export_info(result=result)
    assert manifest["sources"] == [
        {"step_id": source.step_id, "name": "Orders", "rows": 2, "columns": ["order", "amount"]}
    ]
    assert manifest["includes_filtered_out_rows"] is True
    assert "private_note" in original.columns
    assert "private_note" not in json.dumps(manifest)
    approved = {source.step_id: ["order", "amount"]}
    payload = story.to_json(result=result, approved_source_columns=approved)
    assert "private_note" not in payload and "secret-a" not in payload
    path = story.export_html(
        tmp_path / "reviewed.html", result=result, approved_source_columns=approved
    )
    assert "secret-a" not in path.read_text(encoding="utf-8")


def test_export_approval_covers_each_source_and_exact_column_order(tmp_path):
    story = DataStory()
    left = story.table(pd.DataFrame({"key": ["x"], "amount": [2]}), name="Same")
    right = story.table(pd.DataFrame({"key": ["x"], "category": ["Books"]}), name="Same")
    result = left.merge(right, on="key", validate="one_to_one")
    manifest = story.export_info(result=result)
    assert [source["step_id"] for source in manifest["sources"]] == [
        left.step_id,
        right.step_id,
    ]
    target = tmp_path / "story.html"
    with pytest.raises(ValueError, match="every exported source"):
        story.export_html(
            target,
            result=result,
            approved_source_columns={left.step_id: ["key", "amount"]},
        )
    with pytest.raises(ValueError, match="exactly match"):
        story.to_json(
            result=result,
            approved_source_columns={
                left.step_id: ["amount", "key"],
                right.step_id: ["key", "category"],
            },
        )
    assert not target.exists()
    approved = {source["step_id"]: source["columns"] for source in manifest["sources"]}
    assert story.export_html(target, result=result, approved_source_columns=approved).exists()


def test_invalid_source_allowlists_leave_story_unchanged():
    story = DataStory()
    source = pd.DataFrame({"safe": [1], "secret": [2]})
    for columns in ([], ["missing"], "safe", ["safe", "safe"]):
        with pytest.raises(ValueError):
            story.table(source, include_columns=columns)
    assert len(story._steps) == 0
