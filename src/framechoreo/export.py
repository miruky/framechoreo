"""Self-contained HTML and notebook exports."""

from __future__ import annotations

import base64
import gzip
import html
import os
import tempfile
from importlib.resources import files
from pathlib import Path


def render_html(data: str, title: str, theme: str, *, compression: str = "auto") -> str:
    if not isinstance(theme, str) or theme not in {"auto", "light", "dark"}:
        raise ValueError("theme must be 'auto', 'light', or 'dark'")
    if not isinstance(compression, str) or compression not in {"auto", "none", "gzip"}:
        raise ValueError("compression must be 'auto', 'none', or 'gzip'")
    assets = files("framechoreo").joinpath("assets")
    css = assets.joinpath("player.css").read_text(encoding="utf-8")
    model = assets.joinpath("model.js").read_text(encoding="utf-8")
    player = assets.joinpath("player.js").read_text(encoding="utf-8")
    safe_data = None
    encoding = "json"
    data_type = "application/json"
    raw = data.encode("utf-8")
    if compression == "gzip" or (compression == "auto" and len(raw) >= 100_000):
        compressed = base64.b64encode(gzip.compress(raw, compresslevel=6, mtime=0)).decode("ascii")
        plain_size = len(raw) + 5 * sum(data.count(c) for c in "&<>")
        plain_size += 3 * (data.count("\u2028") + data.count("\u2029"))
        if compression == "gzip" or len(compressed) < plain_size:
            safe_data = compressed
            encoding = "gzip-base64"
            data_type = "application/octet-stream"
    if safe_data is None:
        safe_data = (
            data.replace("&", "\\u0026")
            .replace("<", "\\u003c")
            .replace(">", "\\u003e")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029")
        )
    return (
        '<!doctype html>\n<html lang="en" data-theme="' + theme + '">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<link rel="icon" href="data:,">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; '
        "script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; "
        "base-uri 'none'; form-action 'none'\">\n"
        f"<title>{html.escape(title)}</title>\n<style>{css}</style>\n</head>\n<body>\n"
        '<main id="framechoreo-player" aria-label="Data transformation story"></main>\n'
        "<noscript>This story needs JavaScript to animate. "
        "No network access is required.</noscript>\n"
        f'<script id="framechoreo-data" type="{data_type}" data-encoding="{encoding}" '
        f'data-json-bytes="{len(raw)}">{safe_data}</script>\n'
        f"<script>{model}</script>\n<script>{player}</script>\n</body>\n</html>\n"
    )


def write_html(path: str | Path, text: str, *, overwrite: bool) -> Path:
    if not isinstance(overwrite, bool):
        raise ValueError("overwrite must be a boolean")
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", dir=target.parent, prefix=".framechoreo-", delete=False
        ) as stream:
            temp_path = Path(stream.name)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        if overwrite:
            os.replace(temp_path, target)
        else:
            os.link(temp_path, target)
        return target
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def notebook_html(text: str, title: str) -> str:
    return (
        '<iframe sandbox="allow-scripts" style="width:100%;height:720px;border:0" '
        f'title="{html.escape(title, quote=True)}" '
        f'srcdoc="{html.escape(text, quote=True)}"></iframe>'
    )


def notebook_placeholder(title: str) -> str:
    return (
        '<div role="note"><strong>' + html.escape(title) + "</strong>"
        "<p>Add a table with <code>story.table(df)</code> to start this story.</p></div>"
    )
