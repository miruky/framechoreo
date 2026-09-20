"""Display values without converting large integers to JavaScript numbers."""

import datetime as dt
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd

from .errors import CaptureLimitError, UnsupportedDataError


def validate_text(value: str) -> str:
    """Bound display strings and reject text that cannot be exported as UTF-8."""
    if len(value) > 20_000:
        raise CaptureLimitError("Display text exceeds the 20,000-character limit")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise UnsupportedDataError("Text must contain valid Unicode for UTF-8 export") from exc
    return value


def encode_cell(value: Any) -> dict[str, Any]:
    if value is None or value is pd.NA or value is pd.NaT:
        return {"type": "missing", "value": None, "display": "∅"}
    if isinstance(value, (float, np.floating)) and np.isnan(value):
        return {"type": "missing", "value": None, "display": "∅"}
    if isinstance(value, (np.datetime64, np.timedelta64)) and np.isnat(value):
        return {"type": "missing", "value": None, "display": "∅"}
    if isinstance(value, Decimal) and value.is_nan():
        return {"type": "missing", "value": None, "display": "∅"}
    if isinstance(value, np.datetime64):
        # Converting to Timestamp can silently discard sub-nanosecond digits.
        text = validate_text(str(value))
        return {"type": "datetime", "value": text, "display": text}
    # NumPy timedelta64 is also an np.integer; handle its actual meaning first.
    if isinstance(value, (pd.Timedelta, dt.timedelta, np.timedelta64)):
        try:
            text = pd.Timedelta(value).isoformat()
        except (ValueError, OverflowError) as exc:
            raise UnsupportedDataError(
                "Duration must be representable by pandas without ambiguous calendar units"
            ) from exc
        return {"type": "duration", "value": text, "display": text}
    if isinstance(value, (bool, np.bool_)):
        return {"type": "boolean", "value": bool(value), "display": str(bool(value))}
    if isinstance(value, (int, np.integer)):
        text = validate_text(str(value))
        return {"type": "integer", "value": text, "display": text}
    if isinstance(value, (float, np.floating)):
        text = str(value) if isinstance(value, np.floating) else repr(value)
        return {"type": "float", "value": text, "display": text}
    if isinstance(value, str):
        if len(value) > 20_000:
            raise CaptureLimitError("A text cell exceeds the 20,000-character limit")
        return {"type": "string", "value": validate_text(value), "display": value}
    if isinstance(value, Decimal):
        text = validate_text(str(value))
        return {"type": "decimal", "value": text, "display": text}
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date, dt.time)):
        text = value.isoformat()
        return {"type": "datetime", "value": text, "display": text}
    raise UnsupportedDataError(
        f"Unsupported cell type: {type(value).__name__}. "
        "Use scalar values; nested objects are not captured."
    )


def cell_signature(value: Any) -> tuple[Any, ...]:
    """Distinguish representations that numeric equality alone treats as equal."""
    cell = encode_cell(value)
    return type(value), cell["type"], cell["value"], cell["display"], getattr(value, "fold", None)
