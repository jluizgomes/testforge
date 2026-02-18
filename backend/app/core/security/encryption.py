"""Fernet-based encryption for sensitive fields stored in the database."""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger(__name__)

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    """Derive a Fernet key from the application SECRET_KEY (lazy, cached)."""
    global _fernet
    if _fernet is None:
        from app.config import settings

        digest = hashlib.sha256(settings.secret_key.encode()).digest()
        key = base64.urlsafe_b64encode(digest)
        _fernet = Fernet(key)
    return _fernet


def encrypt_value(plaintext: str | None) -> str | None:
    """Encrypt a plaintext string. Returns None for None/empty input."""
    if not plaintext:
        return plaintext
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_value(ciphertext: str | None) -> str | None:
    """Decrypt a ciphertext string.

    Gracefully returns the raw value if decryption fails (backward
    compatibility with pre-encryption data).
    """
    if not ciphertext:
        return ciphertext
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        # Value was stored before encryption was enabled — return as-is
        logger.debug("decrypt_value: returning raw value (likely pre-encryption data)")
        return ciphertext


def mask_for_display(value: str | None, visible_chars: int = 4) -> str | None:
    """Mask a value for API display, showing only the last N characters.

    Example: ``"mysecretpassword"`` → ``"************word"``
    """
    if not value:
        return value
    if len(value) <= visible_chars:
        return "*" * len(value)
    masked_len = len(value) - visible_chars
    return "*" * masked_len + value[-visible_chars:]
