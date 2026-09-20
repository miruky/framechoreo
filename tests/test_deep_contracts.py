"""Further regressions for representation fidelity and live configuration."""

import datetime as dt
from decimal import Decimal

import numpy as np
import pandas as pd
import pytest

from framechoreo import CaptureLimitError, DataStory, StoryFrame, UnsupportedDataError


@pytest.mark.parametrize(
    "before,after",
    [
        (-0.0, 0.0),
        (Decimal("1.0"), Decimal("1.00")),
        (True, 1),
        (dt.datetime(2026, 1, 1, fold=0), dt.datetime(2026, 1, 1, fold=1)),
    ],
)
def test_equal_values_cannot_hide_a_changed_recorded_representation(before, after):
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": pd.Series([before], dtype=object)}))

    def predicate(df):
        df.iat[0, 0] = after
        return [True]

    with pytest.raises(ValueError, match="mutate"):
        frame.filter_rows(predicate)
    assert len(story.to_dict()["steps"]) == 1


@pytest.mark.parametrize("unit", ["ps", "fs", "as", "Y", "M"])
def test_numpy_datetime_keeps_its_native_resolution(unit):
    value = np.datetime64(1500, unit)
    story = DataStory()
    story.table(pd.DataFrame({"time": pd.Series([value], dtype=object)}))
    cell = story.to_dict()["steps"][0]["rows"][0]["cells"][0]
    assert cell["value"] == str(value)
    assert cell["display"] == str(value)


@pytest.mark.parametrize(
    "name,bad",
    [
        ("title", 123),
        ("title", "  "),
        ("max_rows", 0),
        ("max_columns", True),
        ("max_steps", -1),
        ("max_export_bytes", 1.5),
    ],
)
def test_later_configuration_assignments_are_validated_atomically(name, bad):
    story = DataStory()
    previous = getattr(story, name)
    with pytest.raises(ValueError):
        setattr(story, name, bad)
    assert getattr(story, name) == previous


def test_lowering_capture_limit_does_not_break_existing_lineage():
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [7]}))
    for _ in range(4):
        frame = frame.filter_rows([True])
    story.max_steps = 1
    assert [o.value for o in frame.explain(0, "v", max_sources=1)] == [7]


def test_frame_identity_cannot_be_reassigned_to_another_record():
    story = DataStory()
    frame = story.table(pd.DataFrame({"v": [1]}))
    other = story.table(pd.DataFrame({"v": [99]}))
    with pytest.raises(AttributeError):
        frame.step_id = other.step_id
    assert frame.to_pandas().iat[0, 0] == 1


def test_unknown_frame_identity_is_rejected_at_construction():
    with pytest.raises(ValueError):
        StoryFrame(DataStory(), "unknown")


def test_an_empty_notebook_representation_is_helpful_without_exporting_a_player():
    story = DataStory(title="A new story")
    assert "Add a table" in story._repr_html_()
    assert "A new story" in story._repr_html_()
    with pytest.raises(ValueError, match="Add a table"):
        story.to_html()


@pytest.mark.parametrize("case", ["column", "decimal"])
def test_non_string_cell_and_header_text_are_also_bounded(case):
    df = (
        pd.DataFrame({"x" * 20001: [1]})
        if case == "column"
        else pd.DataFrame({"v": [Decimal("1" * 20001)]})
    )
    story = DataStory()
    with pytest.raises(CaptureLimitError):
        story.table(df)
    assert story.to_dict()["steps"] == []


def test_whitespace_only_and_unhashable_columns_have_clear_data_errors():
    for label in [" ", ["unhashable"]]:
        labels = np.empty(1, dtype=object)
        labels[0] = label
        df = pd.DataFrame([[1]])
        df.columns = pd.Index(labels, tupleize_cols=False)
        with pytest.raises(UnsupportedDataError, match="Columns"):
            DataStory().table(df)


def test_minimum_count_cannot_lose_integer_precision_in_the_player():
    frame = DataStory().table(pd.DataFrame({"k": ["a"], "v": [1]}))
    with pytest.raises(ValueError, match="min_count"):
        frame.group_sum(by="k", value="v", dropna=False, min_count=2**53 + 1)
    assert pd.isna(
        frame.group_sum(by="k", value="v", dropna=False, min_count=2**53 - 1).to_pandas().iat[0, 1]
    )
