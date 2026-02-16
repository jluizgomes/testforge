"""Trace collector for storing and retrieving traces."""

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult


@dataclass
class CollectedSpan:
    """A collected span for storage."""

    span_id: str
    parent_span_id: str | None
    trace_id: str
    name: str
    service: str
    start_time: datetime
    end_time: datetime
    duration_ms: int
    status: str
    error_message: str | None = None
    attributes: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)


class InMemorySpanExporter(SpanExporter):
    """In-memory span exporter for collecting traces."""

    _instance = None
    _lock = Lock()

    def __new__(cls):
        """Singleton pattern for shared access."""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._spans = deque(maxlen=10000)
                    cls._instance._traces = {}
        return cls._instance

    def export(self, spans: list[ReadableSpan]) -> SpanExportResult:
        """Export spans to memory."""
        for span in spans:
            collected = self._convert_span(span)
            self._spans.append(collected)

            # Group by trace
            if collected.trace_id not in self._traces:
                self._traces[collected.trace_id] = []
            self._traces[collected.trace_id].append(collected)

        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        """Shutdown the exporter."""
        pass

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        """Force flush any pending spans."""
        return True

    def _convert_span(self, span: ReadableSpan) -> CollectedSpan:
        """Convert OpenTelemetry span to collected span."""
        start_time = datetime.fromtimestamp(span.start_time / 1e9, tz=timezone.utc)
        end_time = datetime.fromtimestamp(span.end_time / 1e9, tz=timezone.utc) if span.end_time else start_time
        duration_ms = int((span.end_time - span.start_time) / 1e6) if span.end_time else 0

        # Get status
        status = "ok"
        error_message = None
        if span.status and span.status.status_code.name == "ERROR":
            status = "error"
            error_message = span.status.description

        # Convert attributes
        attributes = dict(span.attributes) if span.attributes else {}

        # Convert events
        events = []
        for event in span.events or []:
            events.append({
                "name": event.name,
                "timestamp": datetime.fromtimestamp(event.timestamp / 1e9, tz=timezone.utc).isoformat(),
                "attributes": dict(event.attributes) if event.attributes else {},
            })

        return CollectedSpan(
            span_id=format(span.context.span_id, "016x"),
            parent_span_id=format(span.parent.span_id, "016x") if span.parent else None,
            trace_id=format(span.context.trace_id, "032x"),
            name=span.name,
            service=span.resource.attributes.get("service.name", "unknown") if span.resource else "unknown",
            start_time=start_time,
            end_time=end_time,
            duration_ms=duration_ms,
            status=status,
            error_message=error_message,
            attributes=attributes,
            events=events,
        )

    def get_spans(self, trace_id: str | None = None) -> list[CollectedSpan]:
        """Get collected spans, optionally filtered by trace ID."""
        if trace_id:
            return self._traces.get(trace_id, [])
        return list(self._spans)

    def get_trace_ids(self) -> list[str]:
        """Get all trace IDs."""
        return list(self._traces.keys())

    def clear(self) -> None:
        """Clear all collected spans."""
        self._spans.clear()
        self._traces.clear()


class TraceCollector:
    """High-level interface for collecting and storing traces."""

    def __init__(self) -> None:
        """Initialize the trace collector."""
        self._exporter = InMemorySpanExporter()

    def get_trace(self, trace_id: str) -> dict[str, Any] | None:
        """Get a complete trace by ID."""
        spans = self._exporter.get_spans(trace_id)
        if not spans:
            return None

        # Find root span
        root_span = None
        for span in spans:
            if span.parent_span_id is None:
                root_span = span
                break

        if not root_span:
            root_span = spans[0]

        # Build span tree
        span_map = {span.span_id: span for span in spans}
        children_map: dict[str, list[str]] = {}

        for span in spans:
            if span.parent_span_id:
                if span.parent_span_id not in children_map:
                    children_map[span.parent_span_id] = []
                children_map[span.parent_span_id].append(span.span_id)

        def build_span_tree(span_id: str) -> dict[str, Any]:
            span = span_map[span_id]
            children = children_map.get(span_id, [])

            return {
                "span_id": span.span_id,
                "name": span.name,
                "service": span.service,
                "start_time": span.start_time.isoformat(),
                "end_time": span.end_time.isoformat(),
                "duration_ms": span.duration_ms,
                "status": span.status,
                "error_message": span.error_message,
                "attributes": span.attributes,
                "events": span.events,
                "children": [build_span_tree(child_id) for child_id in children],
            }

        return {
            "trace_id": trace_id,
            "root_span": build_span_tree(root_span.span_id),
            "span_count": len(spans),
            "start_time": min(s.start_time for s in spans).isoformat(),
            "end_time": max(s.end_time for s in spans).isoformat(),
            "duration_ms": sum(s.duration_ms for s in spans if s.parent_span_id is None),
        }

    def get_recent_traces(self, limit: int = 100) -> list[dict[str, Any]]:
        """Get recent traces with summary info."""
        trace_ids = self._exporter.get_trace_ids()[-limit:]
        traces = []

        for trace_id in reversed(trace_ids):
            spans = self._exporter.get_spans(trace_id)
            if spans:
                root_span = next(
                    (s for s in spans if s.parent_span_id is None),
                    spans[0],
                )
                traces.append({
                    "trace_id": trace_id,
                    "name": root_span.name,
                    "service": root_span.service,
                    "start_time": root_span.start_time.isoformat(),
                    "duration_ms": root_span.duration_ms,
                    "status": root_span.status,
                    "span_count": len(spans),
                })

        return traces

    def clear(self) -> None:
        """Clear all collected traces."""
        self._exporter.clear()
