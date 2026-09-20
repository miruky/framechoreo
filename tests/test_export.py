import datetime as dt
import json
from decimal import Decimal

import pandas as pd
import pytest

from framechoreo import CaptureLimitError, DataStory


def test_scalar_roundtrip_display_and_script_safety(tmp_path):
    attack = '</script><img src=x onerror="alert(1)">'
    s = DataStory(title=attack)
    s.table(
        pd.DataFrame(
            {
                "text": [attack],
                "big": [2**60],
                "decimal": [Decimal("1.234567890123456789")],
                "date": [dt.date(2026, 1, 1)],
                "missing": [None],
            }
        )
    )
    payload = s.to_dict()
    assert payload["steps"][0]["rows"][0]["cells"][1] == {
        "type": "integer",
        "value": str(2**60),
        "display": str(2**60),
    }
    text = s.to_html()
    assert attack not in text
    assert "\\u003c/script\\u003e" in text
    assert "https://" not in text and "http://" not in text
    assert json.loads(s.to_json())["title"] == attack
    path = s.export_html(tmp_path / "out.html")
    assert path.read_text() == text
    with pytest.raises(FileExistsError):
        s.export_html(path)
    s.export_html(path, overwrite=True)


def test_repeatable_output_and_notebook():
    s = DataStory()
    f = s.table(pd.DataFrame({"a": [1]}))
    assert s.to_html() == s.to_html()
    assert 'sandbox="allow-scripts"' in f._repr_html_()
    assert 'srcdoc="' in f._repr_html_()


def test_export_data_limit():
    s = DataStory(max_export_bytes=100)
    s.table(pd.DataFrame({"a": ["x" * 1000]}))
    with pytest.raises(CaptureLimitError):
        s.to_html()
