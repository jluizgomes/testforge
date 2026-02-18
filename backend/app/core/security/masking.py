"""Credential masking utilities — prevent secrets from leaking into AI prompts."""

from __future__ import annotations

import re
from urllib.parse import urlparse, urlunparse


def mask_credential(value: str | None) -> str:
    """Replace a credential value with a safe placeholder.

    Returns ``"****"`` for non-empty values, ``""`` for None/empty.
    """
    if not value:
        return ""
    return "****"


def mask_url(url: str | None) -> str:
    """Strip password (and optionally user) from a connection-string URL.

    Examples
    --------
    >>> mask_url("postgresql://admin:s3cret@db:5432/mydb")
    'postgresql://admin:****@db:5432/mydb'
    >>> mask_url(None)
    ''
    """
    if not url:
        return ""

    try:
        parsed = urlparse(url)
        if parsed.password:
            # Rebuild netloc with masked password
            user_part = parsed.username or ""
            host_part = parsed.hostname or ""
            port_part = f":{parsed.port}" if parsed.port else ""
            netloc = f"{user_part}:****@{host_part}{port_part}"
            return urlunparse(parsed._replace(netloc=netloc))
        return url
    except Exception:
        # Fallback: regex-based masking for non-standard URLs
        return re.sub(r"://([^:]+):([^@]+)@", r"://\1:****@", url)
