# Release checklist for the unpublished 1.0 candidate

The local artifacts are prepared separately from publishing. A successful build
does not mean a GitHub repository or PyPI project already exists.

1. Confirm the project name and inspect the final source diff.
2. Run Python tests on both supported pandas lines, player-model tests, and lint.
3. Generate examples and inspect the player in a browser, including a narrow view.
4. Build wheel and sdist, run `twine check`, and install the wheel outside the checkout.
5. Check the distributions for assets, license, docs, tests, and accidental private data.
6. Create the public repository only when publication is authorized. Enable its
   issue reporting and private vulnerability-reporting features as appropriate.
7. Run the configured CI on the actual repository before relying on its platform matrix.
8. Set the release date in CHANGELOG and update installation instructions when a
   real PyPI release exists. Add verified project URLs to package metadata.
9. Configure the PyPI project and trusted publishing, or follow PyPI's supported
   authenticated upload process. Account creation and publisher configuration are separate.
10. Tag the checked source, publish the matching artifacts, and confirm installation
    from the published package. Preserve artifact hashes in the release record.

The intended license is MIT. Review the project description and name before public
registration; a search finding no package is not a name reservation.

## Accounts and registration

Preparing a Python package locally needs no publisher account. For the intended
public workflow, use a GitHub account for the repository and a PyPI account for
package uploads. PyPI requires a verified email address; configure two-factor
authentication and retain recovery codes. See [PyPI account help](https://pypi.org/help/#twofa).

TestPyPI is an optional rehearsal service with a separate account and namespace;
it does not reserve the production name. See the [packaging tutorial](https://packaging.python.org/en/latest/tutorials/packaging-projects/).

A new project can use a pending Trusted Publisher: it creates the project on its
first successful upload. Configure the actual repository owner, repository,
workflow filename, and deployment environment after those exist. See [PyPI's
new-project guide](https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/).
The included workflow runs checks only; no publisher, token, or upload job is configured.

## Local verification commands

```sh
python -m pytest
npm ci
npm test
npm run format:check
python tests/check_wire.py
python -m ruff check .
python -m ruff format --check .
python examples/sales_story.py
python examples/missing_values.py
python examples/classroom.py
python examples/float_precision.py
python examples/blank_strings.py
python examples/retail_workflow.py
python examples/reshape_workflow.py
python examples/decision_window_workflow.py
python examples/compound_conditions_workflow.py
python examples/join_audit_workflow.py
python examples/group_transform_workflow.py
python examples/ordered_cases_workflow.py
python examples/asof_workflow.py
python examples/rank_workflow.py
python examples/growth_workflow.py
python examples/time_buckets_workflow.py
python examples/large_group_workflow.py --rows 1000
python examples/large_analysis.py --rows 2000
python -m build
python -m twine check dist/*
python tests/check_distribution.py
```

For the notebook path, install `.[notebook]`, run `python tests/check_notebook.py`,
and open `examples/notebook.ipynb` in JupyterLab to inspect the embedded controls.

## Candidate status

The current version is `1.0.0rc5`; it is a local candidate and has not been uploaded.
The public Python surface and migration boundaries are in [the 1.0 guide](v1.md).
Generated HTML carries the bundled player's MIT notice separately from the user's
content. This does not complete account setup, verified public URLs, a Git-history
privacy review, remote CI, or installation from a real published release.

Before changing the candidate version to `1.0.0`, review the recorded verification,
resolve any remaining release issues, rebuild from that exact source, and run the
fresh-install check again. Package classifiers do not turn a version into a prerelease;
the version string and runtime `__version__` must agree.
