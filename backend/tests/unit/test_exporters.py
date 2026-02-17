"""Unit tests for report exporters.

Total: 4 tests
"""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock

from app.reports.exporters import HTMLExporter, JSONExporter, JUnitXMLExporter, MarkdownExporter


# ── Shared test data ──────────────────────────────────────────────────────────

SAMPLE_REPORT: dict = {
    "metadata": {
        "report_id": "report-test-1",
        "generated_at": "2026-02-17T10:00:00",
        "test_run_id": "run-1",
        "project_id": "proj-1",
        "started_at": "2026-02-17T09:55:00",
        "completed_at": "2026-02-17T10:00:00",
    },
    "summary": {
        "status": "passed",
        "total_tests": 10,
        "passed": 8,
        "failed": 1,
        "skipped": 1,
        "pass_rate": 80.0,
        "health_score": 78,
        "duration_ms": 5000,
    },
    "results_by_layer": {
        "frontend": [
            {"test_name": "Login test", "status": "passed", "duration_ms": 500},
            {"test_name": "Signup test", "status": "failed", "duration_ms": 1200,
             "error_message": "element not found"},
        ],
        "backend": [
            {"test_name": "API health", "status": "passed", "duration_ms": 80},
        ],
        "database": [],
        "infrastructure": [],
    },
    "failures": [
        {
            "test_name": "Signup test",
            "test_file": "signup.spec.ts",
            "test_layer": "frontend",
            "error_message": "element not found",
            "error_stack": "  at Object.<anonymous> (signup.spec.ts:20:5)",
        },
    ],
    "traces": [],
    "ai_analysis": None,
    "performance": {"avg_duration_ms": 593, "slowest_tests": [], "fastest_tests": []},
    "trends": {"pass_rate_trend": "stable"},
    "recommendations": ["Use data-testid for stable selectors."],
}


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestJSONExporter:
    def test_produces_valid_json_bytes(self):
        """JSONExporter.export() returns valid UTF-8 JSON bytes."""
        exporter = JSONExporter()
        result = exporter.export(SAMPLE_REPORT)

        assert isinstance(result, bytes)
        parsed = json.loads(result.decode("utf-8"))
        assert parsed["summary"]["total_tests"] == 10
        assert exporter.get_content_type() == "application/json; charset=utf-8"
        assert exporter.get_file_extension() == ".json"


class TestJUnitXMLExporter:
    def test_produces_valid_xml_structure(self):
        """JUnitXMLExporter produces parseable XML with testsuites root element."""
        exporter = JUnitXMLExporter()
        result = exporter.export(SAMPLE_REPORT)

        assert isinstance(result, bytes)
        xml_str = result.decode("utf-8")
        root = ET.fromstring(xml_str)

        assert root.tag == "testsuites"
        suites = root.findall("testsuite")
        # frontend and backend have tests
        suite_names = [s.get("name") for s in suites]
        assert "frontend" in suite_names
        assert "backend" in suite_names
        assert exporter.get_file_extension() == ".xml"

    def test_escape_xml_special_chars(self):
        """_escape_xml handles &, <, > and quotes."""
        assert JUnitXMLExporter._escape_xml("a & b") == "a &amp; b"
        assert JUnitXMLExporter._escape_xml("<tag>") == "&lt;tag&gt;"
        assert JUnitXMLExporter._escape_xml('"quoted"') == "&quot;quoted&quot;"


class TestMarkdownExporter:
    def test_contains_summary_table(self):
        """MarkdownExporter output has # Test Report heading and summary table."""
        exporter = MarkdownExporter()
        result = exporter.export(SAMPLE_REPORT)

        md = result.decode("utf-8")
        assert "# Test Report" in md
        assert "| Total Tests | 10 |" in md
        assert "| Passed | 8 |" in md
        assert exporter.get_content_type() == "text/markdown; charset=utf-8"


class TestHTMLExporter:
    def test_delegates_to_generator(self):
        """HTMLExporter.export() calls generator.render_html() once."""
        mock_generator = MagicMock()
        mock_generator.render_html.return_value = "<html>Test</html>"

        exporter = HTMLExporter(generator=mock_generator)
        result = exporter.export(SAMPLE_REPORT)

        mock_generator.render_html.assert_called_once_with(SAMPLE_REPORT)
        assert result == b"<html>Test</html>"
        assert exporter.get_content_type() == "text/html; charset=utf-8"
