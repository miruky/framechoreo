"""Regenerate the compound-condition fixture from its example."""

import runpy
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    story, result = runpy.run_path(str(root / "examples/compound_conditions_workflow.py"))[
        "build_story"
    ]()
    (root / "tests/fixtures/compound_conditions.json").write_text(
        story.to_json(result=result), encoding="utf-8"
    )
