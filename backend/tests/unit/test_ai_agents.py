"""Unit tests for AI agents — TestGeneratorAgent and FailureAnalyzerAgent.

Total: 16 tests
  - TestGeneratorAgent: 8
  - FailureAnalyzerAgent: 8
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.ai.agents.test_generator import TestGeneratorAgent
from app.ai.agents.failure_analyzer import FailureAnalyzerAgent
from app.ai.providers import AIResponse


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_response(content: str) -> AIResponse:
    return AIResponse(content=content, model="gpt-4-mock")


def _make_provider(content: str = "APPROVED") -> MagicMock:
    provider = MagicMock()
    provider.generate = AsyncMock(return_value=_make_response(content))
    return provider


def _make_retriever(context: str = "") -> MagicMock:
    retriever = MagicMock()
    retriever.get_context_for_test_generation = AsyncMock(return_value=context)
    retriever.get_context_for_failure_analysis = AsyncMock(return_value=context)
    return retriever


# ── TestGeneratorAgent — 8 tests ─────────────────────────────────────────────

class TestExtractCodeBlocks:
    """Tests for _extract_code_blocks helper method."""

    def setup_method(self):
        self.agent = TestGeneratorAgent(
            provider=_make_provider(),
            retriever=_make_retriever(),
        )

    def test_extract_typescript_fence(self):
        """Extracts code from a typescript fenced block."""
        text = "```typescript\nconst x = 1;\n```"
        result = self.agent._extract_code_blocks(text)
        assert result == ["const x = 1;"]

    def test_extract_python_fence(self):
        """Extracts code from a python fenced block."""
        text = "```python\ndef test_foo():\n    assert True\n```"
        result = self.agent._extract_code_blocks(text)
        assert result == ["def test_foo():\n    assert True"]

    def test_extract_multiple_blocks(self):
        """Extracts all code blocks when multiple are present."""
        text = "```ts\nconst a = 1\n```\n\n```python\ndef b(): pass\n```"
        result = self.agent._extract_code_blocks(text)
        assert len(result) == 2

    def test_no_fence_code_like_text_returned(self):
        """Falls back to full text when it looks like code (import/from)."""
        text = "import React from 'react'\nexport default function App() {}"
        result = self.agent._extract_code_blocks(text)
        assert len(result) == 1
        assert "import React" in result[0]

    def test_plain_text_returns_empty_list(self):
        """Returns empty list when text has no code blocks or code-like lines."""
        text = "Here are some notes about the project. No code here."
        result = self.agent._extract_code_blocks(text)
        assert result == []


class TestGeneratorAgentGenerate:
    """Tests for generate() state machine."""

    @pytest.mark.asyncio
    async def test_generate_completes_when_review_approved(self):
        """Stops after 1 iteration when review returns 'APPROVED'."""
        provider = _make_provider()
        # First call: generation (returns code), Second call: review (returns APPROVED)
        provider.generate = AsyncMock(side_effect=[
            _make_response("```typescript\ntest('foo', () => {})\n```"),
            _make_response("APPROVED"),
        ])
        agent = TestGeneratorAgent(provider=provider, retriever=_make_retriever())

        result = await agent.generate("test login", project_id="p1", test_type="e2e")

        assert result["iterations"] == 1
        assert len(result["tests"]) == 1

    @pytest.mark.asyncio
    async def test_generate_iterates_on_feedback(self):
        """Iterates again when review does not say 'APPROVED'."""
        provider = _make_provider()
        provider.generate = AsyncMock(side_effect=[
            _make_response("```typescript\ntest('foo', () => {})\n```"),
            _make_response("Missing assertion, please fix."),  # not approved
            _make_response("```typescript\ntest('foo', () => { expect(1).toBe(1) })\n```"),
            _make_response("APPROVED"),
        ])
        agent = TestGeneratorAgent(provider=provider, retriever=_make_retriever())

        result = await agent.generate("test login", project_id="p1", test_type="e2e")

        assert result["iterations"] == 2

    @pytest.mark.asyncio
    async def test_generate_stops_at_max_iterations(self):
        """Never exceeds max_iterations even if review keeps rejecting."""
        provider = _make_provider()
        # Always returns feedback (never approved) + code blocks
        provider.generate = AsyncMock(return_value=_make_response(
            "```typescript\ntest('a', () => {})\n```\n\nNeeds improvement."
        ))
        agent = TestGeneratorAgent(provider=provider, retriever=_make_retriever())
        agent.max_iterations = 2

        result = await agent.generate("test foo", project_id="p1")

        assert result["iterations"] <= 2

    @pytest.mark.asyncio
    async def test_generate_no_tests_sets_review_feedback(self):
        """When provider returns no code blocks, review_feedback is set to retry."""
        provider = _make_provider()
        provider.generate = AsyncMock(side_effect=[
            _make_response("I cannot generate tests without more context."),  # no code block
            _make_response("No tests were generated. Please try again."),  # review feedback
            _make_response("```typescript\ntest('b', () => {})\n```"),
            _make_response("APPROVED"),
        ])
        agent = TestGeneratorAgent(provider=provider, retriever=_make_retriever())

        result = await agent.generate("test foo", project_id="p1")

        # Should eventually complete
        assert "tests" in result
        assert "iterations" in result


# ── FailureAnalyzerAgent — 8 tests ───────────────────────────────────────────

class TestFailureAnalyzerReturnsKeys:

    @pytest.mark.asyncio
    async def test_analyze_returns_required_keys(self):
        """analyze() result has analysis, root_cause, suggestions, confidence."""
        provider = MagicMock()
        provider.generate = AsyncMock(return_value=_make_response(
            "Root Cause: selector not found\nAnalysis: element missing\nConfidence: 80%"
        ))
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        result = await agent.analyze(
            error_message="Element not found",
            error_stack="at test.ts:10",
            test_name="test_login",
            test_file="login.spec.ts",
            project_id="proj-1",
        )

        assert "analysis" in result
        assert "root_cause" in result
        assert "suggestions" in result
        assert "confidence" in result

    @pytest.mark.asyncio
    async def test_analyze_extracts_confidence_percentage(self):
        """Extracts confidence value from response content."""
        provider = MagicMock()
        provider.generate = AsyncMock(return_value=_make_response(
            "Root Cause: timeout\nConfidence: 85%\n1. Add explicit wait"
        ))
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        result = await agent.analyze(
            error_message="Timeout",
            error_stack="",
            test_name="t",
            test_file="f",
            project_id="p",
        )

        assert result["confidence"] == pytest.approx(0.85)

    @pytest.mark.asyncio
    async def test_analyze_default_confidence_when_not_found(self):
        """Defaults to 0.7 when no confidence percentage found."""
        provider = MagicMock()
        provider.generate = AsyncMock(return_value=_make_response(
            "Root Cause: selector error\nAnalysis: element changed"
        ))
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        result = await agent.analyze(
            error_message="Selector error",
            error_stack="",
            test_name="t",
            test_file="f",
            project_id="p",
        )

        assert result["confidence"] == pytest.approx(0.7)

    @pytest.mark.asyncio
    async def test_analyze_extracts_root_cause_from_colon_line(self):
        """Extracts text after 'Root Cause:' as root_cause."""
        provider = MagicMock()
        provider.generate = AsyncMock(return_value=_make_response(
            "Root Cause: selector was changed in a recent deploy\nConfidence: 70%"
        ))
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        result = await agent.analyze("err", "stack", "t", "f", "p")

        assert result["root_cause"] is not None
        assert "selector" in result["root_cause"].lower()

    @pytest.mark.asyncio
    async def test_generate_suggestions_parses_numbered_list(self):
        """Numbered suggestions are split into separate list items."""
        provider = MagicMock()
        provider.generate = AsyncMock(return_value=_make_response(
            "Root Cause: timeout\n1. Add explicit wait\n2. Increase timeout\n3. Use retry"
        ))
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        result = await agent.analyze("timeout", "", "t", "f", "p")

        assert len(result["suggestions"]) >= 2

    @pytest.mark.asyncio
    async def test_generate_suggestions_fallback_to_full_response(self):
        """When no numbered list, whole response becomes one suggestion."""
        provider = MagicMock()
        provider.generate = AsyncMock(return_value=_make_response(
            "Root Cause: unknown\nConfidence: 50%\nTry checking the network tab."
        ))
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        result = await agent.analyze("err", "", "t", "f", "p")

        assert len(result["suggestions"]) >= 1

    @pytest.mark.asyncio
    async def test_analyze_pattern_empty_failures_returns_empty(self):
        """analyze_pattern with empty list returns empty patterns and recommendations."""
        agent = FailureAnalyzerAgent(provider=_make_provider(), retriever=_make_retriever())

        result = await agent.analyze_pattern([], project_id="p")

        assert result == {"patterns": [], "recommendations": []}

    @pytest.mark.asyncio
    async def test_analyze_pattern_uses_failure_names(self):
        """analyze_pattern builds prompt containing failure names."""
        captured_prompt: list[str] = []

        async def capture_generate(messages, **_):
            captured_prompt.append(messages[-1].content)
            return _make_response("Pattern: selector issues")

        provider = MagicMock()
        provider.generate = AsyncMock(side_effect=capture_generate)
        agent = FailureAnalyzerAgent(provider=provider, retriever=_make_retriever())

        failures = [
            {"test_name": "test_login", "error_message": "element not found"},
            {"test_name": "test_dashboard", "error_message": "timeout exceeded"},
        ]
        result = await agent.analyze_pattern(failures, project_id="p")

        assert "analysis" in result
        assert result["failure_count"] == 2
        assert "test_login" in captured_prompt[0]
