"""Small, explicit pandas operations with immutable snapshots and local provenance."""

from __future__ import annotations

import copy
import io
import json
import math
import operator
from collections.abc import Callable, Iterator, Mapping, Sequence, Set
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from .encoding import cell_signature, encode_cell, validate_text
from .errors import CaptureLimitError, UnsupportedDataError

VERSION = "0.1.0"


@dataclass(frozen=True, slots=True)
class _RowRef:
    step: str
    row: int


@dataclass(frozen=True, slots=True)
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
class OriginPage:
    """A bounded slice of source uses, with an exact count including repetitions."""

    origins: tuple[CellOrigin, ...]
    total: int
    offset: int

    @property
    def has_next(self) -> bool:
        return self.offset + len(self.origins) < self.total


@dataclass(frozen=True, slots=True)
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


def _positive_integer(value: int, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


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


def _row_values(frame: pd.DataFrame) -> Iterator[tuple[Any, ...]]:
    """Read column scalars without tuple boxing or mixed-row numeric coercion."""
    columns = [frame[column].array for column in frame.columns]
    for row in range(len(frame)):
        yield tuple(column[row] for column in columns)


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
        max_cells: int | None = None,
    ) -> None:
        self.title = title
        self.max_rows = max_rows
        self.max_columns = max_columns
        self.max_steps = max_steps
        self.max_export_bytes = max_export_bytes
        self.max_cells = max_cells
        self._steps: list[_Step] = []
        self._step_index: dict[str, _Step] = {}
        self._recorded_cells = 0
        self._presentations: dict[str, dict[str, Any]] = {}

    @classmethod
    def for_analysis(
        cls,
        title: str = "A data analysis",
        *,
        max_rows: int = 50_000,
        max_columns: int = 24,
        max_steps: int = 50,
        max_export_bytes: int = 128_000_000,
        max_cells: int = 2_000_000,
    ) -> DataStory:
        """Opt into larger captures while bounding the total cells across snapshots."""
        return cls(
            title,
            max_rows=max_rows,
            max_columns=max_columns,
            max_steps=max_steps,
            max_export_bytes=max_export_bytes,
            max_cells=max_cells,
        )

    @property
    def title(self) -> str:
        return self._title

    @title.setter
    def title(self, value: str) -> None:
        self._title = _text(value, "title", 200)

    @property
    def max_rows(self) -> int:
        return self._max_rows

    @max_rows.setter
    def max_rows(self, value: int) -> None:
        self._max_rows = _positive_integer(value, "max_rows")

    @property
    def max_columns(self) -> int:
        return self._max_columns

    @max_columns.setter
    def max_columns(self, value: int) -> None:
        self._max_columns = _positive_integer(value, "max_columns")

    @property
    def max_steps(self) -> int:
        return self._max_steps

    @max_steps.setter
    def max_steps(self, value: int) -> None:
        self._max_steps = _positive_integer(value, "max_steps")

    @property
    def max_export_bytes(self) -> int:
        return self._max_export_bytes

    @max_export_bytes.setter
    def max_export_bytes(self, value: int) -> None:
        self._max_export_bytes = _positive_integer(value, "max_export_bytes")

    @property
    def max_cells(self) -> int | None:
        return self._max_cells

    @max_cells.setter
    def max_cells(self, value: int | None) -> None:
        self._max_cells = None if value is None else _positive_integer(value, "max_cells")

    def _step(self, step_id: str) -> _Step:
        try:
            return self._step_index[step_id]
        except (KeyError, TypeError) as exc:
            raise ValueError("Unknown step") from exc

    def _ancestors(self, result_id: str | None) -> set[str]:
        required: set[str] = set()
        pending = [result_id] if result_id is not None else []
        while pending:
            sid = pending.pop()
            if sid not in required:
                required.add(sid)
                pending.extend(self._step(sid).parents)
        return required

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
        cells = len(frame) * len(frame.columns)
        if self.max_cells is not None and self._recorded_cells + cells > self.max_cells:
            raise CaptureLimitError("Story exceeds cumulative max_cells; data was not sampled")
        if not all(isinstance(c, str) and c.strip() for c in frame.columns):
            raise UnsupportedDataError("Columns must have unique, nonempty string names")
        if not frame.columns.is_unique:
            raise UnsupportedDataError("Columns must have unique, nonempty string names")
        if len(frame.columns) == 0:
            raise UnsupportedDataError("At least one column is required")
        for column in frame.columns:
            validate_text(column)
        for values in _row_values(frame):
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
        self._step_index[step.id] = step
        self._recorded_cells += cells
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

    def _export_plan(self, result: StoryFrame | None) -> tuple[dict[str, Any], list[_Step]]:
        result_id = self._result(result)
        required = self._ancestors(result_id)
        timeline = []
        sid = result_id
        while sid is not None:
            timeline.append(sid)
            parents = self._step(sid).parents
            sid = parents[0] if parents else None
        timeline.reverse()
        return {
            "format": "framechoreo.story",
            "schema_version": 1,
            "library_version": VERSION,
            "pandas_version": pd.__version__,
            "title": self.title,
            "result": result_id,
            "timeline": timeline,
        }, [step for step in self._steps if step.id in required]

    @staticmethod
    def _step_header(step: _Step, presentation: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": step.id,
            "name": step.name,
            "operation": step.operation,
            "label": step.label,
            "columns": list(step.frame.columns),
            "dtypes": [str(x) for x in step.frame.dtypes],
            "parents": list(step.parents),
            "parameters": copy.deepcopy(step.parameters),
            "presentation": copy.deepcopy(presentation),
        }

    @staticmethod
    def _row_record(step: _Step, i: int, values: tuple[Any, ...]) -> dict[str, Any]:
        refs = step.row_parents[i] if step.row_parents else ()
        cell_refs = step.cell_parents[i] if step.cell_parents else {}
        return {
            "id": f"{step.id}:{i}",
            "position": i,
            "cells": [encode_cell(v) for v in values],
            "parents": [{"step": r.step, "row": r.row} for r in refs],
            "cell_parents": {
                col: [{"step": r.step, "row": r.row, "column": r.column} for r in rr]
                for col, rr in cell_refs.items()
            },
        }

    def to_dict(self, *, result: StoryFrame | None = None) -> dict[str, Any]:
        """Return detached display data for the result and its ancestors."""
        payload, steps = self._export_plan(result)
        records = []
        for step in steps:
            record = self._step_header(step, self._presentations.get(step.id, {}))
            record["rows"] = [
                self._row_record(step, i, values)
                for i, values in enumerate(_row_values(step.frame))
            ]
            records.append(record)
        payload["steps"] = records
        return payload

    def to_json(self, *, result: StoryFrame | None = None) -> str:
        """Encode one row at a time, without materializing a second complete story."""
        payload, steps = self._export_plan(result)
        stream = io.StringIO()
        size = 0
        encoder = json.JSONEncoder(ensure_ascii=False, allow_nan=False, separators=(",", ":"))

        def raw(chunk: str) -> None:
            nonlocal size
            size += len(chunk.encode("utf-8"))
            if size > self.max_export_bytes:
                raise CaptureLimitError(
                    "Recorded data exceeds max_export_bytes; nothing was truncated"
                )
            stream.write(chunk)

        def value(item: Any) -> None:
            for chunk in encoder.iterencode(item):
                raw(chunk)

        def header(item: dict[str, Any]) -> None:
            raw("{")
            for i, (key, entry) in enumerate(item.items()):
                if i:
                    raw(",")
                value(key)
                raw(":")
                value(entry)

        header(payload)
        raw(',"steps":[')
        for position, step in enumerate(steps):
            if position:
                raw(",")
            header(self._step_header(step, self._presentations.get(step.id, {})))
            raw(',"rows":[')
            for i, values in enumerate(_row_values(step.frame)):
                if i:
                    raw(",")
                value(self._row_record(step, i, values))
            raw("]}")
        raw("]}")
        return stream.getvalue()

    def to_html(
        self, *, result: StoryFrame | None = None, theme: str = "auto", compression: str = "auto"
    ) -> str:
        """Return a self-contained player with no external assets or network requests."""
        from .export import render_html

        if self._result(result) is None:
            raise ValueError("Add a table before exporting HTML")
        return render_html(self.to_json(result=result), self.title, theme, compression=compression)

    def export_html(
        self,
        path: str | Path,
        *,
        result: StoryFrame | None = None,
        theme: str = "auto",
        overwrite: bool = False,
        compression: str = "auto",
    ) -> Path:
        """Write HTML atomically; refuse to replace an existing file by default."""
        from .export import write_html

        return write_html(
            path,
            self.to_html(result=result, theme=theme, compression=compression),
            overwrite=overwrite,
        )

    def export_info(self, *, result: StoryFrame | None = None) -> dict[str, Any]:
        """Summarize the data that will travel with an export."""
        text = self.to_json(result=result)
        _, steps = self._export_plan(result)
        return {
            "steps": len(steps),
            "rows_across_snapshots": sum(len(s.frame) for s in steps),
            "cells_across_snapshots": sum(len(s.frame) * len(s.frame.columns) for s in steps),
            "json_bytes": len(text.encode("utf-8")),
            "source_tables": [s.name for s in steps if s.operation == "source"],
            "includes_filtered_out_rows": True,
        }

    def _repr_html_(self) -> str:
        from .export import notebook_html, notebook_placeholder

        if not self._steps:
            return notebook_placeholder(self.title)
        return notebook_html(self.to_html(), self.title)


class StoryFrame:
    """An immutable recorded step, with a small explicit operation surface."""

    def __init__(self, story: DataStory, step_id: str) -> None:
        if not isinstance(story, DataStory):
            raise ValueError("story must be a DataStory")
        story._step(step_id)
        self._story = story
        self._step_id = step_id

    @property
    def step_id(self) -> str:
        return self._step_id

    @property
    def _snapshot(self) -> _Step:
        return self._story._step(self.step_id)

    def to_pandas(self) -> pd.DataFrame:
        """Return a copy, so changes cannot mutate the recorded history."""
        return _detached_copy(self._snapshot.frame)

    def _record_rows(
        self,
        output: pd.DataFrame,
        *,
        operation: str,
        label: str,
        positions: Sequence[int],
        columns: dict[str, tuple[str, ...]],
        parameters: dict[str, Any],
    ) -> StoryFrame:
        return self._story._add(
            output,
            name={
                "sort": "Sorted rows",
                "select": "Selected columns",
                "rename": "Renamed columns",
                "calculate": "Calculated column",
            }[operation],
            operation=operation,
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in positions),
            cell_parents=tuple(
                {
                    out: tuple(_CellRef(self.step_id, i, source) for source in inputs)
                    for out, inputs in columns.items()
                }
                for i in positions
            ),
            parameters=parameters,
        )

    def sort_values(
        self,
        by: str | Sequence[str],
        *,
        ascending: bool | Sequence[bool] = True,
        na_position: str = "last",
        label: str = "Sort rows",
    ) -> StoryFrame:
        """Stably reorder rows while retaining their original positional identities."""
        df = self.to_pandas()
        keys = _keys(by, df.columns)
        if not isinstance(ascending, bool):
            if not isinstance(ascending, (list, tuple)) or len(ascending) != len(keys):
                raise ValueError("ascending must be a boolean or one boolean per sort key")
            if not all(isinstance(item, bool) for item in ascending):
                raise ValueError("ascending must contain booleans")
            ascending = list(ascending)
        if na_position not in ("first", "last"):
            raise ValueError("na_position must be 'first' or 'last'")
        output = df.sort_values(keys, ascending=ascending, na_position=na_position, kind="stable")
        positions = (
            df[keys]
            .reset_index(drop=True)
            .sort_values(keys, ascending=ascending, na_position=na_position, kind="stable")
            .index.tolist()
        )
        return self._record_rows(
            output,
            operation="sort",
            label=label,
            positions=positions,
            columns={c: (c,) for c in df.columns},
            parameters={
                "by": keys,
                "ascending": ascending,
                "na_position": na_position,
                "positions": positions,
            },
        )

    def select_columns(
        self, columns: str | Sequence[str], *, label: str = "Select columns"
    ) -> StoryFrame:
        """Choose and order columns without dropping their value inputs."""
        df = self.to_pandas()
        chosen = _keys(columns, df.columns)
        return self._record_rows(
            df.loc[:, chosen],
            operation="select",
            label=label,
            positions=range(len(df)),
            columns={c: (c,) for c in chosen},
            parameters={"columns": chosen},
        )

    def rename_columns(
        self, mapping: Mapping[str, str], *, label: str = "Rename columns"
    ) -> StoryFrame:
        """Rename columns and keep references to the old source column names."""
        df = self.to_pandas()
        if not isinstance(mapping, Mapping) or not mapping:
            raise ValueError("mapping must contain column names to rename")
        names = dict(mapping)
        if any(not isinstance(k, str) or k not in df.columns for k in names):
            raise ValueError("All renamed columns must exist")
        if any(not isinstance(v, str) or not v.strip() for v in names.values()):
            raise ValueError("New column names must be nonempty strings")
        output = df.rename(columns=names)
        if not output.columns.is_unique:
            raise ValueError("Renaming must keep column names unique")
        return self._record_rows(
            output,
            operation="rename",
            label=label,
            positions=range(len(df)),
            columns={names.get(c, c): (c,) for c in df.columns},
            parameters={"mapping": names},
        )

    def calculate(
        self,
        name: str,
        *,
        left: str,
        op: str,
        right: str | int | float,
        label: str = "Calculate a column",
    ) -> StoryFrame:
        """Add a row-wise numeric column using a known arithmetic operation.

        ``right`` is a column name or a numeric scalar. Arbitrary callbacks are
        not accepted, so references describe the actual operands of each row.
        """
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        operations = {
            "add": operator.add,
            "subtract": operator.sub,
            "multiply": operator.mul,
            "divide": operator.truediv,
        }
        if not isinstance(op, str) or op not in operations:
            raise ValueError("op must be add, subtract, multiply, or divide")
        inputs = _keys([left], df.columns)
        if isinstance(right, str):
            _keys([right], df.columns)
            inputs.append(right)
            operand = df[right]
            right_record = {"column": right}
        else:
            if isinstance(right, (bool, np.bool_, np.timedelta64)) or not isinstance(
                right, (int, float, np.integer, np.floating)
            ):
                raise ValueError("right must be a numeric scalar or a column name")
            right_record = {"constant": encode_cell(right)}
            operand = right
        for column in inputs:
            if not pd.api.types.is_numeric_dtype(df[column].dtype) or pd.api.types.is_bool_dtype(
                df[column].dtype
            ):
                raise UnsupportedDataError("calculate requires numeric, non-boolean operands")
        df[name] = operations[op](df[left], operand)
        columns = {c: (c,) for c in self._snapshot.frame.columns}
        columns[name] = tuple(inputs)
        return self._record_rows(
            df,
            operation="calculate",
            label=label,
            positions=range(len(df)),
            columns=columns,
            parameters={"name": name, "left": left, "op": op, "right": right_record},
        )

    def filter_rows(
        self,
        predicate: Callable[[pd.DataFrame], Any] | Any,
        *,
        label: str = "Filter rows",
    ) -> StoryFrame:
        df = self.to_pandas()
        before = tuple(tuple(cell_signature(v) for v in row) for row in _row_values(df))
        mask = predicate(df) if callable(predicate) else predicate
        try:
            pd.testing.assert_frame_equal(df, self._snapshot.frame, check_exact=True)
            for expected, row in zip(before, _row_values(df), strict=True):
                if any(
                    original != cell_signature(v) for original, v in zip(expected, row, strict=True)
                ):
                    raise ValueError("Recorded cell representation changed")
        except (AssertionError, TypeError, ValueError) as exc:
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
        if (
            isinstance(min_count, bool)
            or not isinstance(min_count, int)
            or not 0 <= min_count <= 2**53 - 1
        ):
            raise ValueError("min_count must be an integer from 0 through 2**53 - 1")
        if not pd.api.types.is_numeric_dtype(df[value].dtype) or pd.api.types.is_bool_dtype(
            df[value].dtype
        ):
            raise UnsupportedDataError("group_sum requires a numeric, non-boolean value column")
        grouped = df.groupby(keys, dropna=dropna, sort=sort, observed=True)
        output = grouped[value].sum(min_count=min_count).reset_index()
        group_ids = grouped.ngroup().to_numpy()
        members_by_group: list[list[int]] = [[] for _ in range(len(output))]
        for position, group in enumerate(group_ids):
            if not pd.isna(group):
                members_by_group[int(group)].append(position)
        present = df[value].notna().to_numpy(dtype=bool)
        row_parents = []
        cell_parents = []
        groups = []
        for i, members in enumerate(members_by_group):
            row_parents.append(tuple(_RowRef(self.step_id, j) for j in members))
            refs = {c: tuple(_CellRef(self.step_id, j, c) for j in members) for c in keys}
            refs[value] = tuple(_CellRef(self.step_id, j, value) for j in members if present[j])
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

    def _lineage_counts(self, row: int, column: str, cap: int | None = None):
        if (
            isinstance(row, bool)
            or not isinstance(row, int)
            or not 0 <= row < len(self._snapshot.frame)
        ):
            raise IndexError("row is an output row position")
        if column not in self._snapshot.frame.columns:
            raise KeyError(column)
        reference = _CellRef(self.step_id, row, column)
        counts: dict[_CellRef, int] = {}
        work = [(reference, False)]
        while work:
            ref, expanded = work.pop()
            if ref in counts:
                continue
            step = self._story._step(ref.step)
            if step.operation == "source":
                counts[ref] = 1
                continue
            parents = step.cell_parents[ref.row].get(ref.column, ())
            if expanded:
                count = sum(counts[parent] for parent in parents)
                counts[ref] = min(cap, count) if cap is not None else count
            else:
                work.append((ref, True))
                work.extend((parent, False) for parent in parents if parent not in counts)
        return reference, counts

    def _origin_slice(self, reference, counts, offset: int, limit: int) -> tuple[CellOrigin, ...]:
        pending = [reference]
        origins = []
        while pending and len(origins) < limit:
            ref = pending.pop()
            if counts[ref] <= offset:
                offset -= counts[ref]
                continue
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
            else:
                pending.extend(reversed(step.cell_parents[ref.row].get(ref.column, ())))
        return tuple(origins)

    def explain(
        self, row: int, column: str, *, max_sources: int = 10_000
    ) -> tuple[CellOrigin, ...]:
        """Trace all raw source uses, or fail before exceeding max_sources."""
        _positive_integer(max_sources, "max_sources")
        reference, counts = self._lineage_counts(row, column, max_sources + 1)
        if counts[reference] > max_sources:
            raise CaptureLimitError("Cell has more than max_sources inputs")
        return self._origin_slice(reference, counts, 0, max_sources)

    def explain_page(
        self, row: int, column: str, *, offset: int = 0, limit: int = 50
    ) -> OriginPage:
        """Read a bounded page without expanding all preceding or repeated inputs.

        The total is exact. Offsets count source uses, including repetitions;
        an offset at or beyond the end returns an empty page.
        """
        if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
            raise ValueError("offset must be a nonnegative integer")
        _positive_integer(limit, "limit")
        if limit > 10_000:
            raise ValueError("limit must not exceed 10,000 inputs per page")
        reference, counts = self._lineage_counts(row, column)
        origins = self._origin_slice(reference, counts, offset, limit)
        return OriginPage(origins, counts[reference], offset)

    def _repr_html_(self) -> str:
        from .export import notebook_html

        return notebook_html(self._story.to_html(result=self), self._story.title)
