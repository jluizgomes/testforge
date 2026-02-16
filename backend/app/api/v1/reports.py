"""Report generation API endpoints."""

from typing import Literal

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel

router = APIRouter()


class GenerateReportRequest(BaseModel):
    """Request for generating a report."""

    project_id: str
    run_id: str
    format: Literal["html", "pdf", "json"] = "html"
    template: str | None = None


class ReportMetadata(BaseModel):
    """Metadata about a generated report."""

    id: str
    project_id: str
    run_id: str
    format: str
    size_bytes: int
    created_at: str


@router.post("/generate")
async def generate_report(request: GenerateReportRequest) -> Response:
    """Generate a test report in the specified format."""
    # This is a placeholder - actual implementation would use Jinja2/WeasyPrint
    if request.format == "html":
        content = f"""
<!DOCTYPE html>
<html>
<head>
    <title>TestForge AI - Test Report</title>
    <style>
        body {{ font-family: system-ui, sans-serif; padding: 2rem; max-width: 1200px; margin: 0 auto; }}
        .header {{ background: linear-gradient(135deg, #3b82f6, #1d4ed8); color: white; padding: 2rem; border-radius: 8px; }}
        .summary {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 1rem; margin: 2rem 0; }}
        .card {{ background: #f8fafc; padding: 1.5rem; border-radius: 8px; text-align: center; }}
        .card h3 {{ margin: 0; color: #64748b; font-size: 0.875rem; }}
        .card p {{ margin: 0.5rem 0 0; font-size: 2rem; font-weight: bold; }}
        .passed {{ color: #22c55e; }}
        .failed {{ color: #ef4444; }}
    </style>
</head>
<body>
    <div class="header">
        <h1>Test Report</h1>
        <p>Project ID: {request.project_id}</p>
        <p>Run ID: {request.run_id}</p>
    </div>
    <div class="summary">
        <div class="card">
            <h3>Total Tests</h3>
            <p>156</p>
        </div>
        <div class="card">
            <h3>Passed</h3>
            <p class="passed">142</p>
        </div>
        <div class="card">
            <h3>Failed</h3>
            <p class="failed">8</p>
        </div>
        <div class="card">
            <h3>Pass Rate</h3>
            <p>91%</p>
        </div>
    </div>
    <h2>Test Results</h2>
    <p>Detailed results would appear here...</p>
</body>
</html>
"""
        return Response(
            content=content,
            media_type="text/html",
            headers={"Content-Disposition": f'attachment; filename="report-{request.run_id}.html"'},
        )

    elif request.format == "json":
        import json

        report_data = {
            "project_id": request.project_id,
            "run_id": request.run_id,
            "summary": {
                "total": 156,
                "passed": 142,
                "failed": 8,
                "skipped": 6,
                "pass_rate": 0.91,
            },
            "results": [],
        }
        return Response(
            content=json.dumps(report_data, indent=2),
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="report-{request.run_id}.json"'},
        )

    elif request.format == "pdf":
        # PDF generation would use WeasyPrint
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="PDF generation requires WeasyPrint to be properly configured",
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Unsupported format: {request.format}",
    )


@router.get("/templates")
async def list_report_templates() -> list[dict]:
    """List available report templates."""
    return [
        {
            "id": "executive",
            "name": "Executive Summary",
            "description": "High-level overview for stakeholders",
        },
        {
            "id": "detailed",
            "name": "Detailed Technical",
            "description": "In-depth analysis for developers",
        },
        {
            "id": "compliance",
            "name": "Compliance Report",
            "description": "Audit-ready documentation",
        },
    ]
