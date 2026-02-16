"""AI Provider abstraction for multiple LLM backends."""

import asyncio
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Any, AsyncGenerator

from app.config import settings


class ProviderType(str, Enum):
    """Supported AI providers."""

    OPENAI = "openai"
    OLLAMA = "ollama"


@dataclass
class AIMessage:
    """A message in a conversation."""

    role: str  # "system", "user", "assistant"
    content: str


@dataclass
class AIResponse:
    """Response from an AI provider."""

    content: str
    model: str
    tokens_used: int | None = None
    finish_reason: str | None = None


class AIProvider(ABC):
    """Abstract base class for AI providers."""

    @abstractmethod
    async def generate(
        self,
        messages: list[AIMessage],
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AIResponse:
        """Generate a response from the AI model."""
        pass

    @abstractmethod
    async def generate_stream(
        self,
        messages: list[AIMessage],
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generate a streaming response from the AI model."""
        pass

    @abstractmethod
    async def get_embedding(self, text: str) -> list[float]:
        """Get embedding vector for text."""
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if the provider is available."""
        pass


class OpenAIProvider(AIProvider):
    """OpenAI API provider."""

    def __init__(self, api_key: str, model: str = "gpt-4") -> None:
        """Initialize OpenAI provider."""
        self.api_key = api_key
        self.model = model
        self._client = None

    def _get_client(self):
        """Get or create OpenAI client."""
        if self._client is None:
            from openai import AsyncOpenAI

            self._client = AsyncOpenAI(api_key=self.api_key)
        return self._client

    async def generate(
        self,
        messages: list[AIMessage],
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AIResponse:
        """Generate a response using OpenAI."""
        client = self._get_client()

        response = await client.chat.completions.create(
            model=self.model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=temperature,
            max_tokens=max_tokens,
        )

        choice = response.choices[0]
        return AIResponse(
            content=choice.message.content or "",
            model=self.model,
            tokens_used=response.usage.total_tokens if response.usage else None,
            finish_reason=choice.finish_reason,
        )

    async def generate_stream(
        self,
        messages: list[AIMessage],
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generate a streaming response using OpenAI."""
        client = self._get_client()

        stream = await client.chat.completions.create(
            model=self.model,
            messages=[{"role": m.role, "content": m.content} for m in messages],
            temperature=temperature,
            max_tokens=max_tokens,
            stream=True,
        )

        async for chunk in stream:
            if chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    async def get_embedding(self, text: str) -> list[float]:
        """Get embedding using OpenAI."""
        client = self._get_client()

        response = await client.embeddings.create(
            model="text-embedding-3-small",
            input=text,
        )

        return response.data[0].embedding

    async def health_check(self) -> bool:
        """Check if OpenAI API is available."""
        try:
            client = self._get_client()
            await client.models.list()
            return True
        except Exception:
            return False


class OllamaProvider(AIProvider):
    """Ollama local LLM provider."""

    def __init__(self, base_url: str = "http://localhost:11434", model: str = "llama3.1:8b") -> None:
        """Initialize Ollama provider."""
        self.base_url = base_url
        self.model = model

    async def generate(
        self,
        messages: list[AIMessage],
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AIResponse:
        """Generate a response using Ollama."""
        import httpx

        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "stream": False,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                },
            )
            response.raise_for_status()
            data = response.json()

            return AIResponse(
                content=data["message"]["content"],
                model=self.model,
                tokens_used=data.get("eval_count"),
            )

    async def generate_stream(
        self,
        messages: list[AIMessage],
        temperature: float = 0.7,
        max_tokens: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Generate a streaming response using Ollama."""
        import httpx

        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json={
                    "model": self.model,
                    "messages": [{"role": m.role, "content": m.content} for m in messages],
                    "stream": True,
                    "options": {
                        "temperature": temperature,
                        "num_predict": max_tokens,
                    },
                },
            ) as response:
                import json

                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]

    async def get_embedding(self, text: str) -> list[float]:
        """Get embedding using Ollama."""
        import httpx

        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{self.base_url}/api/embeddings",
                json={
                    "model": "nomic-embed-text",
                    "prompt": text,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["embedding"]

    async def health_check(self) -> bool:
        """Check if Ollama is available."""
        try:
            import httpx

            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                return response.status_code == 200
        except Exception:
            return False


class CircuitBreaker:
    """Circuit breaker for AI provider resilience."""

    def __init__(
        self,
        failure_threshold: int = 5,
        reset_timeout: float = 60.0,
    ) -> None:
        """Initialize circuit breaker."""
        self.failure_threshold = failure_threshold
        self.reset_timeout = reset_timeout
        self.failures = 0
        self.last_failure_time: float | None = None
        self.state = "closed"  # closed, open, half-open

    def record_success(self) -> None:
        """Record a successful call."""
        self.failures = 0
        self.state = "closed"

    def record_failure(self) -> None:
        """Record a failed call."""
        import time

        self.failures += 1
        self.last_failure_time = time.time()

        if self.failures >= self.failure_threshold:
            self.state = "open"

    def can_execute(self) -> bool:
        """Check if a call can be executed."""
        import time

        if self.state == "closed":
            return True

        if self.state == "open":
            if self.last_failure_time and time.time() - self.last_failure_time > self.reset_timeout:
                self.state = "half-open"
                return True
            return False

        return True  # half-open state allows one try


def get_ai_provider(
    provider_type: ProviderType | None = None,
    model: str | None = None,
) -> AIProvider:
    """Get an AI provider instance."""
    provider_type = provider_type or ProviderType(settings.default_ai_provider)
    model = model or settings.default_ai_model

    if provider_type == ProviderType.OPENAI:
        return OpenAIProvider(
            api_key=settings.openai_api_key,
            model=model,
        )
    elif provider_type == ProviderType.OLLAMA:
        return OllamaProvider(
            base_url=settings.ollama_base_url,
            model=model,
        )
    else:
        raise ValueError(f"Unknown provider type: {provider_type}")
