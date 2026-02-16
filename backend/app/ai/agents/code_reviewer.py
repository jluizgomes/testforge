"""Code Reviewer Agent for validating generated tests."""

from typing import Any

from app.ai.providers import AIMessage, AIProvider, get_ai_provider


class CodeReviewerAgent:
    """Agent for reviewing generated test code."""

    SYSTEM_PROMPT = """You are an expert code reviewer specializing in test code quality.
Your task is to review test code for correctness, best practices, and potential issues.

Review criteria:
1. Syntax correctness
2. Proper test structure (arrange, act, assert)
3. Meaningful assertions
4. Good selector practices (data-testid preferred)
5. Proper error handling
6. Test isolation
7. Code readability
8. Edge case coverage

Provide feedback in a structured format:
- Severity: error, warning, or suggestion
- Line: approximate line number if applicable
- Issue: description of the issue
- Fix: suggested fix
"""

    def __init__(self, provider: AIProvider | None = None) -> None:
        """Initialize the code reviewer agent."""
        self.provider = provider or get_ai_provider()

    async def review(
        self,
        code: str,
        language: str = "typescript",
    ) -> dict[str, Any]:
        """Review test code and return issues."""
        prompt = f"""Review this {language} test code:

```{language}
{code}
```

Identify any issues, following the review criteria.
For each issue found, provide:
- Severity (error/warning/suggestion)
- Line number (approximate)
- Issue description
- Suggested fix

If the code is good, say "No issues found" and explain why it's well-written.
"""

        messages = [
            AIMessage(role="system", content=self.SYSTEM_PROMPT),
            AIMessage(role="user", content=prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.1)

        # Parse issues from response
        issues = self._parse_issues(response.content)

        return {
            "passed": len([i for i in issues if i["severity"] == "error"]) == 0,
            "issues": issues,
            "summary": self._generate_summary(issues),
        }

    def _parse_issues(self, content: str) -> list[dict[str, Any]]:
        """Parse issues from the review response."""
        issues = []

        if "no issues found" in content.lower():
            return []

        lines = content.split("\n")
        current_issue = {}

        for line in lines:
            line_lower = line.lower().strip()

            if "severity:" in line_lower or line_lower.startswith(("- error", "- warning", "- suggestion")):
                if current_issue:
                    issues.append(current_issue)
                current_issue = {"severity": "warning", "line": None, "issue": "", "fix": ""}

                if "error" in line_lower:
                    current_issue["severity"] = "error"
                elif "suggestion" in line_lower:
                    current_issue["severity"] = "suggestion"

            elif "line:" in line_lower or "line " in line_lower:
                import re

                match = re.search(r"line[:\s]*(\d+)", line_lower)
                if match:
                    current_issue["line"] = int(match.group(1))

            elif "issue:" in line_lower:
                current_issue["issue"] = line.split(":", 1)[-1].strip()

            elif "fix:" in line_lower or "suggested fix:" in line_lower:
                current_issue["fix"] = line.split(":", 1)[-1].strip()

            elif current_issue and current_issue.get("issue") == "":
                # This might be the issue description
                if line.strip():
                    current_issue["issue"] = line.strip()

        if current_issue:
            issues.append(current_issue)

        return issues

    def _generate_summary(self, issues: list[dict[str, Any]]) -> str:
        """Generate a summary of the review."""
        if not issues:
            return "Code review passed. The test code follows best practices."

        errors = sum(1 for i in issues if i["severity"] == "error")
        warnings = sum(1 for i in issues if i["severity"] == "warning")
        suggestions = sum(1 for i in issues if i["severity"] == "suggestion")

        parts = []
        if errors:
            parts.append(f"{errors} error(s)")
        if warnings:
            parts.append(f"{warnings} warning(s)")
        if suggestions:
            parts.append(f"{suggestions} suggestion(s)")

        return f"Found {', '.join(parts)}."

    async def validate_syntax(self, code: str, language: str = "typescript") -> dict[str, Any]:
        """Validate syntax of test code."""
        prompt = f"""Check if this {language} code has any syntax errors:

```{language}
{code}
```

Reply with "VALID" if the syntax is correct, or describe the syntax errors if any.
"""

        messages = [
            AIMessage(role="system", content="You are a syntax validator for code."),
            AIMessage(role="user", content=prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.0)

        is_valid = "valid" in response.content.lower() and "invalid" not in response.content.lower()

        return {
            "valid": is_valid,
            "errors": [] if is_valid else [response.content],
        }

    async def suggest_improvements(self, code: str, language: str = "typescript") -> list[str]:
        """Suggest improvements for test code."""
        prompt = f"""Suggest improvements for this {language} test code:

```{language}
{code}
```

Focus on:
1. Making tests more robust
2. Improving readability
3. Adding edge cases
4. Better assertions

Provide 3-5 specific suggestions.
"""

        messages = [
            AIMessage(role="system", content="You are a test improvement advisor."),
            AIMessage(role="user", content=prompt),
        ]

        response = await self.provider.generate(messages, temperature=0.5)

        # Extract suggestions
        suggestions = []
        lines = response.content.split("\n")

        for line in lines:
            import re

            if re.match(r"^\d+[\.\)]\s", line.strip()):
                suggestions.append(line.strip())

        return suggestions or [response.content]
