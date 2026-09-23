"""Familiar pandas-style entry points backed by explicit recorded operations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .core import StoryFrame


@dataclass(frozen=True, slots=True)
class RecordedGroupBy:
    """A narrow, checked groupby facade that never guesses unsupported lineage."""

    frame: StoryFrame
    by: tuple[str, ...]
    dropna: bool
    sort: bool

    def __getitem__(self, value: str) -> RecordedSeriesGroupBy:
        return RecordedSeriesGroupBy(self.frame, self.by, value, self.dropna, self.sort)

    def agg(self, **named_metrics: tuple[str, str]) -> StoryFrame:
        """Use pandas-style named metrics such as ``total=("amount", "sum")``."""
        return self.frame.group_agg(
            by=self.by,
            aggregations=named_metrics,
            dropna=self.dropna,
            sort=self.sort,
        )


@dataclass(frozen=True, slots=True)
class RecordedSeriesGroupBy:
    """A selected value column with supported grouped reductions and broadcast."""

    frame: StoryFrame
    by: tuple[str, ...]
    value: str
    dropna: bool
    sort: bool

    def sum(self, *, min_count: int = 1) -> StoryFrame:
        return self.frame.group_sum(
            by=self.by,
            value=self.value,
            dropna=self.dropna,
            sort=self.sort,
            min_count=min_count,
        )

    def mean(self) -> StoryFrame:
        return self.frame.group_mean(
            by=self.by,
            value=self.value,
            dropna=self.dropna,
            sort=self.sort,
        )

    def count(self) -> StoryFrame:
        return self.frame.group_count(
            by=self.by,
            value=self.value,
            dropna=self.dropna,
            sort=self.sort,
        )

    def transform(self, name: str, op: str, *, min_count: int | None = None) -> StoryFrame:
        if self.sort:
            raise ValueError("sort=True is not supported for row-preserving group transforms")
        return self.frame.group_transform(
            name,
            by=self.by,
            value=self.value,
            op=op,
            dropna=self.dropna,
            min_count=min_count,
        )
