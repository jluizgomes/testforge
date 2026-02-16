"""Infrastructure test runner for Redis, queues, and storage."""

import traceback
from datetime import datetime
from typing import Any, Callable

from app.core.runners.base import BaseRunner, RunnerConfig, TestResult, TestStatus


class InfrastructureRunner(BaseRunner):
    """Test runner for infrastructure tests (Redis, queues, storage)."""

    def __init__(self, config: RunnerConfig) -> None:
        """Initialize the infrastructure runner."""
        super().__init__(config)
        self._redis_client = None
        self._s3_client = None
        self._rabbitmq_connection = None

    async def setup(self) -> None:
        """Set up infrastructure connections."""
        # Redis setup
        redis_url = self.config.extra.get("redis_url")
        if redis_url:
            try:
                import redis.asyncio as redis

                self._redis_client = redis.from_url(redis_url)
            except ImportError:
                pass

        # S3/MinIO setup
        s3_config = self.config.extra.get("s3")
        if s3_config:
            try:
                import boto3

                self._s3_client = boto3.client(
                    "s3",
                    endpoint_url=s3_config.get("endpoint_url"),
                    aws_access_key_id=s3_config.get("access_key"),
                    aws_secret_access_key=s3_config.get("secret_key"),
                )
            except ImportError:
                pass

    async def teardown(self) -> None:
        """Clean up infrastructure connections."""
        if self._redis_client:
            await self._redis_client.close()
            self._redis_client = None

        self._s3_client = None

    async def run_test(self, test_name: str, test_fn: Callable) -> TestResult:
        """Run a single infrastructure test."""
        result = TestResult(
            name=test_name,
            started_at=datetime.now(),
        )

        start_time = datetime.now()

        try:
            # Execute the test function with infrastructure clients
            await test_fn(self)
            result.status = TestStatus.PASSED

        except AssertionError as e:
            result.status = TestStatus.FAILED
            result.error_message = str(e)
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

    # Redis operations
    async def redis_ping(self) -> bool:
        """Ping Redis server."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        return await self._redis_client.ping()

    async def redis_set(self, key: str, value: str, ex: int | None = None) -> bool:
        """Set a Redis key."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        return await self._redis_client.set(key, value, ex=ex)

    async def redis_get(self, key: str) -> str | None:
        """Get a Redis key."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        value = await self._redis_client.get(key)
        return value.decode() if value else None

    async def redis_delete(self, key: str) -> int:
        """Delete a Redis key."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        return await self._redis_client.delete(key)

    async def redis_exists(self, key: str) -> bool:
        """Check if a Redis key exists."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        return await self._redis_client.exists(key) > 0

    async def redis_ttl(self, key: str) -> int:
        """Get TTL of a Redis key."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        return await self._redis_client.ttl(key)

    async def redis_info(self) -> dict[str, Any]:
        """Get Redis server info."""
        if not self._redis_client:
            raise RuntimeError("Redis client not initialized")
        return await self._redis_client.info()

    async def redis_memory_usage(self) -> dict[str, Any]:
        """Get Redis memory usage info."""
        info = await self.redis_info()
        return {
            "used_memory": info.get("used_memory"),
            "used_memory_human": info.get("used_memory_human"),
            "used_memory_peak": info.get("used_memory_peak"),
            "maxmemory": info.get("maxmemory"),
        }

    # S3/MinIO operations
    def s3_list_buckets(self) -> list[str]:
        """List S3 buckets."""
        if not self._s3_client:
            raise RuntimeError("S3 client not initialized")
        response = self._s3_client.list_buckets()
        return [bucket["Name"] for bucket in response.get("Buckets", [])]

    def s3_bucket_exists(self, bucket_name: str) -> bool:
        """Check if an S3 bucket exists."""
        try:
            self._s3_client.head_bucket(Bucket=bucket_name)
            return True
        except Exception:
            return False

    def s3_put_object(
        self,
        bucket: str,
        key: str,
        body: bytes,
        content_type: str = "application/octet-stream",
    ) -> dict[str, Any]:
        """Put an object in S3."""
        if not self._s3_client:
            raise RuntimeError("S3 client not initialized")
        return self._s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=body,
            ContentType=content_type,
        )

    def s3_get_object(self, bucket: str, key: str) -> bytes:
        """Get an object from S3."""
        if not self._s3_client:
            raise RuntimeError("S3 client not initialized")
        response = self._s3_client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def s3_delete_object(self, bucket: str, key: str) -> dict[str, Any]:
        """Delete an object from S3."""
        if not self._s3_client:
            raise RuntimeError("S3 client not initialized")
        return self._s3_client.delete_object(Bucket=bucket, Key=key)

    def s3_generate_presigned_url(
        self,
        bucket: str,
        key: str,
        expiration: int = 3600,
    ) -> str:
        """Generate a presigned URL for an S3 object."""
        if not self._s3_client:
            raise RuntimeError("S3 client not initialized")
        return self._s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expiration,
        )

    # Assertions
    def assert_redis_key_exists(self, key: str) -> None:
        """Assert that a Redis key exists."""
        import asyncio

        exists = asyncio.get_event_loop().run_until_complete(self.redis_exists(key))
        assert exists, f"Redis key '{key}' does not exist"

    def assert_redis_key_value(self, key: str, expected: str) -> None:
        """Assert that a Redis key has the expected value."""
        import asyncio

        value = asyncio.get_event_loop().run_until_complete(self.redis_get(key))
        assert value == expected, f"Expected '{expected}', got '{value}'"

    def assert_s3_object_exists(self, bucket: str, key: str) -> None:
        """Assert that an S3 object exists."""
        try:
            self._s3_client.head_object(Bucket=bucket, Key=key)
        except Exception:
            raise AssertionError(f"S3 object '{bucket}/{key}' does not exist")
