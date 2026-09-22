"""Small pandas-native quality summaries; no values or mutations are returned."""

from typing import Any

import pandas as pd


def profile_frame(frame: pd.DataFrame) -> dict[str, Any]:
    columns = [
        {
            "name": name,
            "dtype": str(frame[name].dtype),
            "missing": int(frame[name].isna().sum()),
            "unique": int(frame[name].nunique(dropna=True)),
        }
        for name in frame.columns
    ]
    return {
        "rows": len(frame),
        "column_count": len(columns),
        "missing_cells": sum(c["missing"] for c in columns),
        "duplicate_rows": int(frame.duplicated().sum()),
        "columns": columns,
    }
