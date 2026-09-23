"""Regenerate the join audit display fixture from its example."""

import runpy
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    story, result = runpy.run_path(str(root / "examples/join_audit_workflow.py"))["build_story"]()
    (root / "tests/fixtures/join_audit.json").write_text(
        story.to_json(result=result), encoding="utf-8"
    )
