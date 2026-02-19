"""Categorize test errors by pattern matching on error messages and stack traces."""

from __future__ import annotations

import re

_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"TimeoutError|timed\s+out|exceeded\s+\d+\s*ms|timeout", re.IGNORECASE), "timeout"),
    (re.compile(r"AssertionError|AssertionError|assert\s+|expect\(|toBe|toHave|toEqual|toMatch|to_be|to_have|assertEqual", re.IGNORECASE), "assertion"),
    (re.compile(r"ConnectionError|ECONNREFUSED|ECONNRESET|fetch\s+failed|connection\s+refused|connect\s+ETIMEDOUT", re.IGNORECASE), "network"),
    (re.compile(r"ModuleNotFoundError|ImportError|Cannot\s+find\s+module|Module\s+not\s+found", re.IGNORECASE), "import_error"),
    (re.compile(r"SyntaxError|IndentationError|unexpected\s+token|Unexpected\s+identifier", re.IGNORECASE), "syntax"),
    (re.compile(r"PermissionError|EACCES|Permission\s+denied|access\s+denied", re.IGNORECASE), "permission"),
    (re.compile(r"fixture.*not\s+found|SetupError|collection\s+error|BeforeAll|beforeEach.*failed", re.IGNORECASE), "setup"),
    (re.compile(r"SIGSEGV|OOMKilled|MemoryError|out\s+of\s+memory|heap\s+out\s+of\s+memory|segmentation\s+fault", re.IGNORECASE), "crash"),
]


def categorize_error(error_message: str | None, error_stack: str | None = None) -> str | None:
    """Return an error category string or None if no error text is provided.

    Checks both *error_message* and *error_stack* against known patterns.
    Returns the first matching category.
    """
    text = " ".join(filter(None, [error_message, error_stack]))
    if not text.strip():
        return None

    for pattern, category in _PATTERNS:
        if pattern.search(text):
            return category

    return "unknown"
