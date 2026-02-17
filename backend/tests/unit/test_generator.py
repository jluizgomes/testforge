"""Unit tests for ReportGenerator.

Total: 4 tests
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from app.reports.generator import ReportGenerator


def _make_test_run(
    *,
    status: str = "passed",
    total: int = 10,
    passed: int = 8,
    failed: int = 2,
    skipped: int = 0,
    duration_ms: int | None = 5000,
) -> MagicMock:
    """Create a mock TestRun with the given stats."""
    run = MagicMock()
    run.id = "run-test-1"
    run.project_id = "proj-1"
    run.status = MagicMock()
    run.status.value = status
    run.total_tests = total
    run.passed_tests = passed
    run.failed_tests = failed
    run.skipped_tests = skipped
    run.duration_ms = duration_ms
    run.started_at = datetime(2026, 2, 17, 9, 0, 0, tzinfo=timezone.utc)
    run.completed_at = datetime(2026, 2, 17, 9, 5, 0, tzinfo=timezone.utc)
    return run


SAMPLE_RESULTS = [
    {"test_name": "Login", "test_layer": "frontend", "status": "passed", "duration_ms": 500},
    {"test_name": "API check", "test_layer": "backend", "status": "failed", "duration_ms": 100,
     "error_message": "timeout occurred"},
    {"test_name": "DB select", "test_layer": "database", "status": "skipped", "duration_ms": 0},
    {"test_name": "Error flow", "test_layer": "frontend", "status": "error", "duration_ms": 200,
     "error_message": "unexpected element"},
]


class TestGenerateReportStructure:
    def test_generate_report_has_required_keys(self):
        """generate_report() returns dict with all expected top-level keys."""
        gen = ReportGenerator()
        run = _make_test_run()

        report = gen.generate_report(run, SAMPLE_RESULTS)

        expected_keys = {
            "metadata", "summary", "results_by_layer", "failures",
            "traces", "ai_analysis", "performance", "trends", "recommendations",
        }
        assert expected_keys.issubset(set(report.keys()))

    def test_extract_failures_only_failed_and_error(self):
        """Only 'failed' and 'error' results are included in failures list."""
        gen = ReportGenerator()
        run = _make_test_run()

        report = gen.generate_report(run, SAMPLE_RESULTS)

        failure_names = {f["test_name"] for f in report["failures"]}
        assert "API check" in failure_names   # status=failed
        assert "Error flow" in failure_names  # status=error
        assert "Login" not in failure_names   # status=passed
        assert "DB select" not in failure_names  # status=skipped


class TestHealthScore:
    def test_health_score_perfect_with_no_failures(self):
        """100% pass rate and 0 failures yields health_score = 100."""
        gen = ReportGenerator()
        score = gen._calculate_health_score(100.0, 0)
        assert score == 100

    def test_health_score_penalty_per_failure(self):
        """Each failure reduces health score by 2 (max 20 point penalty)."""
        gen = ReportGenerator()
        score_no_fail = gen._calculate_health_score(80.0, 0)
        score_five_fail = gen._calculate_health_score(80.0, 5)
        assert score_five_fail == score_no_fail - 10  # 5 * 2 = 10 point penalty


class TestFormatDuration:
    @pytest.mark.parametrize("ms,expected", [
        (500, "500ms"),
        (1500, "1.5s"),
        (65000, "1m 5s"),
        (0, "0ms"),
        (None, "N/A"),
    ])
    def test_format_duration_cases(self, ms, expected):
        """_format_duration converts milliseconds to human-readable string."""
        result = ReportGenerator._format_duration(ms)
        assert result == expected
