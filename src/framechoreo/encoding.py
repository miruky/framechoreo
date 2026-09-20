"""Display values without converting large integers to JavaScript numbers."""

import datetime as dt
import math
from decimal import Decimal
from typing import Any

import numpy as np
import pandas as pd

from .errors import CaptureLimitError, UnsupportedDataError


def encode_cell(value: Any) -> dict[str, Any]:
    if value is None or value is pd.NA or value is pd.NaT:
        return {"type": "missing", "value": None, "display": "∅"}
    if isinstance(value, (float, np.floating)) and math.isnan(value):
        return {"type": "missing", "value": None, "display": "∅"}
    if isinstance(value, (bool, np.bool_)):
        return {"type": "boolean", "value": bool(value), "display": str(bool(value))}
    if isinstance(value, (int, np.integer)):
        return {"type": "integer", "value": str(value), "display": str(value)}
    if isinstance(value, (float, np.floating)):
        text = repr(float(value))
        return {"type": "float", "value": text, "display": text}
    if isinstance(value, str):
        if len(value) > 20_000:
            raise CaptureLimitError("A text cell exceeds the 20,000-character limit")
        return {"type": "string", "value": value, "display": value}
    if isinstance(value, Decimal):
        return {"type": "decimal", "value": str(value), "display": str(value)}
    if isinstance(value, (pd.Timestamp, dt.datetime, dt.date, dt.time)):
        text = value.isoformat()
        return {"type": "datetime", "value": text, "display": text}
    if isinstance(value, (pd.Timedelta, dt.timedelta, np.timedelta64)):
        text = pd.Timedelta(value).isoformat()
        return {"type": "duration", "value": text, "display": text}
    if isinstance(value, np.datetime64):
        return encode_cell(pd.Timestamp(value))
    raise UnsupportedDataError(
        f"Unsupported cell type: {type(value).__name__}. "
        "Use scalar values; nested objects are not captured."
    )
