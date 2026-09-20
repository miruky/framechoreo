"""Portable animations for explicit pandas transformations."""

from .core import VERSION, CellOrigin, DataStory, OriginPage, StoryFrame
from .errors import CaptureLimitError, FrameChoreoError, UnsupportedDataError

__version__ = VERSION
__all__ = [
    "CaptureLimitError",
    "CellOrigin",
    "DataStory",
    "FrameChoreoError",
    "OriginPage",
    "StoryFrame",
    "UnsupportedDataError",
    "__version__",
]
