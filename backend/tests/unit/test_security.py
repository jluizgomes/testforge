"""Unit tests for the security modules: masking, encryption, auth.

Total: 18 tests
"""

from __future__ import annotations

import pytest

# ── Masking ───────────────────────────────────────────────────────────────────

from app.core.security.masking import mask_credential, mask_url


class TestMaskCredential:
    def test_non_empty_returns_stars(self):
        assert mask_credential("supersecret") == "****"

    def test_none_returns_empty(self):
        assert mask_credential(None) == ""

    def test_empty_string_returns_empty(self):
        assert mask_credential("") == ""


class TestMaskUrl:
    def test_masks_password_in_postgres_url(self):
        url = "postgresql://admin:s3cret@db:5432/mydb"
        masked = mask_url(url)
        assert "s3cret" not in masked
        assert "****" in masked
        assert "admin" in masked
        assert "db:5432/mydb" in masked

    def test_none_returns_empty(self):
        assert mask_url(None) == ""

    def test_empty_returns_empty(self):
        assert mask_url("") == ""

    def test_url_without_password_returned_as_is(self):
        url = "redis://localhost:6379"
        assert mask_url(url) == url

    def test_url_with_user_and_password(self):
        url = "postgresql://user:pass@host/db"
        masked = mask_url(url)
        assert "pass" not in masked
        assert "user" in masked


# ── Encryption ────────────────────────────────────────────────────────────────

from app.core.security.encryption import (
    decrypt_value,
    encrypt_value,
    mask_for_display,
)


class TestEncryptDecrypt:
    def test_encrypt_then_decrypt_roundtrip(self):
        plaintext = "my-secret-password"
        encrypted = encrypt_value(plaintext)
        assert encrypted is not None
        assert encrypted != plaintext  # Must be different
        decrypted = decrypt_value(encrypted)
        assert decrypted == plaintext

    def test_encrypt_none_returns_none(self):
        assert encrypt_value(None) is None

    def test_encrypt_empty_returns_empty(self):
        assert encrypt_value("") == ""  # falsy → passthrough

    def test_decrypt_none_returns_none(self):
        assert decrypt_value(None) is None

    def test_decrypt_non_encrypted_returns_raw(self):
        """Backward compat: pre-encryption plaintext is returned as-is."""
        raw = "plain-text-password"
        assert decrypt_value(raw) == raw


class TestMaskForDisplay:
    def test_masks_long_value(self):
        result = mask_for_display("mysecretpassword", visible_chars=4)
        assert result is not None
        assert result.endswith("word")
        assert result.startswith("*")
        assert len(result) == len("mysecretpassword")

    def test_masks_short_value(self):
        result = mask_for_display("ab", visible_chars=4)
        assert result == "**"

    def test_none_returns_none(self):
        assert mask_for_display(None) is None

    def test_empty_returns_empty(self):
        assert mask_for_display("") == ""  # falsy → passthrough


# ── Auth (password hashing + JWT) ─────────────────────────────────────────────

from app.core.security.auth import (
    create_access_token,
    hash_password,
    verify_password,
)


class TestPasswordHashing:
    def test_hash_and_verify_success(self):
        password = "Str0ng!Pass"
        hashed = hash_password(password)
        assert hashed != password
        assert verify_password(password, hashed) is True

    def test_wrong_password_fails(self):
        hashed = hash_password("real-pass")
        assert verify_password("wrong-pass", hashed) is False


class TestJWT:
    def test_create_token_returns_string(self):
        token = create_access_token(data={"sub": "user-123"})
        assert isinstance(token, str)
        assert len(token) > 20

    def test_token_can_be_decoded(self):
        from jose import jwt
        from app.config import settings

        token = create_access_token(data={"sub": "user-456"})
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        assert payload["sub"] == "user-456"
        assert "exp" in payload


# ── Config validation ─────────────────────────────────────────────────────────

from app.config import Settings


class TestSecretKeyValidation:
    def test_rejects_default_key_in_production(self):
        with pytest.raises(ValueError, match="known default"):
            Settings(
                environment="production",
                secret_key="change-me-in-production-with-a-secure-random-key",
            )

    def test_rejects_short_key_in_production(self):
        with pytest.raises(ValueError, match="at least 32 characters"):
            Settings(
                environment="production",
                secret_key="tooshort",
            )

    def test_allows_short_key_in_development(self):
        s = Settings(environment="development", secret_key="short")
        assert s.secret_key == "short"
