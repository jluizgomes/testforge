"""OpenTelemetry setup and utilities."""

from contextlib import contextmanager
from typing import Any, Generator

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor

from app.config import settings

# Global tracer instance
_tracer: trace.Tracer | None = None


def setup_telemetry() -> None:
    """Set up OpenTelemetry tracing."""
    global _tracer

    if not settings.enable_tracing:
        return

    # Create resource
    resource = Resource.create({
        "service.name": "testforge-backend",
        "service.version": settings.app_version,
        "deployment.environment": settings.environment,
    })

    # Create tracer provider
    provider = TracerProvider(resource=resource)

    # Add exporters
    if settings.jaeger_endpoint:
        try:
            from opentelemetry.exporter.jaeger.thrift import JaegerExporter

            jaeger_exporter = JaegerExporter(
                agent_host_name=settings.jaeger_endpoint.split(":")[0],
                agent_port=int(settings.jaeger_endpoint.split(":")[1]) if ":" in settings.jaeger_endpoint else 6831,
            )
            provider.add_span_processor(BatchSpanProcessor(jaeger_exporter))
        except ImportError:
            pass

    # Add in-memory exporter for trace collection
    from app.core.tracing.trace_collector import InMemorySpanExporter

    memory_exporter = InMemorySpanExporter()
    provider.add_span_processor(SimpleSpanProcessor(memory_exporter))

    # Set the tracer provider
    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer("testforge")


def get_tracer() -> trace.Tracer:
    """Get the global tracer instance."""
    global _tracer
    if _tracer is None:
        _tracer = trace.get_tracer("testforge")
    return _tracer


@contextmanager
def create_span(
    name: str,
    attributes: dict[str, Any] | None = None,
    kind: trace.SpanKind = trace.SpanKind.INTERNAL,
) -> Generator[trace.Span, None, None]:
    """Create a new span context manager."""
    tracer = get_tracer()

    with tracer.start_as_current_span(
        name,
        kind=kind,
        attributes=attributes or {},
    ) as span:
        try:
            yield span
        except Exception as e:
            span.set_status(trace.Status(trace.StatusCode.ERROR, str(e)))
            span.record_exception(e)
            raise


def inject_trace_headers(headers: dict[str, str]) -> dict[str, str]:
    """Inject trace context into HTTP headers."""
    from opentelemetry.propagate import inject

    inject(headers)

    # Also add our custom header
    current_span = trace.get_current_span()
    if current_span and current_span.get_span_context().is_valid:
        trace_id = format(current_span.get_span_context().trace_id, "032x")
        headers["X-TestForge-TraceID"] = trace_id

    return headers


def extract_trace_headers(headers: dict[str, str]) -> trace.SpanContext | None:
    """Extract trace context from HTTP headers."""
    from opentelemetry.propagate import extract

    context = extract(headers)
    span = trace.get_current_span(context)

    if span and span.get_span_context().is_valid:
        return span.get_span_context()

    return None


def get_current_trace_id() -> str | None:
    """Get the current trace ID."""
    current_span = trace.get_current_span()
    if current_span and current_span.get_span_context().is_valid:
        return format(current_span.get_span_context().trace_id, "032x")
    return None


def get_current_span_id() -> str | None:
    """Get the current span ID."""
    current_span = trace.get_current_span()
    if current_span and current_span.get_span_context().is_valid:
        return format(current_span.get_span_context().span_id, "016x")
    return None


def add_span_attribute(key: str, value: Any) -> None:
    """Add an attribute to the current span."""
    current_span = trace.get_current_span()
    if current_span:
        current_span.set_attribute(key, value)


def add_span_event(name: str, attributes: dict[str, Any] | None = None) -> None:
    """Add an event to the current span."""
    current_span = trace.get_current_span()
    if current_span:
        current_span.add_event(name, attributes=attributes or {})
