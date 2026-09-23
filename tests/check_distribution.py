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
        for name in [
            "assets/model.js",
            "assets/player.js",
            "assets/player.css",
            "assets/workbench.js",
            "assets/workbench.css",
            "assets/LICENSE.txt",
            "profile.py",
            "py.typed",
        ]:
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
            "tests/check_notebook.py",
            "tests/test_deep_contracts.py",
            "tests/test_scalar_fidelity.py",
            "tests/test_empty_lineage.py",
            "tests/player-integrity.test.cjs",
            "tests/player-navigation.test.cjs",
            "tests/player-scale.test.cjs",
            "tests/player-flow.test.cjs",
            "tests/player-motion.test.cjs",
            "tests/motion-fixtures.cjs",
            "tests/test_analysis.py",
            "tests/test_group_aggregates.py",
            "tests/test_workflows.py",
            "tests/player-workbench.test.cjs",
            "tests/player-workflow-model.test.cjs",
            "tests/player-reshape.test.cjs",
            "tests/player-decisions.test.cjs",
            "tests/player-join-audit.test.cjs",
            "tests/player-group-transform.test.cjs",
            "tests/player-compound-conditions.test.cjs",
            "tests/player-ordered-cases.test.cjs",
            "tests/player-asof.test.cjs",
            "tests/player-rank.test.cjs",
            "tests/test_decisions_windows.py",
            "tests/test_join_audit.py",
            "tests/test_group_transform.py",
            "tests/test_compound_conditions.py",
            "tests/test_case_select.py",
            "tests/test_asof.py",
            "tests/test_rank_within.py",
            "tests/make_decision_fixture.py",
            "tests/make_join_audit_fixture.py",
            "tests/make_group_transform_fixture.py",
            "tests/make_compound_fixture.py",
            "tests/make_ordered_cases_fixture.py",
            "tests/make_asof_fixture.py",
            "tests/make_rank_fixture.py",
            "tests/fixtures/retail.json",
            "tests/fixtures/reshape.json",
            "tests/fixtures/decisions.json",
            "tests/fixtures/window_extrema.json",
            "tests/fixtures/join_audit.json",
            "tests/fixtures/group_transform.json",
            "tests/fixtures/compound_conditions.json",
            "tests/fixtures/ordered_cases.json",
            "tests/fixtures/asof.json",
            "tests/fixtures/rank.json",
            "package-lock.json",
            ".prettierrc.json",
            "examples/sales_story.py",
            "examples/notebook.ipynb",
            "examples/float_precision.py",
            "examples/blank_strings.py",
            "examples/large_analysis.py",
            "examples/group_aggregates.py",
            "examples/motion_showcase.py",
            "examples/retail_workflow.py",
            "examples/reshape_workflow.py",
            "examples/decision_window_workflow.py",
            "examples/join_audit_workflow.py",
            "examples/group_transform_workflow.py",
            "examples/compound_conditions_workflow.py",
            "examples/ordered_cases_workflow.py",
            "examples/asof_workflow.py",
            "examples/rank_workflow.py",
            "docs/v1.md",
            "docs/analysis.md",
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
analysis_story = DataStory.for_analysis()
measurements = analysis_story.table(pd.DataFrame({"key": ["all"] * 1000, "v": range(1, 1001)}))
analysis_result = (
    measurements.calculate("double", left="v", op="multiply", right=2)
    .group_sum(by="key", value="double", dropna=False)
    .sort_values("double", ascending=False)
    .select_columns(["key", "double"])
    .rename_columns({"double": "total"})
)
assert analysis_result.to_pandas().iat[0, 1] == 1001000
last_page = analysis_result.explain_page(0, "total", offset=999)
assert last_page.total == 1000 and last_page.origins[0].value == 1000
assert 'data-encoding="gzip-base64"' in analysis_story.to_html(result=analysis_result)
ratings = analysis_story.table(pd.DataFrame({"key": ["a", "a", "a"], "score": [5., 4., None]}))
average = ratings.group_mean(by="key", value="score", dropna=False)
counted = ratings.group_count(by="key", value="score", dropna=False)
assert average.to_pandas().iat[0, 1] == 4.5
assert counted.to_pandas().iat[0, 1] == 2
assert [o.value for o in average.explain(0, "score")] == [5., 4.]
assert counted.explain_page(0, "score").total == 2
assert 'value-flight' in analysis_story.to_html(result=average)
workflow = DataStory(language="ja", description="Fresh-install workflow")
raw = workflow.table(pd.DataFrame({
    "id":[" a ","b","c"], "v":["10","bad","30"], "date":["2026-01-01"]*3
}))
clean = (
    raw.string_transform("id",op="strip").to_numeric("v",errors="coerce")
    .fill_missing({"v":0}).astype({"v":"Int64"})
    .to_datetime("date",format="%Y-%m-%d").drop_missing().drop_duplicates()
)
combo = workflow.concat([clean,clean.take_rows([0])])
stats = combo.group_agg(
    by="id",aggregations={"func":("v","sum"),"average":("v","mean")},dropna=False
)
assert stats.to_pandas()["func"].tolist() == [20,0,30]
long = stats.melt(id_vars="id",value_vars=["func","average"])
wide = long.pivot(index="id",columns="variable",values="value")
assert wide.to_pandas()["func"].tolist() == [20,0,30]
assert clean.profile()["missing_cells"] == 0
workflow_html = workflow.to_html(result=wide)
assert 'FrameChoreoWorkbench' in workflow_html and 'framechoreo-license' in workflow_html
assert 'lang="ja"' in workflow_html
from framechoreo import col, where
decisions = DataStory()
input_frame = decisions.table(pd.DataFrame({
    "sales": pd.Series([10, None, 30], dtype="Int64"),
    "forecast": [None, 20, None], "target": [5, 15, 35],
}))
status = input_frame.case_when(
    "status", column="sales", op="ge", value=col("target"),
    then="pass", otherwise="review",
)
available = status.coalesce("effective", ["sales", "forecast"], default=0)
running = available.window("running", column="effective", op="cumsum")
lowest = available.window("lowest", column="effective", op="cummin")
recent_high = available.window(
    "recent_high", column="effective", op="rolling_max", size=2, min_periods=1
)
filtered = running.filter_by("sales", op="ge", value=col("target"))
assert filtered.to_pandas()["sales"].tolist() == [10]
assert [filtered.filter_decision(i) for i in range(3)] == ["true", "missing", "false"]
assert [o.column for o in status.explain_controls(0, "status")] == ["sales", "target"]
assert [o.column for o in available.explain(1, "effective")] == ["forecast"]
assert [o.row for o in running.explain(2, "running")] == [0, 1, 2]
assert lowest.to_pandas()["lowest"].tolist() == [10, 10, 10]
assert recent_high.to_pandas()["recent_high"].tolist() == [10, 20, 30]
assert 'decision-audit' in decisions.to_html(result=filtered)
rule = (where("sales", "ge", 10) & where("target", "between", (5, 35)))
selected = input_frame.filter_by(rule)
assert [selected.filter_decision(i) for i in range(3)] == ["true", "missing", "true"]
assert [part["outcome"] for part in selected.condition_breakdown(1)] == ["missing", "true"]
metric_story = DataStory()
metric_source = metric_story.table(pd.DataFrame({"g":["a","a","b"],"v":[1.0,None,2.0]}))
metric = metric_source.group_transform("total", by="g", value="v", op="sum", dropna=False)
assert metric.to_pandas()["total"].tolist() == [1.0,1.0,2.0]
assert [o.row for o in metric.explain(1,"total")] == [0]
join_story = DataStory()
orders = join_story.table(pd.DataFrame({"key":["a","b"],"amount":[1,2]}))
catalog = join_story.table(pd.DataFrame({"key":["a","c"],"kind":["x","y"]}))
joined_audit = orders.merge(catalog,on="key",how="inner",validate="one_to_one")
assert joined_audit.join_audit()["right_unmatched"] == [1]
assert 'Join input audit' in join_story.to_html(result=joined_audit)
ordered = input_frame.case_select(
    "tier", cases=[(where("sales", "ge", 25), "high"),
                   (where("target", "eq", 15), "middle")], otherwise="basic"
)
assert ordered.to_pandas()["tier"].tolist() == ["basic", "middle", "high"]
assert ordered.case_decision(1)["selected_case"] == 1
near_story = DataStory()
left_near = near_story.table(pd.DataFrame({"time":[1,3],"event":["a","b"]}))
right_near = near_story.table(pd.DataFrame({"time":[2],"reading":[9]}))
near = left_near.merge_asof(right_near,on="time",direction="backward")
assert near.asof_audit()["matched_right_rows"] == [None,0]
assert [o.value for o in near.explain(1,"reading")] == [9]
rank_story = DataStory()
rank_source = rank_story.table(pd.DataFrame({"g":["one"]*3,"v":[10,10,20]}))
ranked = rank_source.rank_within("rank",by="g",value="v",method="dense")
assert ranked.to_pandas()["rank"].tolist() == [2.,2.,1.]
assert [o.row for o in ranked.explain(0,"rank")] == [0,1,2]
print(json.dumps({
    "version": framechoreo.__version__, "python": platform.python_version(),
    "pandas": pd.__version__, "html_bytes": len(html.encode("utf-8")),
    "origins": [int(o.value) for o in total.explain(0,"amount")],
    "analysis_rows": 1000, "analysis_source_total": last_page.total,
    "workflow_result_rows": len(wide.to_pandas()), "workflow_language": "ja",
    "decision_result_rows": len(filtered.to_pandas()),
    "compound_result_rows": len(selected.to_pandas()),
    "group_metric_rows": len(metric.to_pandas()),
    "ordered_case_rows": len(ordered.to_pandas()),
    "asof_rows": len(near.to_pandas()),
    "rank_rows": len(ranked.to_pandas()),
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
