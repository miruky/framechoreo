"""Regenerate the recorded decision and window fixture from its public example."""

import runpy
from pathlib import Path

import pandas as pd

from framechoreo import DataStory

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    story, result = runpy.run_path(str(root / "examples/decision_window_workflow.py"))[
        "build_story"
    ]()
    (root / "tests/fixtures/decisions.json").write_text(
        story.to_json(result=result), encoding="utf-8"
    )
    extrema = DataStory(title="Window extrema fixture")
    raw = extrema.table(pd.DataFrame({"group": ["a", "b", "a", "a"], "v": [4.0, 3.0, None, 2.0]}))
    low = raw.window("cumlow", column="v", op="cummin", by="group")
    high = low.window("cumhigh", column="v", op="cummax", by="group")
    rolling_low = high.window(
        "low2", column="v", op="rolling_min", by="group", size=2, min_periods=1
    )
    rolling_high = rolling_low.window(
        "high2", column="v", op="rolling_max", by="group", size=2, min_periods=1
    )
    (root / "tests/fixtures/window_extrema.json").write_text(
        extrema.to_json(result=rolling_high), encoding="utf-8"
    )
