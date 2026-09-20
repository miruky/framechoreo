"""Small, explicit pandas operations with immutable snapshots and local provenance."""

from __future__ import annotations

import copy
import json
import math
from collections.abc import Callable, Mapping, Sequence, Set
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .encoding import encode_cell, validate_text
from .errors import CaptureLimitError, UnsupportedDataError

VERSION = "0.1.0"


@dataclass(frozen=True)
class _RowRef:
    step: str
    row: int


@dataclass(frozen=True)
class _CellRef:
    step: str
    row: int
    column: str


@dataclass(frozen=True)
class CellOrigin:
    """An input cell. Repeated origins are retained when a value is used repeatedly."""

    source: str
    step_id: str
    row: int
    column: str
    value: Any


@dataclass(frozen=True)
class _Step:
    id: str
    name: str
    operation: str
    label: str
    frame: pd.DataFrame
    parents: tuple[str, ...]
    row_parents: tuple[tuple[_RowRef, ...], ...]
    cell_parents: tuple[dict[str, tuple[_CellRef, ...]], ...]
    parameters: dict[str, Any]


def _text(value: str, name: str, limit: int = 400) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError(f"{name} must be a nonempty string of at most {limit} characters")
    return validate_text(value)


def _keys(value: str | Sequence[str], columns: pd.Index, *, allow_empty: bool = False) -> list[str]:
    try:
        if isinstance(value, (Mapping, Set)):
            raise TypeError
        result = [value] if isinstance(value, str) else list(value)
    except TypeError as exc:
        raise ValueError("Keys must be a column name or an ordered sequence of names") from exc
    if (not result and not allow_empty) or any(not isinstance(x, str) for x in result):
        raise ValueError("Keys must be nonempty column names")
    if len(set(result)) != len(result) or any(x not in columns for x in result):
        raise ValueError("Keys must be unique and present in the table")
    return result


def _copy_index(index: pd.Index) -> pd.Index:
    if isinstance(index, pd.MultiIndex):
        return index.copy(deep=True).set_levels(
            [_copy_index(level) for level in index.levels], verify_integrity=False
        )
    if isinstance(index, pd.CategoricalIndex):
        return pd.CategoricalIndex(_copy_categorical(index.array), name=index.name)
    return index.copy(deep=True)


def _copy_categorical(values: pd.Categorical) -> pd.Categorical:
    return pd.Categorical.from_codes(
        values.codes.copy(), categories=_copy_index(values.categories), ordered=values.ordered
    )


def _detached_copy(frame: pd.DataFrame) -> pd.DataFrame:
    """Detach axes and categorical dictionaries that pandas deep copies can share."""
    result = frame.copy(deep=True)
    result.index = _copy_index(frame.index)
    result.columns = _copy_index(frame.columns)
    for position, dtype in enumerate(frame.dtypes):
        if isinstance(dtype, pd.CategoricalDtype):
            result.isetitem(position, _copy_categorical(frame.iloc[:, position].array))
    return result


class DataStory:
    """Capture small transformations and export a network-independent HTML player.

    All recorded ancestor data is included in an export, including filtered-out
    rows. Review the data before sharing the resulting file.
    """

    def __init__(
        self,
        title: str = "A data story",
        *,
        max_rows: int = 200,
        max_columns: int = 12,
        max_steps: int = 20,
        max_export_bytes: int = 2_000_000,
    ) -> None:
        self.title = _text(title, "title", 200)
        for name, limit in {
            "max_rows": max_rows,
            "max_columns": max_columns,
            "max_steps": max_steps,
            "max_export_bytes": max_export_bytes,
        }.items():
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
                raise ValueError(f"{name} must be a positive integer")
        self.max_rows = max_rows
        self.max_columns = max_columns
        self.max_steps = max_steps
        self.max_export_bytes = max_export_bytes
        self._steps: list[_Step] = []
        self._presentations: dict[str, dict[str, Any]] = {}

    def _step(self, step_id: str) -> _Step:
        for step in self._steps:
            if step.id == step_id:
                return step
        raise ValueError("Unknown step")

    def _add(
        self,
        frame: pd.DataFrame,
        *,
        name: str,
        operation: str,
        label: str,
        parents: tuple[str, ...] = (),
        row_parents: tuple[tuple[_RowRef, ...], ...] = (),
        cell_parents: tuple[dict[str, tuple[_CellRef, ...]], ...] = (),
        parameters: dict[str, Any] | None = None,
    ) -> StoryFrame:
        if not isinstance(frame, pd.DataFrame):
            raise TypeError("Expected a pandas DataFrame")
        if len(frame) > self.max_rows or len(frame.columns) > self.max_columns:
            raise CaptureLimitError("Table exceeds max_rows or max_columns; data was not sampled")
        if len(self._steps) >= self.max_steps:
            raise CaptureLimitError("Story exceeds max_steps")
        if not frame.columns.is_unique or not all(isinstance(c, str) and c for c in frame.columns):
            raise UnsupportedDataError("Columns must have unique, nonempty string names")
        if len(frame.columns) == 0:
            raise UnsupportedDataError("At least one column is required")
        for column in frame.columns:
            validate_text(column)
        for values in frame.itertuples(index=False, name=None):
            for value in values:
                encode_cell(value)
        step = _Step(
            id=f"step-{len(self._steps)}",
            name=_text(name, "name", 100),
            operation=operation,
            label=_text(label, "label"),
            frame=_detached_copy(frame),
            parents=parents,
            row_parents=row_parents,
            cell_parents=cell_parents,
            parameters=copy.deepcopy(parameters or {}),
        )
        self._steps.append(step)
        return StoryFrame(self, step.id)

    def table(self, frame: pd.DataFrame, *, name: str | None = None) -> StoryFrame:
        """Record a detached source table. Index labels are not used as row identity."""
        chosen_name = name if name is not None else f"Table {len(self._steps) + 1}"
        return self._add(frame, name=chosen_name, operation="source", label=chosen_name)

    def _result(self, result: StoryFrame | None) -> str | None:
        if result is None:
            return self._steps[-1].id if self._steps else None
        if not isinstance(result, StoryFrame) or result._story is not self:
            raise ValueError("Result must belong to the same story")
        self._step(result.step_id)
        return result.step_id

    def annotate(
        self,
        frame: StoryFrame,
        *,
        note: str = "",
        hold: float = 2.8,
        highlight: str | Sequence[str] = (),
    ) -> None:
        """Set a step's presentation without recalculating or changing its data.

        ``hold`` is playback time in seconds (1–30); highlighting affects columns.
        Calling again replaces the previous presentation settings for this step.
        """
        if not isinstance(frame, StoryFrame):
            raise ValueError("frame must belong to the same story")
        sid = self._result(frame)
        if not isinstance(note, str) or len(note) > 600:
            raise ValueError("note must be a string of at most 600 characters")
        validate_text(note)
        if isinstance(hold, bool) or not isinstance(hold, (int, float)):
            raise ValueError("hold must be between 1 and 30 seconds")
        if not 1 <= hold <= 30 or not math.isfinite(hold):
            raise ValueError("hold must be between 1 and 30 seconds")
        columns = _keys(highlight, frame._snapshot.frame.columns, allow_empty=True)
        self._presentations[sid] = {
            "note": note,
            "hold_ms": round(hold * 1000),
            "highlight": columns,
        }

    def to_dict(self, *, result: StoryFrame | None = None) -> dict[str, Any]:
        """Return detached display data for the result and its ancestors."""
        result_id = self._result(result)
        required: set[str] = set()
        pending = [result_id] if result_id else []
        while pending:
            sid = pending.pop()
            if sid not in required:
                required.add(sid)
                pending.extend(self._step(sid).parents)
        timeline = []
        sid = result_id
        while sid is not None:
            timeline.append(sid)
            parents = self._step(sid).parents
            sid = parents[0] if parents else None
        timeline.reverse()
        steps = []
        for step in self._steps:
            if step.id not in required:
                continue
            rows = []
            for i, values in enumerate(step.frame.itertuples(index=False, name=None)):
                refs = step.row_parents[i] if step.row_parents else ()
                cell_refs = step.cell_parents[i] if step.cell_parents else {}
                rows.append(
                    {
                        "id": f"{step.id}:{i}",
                        "position": i,
                        "cells": [encode_cell(v) for v in values],
                        "parents": [{"step": r.step, "row": r.row} for r in refs],
                        "cell_parents": {
                            col: [{"step": r.step, "row": r.row, "column": r.column} for r in rr]
                            for col, rr in cell_refs.items()
                        },
                    }
                )
            steps.append(
                {
                    "id": step.id,
                    "name": step.name,
                    "operation": step.operation,
                    "label": step.label,
                    "columns": list(step.frame.columns),
                    "dtypes": [str(x) for x in step.frame.dtypes],
                    "rows": rows,
                    "parents": list(step.parents),
                    "parameters": copy.deepcopy(step.parameters),
                    "presentation": copy.deepcopy(self._presentations.get(step.id, {})),
                }
            )
        return {
            "format": "framechoreo.story",
            "schema_version": 1,
            "library_version": VERSION,
            "pandas_version": pd.__version__,
            "title": self.title,
            "result": result_id,
            "timeline": timeline,
            "steps": steps,
        }

    def to_json(self, *, result: StoryFrame | None = None) -> str:
        chunks: list[str] = []
        size = 0
        encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False)
        for chunk in encoder.iterencode(self.to_dict(result=result)):
            size += len(chunk.encode("utf-8"))
            if size > self.max_export_bytes:
                raise CaptureLimitError(
                    "Recorded data exceeds max_export_bytes; nothing was truncated"
                )
            chunks.append(chunk)
        return "".join(chunks)

    def to_html(self, *, result: StoryFrame | None = None, theme: str = "auto") -> str:
        """Return a self-contained player with no external assets or network requests."""
        from .export import render_html

        if self._result(result) is None:
            raise ValueError("Add a table before exporting HTML")
        return render_html(self.to_json(result=result), self.title, theme)

    def export_html(
        self,
        path: str | Path,
        *,
        result: StoryFrame | None = None,
        theme: str = "auto",
        overwrite: bool = False,
    ) -> Path:
        """Write HTML atomically; refuse to replace an existing file by default."""
        from .export import write_html

        return write_html(path, self.to_html(result=result, theme=theme), overwrite=overwrite)

    def export_info(self, *, result: StoryFrame | None = None) -> dict[str, Any]:
        """Summarize the data that will travel with an export."""
        text = self.to_json(result=result)
        payload = json.loads(text)
        return {
            "steps": len(payload["steps"]),
            "rows_across_snapshots": sum(len(s["rows"]) for s in payload["steps"]),
            "json_bytes": len(text.encode("utf-8")),
            "source_tables": [s["name"] for s in payload["steps"] if s["operation"] == "source"],
            "includes_filtered_out_rows": True,
        }

    def _repr_html_(self) -> str:
        from .export import notebook_html

        return notebook_html(self.to_html(), self.title)


class StoryFrame:
    """An immutable recorded step, with a small explicit operation surface."""

    def __init__(self, story: DataStory, step_id: str) -> None:
        self._story = story
        self.step_id = step_id

    @property
    def _snapshot(self) -> _Step:
        return self._story._step(self.step_id)

    def to_pandas(self) -> pd.DataFrame:
        """Return a copy, so changes cannot mutate the recorded history."""
        return _detached_copy(self._snapshot.frame)

    def filter_rows(
        self,
        predicate: Callable[[pd.DataFrame], Any] | Any,
        *,
        label: str = "Filter rows",
    ) -> StoryFrame:
        df = self.to_pandas()
        mask = predicate(df) if callable(predicate) else predicate
        try:
            pd.testing.assert_frame_equal(df, self._snapshot.frame, check_exact=True)
        except AssertionError as exc:
            raise ValueError("Filter predicate must not mutate its input") from exc
        if isinstance(mask, pd.Series):
            if not mask.index.equals(df.index):
                raise ValueError("A Series mask must have the same index and order as the table")
        else:
            if isinstance(mask, (Mapping, Set)) or pd.api.types.is_scalar(mask):
                raise ValueError("Expected a one-dimensional boolean mask, not a scalar or mapping")
            try:
                mask = pd.Series(mask, dtype="boolean" if len(df) == 0 else None)
            except (TypeError, ValueError) as exc:
                raise ValueError("Expected a one-dimensional boolean mask") from exc
        if len(mask) != len(df) or not pd.api.types.is_bool_dtype(mask.dtype):
            raise ValueError("Expected one boolean per input row")
        selected = np.flatnonzero(mask.to_numpy(dtype=bool, na_value=False)).tolist()
        output = df.iloc[selected]
        return self._story._add(
            output,
            name="Filtered rows",
            operation="filter",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in selected),
            cell_parents=tuple(
                {c: (_CellRef(self.step_id, i, c),) for c in df.columns} for i in selected
            ),
            parameters={"selected_rows": selected, "removed_rows": len(df) - len(output)},
        )

    def merge(
        self,
        right: StoryFrame,
        *,
        on: str | Sequence[str],
        how: str = "left",
        validate: str = "many_to_one",
        suffixes: tuple[str, str] = ("_x", "_y"),
        label: str = "Join tables",
    ) -> StoryFrame:
        if not isinstance(right, StoryFrame) or right._story is not self._story:
            raise ValueError("Both tables must belong to the same story")
        if how not in {"left", "inner"}:
            raise ValueError("how must be 'left' or 'inner'")
        if validate not in {"many_to_one", "one_to_one", "m:1", "1:1"}:
            raise ValueError("validate must be 'many_to_one' or 'one_to_one'")
        if (
            not isinstance(suffixes, (tuple, list))
            or len(suffixes) != 2
            or not all(isinstance(s, str) for s in suffixes)
        ):
            raise ValueError("suffixes must contain two strings")
        left_df, right_df = self.to_pandas(), right.to_pandas()
        keys = _keys(on, left_df.columns)
        _keys(keys, right_df.columns)
        output = left_df.merge(
            right_df, on=keys, how=how, validate=validate, sort=False, suffixes=suffixes
        )
        left_marker, right_marker = object(), object()
        left_columns, right_columns = list(left_df.columns), list(right_df.columns)
        left_df = left_df[keys].copy()
        right_df = right_df[keys].copy()
        left_df[left_marker] = np.arange(len(left_df))
        right_df[right_marker] = np.arange(len(right_df))
        mapping = left_df.merge(
            right_df, on=keys, how=how, validate=validate, sort=False, suffixes=suffixes
        )
        if len(mapping) != len(output):
            raise UnsupportedDataError("Could not align the join result with its source rows")
        left_indices = mapping[left_marker].tolist()
        right_indices = mapping[right_marker].tolist()
        overlap = (set(left_columns) & set(right_columns)) - set(keys)
        row_parents = []
        cell_parents = []
        unmatched = 0
        for li, ri in zip(left_indices, right_indices, strict=True):
            li = int(li)
            ri = None if pd.isna(ri) else int(ri)
            refs = [_RowRef(self.step_id, li)]
            if ri is not None:
                refs.append(_RowRef(right.step_id, ri))
            else:
                unmatched += 1
            row_parents.append(tuple(refs))
            cells = {}
            for c in left_columns:
                out = c + suffixes[0] if c in overlap else c
                cells[out] = (_CellRef(self.step_id, li, c),)
            for c in right_columns:
                if c in keys:
                    continue
                out = c + suffixes[1] if c in overlap else c
                cells[out] = (_CellRef(right.step_id, ri, c),) if ri is not None else ()
            cell_parents.append(cells)
        return self._story._add(
            output,
            name="Joined rows",
            operation="merge",
            label=label,
            parents=(self.step_id, right.step_id),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            parameters={
                "on": keys,
                "how": how,
                "validate": validate,
                "suffixes": list(suffixes),
                "unmatched_rows": unmatched,
            },
        )

    def group_sum(
        self,
        *,
        by: str | Sequence[str],
        value: str,
        dropna: bool,
        min_count: int = 1,
        sort: bool = False,
        label: str = "Group and sum",
    ) -> StoryFrame:
        df = self.to_pandas()
        keys = _keys(by, df.columns)
        if not isinstance(value, str) or value not in df.columns or value in keys:
            raise ValueError("value must name a column outside the grouping keys")
        if not isinstance(dropna, bool) or not isinstance(sort, bool):
            raise ValueError("dropna and sort must be booleans")
        if isinstance(min_count, bool) or not isinstance(min_count, int) or min_count < 0:
            raise ValueError("min_count must be a nonnegative integer")
        if not pd.api.types.is_numeric_dtype(df[value].dtype) or pd.api.types.is_bool_dtype(
            df[value].dtype
        ):
            raise UnsupportedDataError("group_sum requires a numeric, non-boolean value column")
        grouped = df.groupby(keys, dropna=dropna, sort=sort, observed=True)
        output = grouped[value].sum(min_count=min_count).reset_index()
        group_ids = grouped.ngroup().to_numpy()
        row_parents = []
        cell_parents = []
        groups = []
        for i in range(len(output)):
            members = np.flatnonzero(group_ids == i).tolist()
            row_parents.append(tuple(_RowRef(self.step_id, j) for j in members))
            refs = {c: tuple(_CellRef(self.step_id, j, c) for j in members) for c in keys}
            refs[value] = tuple(
                _CellRef(self.step_id, j, value)
                for j in members
                if not pd.isna(df.iat[j, df.columns.get_loc(value)])
            )
            cell_parents.append(refs)
            groups.append({"output_row": i, "input_rows": members})
        return self._story._add(
            output,
            name="Grouped sum",
            operation="group_sum",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            parameters={
                "by": keys,
                "value": value,
                "dropna": dropna,
                "min_count": min_count,
                "sort": sort,
                "groups": groups,
                "excluded_rows": int(pd.isna(group_ids).sum()),
            },
        )

    def explain(
        self, row: int, column: str, *, max_sources: int = 10_000
    ) -> tuple[CellOrigin, ...]:
        """Trace a cell's value inputs to source cells, preserving multiplicity.

        Missing sum inputs and unmatched right-side cells have no value inputs.
        Group membership and min_count remain in the exported operation record.
        """
        if (
            isinstance(row, bool)
            or not isinstance(row, int)
            or not 0 <= row < len(self._snapshot.frame)
        ):
            raise IndexError("row is an output row position")
        if column not in self._snapshot.frame.columns:
            raise KeyError(column)
        if isinstance(max_sources, bool) or not isinstance(max_sources, int) or max_sources < 1:
            raise ValueError("max_sources must be a positive integer")
        pending = [_CellRef(self.step_id, row, column)]
        origins = []
        visited = 0
        while pending:
            ref = pending.pop()
            visited += 1
            if visited > max_sources * self._story.max_steps:
                raise CaptureLimitError("Lineage traversal exceeds the limit")
            step = self._story._step(ref.step)
            if step.operation == "source":
                origins.append(
                    CellOrigin(
                        step.name,
                        step.id,
                        ref.row,
                        ref.column,
                        step.frame.iat[ref.row, step.frame.columns.get_loc(ref.column)],
                    )
                )
                if len(origins) > max_sources:
                    raise CaptureLimitError("Cell has more than max_sources inputs")
            else:
                pending.extend(reversed(step.cell_parents[ref.row].get(ref.column, ())))
        return tuple(origins)

    def _repr_html_(self) -> str:
        from .export import notebook_html

        return notebook_html(self._story.to_html(result=self), self._story.title)
