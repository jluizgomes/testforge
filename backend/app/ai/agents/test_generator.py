"""Test Generator Agent using LangGraph."""

from typing import Any, TypedDict

from app.ai.providers import AIMessage, AIProvider, get_ai_provider
from app.ai.rag.retriever import RAGRetriever


class TestGeneratorState(TypedDict):
    """State for test generator agent."""

    prompt: str
    project_id: str
    test_type: str
    context: str
    project_context: dict[str, Any]
    generated_tests: list[str]
    review_feedback: str | None
    iteration: int
    is_complete: bool


class TestGeneratorAgent:
    """Agent for generating tests using LangGraph-style state machine."""

    SYSTEM_PROMPT = """You are an expert test engineer specializing in E2E and API testing.
Your task is to generate high-quality, maintainable, DISTINCT tests based on the provided context.

Guidelines:
1. Follow best practices for the test framework (Playwright for E2E, pytest for API)
2. Use data-testid attributes for selectors when possible
3. Include proper assertions and error handling
4. Add comments explaining complex test logic
5. Consider edge cases and error scenarios
6. Make tests independent and idempotent
7. ALWAYS use the REAL URLs, credentials, and endpoints provided in the project context
8. NEVER use placeholder URLs like localhost:8000 or example.com unless those ARE the real URLs
9. Each test MUST cover a DIFFERENT feature, endpoint, or user flow — NO duplicates
10. If login credentials are provided, use them for authentication tests

Output format:
- For E2E tests: TypeScript with Playwright
- For API tests: Python with pytest and httpx
- For Database tests: Python with SQLAlchemy

Always include:
- Clear test names describing what is being tested
- Setup and teardown when needed
- Meaningful assertions
- Real URLs and endpoints from the project context
"""

    def __init__(
        self,
        provider: AIProvider | None = None,
        retriever: RAGRetriever | None = None,
    ) -> None:
        """Initialize the test generator agent."""
        self.provider = provider or get_ai_provider()
        self.retriever = retriever or RAGRetriever()
        self.max_iterations = 3

    async def generate(
        self,
        prompt: str,
        project_id: str,
        test_type: str = "e2e",
        project_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Generate tests using the state machine."""
        # Initialize state
        state: TestGeneratorState = {
            "prompt": prompt,
            "project_id": project_id,
            "test_type": test_type,
            "context": "",
            "project_context": project_context or {},
            "generated_tests": [],
            "review_feedback": None,
            "iteration": 0,
            "is_complete": False,
        }

        # Run the state machine
        while not state["is_complete"] and state["iteration"] < self.max_iterations:
            state = await self._retrieve_context(state)
            state = await self._generate_tests(state)
            state = await self._review_tests(state)
            state["iteration"] += 1

            # Check if tests passed review
            if state["review_feedback"] is None or "approved" in state["review_feedback"].lower():
                state["is_complete"] = True

        return {
            "tests": state["generated_tests"],
            "iterations": state["iteration"],
            "context_used": state["context"][:500] + "..." if len(state["context"]) > 500 else state["context"],
        }

    async def _retrieve_context(self, state: TestGeneratorState) -> TestGeneratorState:
        """Retrieve relevant context from the codebase."""
        context = await self.retriever.get_context_for_test_generation(
            prompt=state["prompt"],
            project_id=state["project_id"],
            test_type=state["test_type"],
        )
        state["context"] = context
        return state

    async def _generate_tests(self, state: TestGeneratorState) -> TestGeneratorState:
        """Generate tests based on context and prompt."""
        user_prompt = f"""Generate {state['test_type']} tests for the following requirement:

{state['prompt']}

Context from the codebase:
{state['context']}
"""

        # Inject project context (URLs, credentials, endpoints)
        pc = state["project_context"]
        if pc:
            context_lines = []
            if pc.get("frontend_url"):
                context_lines.append(f"Frontend URL: {pc['frontend_url']}")
            if pc.get("backend_url"):
                context_lines.append(f"Backend/API URL: {pc['backend_url']}")
            if pc.get("test_login_email"):
                context_lines.append(f"Test login email: {pc['test_login_email']}")
            if pc.get("test_login_password"):
                context_lines.append("Test login password: credentials configured (use env var or fixture)")
            if pc.get("openapi_endpoints"):
                endpoints = pc["openapi_endpoints"]
                ep_lines = []
                for ep in endpoints[:10]:
                    line = f"  {ep['method']} {ep['path']}"
                    if ep.get("summary"):
                        line += f" — {ep['summary']}"
                    ep_lines.append(line)
                context_lines.append("Available API endpoints:\n" + "\n".join(ep_lines))

            if context_lines:
                user_prompt += f"""

PROJECT CONTEXT (use these real values in your tests):
{chr(10).join(context_lines)}

IMPORTANT: Use the URLs and credentials above instead of placeholder values.
"""

        if state["review_feedback"]:
            user_prompt += f"""

Previous review feedback (please address these issues):
{state['review_feedback']}

Previous generated tests:
```
{chr(10).join(state['generated_tests'])}
```
"""

        messages = [
            AIMessage(role="system", content=self.SYSTEM_PROMPT),
            AIMessage(role="user", content=user_prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.3)

        # Extract code blocks from response
        tests = self._extract_code_blocks(response.content)
        state["generated_tests"] = tests

        return state

    async def _review_tests(self, state: TestGeneratorState) -> TestGeneratorState:
        """Review generated tests for quality."""
        if not state["generated_tests"]:
            state["review_feedback"] = "No tests were generated. Please try again."
            return state

        # Build review context with project info
        pc = state["project_context"]
        url_check = ""
        if pc:
            real_urls = []
            if pc.get("frontend_url"):
                real_urls.append(pc["frontend_url"])
            if pc.get("backend_url"):
                real_urls.append(pc["backend_url"])
            if real_urls:
                url_check = (
                    f"\n6. Tests use the real project URLs ({', '.join(real_urls)}) "
                    "instead of placeholder values like localhost:8000"
                )

        review_prompt = f"""Review the following generated tests for quality and correctness:

```
{chr(10).join(state['generated_tests'])}
```

Check for:
1. Syntax errors
2. Missing assertions
3. Poor selectors (avoid xpath, prefer data-testid)
4. Missing error handling
5. Test isolation issues{url_check}
7. Each test covers a DIFFERENT scenario (no duplicates)

If the tests are good, respond with "APPROVED".
If there are issues, list them clearly so they can be fixed.
"""

        messages = [
            AIMessage(role="system", content="You are a code reviewer specializing in test quality."),
            AIMessage(role="user", content=review_prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.1)

        if "approved" in response.content.lower():
            state["review_feedback"] = None
        else:
            state["review_feedback"] = response.content

        return state

    def _extract_code_blocks(self, text: str) -> list[str]:
        """Extract code blocks from markdown-formatted text."""
        import re

        # Find all code blocks
        pattern = r"```(?:typescript|python|javascript|ts|py|js)?\n(.*?)```"
        matches = re.findall(pattern, text, re.DOTALL)

        if matches:
            return [match.strip() for match in matches]

        # If no code blocks found, try to extract the whole response
        # if it looks like code
        lines = text.strip().split("\n")
        if any(line.strip().startswith(("import ", "from ", "test(", "describe(", "def ")) for line in lines):
            return [text.strip()]

        return []
