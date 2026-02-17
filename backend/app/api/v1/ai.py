"""AI API endpoints — real LangGraph agents + RAG."""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.test_run import TestResult, TestRun

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────


class GenerateTestsRequest(BaseModel):
    project_id: str
    prompt: str
    test_type: str = "e2e"  # e2e | api | database


class GenerateTestsResponse(BaseModel):
    tests: list[str]
    explanation: str | None = None
    context_used: str | None = None


class AnalyzeFailureRequest(BaseModel):
    run_id: str
    test_id: str


class AnalyzeFailureResponse(BaseModel):
    analysis: str
    root_cause: str | None = None
    suggestions: list[str]
    confidence: float


class ChatRequest(BaseModel):
    project_id: str
    message: str
    history: list[dict[str, str]] | None = None


class ChatResponse(BaseModel):
    response: str
    context_used: list[str] | None = None


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_provider():
    """Get AI provider from persisted settings (falls back to env config)."""
    from app.ai.providers import get_ai_provider

    return get_ai_provider()


def _get_retriever():
    from app.ai.rag.retriever import RAGRetriever

    return RAGRetriever()


async def _safe_rag_context(retriever, **kwargs) -> str:
    """Call RAG retriever, returning empty string if the collection is empty."""
    try:
        return await retriever.get_context_for_test_generation(**kwargs)
    except Exception as exc:
        logger.debug("RAG retrieval skipped (collection may be empty): %s", exc)
        return ""


# ── Endpoints ────────────────────────────────────────────────────────────────


@router.post("/generate", response_model=GenerateTestsResponse)
async def generate_tests(request: GenerateTestsRequest) -> GenerateTestsResponse:
    """Generate tests using the TestGeneratorAgent (LangGraph + RAG)."""
    from app.ai.agents.test_generator import TestGeneratorAgent

    try:
        provider = _get_provider()
        retriever = _get_retriever()
        agent = TestGeneratorAgent(provider=provider, retriever=retriever)

        result = await agent.generate(
            prompt=request.prompt,
            project_id=request.project_id,
            test_type=request.test_type,
        )

        tests = result.get("tests", [])
        context_used = result.get("context_used", "")

        if not tests:
            # If the agent produced no code blocks, return the raw content as a single test
            tests = [request.prompt]

        return GenerateTestsResponse(
            tests=tests,
            explanation=f"Generated {len(tests)} test(s) using AI. Iterations: {result.get('iterations', 1)}.",
            context_used=context_used or None,
        )

    except Exception as exc:
        logger.warning("AI generation failed: %s", exc)
        # Graceful fallback — return a helpful template
        fallback = _fallback_test(request.prompt, request.test_type)
        return GenerateTestsResponse(
            tests=[fallback],
            explanation=(
                f"AI provider unavailable ({type(exc).__name__}). "
                "Returning a template — configure your API key in Settings."
            ),
        )


@router.post("/analyze", response_model=AnalyzeFailureResponse)
async def analyze_failure(
    request: AnalyzeFailureRequest,
    db: AsyncSession = Depends(get_db),
) -> AnalyzeFailureResponse:
    """Analyze a test failure using FailureAnalyzerAgent."""
    from app.ai.agents.failure_analyzer import FailureAnalyzerAgent

    # Fetch the failed test result from DB
    result_row = await db.execute(
        select(TestResult).where(TestResult.id == request.test_id)
    )
    test_result = result_row.scalar_one_or_none()

    if not test_result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Test result '{request.test_id}' not found.",
        )

    # Fetch the parent run to get project_id
    run_row = await db.execute(
        select(TestRun).where(TestRun.id == request.run_id)
    )
    test_run = run_row.scalar_one_or_none()
    project_id = test_run.project_id if test_run else "unknown"

    try:
        provider = _get_provider()
        retriever = _get_retriever()
        agent = FailureAnalyzerAgent(provider=provider, retriever=retriever)

        analysis = await agent.analyze(
            error_message=test_result.error_message or "Unknown error",
            error_stack=test_result.error_stack or "",
            test_name=test_result.test_name,
            test_file=test_result.test_file or "",
            project_id=project_id,
            screenshot_path=test_result.screenshot_path,
            trace_id=test_result.trace_id,
        )

        return AnalyzeFailureResponse(
            analysis=analysis["analysis"],
            root_cause=analysis.get("root_cause"),
            suggestions=analysis.get("suggestions", []),
            confidence=analysis.get("confidence", 0.7),
        )

    except Exception as exc:
        logger.warning("Failure analysis failed: %s", exc)
        return AnalyzeFailureResponse(
            analysis=(
                f"AI analysis unavailable ({type(exc).__name__}). "
                f"Error: {test_result.error_message or 'Unknown'}"
            ),
            root_cause=test_result.error_message,
            suggestions=[
                "Check the error message and stack trace above.",
                "Ensure selectors are stable (use data-testid).",
                "Add explicit waits for async elements.",
            ],
            confidence=0.3,
        )


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    """Chat with AI assistant using RAG context."""
    from app.ai.providers import AIMessage

    try:
        provider = _get_provider()
        retriever = _get_retriever()

        # Retrieve relevant context
        context = await _safe_rag_context(
            retriever,
            prompt=request.message,
            project_id=request.project_id,
            test_type="e2e",
        )

        system_prompt = """You are TestForge AI — an expert testing assistant.
You help teams write, debug, and improve E2E, API, and database tests.
Be concise, practical, and include code examples when relevant.
Focus on Playwright (TypeScript) for frontend tests and pytest (Python) for backend tests."""

        messages_payload: list[AIMessage] = [
            AIMessage(role="system", content=system_prompt),
        ]

        # Inject RAG context if available
        if context and context != "No relevant context found.":
            messages_payload.append(
                AIMessage(
                    role="system",
                    content=f"Relevant project context:\n\n{context}",
                )
            )

        # Replay conversation history
        for turn in (request.history or []):
            if turn.get("role") in ("user", "assistant") and turn.get("content"):
                messages_payload.append(AIMessage(role=turn["role"], content=turn["content"]))

        # Current message
        messages_payload.append(AIMessage(role="user", content=request.message))

        response = await provider.generate(messages_payload, temperature=0.7)

        return ChatResponse(
            response=response.content,
            context_used=["project_code", "test_history"] if context else None,
        )

    except Exception as exc:
        logger.warning("AI chat failed: %s", exc)
        return ChatResponse(
            response=(
                "I'm currently unavailable — please configure your AI provider in **Settings → AI Settings**. "
                f"Error: `{type(exc).__name__}`"
            ),
        )


# ── Fallback template ─────────────────────────────────────────────────────────


def _fallback_test(prompt: str, test_type: str) -> str:
    """Return a starter test template when AI is unavailable."""
    if test_type == "api":
        return f"""import pytest
import httpx

# TODO: Generated from prompt: "{prompt}"

@pytest.mark.asyncio
async def test_api_endpoint():
    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        response = await client.get("/")
        assert response.status_code == 200
"""
    return f"""import {{ test, expect }} from '@playwright/test'

// TODO: Generated from prompt: "{prompt}"

test.describe('Generated Suite', () => {{
  test('should meet the requirement', async ({{ page }}) => {{
    await page.goto('/')
    await expect(page).toHaveTitle(/.*/)
  }})
}})
"""
