from mcp_server.tools.logs_analyzer import (
    extract_failing_tests,
    extract_file_path_candidates,
    normalize_logs,
)


def test_extract_failing_tests():
    logs = """
    test_a.py::test_x FAILED
    AssertionError: expected 1 got 0
    """
    failures = extract_failing_tests(logs)
    assert failures


def test_normalize_logs_limits_chars():
    raw = "a" * 10000
    normalized = normalize_logs(raw, max_chars=100)
    assert len(normalized) == 100


def test_extract_file_path_candidates_from_logs_and_tests():
    items = [
        "ERROR in .github/workflows/ci.yml:14 command failed",
        "File \"/home/runner/work/repo/app/main.py\", line 10",
        "tests/test_app.py::test_x FAILED",
    ]
    paths = extract_file_path_candidates(items)
    assert ".github/workflows/ci.yml" in paths
    assert "tests/test_app.py" in paths

