"""Explicit pandas workflows with immutable snapshots and local provenance."""

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
from .profile import profile_frame

VERSION = "1.0.0rc4"


@dataclass(frozen=True, slots=True)
class ColumnRef:
    """Explicitly select a column operand where a string could mean a literal."""

    name: str


def col(name: str) -> ColumnRef:
    """Refer to a column in a conditional value or comparison."""
    return ColumnRef(_text(name, "column", 100))


@dataclass(frozen=True, slots=True)
class Condition:
    """An explicit comparison tree evaluated with pandas nullable-boolean logic."""

    kind: str
    column: str | None = None
    op: str | None = None
    value: Any = None
    children: tuple[Condition, ...] = ()

    def __and__(self, other: Condition) -> Condition:
        if not isinstance(other, Condition):
            return NotImplemented
        return Condition("all", children=(self, other))

    def __or__(self, other: Condition) -> Condition:
        if not isinstance(other, Condition):
            return NotImplemented
        return Condition("any", children=(self, other))

    def __invert__(self) -> Condition:
        return Condition("not", children=(self,))

    def __bool__(self) -> bool:
        raise TypeError("Combine conditions with &, |, and ~, not and/or/not")


def where(column: str, op: str, value: Any = None) -> Condition:
    """Build a safe, explicit condition for ``case_when`` or ``filter_by``."""
    name = _text(column, "column", 100)
    if op not in (
        "eq",
        "ne",
        "gt",
        "ge",
        "lt",
        "le",
        "is_missing",
        "is_not_missing",
        "in",
        "between",
    ):
        raise ValueError("Unsupported condition operator")
    return Condition(
        "atom", column=name, op=op, value=tuple(value) if isinstance(value, list) else value
    )


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
    row_controls: tuple[tuple[_CellRef, ...], ...] = ()
    cell_controls: tuple[dict[str, tuple[_CellRef, ...]], ...] = ()


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


def _operand(
    value: Any, columns: pd.Index, *, allow_missing: bool = False
) -> tuple[dict[str, Any], str | None, Any]:
    if isinstance(value, ColumnRef):
        _keys([value.name], columns)
        return {"column": value.name}, value.name, None
    cell = encode_cell(value)
    if cell["type"] == "missing" and not allow_missing:
        raise ValueError("Use is_missing or is_not_missing to test missing values")
    return {"constant": cell}, None, value


def _condition(
    df: pd.DataFrame, column: str, op: str, value: Any
) -> tuple[dict[str, Any], list[str], list[str]]:
    _keys([column], df.columns)
    if not isinstance(op, str):
        raise ValueError("Unsupported condition operator")
    comparisons = {
        "eq": operator.eq,
        "ne": operator.ne,
        "gt": operator.gt,
        "ge": operator.ge,
        "lt": operator.lt,
        "le": operator.le,
    }
    if op in ("is_missing", "is_not_missing"):
        if value is not None:
            raise ValueError("Missingness conditions do not accept a comparison value")
        operand, fields = None, [column]
        mask = df[column].isna() if op == "is_missing" else df[column].notna()
    elif op in comparisons:
        operand, other_column, target = _operand(value, df.columns)
        fields = [column, *([other_column] if other_column else [])]
        if other_column is not None:
            target = df[other_column]
        try:
            mask = comparisons[op](df[column], target)
        except (TypeError, ValueError) as exc:
            raise ValueError("Condition operands cannot be compared") from exc
    elif op == "in":
        if not isinstance(value, (tuple, list)) or len(value) > 1000:
            raise ValueError(
                "Membership values must be an ordered sequence of at most 1000 scalars"
            )
        cells = [encode_cell(item) for item in value]
        operand, fields = {"values": cells}, [column]
        mask = df[column].isin(value)
    elif op == "between":
        if not isinstance(value, (tuple, list)) or len(value) != 2:
            raise ValueError("between requires lower and upper bounds")
        bounds = [_operand(bound, df.columns) for bound in value]
        operand = {"bounds": [item[0] for item in bounds]}
        fields = [column, *(item[1] for item in bounds if item[1])]
        targets = [df[item[1]] if item[1] else item[2] for item in bounds]
        try:
            mask = df[column].between(*targets, inclusive="both")
        except (TypeError, ValueError) as exc:
            raise ValueError("Condition bounds cannot be compared") from exc
    else:
        raise ValueError("Unsupported condition operator")
    try:
        boolean = pd.array(mask, dtype="boolean")
    except (TypeError, ValueError) as exc:
        raise ValueError("Condition must produce one boolean per row") from exc
    if len(boolean) != len(df):
        raise ValueError("Condition must produce one boolean per row")
    outcomes = ["missing" if pd.isna(x) else "true" if x else "false" for x in boolean]
    return {"column": column, "op": op, "value": operand}, fields, outcomes


def _evaluate_condition(
    df: pd.DataFrame, expression: Condition, *, depth: int = 0, count: list[int] | None = None
) -> tuple[dict[str, Any], list[str], list[str], list[list[str]]]:
    if not isinstance(expression, Condition):
        raise ValueError("Invalid condition tree")
    if count is None:
        count = [0]
    if depth > 8:
        raise ValueError("Condition tree exceeds depth 8")
    if expression.kind == "atom":
        count[0] += 1
        if count[0] > 32:
            raise ValueError("Condition tree exceeds 32 comparisons")
        if expression.children:
            raise ValueError("An atomic condition cannot have children")
        record, fields, outcomes = _condition(
            df, expression.column, expression.op, expression.value
        )
        return record, fields, outcomes, [outcomes]
    if expression.kind not in ("all", "any", "not") or len(expression.children) != (
        1 if expression.kind == "not" else 2
    ):
        raise ValueError("Invalid condition tree")
    parts = [
        _evaluate_condition(df, child, depth=depth + 1, count=count)
        for child in expression.children
    ]
    arrays = [
        pd.array(
            [pd.NA if value == "missing" else value == "true" for value in part[2]], dtype="boolean"
        )
        for part in parts
    ]
    result = (
        ~arrays[0]
        if expression.kind == "not"
        else arrays[0] & arrays[1]
        if expression.kind == "all"
        else arrays[0] | arrays[1]
    )
    outcomes = ["missing" if pd.isna(x) else "true" if x else "false" for x in result]
    return (
        {"kind": expression.kind, "children": [part[0] for part in parts]},
        [field for part in parts for field in part[1]],
        outcomes,
        [leaf for part in parts for leaf in part[3]],
    )


def _condition_leaves(record: dict[str, Any]) -> Iterator[dict[str, Any]]:
    if "kind" not in record:
        yield record
    else:
        for child in record["children"]:
            yield from _condition_leaves(child)


class DataStory:
    """Capture explicit workflows and export a network-independent HTML player.

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
        language: str = "en",
        description: str = "",
    ) -> None:
        self.title = title
        self.max_rows = max_rows
        self.max_columns = max_columns
        self.max_steps = max_steps
        self.max_export_bytes = max_export_bytes
        self.max_cells = max_cells
        self.language = language
        self.description = description
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
        language: str = "en",
        description: str = "",
    ) -> DataStory:
        """Opt into larger captures while bounding the total cells across snapshots."""
        return cls(
            title,
            max_rows=max_rows,
            max_columns=max_columns,
            max_steps=max_steps,
            max_export_bytes=max_export_bytes,
            max_cells=max_cells,
            language=language,
            description=description,
        )

    @property
    def language(self) -> str:
        return self._language

    @language.setter
    def language(self, value: str) -> None:
        if not isinstance(value, str) or value not in ("en", "ja"):
            raise ValueError("language must be 'en' or 'ja'")
        self._language = value

    @property
    def description(self) -> str:
        return self._description

    @description.setter
    def description(self, value: str) -> None:
        if not isinstance(value, str) or len(value) > 2000:
            raise ValueError("description must be a string of at most 2000 characters")
        self._description = validate_text(value)

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
        row_controls: tuple[tuple[_CellRef, ...], ...] = (),
        cell_controls: tuple[dict[str, tuple[_CellRef, ...]], ...] = (),
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
            row_controls=row_controls,
            cell_controls=cell_controls,
        )
        self._steps.append(step)
        self._step_index[step.id] = step
        self._recorded_cells += cells
        return StoryFrame(self, step.id)

    def table(self, frame: pd.DataFrame, *, name: str | None = None) -> StoryFrame:
        """Record a detached source table. Index labels are not used as row identity."""
        chosen_name = name if name is not None else f"Table {len(self._steps) + 1}"
        return self._add(frame, name=chosen_name, operation="source", label=chosen_name)

    def concat(
        self,
        frames: Sequence[StoryFrame],
        *,
        join: str = "outer",
        ignore_index: bool = True,
        label: str = "Combine rows",
    ) -> StoryFrame:
        """Stack recorded tables. Missing schema fields have no invented input cell."""
        if isinstance(frames, (str, Mapping, Set)):
            raise ValueError("frames must be an ordered sequence of recorded tables")
        frames = list(frames)
        if not frames or any(not isinstance(f, StoryFrame) or f._story is not self for f in frames):
            raise ValueError("frames must contain tables from the same story")
        if (
            not isinstance(join, str)
            or join not in ("outer", "inner")
            or not isinstance(ignore_index, bool)
        ):
            raise ValueError("join must be outer/inner and ignore_index must be a boolean")
        if sum(len(f._snapshot.frame) for f in frames) > self.max_rows:
            raise CaptureLimitError("Concatenation exceeds max_rows")
        output = pd.concat(
            [f.to_pandas() for f in frames], join=join, ignore_index=ignore_index, sort=False
        )
        row_parents, cell_parents = [], []
        for f in frames:
            for i in range(len(f._snapshot.frame)):
                row_parents.append((_RowRef(f.step_id, i),))
                cell_parents.append(
                    {
                        c: (_CellRef(f.step_id, i, c),) if c in f._snapshot.frame.columns else ()
                        for c in output.columns
                    }
                )
        return self._add(
            output,
            name="Combined rows",
            operation="concat",
            label=label,
            parents=tuple(dict.fromkeys(f.step_id for f in frames)),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            parameters={
                "inputs": [f.step_id for f in frames],
                "join": join,
                "ignore_index": ignore_index,
            },
        )

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
        chapter: str = "",
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
        if not isinstance(chapter, str) or len(chapter) > 100:
            raise ValueError("chapter must be a string of at most 100 characters")
        validate_text(chapter)
        if isinstance(hold, bool) or not isinstance(hold, (int, float)):
            raise ValueError("hold must be between 1 and 30 seconds")
        if not 1 <= hold <= 30 or not math.isfinite(hold):
            raise ValueError("hold must be between 1 and 30 seconds")
        columns = _keys(highlight, frame._snapshot.frame.columns, allow_empty=True)
        self._presentations[sid] = {
            "note": note,
            "hold_ms": round(hold * 1000),
            "highlight": columns,
            **({"chapter": chapter} if chapter else {}),
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
            "language": self.language,
            "description": self.description,
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
            "profile": profile_frame(step.frame),
        }

    @staticmethod
    def _row_record(step: _Step, i: int, values: tuple[Any, ...]) -> dict[str, Any]:
        refs = step.row_parents[i] if step.row_parents else ()
        cell_refs = step.cell_parents[i] if step.cell_parents else {}
        record = {
            "id": f"{step.id}:{i}",
            "position": i,
            "cells": [encode_cell(v) for v in values],
            "parents": [{"step": r.step, "row": r.row} for r in refs],
            "cell_parents": {
                col: [{"step": r.step, "row": r.row, "column": r.column} for r in rr]
                for col, rr in cell_refs.items()
            },
        }
        if step.row_controls:
            record["row_controls"] = [
                {"step": r.step, "row": r.row, "column": r.column} for r in step.row_controls[i]
            ]
        if step.cell_controls:
            record["cell_controls"] = {
                col: [{"step": r.step, "row": r.row, "column": r.column} for r in rr]
                for col, rr in step.cell_controls[i].items()
            }
        return record

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
        return render_html(
            self.to_json(result=result),
            self.title,
            theme,
            compression=compression,
            language=self.language,
        )

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
            return notebook_placeholder(self.title, self.language)
        return notebook_html(self.to_html(), self.title)


class StoryFrame:
    """An immutable recorded step, with an explicit operation surface."""

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

    def profile(self) -> dict[str, Any]:
        """Return a detached summary of dtypes, missingness, uniqueness and duplicate rows."""
        return profile_frame(self._snapshot.frame)

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
            }.get(operation, operation.replace("_", " ").capitalize()),
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

    def drop_missing(
        self,
        *,
        subset: str | Sequence[str] | None = None,
        how: str = "any",
        label: str = "Remove missing rows",
    ) -> StoryFrame:
        """Remove rows missing any/all of the chosen fields, using pandas semantics."""
        df = self.to_pandas()
        columns = list(df.columns) if subset is None else _keys(subset, df.columns)
        if not isinstance(how, str) or how not in ("any", "all"):
            raise ValueError("how must be 'any' or 'all'")
        absent = df[columns].isna()
        removed = absent.any(axis=1) if how == "any" else absent.all(axis=1)
        positions = np.flatnonzero(~removed.to_numpy()).tolist()
        return self._record_rows(
            df.iloc[positions],
            operation="drop_missing",
            label=label,
            positions=positions,
            columns={c: (c,) for c in df.columns},
            parameters={
                "subset": columns,
                "how": how,
                "positions": positions,
                "removed_rows": len(df) - len(positions),
            },
        )

    def drop_duplicates(
        self,
        *,
        subset: str | Sequence[str] | None = None,
        keep: str | bool = "first",
        label: str = "Remove duplicate rows",
    ) -> StoryFrame:
        """Deduplicate by value while retaining exact positional identities."""
        df = self.to_pandas()
        columns = list(df.columns) if subset is None else _keys(subset, df.columns)
        if keep is not False and keep not in ("first", "last"):
            raise ValueError("keep must be first, last, or False")
        positions = np.flatnonzero(~df.duplicated(subset=columns, keep=keep).to_numpy()).tolist()
        return self._record_rows(
            df.iloc[positions],
            operation="drop_duplicates",
            label=label,
            positions=positions,
            columns={c: (c,) for c in df.columns},
            parameters={
                "subset": columns,
                "keep": keep,
                "positions": positions,
                "removed_rows": len(df) - len(positions),
            },
        )

    def fill_missing(
        self, values: Mapping[str, Any], *, label: str = "Fill missing values"
    ) -> StoryFrame:
        """Fill chosen fields with explicit constants, which are not invented source cells."""
        df = self.to_pandas()
        if not isinstance(values, Mapping) or not values:
            raise ValueError("values must map existing columns to non-missing scalar constants")
        columns = _keys(list(values), df.columns)
        constants = {c: encode_cell(values[c]) for c in columns}
        if any(v["type"] == "missing" for v in constants.values()):
            raise ValueError("Fill constants must not be missing")
        filled = {c: np.flatnonzero(df[c].isna().to_numpy()).tolist() for c in columns}
        output = df.fillna(dict(values))
        positions = {c: set(rows) for c, rows in filled.items()}
        return self._story._add(
            output,
            name="Filled values",
            operation="fill_missing",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {
                    c: () if i in positions.get(c, ()) else (_CellRef(self.step_id, i, c),)
                    for c in df.columns
                }
                for i in range(len(df))
            ),
            parameters={"values": constants, "filled_positions": filled},
        )

    def take_rows(self, positions: Sequence[int], *, label: str = "Choose rows") -> StoryFrame:
        """Select explicit nonnegative row positions; order and repeated uses are preserved."""
        if isinstance(positions, (str, Mapping, Set)):
            raise ValueError("positions must be an ordered sequence of row numbers")
        chosen = list(positions)
        if any(
            isinstance(i, (bool, np.bool_)) or not isinstance(i, (int, np.integer)) for i in chosen
        ):
            raise ValueError("positions must contain integers")
        if any(i < 0 or i >= len(self._snapshot.frame) for i in chosen):
            raise IndexError("A requested row position is outside the table")
        if len(chosen) > self._story.max_rows:
            raise CaptureLimitError("Selected rows exceed max_rows")
        chosen = [int(i) for i in chosen]
        df = self.to_pandas()
        return self._record_rows(
            df.iloc[chosen],
            operation="take",
            label=label,
            positions=chosen,
            columns={c: (c,) for c in df.columns},
            parameters={"positions": chosen},
        )

    def astype(
        self, mapping: Mapping[str, str], *, label: str = "Change column types"
    ) -> StoryFrame:
        """Convert fields using explicit pandas dtype names and errors='raise'."""
        df = self.to_pandas()
        if not isinstance(mapping, Mapping) or not mapping:
            raise ValueError("mapping must contain column names and dtype strings")
        _keys(list(mapping), df.columns)
        if any(not isinstance(dtype, str) or not dtype.strip() for dtype in mapping.values()):
            raise ValueError("Each target dtype must be a nonempty string")
        return self._record_rows(
            df.astype(dict(mapping)),
            operation="astype",
            label=label,
            positions=range(len(df)),
            columns={c: (c,) for c in df.columns},
            parameters={"mapping": dict(mapping)},
        )

    def to_numeric(
        self,
        columns: str | Sequence[str],
        *,
        errors: str = "raise",
        label: str = "Parse numeric values",
    ) -> StoryFrame:
        """Parse numbers. A coerced missing value still points to the original input text."""
        df = self.to_pandas()
        chosen = _keys(columns, df.columns)
        if not isinstance(errors, str) or errors not in ("raise", "coerce"):
            raise ValueError("errors must be raise or coerce")
        for c in chosen:
            df[c] = pd.to_numeric(df[c], errors=errors)
        return self._record_rows(
            df,
            operation="to_numeric",
            label=label,
            positions=range(len(df)),
            columns={c: (c,) for c in df.columns},
            parameters={"columns": chosen, "errors": errors},
        )

    def to_datetime(
        self,
        columns: str | Sequence[str],
        *,
        format: str,
        errors: str = "raise",
        utc: bool = False,
        label: str = "Parse date values",
    ) -> StoryFrame:
        """Parse dates using an explicit format; timezone normalization is opt-in."""
        df = self.to_pandas()
        chosen = _keys(columns, df.columns)
        _text(format, "format", 200)
        if (
            not isinstance(errors, str)
            or errors not in ("raise", "coerce")
            or not isinstance(utc, bool)
        ):
            raise ValueError("errors must be raise/coerce and utc must be a boolean")
        for c in chosen:
            df[c] = pd.to_datetime(df[c], format=format, errors=errors, utc=utc)
        return self._record_rows(
            df,
            operation="to_datetime",
            label=label,
            positions=range(len(df)),
            columns={c: (c,) for c in df.columns},
            parameters={"columns": chosen, "format": format, "errors": errors, "utc": utc},
        )

    def string_transform(
        self, columns: str | Sequence[str], *, op: str, label: str = "Normalize text"
    ) -> StoryFrame:
        """Apply strip/lower/upper/casefold to string-or-missing columns."""
        df = self.to_pandas()
        chosen = _keys(columns, df.columns)
        if not isinstance(op, str) or op not in ("strip", "lower", "upper", "casefold"):
            raise ValueError("op must be strip, lower, upper, or casefold")
        for c in chosen:
            if any(not isinstance(v, str) for v in df[c].dropna().array):
                raise UnsupportedDataError("string_transform requires strings or missing values")
            if len(df[c].dropna()):
                df[c] = getattr(df[c].str, op)()
        return self._record_rows(
            df,
            operation="string_transform",
            label=label,
            positions=range(len(df)),
            columns={c: (c,) for c in df.columns},
            parameters={"columns": chosen, "op": op},
        )

    def melt(
        self,
        *,
        id_vars: str | Sequence[str],
        value_vars: str | Sequence[str],
        var_name: str = "variable",
        value_name: str = "value",
        label: str = "Unpivot columns into rows",
    ) -> StoryFrame:
        """Convert an explicit set of value columns to long form (ignore_index=True)."""
        df = self.to_pandas()
        ids = _keys(id_vars, df.columns, allow_empty=True)
        values = _keys(value_vars, df.columns)
        if set(ids) & set(values):
            raise ValueError("id_vars and value_vars must not overlap")
        if any(not isinstance(c, str) or not c.strip() for c in [var_name, value_name]):
            raise ValueError("Output column names must be nonempty strings")
        if var_name == value_name or var_name in ids or value_name in df.columns:
            raise ValueError("melt output column names must be distinct and unused")
        if len(df) * len(values) > self._story.max_rows:
            raise CaptureLimitError("Melt exceeds max_rows")
        output = df.melt(
            id_vars=ids,
            value_vars=values,
            var_name=var_name,
            value_name=value_name,
            ignore_index=True,
        )
        row_parents, cell_parents = [], []
        for column in values:
            for i in range(len(df)):
                row_parents.append((_RowRef(self.step_id, i),))
                cell_parents.append(
                    {
                        **{c: (_CellRef(self.step_id, i, c),) for c in ids},
                        var_name: (),
                        value_name: (_CellRef(self.step_id, i, column),),
                    }
                )
        return self._story._add(
            output,
            name="Long table",
            operation="melt",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            parameters={
                "id_vars": ids,
                "value_vars": values,
                "var_name": var_name,
                "value_name": value_name,
            },
        )

    def pivot(
        self,
        *,
        index: str | Sequence[str],
        columns: str,
        values: str,
        label: str = "Pivot rows into columns",
    ) -> StoryFrame:
        """Pivot unique key pairs without aggregation; pivoted column labels must be strings."""
        df = self.to_pandas()
        keys = _keys(index, df.columns)
        _keys([columns, values], df.columns)
        if columns in keys or values in keys:
            raise ValueError("index, columns, and values must name distinct fields")
        names = df[columns].drop_duplicates().tolist()
        if any(not isinstance(c, str) or not c.strip() or c in keys for c in names):
            raise UnsupportedDataError(
                "Pivot labels must be nonempty strings outside the index names"
            )
        if len(keys) + len(names) > self._story.max_columns:
            raise CaptureLimitError("Pivot exceeds max_columns")
        wide = df.pivot(index=keys, columns=columns, values=values)
        output = wide.reset_index()
        marker = object()
        source = df[[*keys, columns]].copy()
        source[marker] = np.arange(len(df), dtype=np.int64)
        positions = source.pivot(index=keys, columns=columns, values=marker).reindex(
            index=wide.index, columns=wide.columns
        )
        row_parents, cell_parents = [], []
        for i in range(len(output)):
            available = sorted(int(x) for x in positions.iloc[i] if not pd.isna(x))
            row_parents.append(tuple(_RowRef(self.step_id, j) for j in available))
            refs = {c: tuple(_CellRef(self.step_id, j, c) for j in available) for c in keys}
            for j, name in enumerate(wide.columns):
                position = positions.iat[i, j]
                refs[name] = (
                    () if pd.isna(position) else (_CellRef(self.step_id, int(position), values),)
                )
            cell_parents.append(refs)
        return self._story._add(
            output,
            name="Wide table",
            operation="pivot",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            parameters={
                "index": keys,
                "columns": columns,
                "values": values,
                "output_columns": list(wide.columns),
            },
        )

    def group_agg(
        self,
        *,
        by: str | Sequence[str],
        aggregations: Mapping[str, tuple[str, str]],
        dropna: bool,
        sort: bool = False,
        min_count: int = 1,
        label: str = "Summarize groups",
    ) -> StoryFrame:
        """Named sum/mean/min/max/median/count/nunique metrics in a single grouping."""
        df = self.to_pandas()
        keys = _keys(by, df.columns)
        if not isinstance(aggregations, Mapping) or not aggregations:
            raise ValueError("aggregations must map result names to (column, reducer)")
        if not isinstance(dropna, bool) or not isinstance(sort, bool):
            raise ValueError("dropna and sort must be booleans")
        if (
            isinstance(min_count, bool)
            or not isinstance(min_count, int)
            or not 0 <= min_count <= 2**53 - 1
        ):
            raise ValueError("min_count must be an integer from 0 through 2**53 - 1")
        metrics = []
        for name, spec in aggregations.items():
            if not isinstance(name, str) or not name.strip() or name in keys:
                raise ValueError("Metric names must be nonempty and distinct from grouping keys")
            if not isinstance(spec, (tuple, list)) or len(spec) != 2:
                raise ValueError("Each metric must be (column, reducer)")
            column, agg = spec
            self._group_keys_and_value(df, keys, column)
            if not isinstance(agg, str) or agg not in (
                "sum",
                "mean",
                "min",
                "max",
                "median",
                "count",
                "nunique",
            ):
                raise ValueError("Unsupported named reducer")
            if agg in ("sum", "mean", "median") and (
                not pd.api.types.is_numeric_dtype(df[column].dtype)
                or pd.api.types.is_bool_dtype(df[column].dtype)
            ):
                raise UnsupportedDataError("This reducer requires a numeric, non-boolean column")
            metrics.append({"output": name, "column": column, "agg": agg})
        grouped = df.groupby(keys, dropna=dropna, sort=sort, observed=True)
        results = []
        for m in metrics:
            values = grouped[m["column"]]
            series = (
                values.sum(min_count=min_count)
                if m["agg"] == "sum"
                else getattr(values, m["agg"])()
            )
            results.append(series.rename(m["output"]))
        output = pd.concat(results, axis=1).reset_index()
        group_ids = grouped.ngroup().to_numpy()
        members: list[list[int]] = [[] for _ in range(len(output))]
        for i, group in enumerate(group_ids):
            if not pd.isna(group):
                members[int(group)].append(i)
        present = {m["column"]: df[m["column"]].notna().to_numpy(dtype=bool) for m in metrics}
        return self._story._add(
            output,
            name="Grouped metrics",
            operation="group_agg",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple(tuple(_RowRef(self.step_id, j) for j in rows) for rows in members),
            cell_parents=tuple(
                {
                    **{c: tuple(_CellRef(self.step_id, j, c) for j in rows) for c in keys},
                    **{
                        m["output"]: tuple(
                            _CellRef(self.step_id, j, m["column"])
                            for j in rows
                            if present[m["column"]][j]
                        )
                        for m in metrics
                    },
                }
                for rows in members
            ),
            parameters={
                "by": keys,
                "metrics": metrics,
                "dropna": dropna,
                "sort": sort,
                "min_count": min_count,
                "groups": [{"output_row": i, "input_rows": rows} for i, rows in enumerate(members)],
                "excluded_rows": int(pd.isna(group_ids).sum()),
            },
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

    def case_when(
        self,
        name: str,
        *,
        column: str | None = None,
        op: str | None = None,
        value: Any = None,
        condition: Condition | None = None,
        then: Any,
        otherwise: Any,
        label: str = "Choose a value by condition",
    ) -> StoryFrame:
        """Choose one value per row and separately record the deciding inputs.

        Strings are literals; use ``col("field")`` for a column operand.
        A missing comparison selects ``otherwise`` and is recorded as missing.
        """
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        if condition is not None:
            if (
                not isinstance(condition, Condition)
                or column is not None
                or op is not None
                or value is not None
            ):
                raise ValueError("Use either condition or column/op/value")
            condition_record, fields, outcomes, clause_outcomes = _evaluate_condition(df, condition)
        else:
            if column is None or op is None:
                raise ValueError("column and op are required without condition")
            condition_record, fields, outcomes = _condition(df, column, op, value)
            clause_outcomes = None
        true_record, true_column, true_literal = _operand(then, df.columns, allow_missing=True)
        false_record, false_column, false_literal = _operand(
            otherwise, df.columns, allow_missing=True
        )
        selected_values = []
        value_refs = []
        control_refs = []
        for i, outcome in enumerate(outcomes):
            chosen_column, literal = (
                (true_column, true_literal) if outcome == "true" else (false_column, false_literal)
            )
            selected_values.append(df[chosen_column].array[i] if chosen_column else literal)
            value_refs.append((_CellRef(self.step_id, i, chosen_column),) if chosen_column else ())
            control_refs.append(tuple(_CellRef(self.step_id, i, c) for c in fields))
        df[name] = pd.Series(selected_values, index=df.index).array
        original = self._snapshot.frame.columns
        return self._story._add(
            df,
            name="Conditional value",
            operation="case_when",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {**{c: (_CellRef(self.step_id, i, c),) for c in original}, name: value_refs[i]}
                for i in range(len(df))
            ),
            cell_controls=tuple({name: control_refs[i]} for i in range(len(df))),
            parameters={
                "name": name,
                "condition": condition_record,
                "then": true_record,
                "otherwise": false_record,
                "outcomes": outcomes,
                **({"clause_outcomes": clause_outcomes} if clause_outcomes is not None else {}),
            },
        )

    def case_select(
        self,
        name: str,
        *,
        cases: Sequence[tuple[Condition, Any]],
        otherwise: Any = None,
        label: str = "Choose the first matching case",
    ) -> StoryFrame:
        """Select the first true condition; missing checks continue to later cases.

        All conditions are evaluated as recorded inputs. A selected literal has
        no source value cell; column replacements use ``col("field")``.
        """
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        if not isinstance(cases, Sequence) or isinstance(cases, (str, bytes)):
            raise ValueError("cases must be an ordered sequence of condition/value pairs")
        if not 1 <= len(cases) <= 16:
            raise ValueError("cases must contain 1 through 16 branches")
        branches = list(cases)
        counter = [0]
        records = []
        condition_fields = []
        branch_values = []
        for branch in branches:
            if not isinstance(branch, (tuple, list)) or len(branch) != 2:
                raise ValueError("Each case must be (Condition, value)")
            condition, replacement = branch
            if not isinstance(condition, Condition):
                raise ValueError("Each case requires an explicit Condition")
            predicate, fields, outcomes, clauses = _evaluate_condition(df, condition, count=counter)
            operand, source_column, literal = _operand(replacement, df.columns, allow_missing=True)
            records.append(
                {
                    "condition": predicate,
                    "value": operand,
                    "outcomes": outcomes,
                    "clause_outcomes": clauses,
                }
            )
            condition_fields.extend(fields)
            branch_values.append((source_column, literal))
        default_record, default_column, default_literal = _operand(
            otherwise, df.columns, allow_missing=True
        )
        selected_cases: list[int | None] = []
        selected_values = []
        value_refs = []
        control_refs = []
        for row in range(len(df)):
            chosen = next(
                (i for i, branch in enumerate(records) if branch["outcomes"][row] == "true"),
                None,
            )
            selected_cases.append(chosen)
            source_column, literal = (
                branch_values[chosen] if chosen is not None else (default_column, default_literal)
            )
            selected_values.append(df[source_column].array[row] if source_column else literal)
            value_refs.append(
                (_CellRef(self.step_id, row, source_column),) if source_column else ()
            )
            control_refs.append(
                tuple(_CellRef(self.step_id, row, field) for field in condition_fields)
            )
        df[name] = pd.Series(selected_values, index=df.index).array
        original = self._snapshot.frame.columns
        return self._story._add(
            df,
            name="Ordered cases",
            operation="case_select",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {**{c: (_CellRef(self.step_id, i, c),) for c in original}, name: value_refs[i]}
                for i in range(len(df))
            ),
            cell_controls=tuple({name: control_refs[i]} for i in range(len(df))),
            parameters={
                "name": name,
                "cases": records,
                "otherwise": default_record,
                "selected_cases": selected_cases,
            },
        )

    def coalesce(
        self,
        name: str,
        columns: str | Sequence[str],
        *,
        default: Any = None,
        label: str = "Use the first available value",
    ) -> StoryFrame:
        """Pick each row's first non-missing value from ordered columns.

        Every tested cell is a control input; only the selected cell is a
        value input. ``default`` is an explicit scalar, never a source cell.
        """
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        candidates = _keys(columns, df.columns)
        default_cell = encode_cell(default)
        selected_values = []
        selected_columns: list[str | None] = []
        value_refs = []
        control_refs = []
        for i in range(len(df)):
            checked = []
            chosen = None
            for candidate in candidates:
                checked.append(_CellRef(self.step_id, i, candidate))
                if pd.notna(df[candidate].array[i]):
                    chosen = candidate
                    break
            selected_columns.append(chosen)
            selected_values.append(df[chosen].array[i] if chosen else default)
            value_refs.append((_CellRef(self.step_id, i, chosen),) if chosen else ())
            control_refs.append(tuple(checked))
        df[name] = pd.Series(selected_values, index=df.index).array
        original = self._snapshot.frame.columns
        return self._story._add(
            df,
            name="First available value",
            operation="coalesce",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {**{c: (_CellRef(self.step_id, i, c),) for c in original}, name: value_refs[i]}
                for i in range(len(df))
            ),
            cell_controls=tuple({name: control_refs[i]} for i in range(len(df))),
            parameters={
                "name": name,
                "columns": candidates,
                "default": default_cell,
                "selected_columns": selected_columns,
            },
        )

    def filter_by(
        self,
        column: str | Condition,
        *,
        op: str | None = None,
        value: Any = None,
        label: str = "Filter by condition",
    ) -> StoryFrame:
        """Filter using an explicit condition and retain every input-row outcome."""
        df = self.to_pandas()
        if isinstance(column, Condition):
            if op is not None or value is not None:
                raise ValueError("A condition tree cannot also receive op or value")
            condition_record, fields, outcomes, clause_outcomes = _evaluate_condition(df, column)
        else:
            if op is None:
                raise ValueError("op is required for a column condition")
            condition_record, fields, outcomes = _condition(df, column, op, value)
            clause_outcomes = None
        selected = [i for i, outcome in enumerate(outcomes) if outcome == "true"]
        output = df.iloc[selected]
        return self._story._add(
            output,
            name="Filtered by condition",
            operation="filter_by",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in selected),
            cell_parents=tuple(
                {c: (_CellRef(self.step_id, i, c),) for c in df.columns} for i in selected
            ),
            row_controls=tuple(
                tuple(_CellRef(self.step_id, i, c) for c in fields) for i in selected
            ),
            parameters={
                "condition": condition_record,
                "outcomes": outcomes,
                "selected_rows": selected,
                "removed_rows": len(df) - len(selected),
                **({"clause_outcomes": clause_outcomes} if clause_outcomes is not None else {}),
            },
        )

    def window(
        self,
        name: str,
        *,
        column: str,
        op: str,
        by: str | Sequence[str] | None = None,
        periods: int = 1,
        size: int = 3,
        min_periods: int | None = None,
        label: str = "Calculate over ordered rows",
    ) -> StoryFrame:
        """Record lag, difference, cumulative, or trailing rolling statistics.

        The input order is the current row order; call ``sort_values`` first for
        chronological work. Explicit per-cell references are limited so an
        expanding window cannot silently produce an enormous export.
        """
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        _keys([column], df.columns)
        keys = [] if by is None else _keys(by, df.columns)
        if column in keys:
            raise ValueError("The value column must differ from grouping keys")
        if op not in (
            "lag",
            "diff",
            "cumsum",
            "cummin",
            "cummax",
            "rolling_sum",
            "rolling_mean",
            "rolling_min",
            "rolling_max",
        ):
            raise ValueError("Unsupported window operation")
        if op != "lag" and (
            not pd.api.types.is_numeric_dtype(df[column].dtype)
            or pd.api.types.is_bool_dtype(df[column].dtype)
        ):
            raise UnsupportedDataError("This window operation requires numeric, non-boolean values")
        _positive_integer(periods, "periods")
        _positive_integer(size, "size")
        if min_periods is not None and (
            isinstance(min_periods, bool)
            or not isinstance(min_periods, int)
            or min_periods < 0
            or min_periods > size
        ):
            raise ValueError("min_periods must be between zero and size")
        minimum = size if min_periods is None else min_periods
        if keys:
            ids = (
                df.reset_index(drop=True)
                .groupby(keys, sort=False, dropna=False, observed=True)
                .ngroup()
                .to_numpy()
            )
        else:
            ids = np.zeros(len(df), dtype=int)
        groups_by_id: dict[int, list[int]] = {}
        for position, group_id in enumerate(ids):
            groups_by_id.setdefault(int(group_id), []).append(position)
        groups = list(groups_by_id.values())
        chunks = []
        inputs: list[tuple[_CellRef, ...]] = [()] * len(df)
        controls: list[tuple[_CellRef, ...]] = [()] * len(df)
        references = 0
        for positions in groups:
            series = df[column].iloc[positions].reset_index(drop=True)
            if op == "lag":
                # GroupBy.shift preserves pandas' boundary-missing scalar for
                # object and extension dtypes; per-group concat can change it.
                calculated = None
            elif op == "diff":
                calculated = series.diff(periods)
            elif op in ("cumsum", "cummin", "cummax"):
                calculated = getattr(series, op)()
            else:
                rolling = series.rolling(size, min_periods=minimum)
                calculated = getattr(rolling, op.removeprefix("rolling_"))()
            if calculated is not None:
                calculated.index = positions
                chunks.append(calculated)
            for j, position in enumerate(positions):
                window_positions = positions[max(0, j - size + 1) : j + 1]
                if op == "lag":
                    members = [positions[j - periods]] if j >= periods else []
                elif op == "diff":
                    members = [position, positions[j - periods]] if j >= periods else [position]
                elif op in ("cumsum", "cummin", "cummax"):
                    members = (
                        [p for p in positions[: j + 1] if pd.notna(df[column].array[p])]
                        if pd.notna(df[column].array[position])
                        else []
                    )
                else:
                    members = [p for p in window_positions if pd.notna(df[column].array[p])]
                inputs[position] = tuple(_CellRef(self.step_id, p, column) for p in members)
                missing_candidates = (
                    [p for p in window_positions if pd.isna(df[column].array[p])]
                    if op.startswith("rolling_")
                    else [position]
                    if op in ("cumsum", "cummin", "cummax") and pd.isna(df[column].array[position])
                    else []
                )
                controls[position] = tuple(
                    [
                        _CellRef(self.step_id, p, key)
                        for p in dict.fromkeys([*members, position])
                        for key in keys
                    ]
                    + [_CellRef(self.step_id, p, column) for p in missing_candidates]
                )
                references += len(inputs[position]) + len(controls[position])
                if references > 250_000:
                    raise CaptureLimitError("Window exceeds 250,000 explicit provenance references")
        if op == "lag":
            result = (
                df.groupby(keys, sort=False, dropna=False, observed=True)[column].shift(periods)
                if keys
                else df[column].shift(periods)
            )
        else:
            result = pd.concat(chunks).sort_index() if chunks else df[column].iloc[:0].copy()
        df[name] = result.array
        original = self._snapshot.frame.columns
        return self._story._add(
            df,
            name="Window calculation",
            operation="window",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {**{c: (_CellRef(self.step_id, i, c),) for c in original}, name: inputs[i]}
                for i in range(len(df))
            ),
            cell_controls=tuple({name: controls[i]} for i in range(len(df))),
            parameters={
                "name": name,
                "column": column,
                "op": op,
                "by": keys,
                "periods": periods,
                "size": size,
                "min_periods": minimum,
                "groups": groups,
            },
        )

    def group_transform(
        self,
        name: str,
        *,
        by: str | Sequence[str],
        value: str,
        op: str,
        dropna: bool,
        min_count: int | None = None,
        label: str = "Attach a group metric to every row",
    ) -> StoryFrame:
        """Broadcast one pandas group metric without collapsing the original rows.

        Every non-missing candidate in a group is an input to its repeated
        metric. Grouping-key cells are separate decision inputs. A large
        broadcast raises rather than silently dropping provenance.
        """
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        keys = self._group_keys_and_value(df, by, value)
        if not isinstance(dropna, bool):
            raise ValueError("dropna must be a boolean")
        if op not in ("sum", "mean", "min", "max", "count", "nunique"):
            raise ValueError("Unsupported group transformation")
        if op in ("sum", "mean", "min", "max") and (
            not pd.api.types.is_numeric_dtype(df[value].dtype)
            or pd.api.types.is_bool_dtype(df[value].dtype)
        ):
            raise UnsupportedDataError("This group transformation requires numeric values")
        if op == "sum":
            minimum = 1 if min_count is None else min_count
            if (
                isinstance(minimum, bool)
                or not isinstance(minimum, int)
                or not 0 <= minimum <= 2**53 - 1
            ):
                raise ValueError("min_count must be an integer from 0 through 2**53 - 1")
        elif min_count is not None:
            raise ValueError("min_count applies only to sum")
        grouped = df.groupby(keys, dropna=dropna, sort=False, observed=True)
        values = grouped[value]
        calculated = (
            values.transform(lambda s: s.sum(min_count=minimum))
            if op == "sum"
            else values.transform(op)
        )
        ids = grouped.ngroup().to_numpy()
        groups_by_id: dict[int, list[int]] = {}
        excluded = []
        for position, group_id in enumerate(ids):
            if pd.isna(group_id):
                excluded.append(position)
            else:
                groups_by_id.setdefault(int(group_id), []).append(position)
        groups = list(groups_by_id.values())
        row_groups: list[int | None] = [None] * len(df)
        inputs: list[tuple[_CellRef, ...]] = [()] * len(df)
        controls: list[tuple[_CellRef, ...]] = [()] * len(df)
        reference_count = 0
        for group_index, members in enumerate(groups):
            candidates = tuple(
                _CellRef(self.step_id, i, value) for i in members if pd.notna(df[value].array[i])
            )
            group_keys = tuple(_CellRef(self.step_id, i, key) for i in members for key in keys)
            reference_count += len(members) * (len(candidates) + len(group_keys))
            if reference_count > 250_000:
                raise CaptureLimitError("Group transform exceeds 250,000 provenance references")
            for i in members:
                row_groups[i] = group_index
                inputs[i] = candidates
                controls[i] = group_keys
        for i in excluded:
            controls[i] = tuple(_CellRef(self.step_id, i, key) for key in keys)
            reference_count += len(keys)
            if reference_count > 250_000:
                raise CaptureLimitError("Group transform exceeds 250,000 provenance references")
        df[name] = calculated.array
        original = self._snapshot.frame.columns
        parameters = {
            "name": name,
            "by": keys,
            "value": value,
            "op": op,
            "dropna": dropna,
            "groups": groups,
            "row_groups": row_groups,
            "excluded_rows": excluded,
        }
        if op == "sum":
            parameters["min_count"] = minimum
        return self._story._add(
            df,
            name="Grouped row metric",
            operation="group_transform",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {**{c: (_CellRef(self.step_id, i, c),) for c in original}, name: inputs[i]}
                for i in range(len(df))
            ),
            cell_controls=tuple({name: controls[i]} for i in range(len(df))),
            parameters=parameters,
        )

    def rank_within(
        self,
        name: str,
        *,
        value: str,
        by: str | Sequence[str] | None = None,
        method: str = "dense",
        ascending: bool = False,
        label: str = "Rank values within each group",
    ) -> StoryFrame:
        """Rank recorded numeric values while retaining tie-policy candidates."""
        df = self.to_pandas()
        if not isinstance(name, str) or not name.strip() or name in df.columns:
            raise ValueError("name must be a new nonempty column name")
        validate_text(name)
        _keys([value], df.columns)
        keys = [] if by is None else _keys(by, df.columns)
        if value in keys:
            raise ValueError("value must differ from grouping keys")
        if method not in ("average", "min", "max", "dense", "first"):
            raise ValueError("Unsupported rank tie method")
        if not isinstance(ascending, bool):
            raise ValueError("ascending must be a boolean")
        if not pd.api.types.is_numeric_dtype(df[value].dtype) or pd.api.types.is_bool_dtype(
            df[value].dtype
        ):
            raise UnsupportedDataError("rank_within requires numeric, non-boolean values")
        if keys:
            grouped = df.groupby(keys, sort=False, dropna=False, observed=True)
            calculated = grouped[value].rank(method=method, ascending=ascending, na_option="keep")
            ids = grouped.ngroup().to_numpy()
        else:
            calculated = df[value].rank(method=method, ascending=ascending, na_option="keep")
            ids = np.zeros(len(df), dtype=int)
        groups_by_id: dict[int, list[int]] = {}
        for position, group_id in enumerate(ids):
            groups_by_id.setdefault(int(group_id), []).append(position)
        groups = list(groups_by_id.values())
        row_groups: list[int | None] = [None] * len(df)
        inputs: list[tuple[_CellRef, ...]] = [()] * len(df)
        controls: list[tuple[_CellRef, ...]] = [()] * len(df)
        reference_count = 0
        for group_index, members in enumerate(groups):
            candidates = [i for i in members if pd.notna(df[value].array[i])]
            candidate_set = set(candidates)
            value_refs = tuple(_CellRef(self.step_id, i, value) for i in candidates)
            key_refs = tuple(_CellRef(self.step_id, i, key) for i in candidates for key in keys)
            for i in members:
                row_groups[i] = group_index
                if i in candidate_set:
                    inputs[i] = value_refs
                    controls[i] = key_refs
                else:
                    controls[i] = tuple(_CellRef(self.step_id, i, key) for key in keys) + (
                        _CellRef(self.step_id, i, value),
                    )
                reference_count += len(inputs[i]) + len(controls[i])
                if reference_count > 250_000:
                    raise CaptureLimitError("Rank exceeds 250,000 provenance references")
        df[name] = calculated.array
        original = self._snapshot.frame.columns
        return self._story._add(
            df,
            name="Ranked rows",
            operation="rank_within",
            label=label,
            parents=(self.step_id,),
            row_parents=tuple((_RowRef(self.step_id, i),) for i in range(len(df))),
            cell_parents=tuple(
                {**{c: (_CellRef(self.step_id, i, c),) for c in original}, name: inputs[i]}
                for i in range(len(df))
            ),
            cell_controls=tuple({name: controls[i]} for i in range(len(df))),
            parameters={
                "name": name,
                "by": keys,
                "value": value,
                "method": method,
                "ascending": ascending,
                "groups": groups,
                "row_groups": row_groups,
            },
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
        on: str | Sequence[str] | None = None,
        left_on: str | Sequence[str] | None = None,
        right_on: str | Sequence[str] | None = None,
        how: str = "left",
        validate: str = "many_to_one",
        suffixes: tuple[str, str] = ("_x", "_y"),
        label: str = "Join tables",
    ) -> StoryFrame:
        """Validated left/inner/right/outer joins with explicit matching fields."""
        if not isinstance(right, StoryFrame) or right._story is not self._story:
            raise ValueError("Both tables must belong to the same story")
        if not isinstance(how, str) or how not in ("left", "inner", "right", "outer"):
            raise ValueError("how must be left, inner, right, or outer")
        if not isinstance(validate, str) or validate not in (
            "many_to_one",
            "one_to_one",
            "one_to_many",
            "m:1",
            "1:1",
            "1:m",
        ):
            raise ValueError("validate must be many_to_one, one_to_one, or one_to_many")
        if (
            not isinstance(suffixes, (tuple, list))
            or len(suffixes) != 2
            or not all(isinstance(s, str) for s in suffixes)
        ):
            raise ValueError("suffixes must contain two strings")
        left_df, right_df = self.to_pandas(), right.to_pandas()
        if on is not None:
            if left_on is not None or right_on is not None:
                raise ValueError("Specify on or left_on/right_on, not both")
            left_keys = _keys(on, left_df.columns)
            right_keys = _keys(left_keys, right_df.columns)
            matching = {"on": left_keys}
        else:
            if left_on is None or right_on is None:
                raise ValueError("Specify on or both left_on and right_on")
            left_keys, right_keys = (
                _keys(left_on, left_df.columns),
                _keys(right_on, right_df.columns),
            )
            if len(left_keys) != len(right_keys):
                raise ValueError("Join key lists must have equal length")
            matching = {"left_on": left_keys, "right_on": right_keys}
        options = dict(how=how, validate=validate, sort=False, suffixes=suffixes, **matching)
        left_marker, right_marker = object(), object()
        left_map, right_map = left_df[left_keys].copy(), right_df[right_keys].copy()
        left_map[left_marker] = np.arange(len(left_map))
        right_map[right_marker] = np.arange(len(right_map))
        mapping = left_map.merge(right_map, **options)
        if len(mapping) > self._story.max_rows:
            raise CaptureLimitError("Join result exceeds max_rows")
        output = left_df.merge(right_df, **options)
        if len(mapping) != len(output):
            raise UnsupportedDataError("Could not align the join result with its source rows")
        common = {
            left for left, right_key in zip(left_keys, right_keys, strict=True) if left == right_key
        }
        overlap = (set(left_df.columns) & set(right_df.columns)) - common
        row_parents, cell_parents = [], []
        no_left = no_right = 0
        left_match_counts = [0] * len(left_df)
        right_match_counts = [0] * len(right_df)
        null_key_output_rows = []
        for li, ri in zip(mapping[left_marker].array, mapping[right_marker].array, strict=True):
            li = None if pd.isna(li) else int(li)
            ri = None if pd.isna(ri) else int(ri)
            no_left += li is None
            no_right += ri is None
            if li is not None and ri is not None:
                left_match_counts[li] += 1
                right_match_counts[ri] += 1
                if any(pd.isna(left_df[key].array[li]) for key in left_keys):
                    null_key_output_rows.append(len(row_parents))
            refs = []
            if li is not None:
                refs.append(_RowRef(self.step_id, li))
            if ri is not None:
                refs.append(_RowRef(right.step_id, ri))
            row_parents.append(tuple(refs))
            cells = {}
            for c in left_df.columns:
                out = c + suffixes[0] if c in overlap else c
                if li is not None:
                    cells[out] = (_CellRef(self.step_id, li, c),)
                elif c in common and ri is not None:
                    cells[out] = (_CellRef(right.step_id, ri, c),)
                else:
                    cells[out] = ()
            for c in right_df.columns:
                if c not in common:
                    out = c + suffixes[1] if c in overlap else c
                    cells[out] = (_CellRef(right.step_id, ri, c),) if ri is not None else ()
            cell_parents.append(cells)
        audit = {
            "left_match_counts": left_match_counts,
            "right_match_counts": right_match_counts,
            "left_unmatched": [i for i, count in enumerate(left_match_counts) if count == 0],
            "right_unmatched": [i for i, count in enumerate(right_match_counts) if count == 0],
            "left_fanout": [i for i, count in enumerate(left_match_counts) if count > 1],
            "right_fanout": [i for i, count in enumerate(right_match_counts) if count > 1],
            "left_duplicate_keys": np.flatnonzero(
                left_df.duplicated(subset=left_keys, keep=False).to_numpy()
            ).tolist(),
            "right_duplicate_keys": np.flatnonzero(
                right_df.duplicated(subset=right_keys, keep=False).to_numpy()
            ).tolist(),
            "null_key_output_rows": null_key_output_rows,
        }
        return self._story._add(
            output,
            name="Joined rows",
            operation="merge",
            label=label,
            parents=(self.step_id, right.step_id),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            parameters={
                "on": left_keys if on is not None else None,
                "left_on": left_keys,
                "right_on": right_keys,
                "how": how,
                "validate": validate,
                "suffixes": list(suffixes),
                "unmatched_rows": no_right,
                "unmatched_left_rows": no_left,
                "audit": audit,
            },
        )

    def join_audit(self) -> dict[str, Any]:
        """Return detached input coverage, fanout, and missing-key match details."""
        step = self._snapshot
        if step.operation != "merge":
            raise ValueError("join_audit requires a merge result")
        return copy.deepcopy(step.parameters["audit"])

    def merge_asof(
        self,
        right: StoryFrame,
        *,
        on: str,
        by: str | Sequence[str] | None = None,
        direction: str = "backward",
        tolerance: Any = None,
        allow_exact_matches: bool = True,
        suffixes: tuple[str, str] = ("_x", "_y"),
        label: str = "Match the nearest earlier row",
    ) -> StoryFrame:
        """Record a sorted pandas as-of join with exact positional right matches."""
        if not isinstance(right, StoryFrame) or right._story is not self._story:
            raise ValueError("Both tables must belong to the same story")
        if direction not in ("backward", "forward", "nearest"):
            raise ValueError("direction must be backward, forward, or nearest")
        if not isinstance(allow_exact_matches, bool):
            raise ValueError("allow_exact_matches must be a boolean")
        if (
            not isinstance(suffixes, (tuple, list))
            or len(suffixes) != 2
            or not all(isinstance(s, str) for s in suffixes)
        ):
            raise ValueError("suffixes must contain two strings")
        left_df, right_df = self.to_pandas(), right.to_pandas()
        _keys([on], left_df.columns)
        _keys([on], right_df.columns)
        keys = [] if by is None else _keys(by, left_df.columns)
        if on in keys:
            raise ValueError("The ordered key must differ from grouping keys")
        if keys:
            _keys(keys, right_df.columns)
        if not left_df[on].is_monotonic_increasing or not right_df[on].is_monotonic_increasing:
            raise ValueError("Both inputs must be sorted by the ordered key")
        if len(left_df) > self._story.max_rows:
            raise CaptureLimitError("As-of join result exceeds max_rows")
        tolerance_cell = None if tolerance is None else encode_cell(tolerance)
        if tolerance_cell is not None and tolerance_cell["type"] == "missing":
            raise ValueError("tolerance must not be missing")
        options = dict(
            on=on,
            by=keys or None,
            direction=direction,
            tolerance=tolerance,
            allow_exact_matches=allow_exact_matches,
            suffixes=suffixes,
        )
        left_marker, right_marker = object(), object()
        matching_keys = [on, *keys]
        left_map, right_map = left_df[matching_keys].copy(), right_df[matching_keys].copy()
        left_map[left_marker] = np.arange(len(left_map))
        right_map[right_marker] = np.arange(len(right_map))
        mapping = pd.merge_asof(left_map, right_map, **options)
        output = pd.merge_asof(left_df, right_df, **options)
        if len(mapping) != len(output) or len(output) != len(left_df):
            raise UnsupportedDataError("Could not align the as-of result with its source rows")
        overlap = (set(left_df.columns) & set(right_df.columns)) - set(matching_keys)
        row_parents, cell_parents, cell_controls = [], [], []
        matches: list[int | None] = []
        right_usage = [0] * len(right_df)
        for li, ri in zip(mapping[left_marker].array, mapping[right_marker].array, strict=True):
            li = int(li)
            ri = None if pd.isna(ri) else int(ri)
            matches.append(ri)
            parents = [_RowRef(self.step_id, li)]
            if ri is not None:
                parents.append(_RowRef(right.step_id, ri))
                right_usage[ri] += 1
            row_parents.append(tuple(parents))
            cells = {}
            controls = {}
            match_keys = tuple(
                [_CellRef(self.step_id, li, c) for c in matching_keys]
                + (
                    [_CellRef(right.step_id, ri, c) for c in matching_keys]
                    if ri is not None
                    else []
                )
            )
            for c in left_df.columns:
                out = c + suffixes[0] if c in overlap else c
                cells[out] = (_CellRef(self.step_id, li, c),)
            for c in right_df.columns:
                if c not in matching_keys:
                    out = c + suffixes[1] if c in overlap else c
                    cells[out] = (_CellRef(right.step_id, ri, c),) if ri is not None else ()
                    controls[out] = match_keys
            cell_parents.append(cells)
            cell_controls.append(controls)
        audit = {
            "matched_right_rows": matches,
            "left_unmatched": [i for i, match in enumerate(matches) if match is None],
            "right_usage_counts": right_usage,
            "right_unused": [i for i, count in enumerate(right_usage) if count == 0],
            "right_reused": [i for i, count in enumerate(right_usage) if count > 1],
        }
        return self._story._add(
            output,
            name="Nearby matched rows",
            operation="merge_asof",
            label=label,
            parents=(self.step_id, right.step_id),
            row_parents=tuple(row_parents),
            cell_parents=tuple(cell_parents),
            cell_controls=tuple(cell_controls),
            parameters={
                "on": on,
                "by": keys,
                "direction": direction,
                "tolerance": tolerance_cell,
                "allow_exact_matches": allow_exact_matches,
                "suffixes": list(suffixes),
                "audit": audit,
            },
        )

    def asof_audit(self) -> dict[str, Any]:
        """Return detached selected-right-row and unused-input information."""
        step = self._snapshot
        if step.operation != "merge_asof":
            raise ValueError("asof_audit requires a merge_asof result")
        return copy.deepcopy(step.parameters["audit"])

    def _group_keys_and_value(
        self, df: pd.DataFrame, by: str | Sequence[str], value: str
    ) -> list[str]:
        keys = _keys(by, df.columns)
        if not isinstance(value, str) or value not in df.columns or value in keys:
            raise ValueError("value must name a column outside the grouping keys")
        return keys

    def _group_provenance(
        self, df: pd.DataFrame, keys: list[str], value: str, group_ids: np.ndarray, n_groups: int
    ) -> tuple[
        tuple[tuple[_RowRef, ...], ...],
        tuple[dict[str, tuple[_CellRef, ...]], ...],
        list[dict[str, Any]],
    ]:
        """Build group membership and value-input references shared by every aggregation.

        Membership comes only from the grouping keys; the value column's own
        missing entries are excluded from its references but never from membership,
        so the grouping scene and every aggregation agree on which rows belong.
        """
        members_by_group: list[list[int]] = [[] for _ in range(n_groups)]
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
        return tuple(row_parents), tuple(cell_parents), groups

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
        """Sum a numeric column per group. Missing keys and ``min_count`` are explicit."""
        df = self.to_pandas()
        keys = self._group_keys_and_value(df, by, value)
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
        row_parents, cell_parents, groups = self._group_provenance(
            df, keys, value, group_ids, len(output)
        )
        return self._story._add(
            output,
            name="Grouped sum",
            operation="group_sum",
            label=label,
            parents=(self.step_id,),
            row_parents=row_parents,
            cell_parents=cell_parents,
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

    def group_mean(
        self,
        *,
        by: str | Sequence[str],
        value: str,
        dropna: bool,
        sort: bool = False,
        label: str = "Group and average",
    ) -> StoryFrame:
        """Average a numeric column per group. A group with no non-missing values is missing.

        pandas skips missing values by default, so there is no ``min_count`` to set.
        """
        df = self.to_pandas()
        keys = self._group_keys_and_value(df, by, value)
        if not isinstance(dropna, bool) or not isinstance(sort, bool):
            raise ValueError("dropna and sort must be booleans")
        if not pd.api.types.is_numeric_dtype(df[value].dtype) or pd.api.types.is_bool_dtype(
            df[value].dtype
        ):
            raise UnsupportedDataError("group_mean requires a numeric, non-boolean value column")
        grouped = df.groupby(keys, dropna=dropna, sort=sort, observed=True)
        output = grouped[value].mean().reset_index()
        group_ids = grouped.ngroup().to_numpy()
        row_parents, cell_parents, groups = self._group_provenance(
            df, keys, value, group_ids, len(output)
        )
        return self._story._add(
            output,
            name="Grouped mean",
            operation="group_mean",
            label=label,
            parents=(self.step_id,),
            row_parents=row_parents,
            cell_parents=cell_parents,
            parameters={
                "by": keys,
                "value": value,
                "dropna": dropna,
                "sort": sort,
                "groups": groups,
                "excluded_rows": int(pd.isna(group_ids).sum()),
            },
        )

    def group_count(
        self,
        *,
        by: str | Sequence[str],
        value: str,
        dropna: bool,
        sort: bool = False,
        label: str = "Group and count",
    ) -> StoryFrame:
        """Count non-missing entries of a column per group; this is not the row count.

        ``value`` may hold any supported scalar type; only its missing entries are
        excluded. A group with no non-missing values counts as zero, not missing.
        """
        df = self.to_pandas()
        keys = self._group_keys_and_value(df, by, value)
        if not isinstance(dropna, bool) or not isinstance(sort, bool):
            raise ValueError("dropna and sort must be booleans")
        grouped = df.groupby(keys, dropna=dropna, sort=sort, observed=True)
        output = grouped[value].count().reset_index()
        group_ids = grouped.ngroup().to_numpy()
        row_parents, cell_parents, groups = self._group_provenance(
            df, keys, value, group_ids, len(output)
        )
        return self._story._add(
            output,
            name="Grouped count",
            operation="group_count",
            label=label,
            parents=(self.step_id,),
            row_parents=row_parents,
            cell_parents=cell_parents,
            parameters={
                "by": keys,
                "value": value,
                "dropna": dropna,
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

    def explain_controls(
        self, row: int, column: str, *, max_sources: int = 10_000
    ) -> tuple[CellOrigin, ...]:
        """Trace source cells that controlled a conditional or window result.

        Decision inputs are separate from source cells used to *make* the value.
        For a ``filter_by`` output row, any column returns that row's predicate
        inputs. Earlier operations may add further control inputs, but this
        method reports the selected step's immediate decision inputs only.
        """
        _positive_integer(max_sources, "max_sources")
        step = self._snapshot
        if isinstance(row, bool) or not isinstance(row, int) or not 0 <= row < len(step.frame):
            raise IndexError("row is an output row position")
        if column not in step.frame.columns:
            raise KeyError(column)
        refs = (
            step.cell_controls[row].get(column, ())
            if step.cell_controls
            else step.row_controls[row]
            if step.row_controls
            else ()
        )
        origins: list[CellOrigin] = []
        for ref in refs:
            source = StoryFrame(self._story, ref.step)
            origins.extend(source.explain(ref.row, ref.column, max_sources=max_sources))
            if len(origins) > max_sources:
                raise CaptureLimitError("Control has more than max_sources inputs")
        return tuple(origins)

    def filter_decision(self, input_row: int) -> str:
        """Return true, false, or missing for one original row of ``filter_by``."""
        step = self._snapshot
        if step.operation != "filter_by":
            raise ValueError("filter_decision requires a filter_by result")
        outcomes = step.parameters["outcomes"]
        if (
            isinstance(input_row, bool)
            or not isinstance(input_row, int)
            or not 0 <= input_row < len(outcomes)
        ):
            raise IndexError("input_row is an original row position")
        return outcomes[input_row]

    def condition_breakdown(self, input_row: int) -> tuple[dict[str, str], ...]:
        """Return each atomic comparison's result for an original input row.

        These are comparison outcomes before any enclosing ``~``, ``&``, or
        ``|`` operator. ``filter_decision`` reports the final tree result.
        """
        step = self._snapshot
        if step.operation not in ("filter_by", "case_when"):
            raise ValueError("condition_breakdown requires filter_by or case_when")
        outcomes = step.parameters["outcomes"]
        if (
            isinstance(input_row, bool)
            or not isinstance(input_row, int)
            or not 0 <= input_row < len(outcomes)
        ):
            raise IndexError("input_row is an original row position")
        leaves = list(_condition_leaves(step.parameters["condition"]))
        clauses = step.parameters.get("clause_outcomes") or [outcomes]
        return tuple(
            {"column": leaf["column"], "op": leaf["op"], "outcome": states[input_row]}
            for leaf, states in zip(leaves, clauses, strict=True)
        )

    def case_decision(self, row: int) -> dict[str, Any]:
        """Return a detached selected-case index and all ordered case outcomes."""
        step = self._snapshot
        if step.operation != "case_select":
            raise ValueError("case_decision requires a case_select result")
        if isinstance(row, bool) or not isinstance(row, int) or not 0 <= row < len(step.frame):
            raise IndexError("row is an output row position")
        return {
            "selected_case": step.parameters["selected_cases"][row],
            "outcomes": [branch["outcomes"][row] for branch in step.parameters["cases"]],
        }

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
