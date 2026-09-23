"""Portable animations for explicit pandas transformations."""

from .authoring import RecordedGroupBy, RecordedSeriesGroupBy
from .core import (
    VERSION,
    CellOrigin,
    ColumnRef,
    Condition,
    DataStory,
    OriginPage,
    StoryFrame,
    col,
    where,
)
from .errors import CaptureLimitError, FrameChoreoError, UnsupportedDataError

__version__ = VERSION
__all__ = [
    "CaptureLimitError",
    "CellOrigin",
    "ColumnRef",
    "Condition",
    "DataStory",
    "FrameChoreoError",
    "OriginPage",
    "RecordedGroupBy",
    "RecordedSeriesGroupBy",
    "StoryFrame",
    "col",
    "where",
    "UnsupportedDataError",
    "__version__",
]
