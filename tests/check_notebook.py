"""Execute the shipped notebook in an isolated kernel and inspect its rich output."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import sys
import tempfile
from pathlib import Path

import nbformat
from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpecManager
from nbclient import NotebookClient


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    notebook = nbformat.read(root / "examples/notebook.ipynb", as_version=4)
    with tempfile.TemporaryDirectory(prefix="framechoreo-notebook-") as folder:
        scratch = Path(folder)
        kernel_dir = scratch / "kernels/validation"
        kernel_dir.mkdir(parents=True)
        (kernel_dir / "kernel.json").write_text(
            json.dumps(
                {
                    "argv": [sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
                    "display_name": "FrameChoreo validation",
                    "language": "python",
                }
            ),
            encoding="utf-8",
        )
        specs = KernelSpecManager(kernel_dirs=[str(kernel_dir.parent)], ensure_native_kernel=False)
        manager = KernelManager(kernel_name="validation", kernel_spec_manager=specs)
        environment = os.environ.copy()
        environment.update(
            IPYTHONDIR=str(scratch / "ipython"), JUPYTER_RUNTIME_DIR=str(scratch / "runtime")
        )
        environment.pop("PYTHONPATH", None)
        environment.pop("PYTHONHOME", None)
        client = NotebookClient(
            notebook,
            km=manager,
            timeout=120,
            allow_errors=False,
            resources={"metadata": {"path": str(scratch)}},
        )
        try:
            executed = client.execute(env=environment)
        finally:
            if manager.has_kernel:
                manager.shutdown_kernel(now=True)
    cells = [cell for cell in executed.cells if cell.cell_type == "code"]
    assert len(cells) == 3 and all(cell.execution_count is not None for cell in cells)
    rich = [
        [output.get("data", {}).get("text/html", "") for output in cell.outputs] for cell in cells
    ]
    assert any("Add a table" in html for html in rich[0])
    assert any('sandbox="allow-scripts"' in html and 'srcdoc="' in html for html in rich[1])
    assert any("27" in html and "9" in html for html in rich[2])
    report = {
        "python": sys.version.split()[0],
        "jupyterlab": importlib.metadata.version("jupyterlab"),
        "nbclient": importlib.metadata.version("nbclient"),
        "executed_code_cells": len(cells),
        "errors": [],
        "empty_placeholder": True,
        "player_iframe": True,
        "kernel_cleaned_up": True,
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
