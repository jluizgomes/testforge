"""Database test runner using SQLAlchemy."""

import re
import traceback
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.sql import quoted_name

_TABLE_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,62}$")
_FORBIDDEN_SQL_RE = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b",
    re.IGNORECASE,
)

from app.core.runners.base import BaseRunner, RunnerConfig, TestResult, TestStatus


class DatabaseRunner(BaseRunner):
    """Test runner for database tests using SQLAlchemy."""

    def __init__(self, config: RunnerConfig) -> None:
        """Initialize the database runner."""
        super().__init__(config)
        self._engine: AsyncEngine | None = None
        self._session: AsyncSession | None = None

    async def setup(self) -> None:
        """Set up the database connection."""
        self._engine = create_async_engine(
            self.config.database_url,
            echo=self.config.extra.get("echo", False),
            pool_pre_ping=True,
        )

    async def teardown(self) -> None:
        """Clean up the database connection."""
        if self._session:
            await self._session.close()
        if self._engine:
            await self._engine.dispose()

        self._session = None
        self._engine = None

    async def run_test(self, test_name: str, test_fn: Callable) -> TestResult:
        """Run a single database test."""
        result = TestResult(
            name=test_name,
            started_at=datetime.now(),
        )

        start_time = datetime.now()

        try:
            # Execute the test function with the engine
            await test_fn(self._engine)
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

    async def execute_query(self, query: str, params: dict[str, Any] | None = None) -> list[dict]:
        """Execute a raw SQL query and return results."""
        if not self._engine:
            raise RuntimeError("Engine not initialized. Call setup() first.")

        async with self._engine.connect() as conn:
            result = await conn.execute(text(query), params or {})
            rows = result.fetchall()
            columns = result.keys()
            return [dict(zip(columns, row)) for row in rows]

    async def check_table_exists(self, table_name: str) -> bool:
        """Check if a table exists in the database."""
        query = """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = :table_name
            );
        """
        result = await self.execute_query(query, {"table_name": table_name})
        return result[0]["exists"] if result else False

    async def check_column_exists(self, table_name: str, column_name: str) -> bool:
        """Check if a column exists in a table."""
        query = """
            SELECT EXISTS (
                SELECT FROM information_schema.columns
                WHERE table_name = :table_name
                AND column_name = :column_name
            );
        """
        result = await self.execute_query(
            query,
            {"table_name": table_name, "column_name": column_name},
        )
        return result[0]["exists"] if result else False

    async def check_foreign_key(
        self,
        table_name: str,
        column_name: str,
        ref_table: str,
        ref_column: str,
    ) -> bool:
        """Check if a foreign key constraint exists."""
        query = """
            SELECT EXISTS (
                SELECT FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                    ON ccu.constraint_name = tc.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                AND tc.table_name = :table_name
                AND kcu.column_name = :column_name
                AND ccu.table_name = :ref_table
                AND ccu.column_name = :ref_column
            );
        """
        result = await self.execute_query(
            query,
            {
                "table_name": table_name,
                "column_name": column_name,
                "ref_table": ref_table,
                "ref_column": ref_column,
            },
        )
        return result[0]["exists"] if result else False

    async def check_index_exists(self, table_name: str, index_name: str) -> bool:
        """Check if an index exists on a table."""
        query = """
            SELECT EXISTS (
                SELECT FROM pg_indexes
                WHERE tablename = :table_name
                AND indexname = :index_name
            );
        """
        result = await self.execute_query(
            query,
            {"table_name": table_name, "index_name": index_name},
        )
        return result[0]["exists"] if result else False

    async def get_table_row_count(self, table_name: str) -> int:
        """Get the row count of a table."""
        if not _TABLE_NAME_RE.match(table_name):
            raise ValueError(f"Invalid table name: {table_name!r}")
        safe_name = quoted_name(table_name, quote=True)
        query = f"SELECT COUNT(*) as count FROM {safe_name};"
        result = await self.execute_query(query)
        return result[0]["count"] if result else 0

    async def explain_query(self, query: str) -> list[dict]:
        """Get the execution plan for a query (SELECT only)."""
        stripped = query.strip()
        if not stripped.upper().startswith("SELECT"):
            raise ValueError("explain_query only accepts SELECT statements")
        if _FORBIDDEN_SQL_RE.match(stripped):
            raise ValueError("DDL/DML statements are not allowed in explain_query")
        explain_query = f"EXPLAIN ANALYZE {stripped}"
        return await self.execute_query(explain_query)

    async def get_table_schema(self, table_name: str) -> list[dict]:
        """Get the schema of a table."""
        query = """
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_name = :table_name
            ORDER BY ordinal_position;
        """
        return await self.execute_query(query, {"table_name": table_name})

    def assert_row_count(
        self,
        actual_count: int,
        expected: int,
        comparison: str = "eq",
    ) -> None:
        """Assert row count with various comparisons."""
        if comparison == "eq":
            assert actual_count == expected, (
                f"Expected {expected} rows, got {actual_count}"
            )
        elif comparison == "gt":
            assert actual_count > expected, (
                f"Expected more than {expected} rows, got {actual_count}"
            )
        elif comparison == "lt":
            assert actual_count < expected, (
                f"Expected less than {expected} rows, got {actual_count}"
            )
        elif comparison == "gte":
            assert actual_count >= expected, (
                f"Expected at least {expected} rows, got {actual_count}"
            )
        elif comparison == "lte":
            assert actual_count <= expected, (
                f"Expected at most {expected} rows, got {actual_count}"
            )
