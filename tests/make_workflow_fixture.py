"""Regenerate the synthetic browser fixture using the checked retail example."""

import json
import runpy
from pathlib import Path

if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    module = runpy.run_path(str(root / "examples" / "retail_workflow.py"))
    story, result = module["make_story"](language="en")
    output = root / "tests" / "fixtures" / "retail.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(
        json.dumps(story.to_dict(result=result), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(output)
    module = runpy.run_path(str(root / "examples" / "reshape_workflow.py"))
    story, result = module["make_story"](language="en")
    output = root / "tests" / "fixtures" / "reshape.json"
    output.write_text(
        json.dumps(story.to_dict(result=result), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(output)
