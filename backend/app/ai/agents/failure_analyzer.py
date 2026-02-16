"""Failure Analyzer Agent for root cause analysis."""

from typing import Any, TypedDict

from app.ai.providers import AIMessage, AIProvider, get_ai_provider
from app.ai.rag.retriever import RAGRetriever


class FailureAnalyzerState(TypedDict):
    """State for failure analyzer agent."""

    error_message: str
    error_stack: str
    test_name: str
    test_file: str
    project_id: str
    screenshot_path: str | None
    trace_id: str | None
    context: str
    analysis: str
    root_cause: str | None
    suggestions: list[str]
    confidence: float


class FailureAnalyzerAgent:
    """Agent for analyzing test failures and finding root causes."""

    SYSTEM_PROMPT = """You are an expert debugging assistant specializing in E2E test failures.
Your task is to analyze test failures and provide clear, actionable insights.

When analyzing failures:
1. Identify the immediate cause of the failure
2. Look for underlying issues in the code or test
3. Consider common patterns (timing issues, selector problems, API changes)
4. Suggest specific fixes with code examples
5. Rate your confidence in the analysis

Output format:
- Root Cause: Clear description of what caused the failure
- Analysis: Detailed explanation of the issue
- Suggestions: Numbered list of actionable fixes
- Confidence: A percentage (0-100) indicating how confident you are
"""

    def __init__(
        self,
        provider: AIProvider | None = None,
        retriever: RAGRetriever | None = None,
    ) -> None:
        """Initialize the failure analyzer agent."""
        self.provider = provider or get_ai_provider()
        self.retriever = retriever or RAGRetriever()

    async def analyze(
        self,
        error_message: str,
        error_stack: str,
        test_name: str,
        test_file: str,
        project_id: str,
        screenshot_path: str | None = None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        """Analyze a test failure."""
        # Initialize state
        state: FailureAnalyzerState = {
            "error_message": error_message,
            "error_stack": error_stack,
            "test_name": test_name,
            "test_file": test_file,
            "project_id": project_id,
            "screenshot_path": screenshot_path,
            "trace_id": trace_id,
            "context": "",
            "analysis": "",
            "root_cause": None,
            "suggestions": [],
            "confidence": 0.0,
        }

        # Run analysis steps
        state = await self._retrieve_context(state)
        state = await self._analyze_failure(state)
        state = await self._generate_suggestions(state)

        return {
            "analysis": state["analysis"],
            "root_cause": state["root_cause"],
            "suggestions": state["suggestions"],
            "confidence": state["confidence"],
        }

    async def _retrieve_context(self, state: FailureAnalyzerState) -> FailureAnalyzerState:
        """Retrieve relevant context for the failure."""
        context = await self.retriever.get_context_for_failure_analysis(
            error_message=state["error_message"],
            test_file=state["test_file"],
            project_id=state["project_id"],
        )
        state["context"] = context
        return state

    async def _analyze_failure(self, state: FailureAnalyzerState) -> FailureAnalyzerState:
        """Analyze the failure and identify root cause."""
        prompt = f"""Analyze this test failure:

Test Name: {state['test_name']}
Test File: {state['test_file']}

Error Message:
{state['error_message']}

Stack Trace:
{state['error_stack'][:2000]}

Related Code Context:
{state['context'][:3000]}

Provide:
1. A clear root cause (one sentence)
2. Detailed analysis of what went wrong
3. Your confidence level (0-100)
"""

        messages = [
            AIMessage(role="system", content=self.SYSTEM_PROMPT),
            AIMessage(role="user", content=prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.2)

        # Parse response
        content = response.content
        state["analysis"] = content

        # Extract root cause (first line or section)
        lines = content.split("\n")
        for line in lines:
            if "root cause" in line.lower() or "cause:" in line.lower():
                state["root_cause"] = line.split(":", 1)[-1].strip() if ":" in line else line
                break

        # Extract confidence
        import re

        confidence_match = re.search(r"confidence[:\s]*(\d+)%?", content.lower())
        if confidence_match:
            state["confidence"] = float(confidence_match.group(1)) / 100.0
        else:
            state["confidence"] = 0.7  # Default confidence

        return state

    async def _generate_suggestions(self, state: FailureAnalyzerState) -> FailureAnalyzerState:
        """Generate fix suggestions."""
        prompt = f"""Based on this failure analysis, provide specific fix suggestions:

Root Cause: {state['root_cause']}

Analysis: {state['analysis']}

Generate 3-5 specific, actionable suggestions with code examples where appropriate.
Each suggestion should be implementable immediately.
"""

        messages = [
            AIMessage(role="system", content="You are a helpful assistant providing code fix suggestions."),
            AIMessage(role="user", content=prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.3)

        # Parse suggestions from response
        suggestions = []
        lines = response.content.split("\n")

        current_suggestion = []
        for line in lines:
            # Check if this is a new numbered suggestion
            import re

            if re.match(r"^\d+[\.\)]\s", line.strip()):
                if current_suggestion:
                    suggestions.append("\n".join(current_suggestion).strip())
                current_suggestion = [line]
            elif current_suggestion:
                current_suggestion.append(line)

        if current_suggestion:
            suggestions.append("\n".join(current_suggestion).strip())

        state["suggestions"] = suggestions or [response.content]

        return state

    async def analyze_pattern(
        self,
        failures: list[dict[str, Any]],
        project_id: str,
    ) -> dict[str, Any]:
        """Analyze patterns across multiple failures."""
        if not failures:
            return {"patterns": [], "recommendations": []}

        # Build summary of failures
        failure_summary = []
        for f in failures[:10]:  # Limit to 10 failures
            failure_summary.append(f"- {f.get('test_name', 'Unknown')}: {f.get('error_message', 'No message')[:100]}")

        prompt = f"""Analyze patterns in these test failures:

{chr(10).join(failure_summary)}

Identify:
1. Common patterns or root causes
2. Systemic issues that might be causing multiple failures
3. Prioritized recommendations for fixing the issues
"""

        messages = [
            AIMessage(role="system", content="You are an expert at identifying patterns in test failures."),
            AIMessage(role="user", content=prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.3)

        return {
            "analysis": response.content,
            "failure_count": len(failures),
        }
