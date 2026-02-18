"""Report generation API endpoints."""

import asyncio
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.test_run import TestResult, TestRun
from app.reports.exporters import (
    HTMLExporter,
    JUnitXMLExporter,
    JSONExporter,
    MarkdownExporter,
    PDFExporter,
)
from app.reports.generator import ReportGenerator

router = APIRouter()

_generator = ReportGenerator()
_exporters = {
    "html": HTMLExporter(_generator),
    "pdf": PDFExporter(_generator),
    "json": JSONExporter(),
    "xml": JUnitXMLExporter(),
    "markdown": MarkdownExporter(),
}

ReportFormat = Literal["html", "pdf", "json", "xml", "markdown"]

_CONTENT_TYPES: dict[str, str] = {
    "html": "text/html; charset=utf-8",
    "pdf": "application/pdf",
    "json": "application/json; charset=utf-8",
    "xml": "application/xml; charset=utf-8",
    "markdown": "text/markdown; charset=utf-8",
}

_EXTENSIONS: dict[str, str] = {
    "html": ".html",
    "pdf": ".pdf",
    "json": ".json",
    "xml": ".xml",
    "markdown": ".md",
}


class GenerateReportRequest(BaseModel):
    """Request for generating a report."""

    project_id: str
    run_id: str
    format: ReportFormat = "html"
    template: str | None = None


@router.post("/generate")
async def generate_report(
    request: GenerateReportRequest,
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Generate a test report in the requested format using real test run data."""
    # Fetch test run from DB
    stmt = (
        select(TestRun)
        .where(
            TestRun.id == request.run_id,
            TestRun.project_id == request.project_id,
        )
        .options(selectinload(TestRun.results))
    )
    result = await db.execute(stmt)
    test_run = result.scalar_one_or_none()

    if test_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run '{request.run_id}' not found for project '{request.project_id}'.",
        )

    # Build report data dict from the ORM objects
    results_dicts = [
        {
            "test_name": r.test_name,
            "test_file": r.test_file,
            "test_suite": r.test_suite,
            "test_layer": r.test_layer,
            "status": r.status.value if hasattr(r.status, "value") else r.status,
            "duration_ms": r.duration_ms,
            "error_message": r.error_message,
            "error_stack": r.error_stack,
            "screenshot_path": r.screenshot_path,
            "trace_id": r.trace_id,
            **(r.extra_data or {}),
        }
        for r in test_run.results
    ]

    report_data = _generator.generate_report(
        test_run=test_run,
        results=results_dicts,
    )

    # Export
    fmt = request.format
    exporter = _exporters[fmt]

    try:
        content = exporter.export(report_data)
    except RuntimeError as exc:
        # WeasyPrint not installed
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc

    filename = f"report-{request.run_id}{_EXTENSIONS[fmt]}"
    return Response(
        content=content,
        media_type=_CONTENT_TYPES[fmt],
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class CodeQualityRequest(BaseModel):
    """Request for code quality analysis."""

    project_id: str
    run_id: str
    include_ai_analysis: bool = False


@router.post("/quality")
async def get_code_quality(
    request: CodeQualityRequest,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return code quality insights for a test run, optionally with AI failure analysis."""
    # Fetch test run from DB
    stmt = (
        select(TestRun)
        .where(
            TestRun.id == request.run_id,
            TestRun.project_id == request.project_id,
        )
        .options(selectinload(TestRun.results))
    )
    result = await db.execute(stmt)
    test_run = result.scalar_one_or_none()

    if test_run is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test run '{request.run_id}' not found for project '{request.project_id}'.",
        )

    results_dicts = [
        {
            "test_name": r.test_name,
            "test_file": r.test_file,
            "test_suite": r.test_suite,
            "test_layer": r.test_layer,
            "status": r.status.value if hasattr(r.status, "value") else r.status,
            "duration_ms": r.duration_ms,
            "error_message": r.error_message,
            "error_stack": r.error_stack,
            "screenshot_path": r.screenshot_path,
            "trace_id": r.trace_id,
            **(r.extra_data or {}),
        }
        for r in test_run.results
    ]

    ai_analyses: list[dict[str, Any]] = []

    if request.include_ai_analysis:
        from app.ai.agents.failure_analyzer import FailureAnalyzerAgent

        analyzer = FailureAnalyzerAgent()
        failures = [r for r in results_dicts if r.get("status") in ["failed", "error"]][:5]

        async def _analyze_one(f: dict[str, Any]) -> dict[str, Any]:
            try:
                result_ai = await asyncio.wait_for(
                    analyzer.analyze(
                        error_message=f.get("error_message") or "",
                        error_stack=f.get("error_stack") or "",
                        test_name=f.get("test_name") or "",
                        test_file=f.get("test_file") or "",
                        project_id=request.project_id,
                        screenshot_path=f.get("screenshot_path"),
                        trace_id=f.get("trace_id"),
                    ),
                    timeout=60.0,
                )
                return {
                    "test_name": f.get("test_name"),
                    "root_cause": result_ai.get("root_cause"),
                    "suggestions": result_ai.get("suggestions", []),
                    "confidence": result_ai.get("confidence", 0.0),
                }
            except Exception:
                return {
                    "test_name": f.get("test_name"),
                    "root_cause": None,
                    "suggestions": [],
                    "confidence": 0.0,
                }

        ai_analyses = await asyncio.gather(*[_analyze_one(f) for f in failures])

    return _generator._generate_code_quality(results_dicts, list(ai_analyses))


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
