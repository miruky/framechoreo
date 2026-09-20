"""Build-output and fresh-install checks; run separately from the offline unit suite."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
import venv
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    wheels = list((root / "dist").glob("*.whl"))
    sources = list((root / "dist").glob("*.tar.gz"))
    if len(wheels) != 1 or len(sources) != 1:
        raise SystemExit("Build one wheel and one sdist in a clean dist directory first.")
    wheel, source = wheels[0], sources[0]
    forbidden = {"node_modules", "__pycache__", ".venv", ".git", ".DS_Store", ".env", ".pypirc"}
    with zipfile.ZipFile(wheel) as archive:
        wheel_names = archive.namelist()
        for name in wheel_names:
            assert not forbidden.intersection(Path(name).parts), name
            if name.startswith("framechoreo/"):
                assert archive.read(name) == (root / "src" / name).read_bytes(), name
        for name in ["assets/model.js", "assets/player.js", "assets/player.css", "py.typed"]:
            assert "framechoreo/" + name in wheel_names
        assert any(name.endswith("/licenses/LICENSE") for name in wheel_names)
    with tarfile.open(source) as archive:
        sdist_names = archive.getnames()
        prefix = source.name.removesuffix(".tar.gz")
        for member in archive.getmembers():
            assert member.isfile(), member.name
            relative = Path(member.name).relative_to(prefix)
            assert ".." not in relative.parts and not relative.is_absolute()
            assert not forbidden.intersection(relative.parts), member.name
            assert "generated" not in relative.parts, member.name
            if relative.as_posix() != "PKG-INFO":
                assert archive.extractfile(member).read() == (root / relative).read_bytes(), (
                    member.name
                )
        for name in [
            "tests/player-dom.test.cjs",
            "tests/test_integrity.py",
            "tests/check_wire.py",
            "tests/check_distribution.py",
            "package-lock.json",
            ".prettierrc.json",
            "examples/sales_story.py",
            "docs/api.md",
            "LICENSE",
        ]:
            assert prefix + "/" + name in sdist_names, name

    readme = (root / "README.md").read_text(encoding="utf-8")
    example = re.search(r"```python\n(.*?)\n```", readme, re.S).group(1)
    guard = """import socket
def no_network(*args, **kwargs):
    raise AssertionError("Runtime network access is blocked")
socket.socket.connect = no_network
socket.socket.connect_ex = no_network
socket.create_connection = no_network
"""
    assertions = """
import framechoreo, importlib.metadata, json, os, platform
from pathlib import Path
assert Path(framechoreo.__file__).resolve().is_relative_to(
    Path(os.environ["FRAMECHOREO_CHECK_ENV"])
)
assert framechoreo.__version__ == importlib.metadata.version("framechoreo")
html = Path("sales-story.html").read_text(encoding="utf-8")
assert "FrameChoreoModel" in html and "framechoreo-data" in html
print(json.dumps({
    "version": framechoreo.__version__, "python": platform.python_version(),
    "pandas": pd.__version__, "html_bytes": len(html.encode("utf-8")),
    "origins": [int(o.value) for o in total.explain(0,"amount")],
}))
"""
    with tempfile.TemporaryDirectory(prefix="framechoreo-dist-") as folder:
        scratch = Path(folder)
        environment = scratch / "venv"
        venv.EnvBuilder(with_pip=True).create(environment)
        python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        env = os.environ.copy()
        for key in ["PYTHONPATH", "PYTHONHOME"]:
            env.pop(key, None)
        env.update(
            PIP_CONFIG_FILE=os.devnull,
            PIP_INDEX_URL="https://pypi.org/simple",
            PIP_EXTRA_INDEX_URL="",
            PIP_DISABLE_PIP_VERSION_CHECK="1",
            FRAMECHOREO_CHECK_ENV=str(environment.resolve()),
        )
        install = subprocess.run(
            [str(python), "-m", "pip", "install", "--no-input", str(wheel)],
            cwd=scratch,
            env=env,
            text=True,
            capture_output=True,
        )
        if install.returncode:
            raise RuntimeError(install.stdout + install.stderr)
        script = scratch / "readme_example.py"
        script.write_text(guard + example + assertions, encoding="utf-8")
        run = subprocess.run(
            [str(python), str(script)], cwd=scratch, env=env, text=True, capture_output=True
        )
        if run.returncode:
            raise RuntimeError(run.stdout + run.stderr)
        smoke = json.loads(run.stdout)
    report = {
        "smoke": smoke,
        "runtime_network_blocked": True,
        "fresh_environment": True,
        "wheel_files": len(wheel_names),
        "sdist_files": len(sdist_names),
        "artifacts": [
            {
                "file": p.name,
                "bytes": p.stat().st_size,
                "sha256": hashlib.sha256(p.read_bytes()).hexdigest(),
            }
            for p in [wheel, source]
        ],
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
