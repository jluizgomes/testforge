"""API v1 module."""

from fastapi import APIRouter

from app.api.v1.ai import router as ai_router
from app.api.v1.projects import router as projects_router
from app.api.v1.report_schedules import router as report_schedules_router
from app.api.v1.reports import router as reports_router
from app.api.v1.scanner import router as scanner_router
from app.api.v1.settings import router as settings_router
from app.api.v1.test_runs import router as test_runs_router
from app.api.v1.traces import router as traces_router
from app.api.v1.workspace import router as workspace_router

router = APIRouter()

# Workspace before projects so /projects/{id}/workspace matches first
router.include_router(workspace_router, prefix="/projects", tags=["Workspace"])
router.include_router(projects_router, prefix="/projects", tags=["Projects"])
router.include_router(test_runs_router, prefix="/projects/{project_id}/runs", tags=["Test Runs"])
router.include_router(traces_router, prefix="/traces", tags=["Traces"])
router.include_router(ai_router, prefix="/ai", tags=["AI"])
router.include_router(reports_router, prefix="/reports", tags=["Reports"])
router.include_router(report_schedules_router, prefix="/report-schedules", tags=["Report Schedules"])
router.include_router(settings_router, prefix="/settings", tags=["Settings"])
router.include_router(scanner_router, prefix="/scan", tags=["Scanner"])
