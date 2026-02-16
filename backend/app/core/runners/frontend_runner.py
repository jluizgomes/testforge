"""Frontend test runner using Playwright."""

import asyncio
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from app.core.runners.base import BaseRunner, RunnerConfig, TestResult, TestStatus


class FrontendRunner(BaseRunner):
    """Test runner for frontend E2E tests using Playwright."""

    def __init__(self, config: RunnerConfig) -> None:
        """Initialize the frontend runner."""
        super().__init__(config)
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None
        self._screenshot_dir = Path("./screenshots")
        self._video_dir = Path("./videos")

    async def setup(self) -> None:
        """Set up Playwright browser and context."""
        try:
            from playwright.async_api import async_playwright

            self._playwright = await async_playwright().start()

            # Select browser
            browser_type = getattr(self._playwright, self.config.browser, self._playwright.chromium)
            self._browser = await browser_type.launch(
                headless=self.config.headless,
                slow_mo=self.config.slow_mo,
            )

            # Create context with viewport
            self._context = await self._browser.new_context(
                viewport={
                    "width": self.config.viewport_width,
                    "height": self.config.viewport_height,
                },
                record_video_dir=str(self._video_dir) if self.config.extra.get("record_video") else None,
            )

            # Create page
            self._page = await self._context.new_page()

            # Set default timeout
            self._page.set_default_timeout(self.config.timeout_ms)

            # Ensure directories exist
            self._screenshot_dir.mkdir(parents=True, exist_ok=True)
            self._video_dir.mkdir(parents=True, exist_ok=True)

        except ImportError:
            raise RuntimeError("Playwright is not installed. Run: playwright install")

    async def teardown(self) -> None:
        """Clean up Playwright resources."""
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()

        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None

    async def run_test(self, test_name: str, test_fn: Callable) -> TestResult:
        """Run a single frontend test."""
        result = TestResult(
            name=test_name,
            started_at=datetime.now(),
        )

        start_time = datetime.now()

        try:
            # Execute the test function with the page
            await test_fn(self._page)
            result.status = TestStatus.PASSED

        except AssertionError as e:
            result.status = TestStatus.FAILED
            result.error_message = str(e)
            result.error_stack = traceback.format_exc()

            # Take screenshot on failure
            screenshot_path = await self._capture_screenshot(test_name)
            result.screenshot_path = screenshot_path

        except Exception as e:
            result.status = TestStatus.ERROR
            result.error_message = str(e)
            result.error_stack = traceback.format_exc()

            # Take screenshot on error
            screenshot_path = await self._capture_screenshot(test_name)
            result.screenshot_path = screenshot_path

        finally:
            end_time = datetime.now()
            result.completed_at = end_time
            result.duration_ms = int((end_time - start_time).total_seconds() * 1000)

        return result

    async def _capture_screenshot(self, test_name: str) -> str | None:
        """Capture a screenshot of the current page."""
        if not self._page:
            return None

        try:
            filename = f"{test_name.replace(' ', '_')}_{uuid4().hex[:8]}.png"
            path = self._screenshot_dir / filename
            await self._page.screenshot(path=str(path), full_page=True)
            return str(path)
        except Exception:
            return None

    async def navigate(self, url: str) -> None:
        """Navigate to a URL."""
        if self._page:
            await self._page.goto(url)

    async def click(self, selector: str) -> None:
        """Click an element."""
        if self._page:
            await self._page.click(selector)

    async def fill(self, selector: str, value: str) -> None:
        """Fill an input field."""
        if self._page:
            await self._page.fill(selector, value)

    async def wait_for_selector(self, selector: str, timeout: int | None = None) -> None:
        """Wait for an element to appear."""
        if self._page:
            await self._page.wait_for_selector(
                selector,
                timeout=timeout or self.config.timeout_ms,
            )

    async def get_text(self, selector: str) -> str | None:
        """Get text content of an element."""
        if self._page:
            element = await self._page.query_selector(selector)
            if element:
                return await element.text_content()
        return None

    async def expect_visible(self, selector: str) -> bool:
        """Assert that an element is visible."""
        if self._page:
            element = await self._page.query_selector(selector)
            return element is not None and await element.is_visible()
        return False

    async def expect_text(self, selector: str, expected: str) -> bool:
        """Assert that an element contains expected text."""
        actual = await self.get_text(selector)
        return actual is not None and expected in actual

    async def intercept_requests(self, pattern: str, handler: Callable) -> None:
        """Intercept network requests matching a pattern."""
        if self._page:
            await self._page.route(pattern, handler)

    async def get_console_logs(self) -> list[str]:
        """Get console logs from the page."""
        logs = []

        if self._page:
            self._page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        return logs
