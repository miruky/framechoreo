# Contributing

Small, reproducible examples are the best starting point. Describe the user-facing
problem and compare the expected DataFrame with ordinary pandas before proposing
an animation change. Search existing issues and pull requests for overlapping work.

## Development setup

Use Python 3.11 or newer in a virtual environment and Node.js 20 or newer for the
browser-independent player tests.

```sh
python -m pip install -e ".[dev]"
npm ci
python -m pytest
npm test
npm run format:check
python tests/check_wire.py
python -m ruff check .
python -m ruff format --check .
```

Python tests block network connections. Examples and test fixtures must use
synthetic data. For supported pandas releases, test both the lower dependency
bound and the current supported 3.0 release.

## Changes to operations

Add a failing regression test before fixing a defect. Compare full DataFrames,
including dtypes and index/column metadata. Check lineage independently of visual
appearance. Do not weaken assertions, remove cases, or add skips to pass a change.

Test repeated values, duplicate indices, missing values, empty outputs, relevant
categorical types, and unsupported inputs. A newly supported operation needs a
clear contract for value inputs and row membership.

## Player changes

Run the Node model and DOM tests and generate the examples. DOM tests use jsdom
with a controlled clock; they test actual player controls, not real browser layout.
`check_wire.py` compares Python and JavaScript source-cell traversal. Keep JavaScript
and CSS formatted with `npm run format`. Inspect normal playback,
backward navigation, source-cell inspection, empty output, narrow screens, and
reduced motion. Cell text must never be inserted as executable HTML. Keep the
export free of external requests.

## Build

```sh
python -m build
python -m twine check dist/*
python tests/check_distribution.py
```

Install the wheel in a fresh environment outside the source checkout and run an
example. The wheel must include CSS, JavaScript, and `py.typed`. The sdist must
include tests, examples, documentation, and the license.

The distribution checker expects one wheel and one sdist in `dist/`. It checks
archive contents against the source, creates a separate virtual environment,
installs the wheel and runtime dependencies, then runs the README example with
runtime connections blocked. Dependency installation itself needs package access.

Keep local caches, private datasets, generated research notes, and credentials out
of patches. Describe verification honestly and distinguish checks you ran from
checks configured to run later. Contributors remain responsible for tool-assisted
changes and for explaining their behavior.

Contributions are submitted under the project's MIT license. See
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md).
