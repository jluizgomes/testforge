"""Backend API test runner using httpx."""

import traceback
from datetime import datetime
from typing import Any, Callable

import httpx

from app.core.runners.base import BaseRunner, RunnerConfig, TestResult, TestStatus


class BackendRunner(BaseRunner):
    """Test runner for backend API tests using httpx."""

    def __init__(self, config: RunnerConfig) -> None:
        """Initialize the backend runner."""
        super().__init__(config)
        self._client: httpx.AsyncClient | None = None

    async def setup(self) -> None:
        """Set up the HTTP client."""
        self._client = httpx.AsyncClient(
            base_url=self.config.base_url,
            headers=self.config.headers,
            timeout=self.config.timeout_ms / 1000,
        )

    async def teardown(self) -> None:
        """Clean up the HTTP client."""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def run_test(self, test_name: str, test_fn: Callable) -> TestResult:
        """Run a single API test."""
        result = TestResult(
            name=test_name,
            started_at=datetime.now(),
        )

        start_time = datetime.now()

        try:
            # Execute the test function with the client
            await test_fn(self._client)
            result.status = TestStatus.PASSED

        except AssertionError as e:
            result.status = TestStatus.FAILED
            result.error_message = str(e)
            result.error_stack = traceback.format_exc()

        except httpx.HTTPStatusError as e:
            result.status = TestStatus.FAILED
            result.error_message = f"HTTP {e.response.status_code}: {e.response.text}"
            result.error_stack = traceback.format_exc()

        except httpx.RequestError as e:
            result.status = TestStatus.ERROR
            result.error_message = f"Request failed: {str(e)}"
            result.error_stack = traceback.format_exc()

        except Exception as e:
            result.status = TestStatus.ERROR
            result.error_message = str(e)
            result.error_stack = traceback.format_exc()

        finally:
            end_time = datetime.now()
            result.completed_at = end_time
            result.duration_ms = int((end_time - start_time).total_seconds() * 1000)

        return result

    async def get(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make a GET request."""
        if not self._client:
            raise RuntimeError("Client not initialized. Call setup() first.")
        return await self._client.get(url, params=params, headers=headers)

    async def post(
        self,
        url: str,
        json: dict[str, Any] | None = None,
        data: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make a POST request."""
        if not self._client:
            raise RuntimeError("Client not initialized. Call setup() first.")
        return await self._client.post(url, json=json, data=data, headers=headers)

    async def put(
        self,
        url: str,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make a PUT request."""
        if not self._client:
            raise RuntimeError("Client not initialized. Call setup() first.")
        return await self._client.put(url, json=json, headers=headers)

    async def patch(
        self,
        url: str,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make a PATCH request."""
        if not self._client:
            raise RuntimeError("Client not initialized. Call setup() first.")
        return await self._client.patch(url, json=json, headers=headers)

    async def delete(
        self,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make a DELETE request."""
        if not self._client:
            raise RuntimeError("Client not initialized. Call setup() first.")
        return await self._client.delete(url, headers=headers)

    def assert_status(self, response: httpx.Response, expected: int) -> None:
        """Assert that response status code matches expected."""
        assert response.status_code == expected, (
            f"Expected status {expected}, got {response.status_code}"
        )

    def assert_json_key(
        self,
        response: httpx.Response,
        key: str,
        expected: Any | None = None,
    ) -> None:
        """Assert that response JSON contains a key with optional value check."""
        data = response.json()
        assert key in data, f"Key '{key}' not found in response"
        if expected is not None:
            assert data[key] == expected, (
                f"Expected {key}={expected}, got {key}={data[key]}"
            )

    def assert_json_schema(
        self,
        response: httpx.Response,
        schema: dict[str, type],
    ) -> None:
        """Assert that response JSON matches a simple schema."""
        data = response.json()
        for key, expected_type in schema.items():
            assert key in data, f"Key '{key}' not found in response"
            assert isinstance(data[key], expected_type), (
                f"Expected {key} to be {expected_type.__name__}, "
                f"got {type(data[key]).__name__}"
            )

    async def validate_openapi(
        self,
        openapi_url: str,
        endpoint: str,
        method: str,
        response: httpx.Response,
    ) -> bool:
        """Validate response against OpenAPI specification."""
        # This would integrate with schemathesis in a full implementation
        # For now, just return True as a placeholder
        return True
