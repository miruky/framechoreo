"""Generate the time-bucket story for player tests."""

import runpy
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    story, result = runpy.run_path(str(root / "examples/time_buckets_workflow.py"))["build_story"]()
    output = root / "tests" / "fixtures" / "time_buckets.json"
    output.write_text(story.to_json(result=result), encoding="utf-8")
    print(output)
