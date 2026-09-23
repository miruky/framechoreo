"""Portable animations for explicit pandas transformations."""

from .core import VERSION, CellOrigin, ColumnRef, DataStory, OriginPage, StoryFrame, col
from .errors import CaptureLimitError, FrameChoreoError, UnsupportedDataError

__version__ = VERSION
__all__ = [
    "CaptureLimitError",
    "CellOrigin",
    "ColumnRef",
    "DataStory",
    "FrameChoreoError",
    "OriginPage",
    "StoryFrame",
    "col",
    "UnsupportedDataError",
    "__version__",
]
