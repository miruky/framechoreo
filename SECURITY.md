# Security

## Supported version

Security fixes target the current 0.1.x line. This is an early release with a
limited supported operation surface.

## Data handling

Exported HTML contains recorded ancestor tables, including rows that were filtered
out. It is not an anonymization mechanism. Prepare or synthesize data before
sharing. A source index is not displayed automatically, but ordinary data columns
and captured values are included.

The HTML player has no network dependencies and does not execute Python. Data is
escaped when embedded and displayed using text APIs. A Content Security Policy
blocks external resources. These protections do not make arbitrary Python
predicates safe: callbacks execute as ordinary trusted code on the producer's PC.

Capture limits bound typical stories. Raising them can increase memory use and
rendering cost. Do not treat the library as a sandbox for untrusted files or code.

## Reporting a vulnerability

Use the repository's private vulnerability-reporting channel when available.
If it is unavailable, open an issue requesting a private reporting channel from
the maintainer, **without exploit details or sensitive data**. The project
maintainer is [miruky](https://github.com/miruky).

Include the affected version and a minimal synthetic reproduction. Do not publish
private datasets, access tokens, or identifying information in a public issue.
