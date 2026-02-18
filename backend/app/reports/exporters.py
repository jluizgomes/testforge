"""Report exporters for different formats."""

import json
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from app.reports.generator import ReportGenerator


class BaseExporter(ABC):
    """Base class for report exporters."""

    @abstractmethod
    def export(self, report_data: dict[str, Any]) -> bytes:
        """Export report data to bytes."""
        pass

    @abstractmethod
    def get_content_type(self) -> str:
        """Get the content type for the export."""
        pass

    @abstractmethod
    def get_file_extension(self) -> str:
        """Get the file extension for the export."""
        pass


class HTMLExporter(BaseExporter):
    """Export reports to HTML format."""

    def __init__(self, generator: ReportGenerator | None = None) -> None:
        """Initialize HTML exporter."""
        self.generator = generator or ReportGenerator()

    def export(self, report_data: dict[str, Any]) -> bytes:
        """Export report to HTML bytes."""
        html = self.generator.render_html(report_data)
        return html.encode("utf-8")

    def get_content_type(self) -> str:
        return "text/html; charset=utf-8"

    def get_file_extension(self) -> str:
        return ".html"


class JSONExporter(BaseExporter):
    """Export reports to JSON format."""

    def export(self, report_data: dict[str, Any]) -> bytes:
        """Export report to JSON bytes."""
        return json.dumps(report_data, indent=2, default=str).encode("utf-8")

    def get_content_type(self) -> str:
        return "application/json; charset=utf-8"

    def get_file_extension(self) -> str:
        return ".json"


class PDFExporter(BaseExporter):
    """Export reports to PDF format using WeasyPrint."""

    def __init__(self, generator: ReportGenerator | None = None) -> None:
        """Initialize PDF exporter."""
        self.generator = generator or ReportGenerator()
        self._weasyprint_available = self._check_weasyprint()

    def _check_weasyprint(self) -> bool:
        """Check if WeasyPrint is available."""
        try:
            import weasyprint

            return True
        except (ImportError, OSError, Exception):
            return False

    def export(self, report_data: dict[str, Any]) -> bytes:
        """Export report to PDF bytes."""
        if not self._weasyprint_available:
            raise RuntimeError(
                "WeasyPrint is not installed. "
                "Install it with: pip install weasyprint"
            )

        from weasyprint import HTML

        html = self.generator.render_html(report_data)
        pdf = HTML(string=html).write_pdf()
        return pdf

    def get_content_type(self) -> str:
        return "application/pdf"

    def get_file_extension(self) -> str:
        return ".pdf"


class JUnitXMLExporter(BaseExporter):
    """Export reports to JUnit XML format."""

    def export(self, report_data: dict[str, Any]) -> bytes:
        """Export report to JUnit XML bytes."""
        summary = report_data.get("summary", {})
        results_by_layer = report_data.get("results_by_layer", {})

        # Build XML
        xml_parts = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<testsuites>',
        ]

        for layer, results in results_by_layer.items():
            if not results:
                continue

            layer_passed = sum(1 for r in results if r.get("status") == "passed")
            layer_failed = sum(1 for r in results if r.get("status") == "failed")
            layer_skipped = sum(1 for r in results if r.get("status") == "skipped")
            layer_time = sum(r.get("duration_ms", 0) for r in results) / 1000

            xml_parts.append(
                f'  <testsuite name="{layer}" tests="{len(results)}" '
                f'failures="{layer_failed}" skipped="{layer_skipped}" '
                f'time="{layer_time:.3f}">'
            )

            for result in results:
                test_name = result.get("test_name", "Unknown")
                test_time = result.get("duration_ms", 0) / 1000
                status = result.get("status", "passed")

                xml_parts.append(
                    f'    <testcase name="{self._escape_xml(test_name)}" '
                    f'classname="{layer}" time="{test_time:.3f}">'
                )

                if status == "failed":
                    error_msg = result.get("error_message", "Test failed")
                    error_stack = result.get("error_stack", "")
                    xml_parts.append(
                        f'      <failure message="{self._escape_xml(error_msg)}">'
                        f'{self._escape_xml(error_stack)}</failure>'
                    )
                elif status == "skipped":
                    xml_parts.append("      <skipped/>")
                elif status == "error":
                    error_msg = result.get("error_message", "Error occurred")
                    xml_parts.append(
                        f'      <error message="{self._escape_xml(error_msg)}"/>'
                    )

                xml_parts.append("    </testcase>")

            xml_parts.append("  </testsuite>")

        xml_parts.append("</testsuites>")

        return "\n".join(xml_parts).encode("utf-8")

    def get_content_type(self) -> str:
        return "application/xml; charset=utf-8"

    def get_file_extension(self) -> str:
        return ".xml"

    @staticmethod
    def _escape_xml(text: str) -> str:
        """Escape XML special characters."""
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )


class MarkdownExporter(BaseExporter):
    """Export reports to Markdown format."""

    def export(self, report_data: dict[str, Any]) -> bytes:
        """Export report to Markdown bytes."""
        summary = report_data.get("summary", {})
        metadata = report_data.get("metadata", {})
        failures = report_data.get("failures", [])
        recommendations = report_data.get("recommendations", [])

        md_parts = [
            "# Test Report",
            "",
            f"**Generated:** {metadata.get('generated_at', 'N/A')}",
            f"**Test Run ID:** {metadata.get('test_run_id', 'N/A')}",
            "",
            "## Summary",
            "",
            f"| Metric | Value |",
            f"|--------|-------|",
            f"| Status | {summary.get('status', 'N/A')} |",
            f"| Total Tests | {summary.get('total_tests', 0)} |",
            f"| Passed | {summary.get('passed', 0)} |",
            f"| Failed | {summary.get('failed', 0)} |",
            f"| Skipped | {summary.get('skipped', 0)} |",
            f"| Pass Rate | {summary.get('pass_rate', 0)}% |",
            f"| Health Score | {summary.get('health_score', 0)} |",
            "",
        ]

        if failures:
            md_parts.extend([
                "## Failures",
                "",
            ])
            for f in failures:
                md_parts.extend([
                    f"### {f.get('test_name', 'Unknown Test')}",
                    "",
                    f"**File:** {f.get('test_file', 'N/A')}",
                    f"**Layer:** {f.get('test_layer', 'N/A')}",
                    "",
                    "**Error:**",
                    f"```",
                    f"{f.get('error_message', 'No error message')}",
                    f"```",
                    "",
                ])

        if recommendations:
            md_parts.extend([
                "## Recommendations",
                "",
            ])
            for r in recommendations:
                md_parts.append(f"- {r}")
            md_parts.append("")

        return "\n".join(md_parts).encode("utf-8")

    def get_content_type(self) -> str:
        return "text/markdown; charset=utf-8"

    def get_file_extension(self) -> str:
        return ".md"
