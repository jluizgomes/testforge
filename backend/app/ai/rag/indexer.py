"""RAG Indexer for codebase indexing."""

import hashlib
from pathlib import Path
from typing import Any

from app.config import settings


class RAGIndexer:
    """Indexes codebase files for RAG retrieval."""

    # File extensions to index
    SUPPORTED_EXTENSIONS = {
        # Code files
        ".py",
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".vue",
        ".svelte",
        ".go",
        ".rs",
        ".java",
        ".kt",
        ".swift",
        ".rb",
        ".php",
        # Config files
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        # Documentation
        ".md",
        ".rst",
        ".txt",
        # API specs
        ".graphql",
    }

    # Directories to skip
    SKIP_DIRS = {
        "node_modules",
        ".git",
        "__pycache__",
        ".venv",
        "venv",
        ".next",
        "dist",
        "build",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        "coverage",
    }

    def __init__(self, collection_name: str = "testforge") -> None:
        """Initialize the RAG indexer."""
        self.collection_name = collection_name
        self._client = None
        self._collection = None

    def _get_client(self):
        """Get or create ChromaDB client."""
        if self._client is None:
            import chromadb

            self._client = chromadb.PersistentClient(
                path=settings.chroma_persist_directory
            )
        return self._client

    def _get_collection(self):
        """Get or create the collection."""
        if self._collection is None:
            client = self._get_client()
            self._collection = client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    def _chunk_text(
        self,
        text: str,
        chunk_size: int = 1000,
        chunk_overlap: int = 200,
    ) -> list[str]:
        """Split text into overlapping chunks."""
        chunks = []
        start = 0

        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]

            # Try to break at a newline
            if end < len(text):
                last_newline = chunk.rfind("\n")
                if last_newline > chunk_size // 2:
                    chunk = chunk[: last_newline + 1]
                    end = start + last_newline + 1

            chunks.append(chunk)
            start = end - chunk_overlap

        return chunks

    def _compute_hash(self, content: str) -> str:
        """Compute hash of content for change detection."""
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    async def index_file(
        self,
        file_path: Path,
        project_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> int:
        """Index a single file."""
        if not file_path.exists():
            return 0

        if file_path.suffix not in self.SUPPORTED_EXTENSIONS:
            return 0

        try:
            content = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return 0

        if not content.strip():
            return 0

        # Chunk the content
        chunks = self._chunk_text(content)
        collection = self._get_collection()

        # Prepare documents
        ids = []
        documents = []
        metadatas = []

        for i, chunk in enumerate(chunks):
            chunk_id = f"{project_id}:{file_path}:{i}:{self._compute_hash(chunk)}"
            ids.append(chunk_id)
            documents.append(chunk)
            metadatas.append({
                "project_id": project_id,
                "file_path": str(file_path),
                "chunk_index": i,
                "file_extension": file_path.suffix,
                "file_name": file_path.name,
                **(metadata or {}),
            })

        # Upsert to collection
        if ids:
            collection.upsert(
                ids=ids,
                documents=documents,
                metadatas=metadatas,
            )

        return len(chunks)

    async def index_directory(
        self,
        directory: Path,
        project_id: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, int]:
        """Index all supported files in a directory."""
        if not directory.exists() or not directory.is_dir():
            return {"files": 0, "chunks": 0}

        files_indexed = 0
        total_chunks = 0

        for file_path in directory.rglob("*"):
            # Skip directories in SKIP_DIRS
            if any(skip_dir in file_path.parts for skip_dir in self.SKIP_DIRS):
                continue

            if file_path.is_file():
                chunks = await self.index_file(file_path, project_id, metadata)
                if chunks > 0:
                    files_indexed += 1
                    total_chunks += chunks

        return {"files": files_indexed, "chunks": total_chunks}

    async def index_openapi_spec(
        self,
        spec_url: str,
        project_id: str,
    ) -> int:
        """Index an OpenAPI specification."""
        import httpx

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(spec_url)
                response.raise_for_status()

                import json

                spec = response.json()

                # Extract relevant parts
                documents = []
                ids = []
                metadatas = []

                # Index paths/endpoints
                for path, methods in spec.get("paths", {}).items():
                    for method, details in methods.items():
                        if isinstance(details, dict):
                            doc = f"API Endpoint: {method.upper()} {path}\n"
                            doc += f"Summary: {details.get('summary', 'N/A')}\n"
                            doc += f"Description: {details.get('description', 'N/A')}\n"

                            if details.get("parameters"):
                                doc += f"Parameters: {json.dumps(details['parameters'], indent=2)}\n"

                            if details.get("requestBody"):
                                doc += f"Request Body: {json.dumps(details['requestBody'], indent=2)}\n"

                            doc_id = f"{project_id}:openapi:{path}:{method}"
                            ids.append(doc_id)
                            documents.append(doc)
                            metadatas.append({
                                "project_id": project_id,
                                "type": "openapi",
                                "path": path,
                                "method": method,
                            })

                # Index schemas
                for schema_name, schema in spec.get("components", {}).get("schemas", {}).items():
                    doc = f"API Schema: {schema_name}\n"
                    doc += json.dumps(schema, indent=2)

                    doc_id = f"{project_id}:openapi:schema:{schema_name}"
                    ids.append(doc_id)
                    documents.append(doc)
                    metadatas.append({
                        "project_id": project_id,
                        "type": "openapi_schema",
                        "schema_name": schema_name,
                    })

                if ids:
                    collection = self._get_collection()
                    collection.upsert(
                        ids=ids,
                        documents=documents,
                        metadatas=metadatas,
                    )

                return len(ids)

        except Exception as e:
            print(f"Error indexing OpenAPI spec: {e}")
            return 0

    async def delete_project_index(self, project_id: str) -> int:
        """Delete all indexed documents for a project."""
        collection = self._get_collection()

        # Get all IDs for this project
        results = collection.get(
            where={"project_id": project_id},
            include=[],
        )

        if results["ids"]:
            collection.delete(ids=results["ids"])
            return len(results["ids"])

        return 0

    def get_stats(self, project_id: str | None = None) -> dict[str, Any]:
        """Get indexing statistics."""
        collection = self._get_collection()

        if project_id:
            results = collection.get(
                where={"project_id": project_id},
                include=["metadatas"],
            )
            count = len(results["ids"])
            file_types = {}
            for meta in results["metadatas"] or []:
                ext = meta.get("file_extension", "unknown")
                file_types[ext] = file_types.get(ext, 0) + 1

            return {
                "project_id": project_id,
                "total_chunks": count,
                "file_types": file_types,
            }

        return {
            "total_chunks": collection.count(),
        }
