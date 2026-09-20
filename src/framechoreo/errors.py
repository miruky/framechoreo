"""Public errors for capture boundaries."""


class FrameChoreoError(ValueError):
    """Base error raised for unsupported or unsafe capture requests."""


class CaptureLimitError(FrameChoreoError):
    """A declared capture, export, or lineage limit was exceeded."""


class UnsupportedDataError(FrameChoreoError):
    """Input cannot be represented without silently losing information."""
