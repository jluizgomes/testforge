"""Base runner class for all test runners."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
from uuid import uuid4


class TestStatus(str, Enum):
    """Status of a test execution."""

    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"
    ERROR = "error"


@dataclass
class TestResult:
    """Result of a single test execution."""

    id: str = field(default_factory=lambda: str(uuid4()))
    name: str = ""
    status: TestStatus = TestStatus.PASSED
    duration_ms: int = 0
    error_message: str | None = None
    error_stack: str | None = None
    screenshot_path: str | None = None
    video_path: str | None = None
    trace_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: datetime | None = None


@dataclass
class RunnerConfig:
    """Configuration for a test runner."""

    # General
    timeout_ms: int = 30000
    retry_count: int = 0
    parallel_workers: int = 1

    # Playwright specific
    headless: bool = True
    slow_mo: int = 0
    viewport_width: int = 1280
    viewport_height: int = 720
    browser: str = "chromium"

    # HTTP client specific
    base_url: str = ""
    headers: dict[str, str] = field(default_factory=dict)

    # Database specific
    database_url: str = ""

    # Extra configuration
    extra: dict[str, Any] = field(default_factory=dict)


class BaseRunner(ABC):
    """Abstract base class for all test runners."""

    def __init__(self, config: RunnerConfig) -> None:
        """Initialize the runner with configuration."""
        self.config = config
        self._results: list[TestResult] = []
        self._is_running = False
        self._should_stop = False

    @property
    def results(self) -> list[TestResult]:
        """Get the list of test results."""
        return self._results

    @property
    def is_running(self) -> bool:
        """Check if the runner is currently executing tests."""
        return self._is_running

    @abstractmethod
    async def setup(self) -> None:
        """Set up the runner before executing tests."""
        pass

    @abstractmethod
    async def teardown(self) -> None:
        """Clean up resources after test execution."""
        pass

    @abstractmethod
    async def run_test(self, test_name: str, test_fn: Any) -> TestResult:
        """Run a single test and return the result."""
        pass

    async def run_all(self, tests: list[tuple[str, Any]]) -> list[TestResult]:
        """Run all tests and return results."""
        self._is_running = True
        self._should_stop = False
        self._results = []

        try:
            await self.setup()

            for test_name, test_fn in tests:
                if self._should_stop:
                    break

                result = await self.run_test(test_name, test_fn)
                self._results.append(result)

        finally:
            await self.teardown()
            self._is_running = False

        return self._results

    def stop(self) -> None:
        """Request to stop the test execution."""
        self._should_stop = True

    def get_summary(self) -> dict[str, Any]:
        """Get a summary of test results."""
        total = len(self._results)
        passed = sum(1 for r in self._results if r.status == TestStatus.PASSED)
        failed = sum(1 for r in self._results if r.status == TestStatus.FAILED)
        skipped = sum(1 for r in self._results if r.status == TestStatus.SKIPPED)
        errors = sum(1 for r in self._results if r.status == TestStatus.ERROR)
        total_duration = sum(r.duration_ms for r in self._results)

        return {
            "total": total,
            "passed": passed,
            "failed": failed,
            "skipped": skipped,
            "errors": errors,
            "pass_rate": (passed / total * 100) if total > 0 else 0,
            "total_duration_ms": total_duration,
        }
