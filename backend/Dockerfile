FROM python:3.11-slim

WORKDIR /app

# System dependencies
# - gcc + libpq-dev: compile asyncpg/psycopg2 C extensions
# - libpango*, libcairo2, libgdk-pixbuf*, libffi-dev, shared-mime-info: WeasyPrint PDF export
# - curl: used by health probes
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    libcairo2 \
    shared-mime-info \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies as a separate cached layer.
# pyproject.toml references README.md for metadata.
COPY pyproject.toml README.md ./
RUN mkdir -p app && touch app/__init__.py
RUN pip install --no-cache-dir -e ".[dev]"

# Copy application source (invalidates cache on code changes only)
COPY . .

EXPOSE 8000

COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

CMD ["./entrypoint.sh"]
