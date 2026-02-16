"""RAG Retriever for semantic search."""

from typing import Any

from app.config import settings


class RAGRetriever:
    """Retrieves relevant context from indexed codebase."""

    def __init__(self, collection_name: str = "testforge") -> None:
        """Initialize the RAG retriever."""
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
        """Get the collection."""
        if self._collection is None:
            client = self._get_client()
            self._collection = client.get_or_create_collection(
                name=self.collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        return self._collection

    async def search(
        self,
        query: str,
        project_id: str | None = None,
        n_results: int = 5,
        file_types: list[str] | None = None,
        include_metadata: bool = True,
    ) -> list[dict[str, Any]]:
        """Search for relevant documents."""
        collection = self._get_collection()

        # Build where filter
        where_filter = {}
        if project_id:
            where_filter["project_id"] = project_id
        if file_types:
            where_filter["file_extension"] = {"$in": file_types}

        # Query the collection
        results = collection.query(
            query_texts=[query],
            n_results=n_results,
            where=where_filter if where_filter else None,
            include=["documents", "metadatas", "distances"] if include_metadata else ["documents"],
        )

        # Format results
        documents = []
        for i, doc in enumerate(results["documents"][0]):
            result = {
                "content": doc,
                "score": 1 - results["distances"][0][i] if results.get("distances") else None,
            }
            if include_metadata and results.get("metadatas"):
                result["metadata"] = results["metadatas"][0][i]
            documents.append(result)

        return documents

    async def search_code(
        self,
        query: str,
        project_id: str,
        n_results: int = 5,
    ) -> list[dict[str, Any]]:
        """Search for relevant code snippets."""
        return await self.search(
            query=query,
            project_id=project_id,
            n_results=n_results,
            file_types=[".py", ".js", ".ts", ".tsx", ".jsx", ".go", ".rs"],
        )

    async def search_api_docs(
        self,
        query: str,
        project_id: str,
        n_results: int = 5,
    ) -> list[dict[str, Any]]:
        """Search for relevant API documentation."""
        collection = self._get_collection()

        results = collection.query(
            query_texts=[query],
            n_results=n_results,
            where={
                "project_id": project_id,
                "type": {"$in": ["openapi", "openapi_schema"]},
            },
            include=["documents", "metadatas", "distances"],
        )

        documents = []
        for i, doc in enumerate(results["documents"][0]):
            documents.append({
                "content": doc,
                "score": 1 - results["distances"][0][i] if results.get("distances") else None,
                "metadata": results["metadatas"][0][i] if results.get("metadatas") else None,
            })

        return documents

    async def get_context_for_test_generation(
        self,
        prompt: str,
        project_id: str,
        test_type: str = "e2e",
    ) -> str:
        """Get relevant context for test generation."""
        # Search for relevant code
        code_results = await self.search_code(
            query=prompt,
            project_id=project_id,
            n_results=3,
        )

        # Search for API docs if it's an API test
        api_results = []
        if test_type in ["api", "e2e"]:
            api_results = await self.search_api_docs(
                query=prompt,
                project_id=project_id,
                n_results=2,
            )

        # Build context
        context_parts = []

        if code_results:
            context_parts.append("## Relevant Code\n")
            for result in code_results:
                file_path = result.get("metadata", {}).get("file_path", "unknown")
                context_parts.append(f"### {file_path}\n```\n{result['content']}\n```\n")

        if api_results:
            context_parts.append("\n## API Documentation\n")
            for result in api_results:
                context_parts.append(f"```\n{result['content']}\n```\n")

        return "\n".join(context_parts) if context_parts else "No relevant context found."

    async def get_context_for_failure_analysis(
        self,
        error_message: str,
        test_file: str,
        project_id: str,
    ) -> str:
        """Get relevant context for failure analysis."""
        # Search for related code
        code_results = await self.search(
            query=f"{error_message} {test_file}",
            project_id=project_id,
            n_results=5,
        )

        context_parts = ["## Related Code and Documentation\n"]

        for result in code_results:
            file_path = result.get("metadata", {}).get("file_path", "unknown")
            context_parts.append(f"### {file_path}\n```\n{result['content']}\n```\n")

        return "\n".join(context_parts)

    async def hybrid_search(
        self,
        query: str,
        project_id: str,
        n_results: int = 10,
    ) -> list[dict[str, Any]]:
        """Perform hybrid search combining semantic and keyword search."""
        # Semantic search
        semantic_results = await self.search(
            query=query,
            project_id=project_id,
            n_results=n_results,
        )

        # Simple keyword matching for re-ranking
        keywords = set(query.lower().split())
        for result in semantic_results:
            content_lower = result["content"].lower()
            keyword_matches = sum(1 for kw in keywords if kw in content_lower)
            # Boost score based on keyword matches
            result["score"] = (result.get("score", 0) or 0) + (keyword_matches * 0.1)

        # Re-sort by combined score
        semantic_results.sort(key=lambda x: x.get("score", 0), reverse=True)

        return semantic_results[:n_results]
