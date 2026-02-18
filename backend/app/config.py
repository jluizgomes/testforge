"""Application configuration using Pydantic Settings."""

import json
from functools import lru_cache
from typing import Literal

from pydantic import PostgresDsn, field_validator, ValidationInfo
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_name: str = "TestForge AI"
    app_version: str = "1.0.0"
    debug: bool = False
    environment: Literal["development", "staging", "production"] = "development"

    # Server
    host: str = "127.0.0.1"
    port: int = 8000

    # Database
    database_url: PostgresDsn | str = "postgresql+asyncpg://testforge:testforge@localhost:5432/testforge"

    @field_validator("database_url", mode="before")
    @classmethod
    def validate_database_url(cls, v: str) -> str:
        """Ensure database URL uses asyncpg driver."""
        if isinstance(v, str) and "postgresql://" in v and "+asyncpg" not in v:
            return v.replace("postgresql://", "postgresql+asyncpg://")
        return v

    # Redis
    redis_url: str = "redis://localhost:6379"

    # Security
    secret_key: str = "change-me-in-production-with-a-secure-random-key"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    algorithm: str = "HS256"

    # CORS
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://jluizgomes.local:5173",
        "http://jluizgomes.local:3000",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: str | list[str]) -> list[str]:
        """Parse CORS_ORIGINS from JSON string (e.g. from Docker env)."""
        if isinstance(v, str):
            try:
                v = json.loads(v)
            except json.JSONDecodeError:
                v = [o.strip() for o in v.split(",") if o.strip()]
        return list(v) if isinstance(v, list) else [v]

    @field_validator("cors_origins", mode="after")
    @classmethod
    def ensure_dev_origins(cls, v: list[str], info: ValidationInfo) -> list[str]:
        """In development, always allow localhost origins (e.g. Vite on 5173)."""
        if info.data.get("environment") != "development":
            return v
        for origin in ("http://localhost:5173", "http://127.0.0.1:5173"):
            if origin not in v:
                v = [*v, origin]
        return v

    # AI Providers
    openai_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"
    default_ai_provider: Literal["openai", "ollama"] = "openai"
    default_ai_model: str = "gpt-4"

    # ChromaDB
    chroma_persist_directory: str = "./data/chroma"

    # Playwright
    playwright_headless: bool = True
    playwright_slow_mo: int = 0

    # Tracing
    enable_tracing: bool = True
    jaeger_endpoint: str = ""

    # Logging
    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


settings = get_settings()
