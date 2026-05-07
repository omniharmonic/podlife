"""Shared pytest fixtures for the optimizer tests."""

from __future__ import annotations

import pytest


@pytest.fixture(scope="session", autouse=True)
def highs_available() -> None:
    """Skip the entire suite if highspy isn't installed."""
    try:
        import highspy  # noqa: F401
    except ImportError as exc:  # pragma: no cover
        pytest.skip(f"highspy not available: {exc}", allow_module_level=True)
