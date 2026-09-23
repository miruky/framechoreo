"""Regenerate the synthetic standalone demo used by the repository README."""

from pathlib import Path

from sales_story import make_story

if __name__ == "__main__":
    story, result = make_story()
    output = Path(__file__).resolve().parents[1] / "docs" / "index.html"
    story.export_html(output, result=result, overwrite=True)
    print(output)
