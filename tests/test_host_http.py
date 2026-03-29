from mcp_server.host_http import _normalize_origin


def test_normalize_origin_strips_trailing_slashes() -> None:
    assert _normalize_origin("https://example.onrender.com/") == "https://example.onrender.com"
    assert _normalize_origin("https://example.onrender.com///") == "https://example.onrender.com"
    assert _normalize_origin("http://localhost:5173") == "http://localhost:5173"
