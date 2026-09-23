"""Regenerate the row-preserving grouped-metric fixture from its example."""

import runpy
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    story, result = runpy.run_path(str(root / "examples/group_transform_workflow.py"))[
        "build_story"
    ]()
    (root / "tests/fixtures/group_transform.json").write_text(
        story.to_json(result=result), encoding="utf-8"
    )
