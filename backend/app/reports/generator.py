"""Report generator for test results."""

from datetime import datetime
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader

from app.models.test_run import TestRun, TestRunStatus


class ReportGenerator:
    """Generates test reports from test run data."""

    def __init__(self, templates_dir: Path | None = None) -> None:
        """Initialize the report generator."""
        if templates_dir is None:
            templates_dir = Path(__file__).parent / "templates"

        templates_dir.mkdir(parents=True, exist_ok=True)

        self.env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=True,
        )

        # Add custom filters
        self.env.filters["format_duration"] = self._format_duration
        self.env.filters["format_datetime"] = self._format_datetime
        self.env.filters["status_class"] = self._status_class

    def generate_report(
        self,
        test_run: TestRun,
        results: list[dict[str, Any]],
        traces: list[dict[str, Any]] | None = None,
        ai_analysis: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate a report data structure."""
        return {
            "metadata": self._generate_metadata(test_run),
            "summary": self._generate_summary(test_run),
            "results_by_layer": self._group_results_by_layer(results),
            "failures": self._extract_failures(results),
            "traces": traces or [],
            "ai_analysis": ai_analysis,
            "performance": self._calculate_performance(results),
            "trends": self._calculate_trends([]),  # Would need historical data
            "recommendations": self._generate_recommendations(results, ai_analysis),
        }

    def render_html(
        self,
        report_data: dict[str, Any],
        template_name: str = "report.html.jinja2",
    ) -> str:
        """Render report as HTML."""
        try:
            template = self.env.get_template(template_name)
            return template.render(**report_data)
        except Exception:
            # Fallback to inline template
            return self._render_inline_html(report_data)

    def render_json(self, report_data: dict[str, Any]) -> str:
        """Render report as JSON."""
        import json

        return json.dumps(report_data, indent=2, default=str)

    def _generate_metadata(self, test_run: TestRun) -> dict[str, Any]:
        """Generate report metadata."""
        return {
            "report_id": f"report-{test_run.id}",
            "generated_at": datetime.now().isoformat(),
            "test_run_id": test_run.id,
            "project_id": test_run.project_id,
            "started_at": test_run.started_at.isoformat() if test_run.started_at else None,
            "completed_at": test_run.completed_at.isoformat() if test_run.completed_at else None,
        }

    def _generate_summary(self, test_run: TestRun) -> dict[str, Any]:
        """Generate summary statistics."""
        total = test_run.total_tests
        passed = test_run.passed_tests
        failed = test_run.failed_tests
        skipped = test_run.skipped_tests

        pass_rate = (passed / total * 100) if total > 0 else 0

        return {
            "status": test_run.status.value if isinstance(test_run.status, TestRunStatus) else test_run.status,
            "total_tests": total,
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "pass_rate": round(pass_rate, 1),
            "duration_ms": test_run.duration_ms,
            "health_score": self._calculate_health_score(pass_rate, failed),
        }

    def _calculate_health_score(self, pass_rate: float, failed: int) -> int:
        """Calculate overall health score (0-100)."""
        # Base score from pass rate
        score = pass_rate

        # Penalty for failures
        if failed > 0:
            score -= min(failed * 2, 20)  # Max 20 point penalty

        return max(0, min(100, int(score)))

    def _group_results_by_layer(self, results: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        """Group results by test layer."""
        layers: dict[str, list[dict[str, Any]]] = {
            "frontend": [],
            "backend": [],
            "database": [],
            "infrastructure": [],
        }

        for result in results:
            layer = result.get("test_layer", "frontend")
            if layer in layers:
                layers[layer].append(result)
            else:
                layers["frontend"].append(result)

        return layers

    def _extract_failures(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Extract failed tests with details."""
        failures = []

        for result in results:
            if result.get("status") in ["failed", "error"]:
                failures.append({
                    "test_name": result.get("test_name"),
                    "test_file": result.get("test_file"),
                    "test_layer": result.get("test_layer"),
                    "error_message": result.get("error_message"),
                    "error_stack": result.get("error_stack"),
                    "screenshot_path": result.get("screenshot_path"),
                    "trace_id": result.get("trace_id"),
                    "duration_ms": result.get("duration_ms"),
                })

        return failures

    def _calculate_performance(self, results: list[dict[str, Any]]) -> dict[str, Any]:
        """Calculate performance metrics."""
        if not results:
            return {"avg_duration_ms": 0, "slowest_tests": [], "fastest_tests": []}

        durations = [(r.get("test_name"), r.get("duration_ms", 0)) for r in results]
        durations_only = [d[1] for d in durations]

        avg_duration = sum(durations_only) / len(durations_only) if durations_only else 0

        # Sort by duration
        sorted_durations = sorted(durations, key=lambda x: x[1], reverse=True)

        return {
            "avg_duration_ms": round(avg_duration, 1),
            "slowest_tests": [{"name": d[0], "duration_ms": d[1]} for d in sorted_durations[:5]],
            "fastest_tests": [{"name": d[0], "duration_ms": d[1]} for d in sorted_durations[-5:]],
            "total_duration_ms": sum(durations_only),
        }

    def _calculate_trends(self, historical_data: list[dict[str, Any]]) -> dict[str, Any]:
        """Calculate trends from historical data."""
        # Placeholder for trend calculation
        return {
            "pass_rate_trend": "stable",
            "duration_trend": "stable",
            "failure_trend": "stable",
        }

    def _generate_recommendations(
        self,
        results: list[dict[str, Any]],
        ai_analysis: dict[str, Any] | None,
    ) -> list[str]:
        """Generate recommendations based on results."""
        recommendations = []

        # Check for common issues
        failures = [r for r in results if r.get("status") in ["failed", "error"]]

        if failures:
            error_messages = [f.get("error_message", "") for f in failures]

            # Check for selector issues
            if any("selector" in msg.lower() or "element" in msg.lower() for msg in error_messages):
                recommendations.append(
                    "Consider using data-testid attributes for more stable selectors."
                )

            # Check for timeout issues
            if any("timeout" in msg.lower() for msg in error_messages):
                recommendations.append(
                    "Some tests are timing out. Consider increasing timeouts or adding explicit waits."
                )

        # Add AI recommendations if available
        if ai_analysis and ai_analysis.get("suggestions"):
            recommendations.extend(ai_analysis["suggestions"][:3])

        return recommendations

    @staticmethod
    def _format_duration(ms: int | None) -> str:
        """Format duration in milliseconds to human readable."""
        if ms is None:
            return "N/A"
        if ms < 1000:
            return f"{ms}ms"
        if ms < 60000:
            return f"{ms / 1000:.1f}s"
        minutes = ms // 60000
        seconds = (ms % 60000) / 1000
        return f"{minutes}m {seconds:.0f}s"

    @staticmethod
    def _format_datetime(dt: datetime | str | None) -> str:
        """Format datetime to human readable."""
        if dt is None:
            return "N/A"
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt)
        return dt.strftime("%Y-%m-%d %H:%M:%S")

    @staticmethod
    def _status_class(status: str) -> str:
        """Get CSS class for status."""
        return {
            "passed": "status-passed",
            "failed": "status-failed",
            "error": "status-error",
            "skipped": "status-skipped",
            "running": "status-running",
            "pending": "status-pending",
        }.get(status.lower(), "status-unknown")

    def _render_inline_html(self, report_data: dict[str, Any]) -> str:
        """Render HTML using inline template."""
        summary = report_data.get("summary", {})
        metadata = report_data.get("metadata", {})
        failures = report_data.get("failures", [])

        return f"""
<!DOCTYPE html>
<html>
<head>
    <title>TestForge AI - Test Report</title>
    <style>
        body {{
            font-family: system-ui, -apple-system, sans-serif;
            line-height: 1.6;
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            background: #f8fafc;
            color: #1e293b;
        }}
        .header {{
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            padding: 2rem;
            border-radius: 12px;
            margin-bottom: 2rem;
        }}
        .summary {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }}
        .card {{
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .card h3 {{
            margin: 0 0 0.5rem;
            color: #64748b;
            font-size: 0.875rem;
            text-transform: uppercase;
        }}
        .card .value {{
            font-size: 2rem;
            font-weight: bold;
        }}
        .passed {{ color: #22c55e; }}
        .failed {{ color: #ef4444; }}
        .skipped {{ color: #eab308; }}
        .section {{
            background: white;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }}
        .failure {{
            border-left: 4px solid #ef4444;
            padding: 1rem;
            margin: 0.5rem 0;
            background: #fef2f2;
            border-radius: 0 8px 8px 0;
        }}
        pre {{
            background: #1e293b;
            color: #e2e8f0;
            padding: 1rem;
            border-radius: 8px;
            overflow-x: auto;
            font-size: 0.875rem;
        }}
        .health-score {{
            display: inline-block;
            padding: 0.5rem 1rem;
            border-radius: 20px;
            font-weight: bold;
        }}
        .health-good {{ background: #dcfce7; color: #166534; }}
        .health-warning {{ background: #fef3c7; color: #92400e; }}
        .health-bad {{ background: #fee2e2; color: #991b1b; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Test Report</h1>
        <p>Generated: {metadata.get('generated_at', 'N/A')}</p>
        <p>Test Run: {metadata.get('test_run_id', 'N/A')}</p>
    </div>

    <div class="summary">
        <div class="card">
            <h3>Total Tests</h3>
            <div class="value">{summary.get('total_tests', 0)}</div>
        </div>
        <div class="card">
            <h3>Passed</h3>
            <div class="value passed">{summary.get('passed', 0)}</div>
        </div>
        <div class="card">
            <h3>Failed</h3>
            <div class="value failed">{summary.get('failed', 0)}</div>
        </div>
        <div class="card">
            <h3>Pass Rate</h3>
            <div class="value">{summary.get('pass_rate', 0)}%</div>
        </div>
        <div class="card">
            <h3>Duration</h3>
            <div class="value">{self._format_duration(summary.get('duration_ms'))}</div>
        </div>
        <div class="card">
            <h3>Health Score</h3>
            <div class="health-score {'health-good' if summary.get('health_score', 0) >= 80 else 'health-warning' if summary.get('health_score', 0) >= 60 else 'health-bad'}">
                {summary.get('health_score', 0)}
            </div>
        </div>
    </div>

    {"".join(f'''
    <div class="section">
        <h2>Failures ({len(failures)})</h2>
        {"".join(f'''
        <div class="failure">
            <strong>{f.get('test_name', 'Unknown Test')}</strong>
            <p>{f.get('error_message', 'No error message')}</p>
            {f'<pre>{f.get("error_stack", "")}</pre>' if f.get('error_stack') else ''}
        </div>
        ''' for f in failures) if failures else '<p>No failures</p>'}
    </div>
    ''' if failures else '')}

    <div class="section">
        <h2>Recommendations</h2>
        <ul>
            {"".join(f'<li>{r}</li>' for r in report_data.get('recommendations', [])) or '<li>No recommendations</li>'}
        </ul>
    </div>
</body>
</html>
"""
