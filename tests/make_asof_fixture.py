"""Regenerate the sorted as-of join player fixture from its public example."""

import runpy
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    story, result = runpy.run_path(str(root / "examples/asof_workflow.py"))["build_story"]()
    (root / "tests/fixtures/asof.json").write_text(story.to_json(result=result), encoding="utf-8")
