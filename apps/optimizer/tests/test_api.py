"""End-to-end tests against the FastAPI app via TestClient."""

from __future__ import annotations

from fastapi.testclient import TestClient

from src.main import app

from .fixtures.polycule_configs import triad_basic


def test_health_endpoint() -> None:
    with TestClient(app) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert body["solver"] == "highs"


def test_optimize_endpoint_with_triad() -> None:
    payload = triad_basic()
    # FastAPI/Pydantic deserialize datetime ISO strings; convert.
    payload["horizon_start"] = payload["horizon_start"].isoformat()
    payload["horizon_end"] = payload["horizon_end"].isoformat()
    for p in payload["persons"]:
        for w in p["free_windows"]:
            w["start"] = w["start"].isoformat()
            w["end"] = w["end"].isoformat()

    with TestClient(app) as client:
        resp = client.post("/optimize", json=payload)
        assert resp.status_code == 200, resp.text
        body = resp.json()

    assert "proposed_blocks" in body
    assert "satisfaction_scores" in body
    assert "infeasibility_notes" in body
    assert "solver_time_ms" in body
    assert "slot_count" in body
    assert "variable_count" in body
    assert isinstance(body["proposed_blocks"], list)
    assert len(body["proposed_blocks"]) > 0
    assert len(body["satisfaction_scores"]) == 3


def test_optimize_endpoint_rejects_invalid_payload() -> None:
    with TestClient(app) as client:
        resp = client.post("/optimize", json={"foo": "bar"})
        assert resp.status_code == 422  # validation error
