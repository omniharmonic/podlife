"""FastAPI service exposing the Pod Life MILP optimizer.

Endpoints:
    POST /optimize  — run the solver and return a proposed schedule.
    GET  /health    — liveness probe; reports HiGHS availability.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException

from .models import OptimizationRequest, OptimizationResponse
from .solver import solve

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("optimizer")

app = FastAPI(
    title="Pod Life Optimizer",
    description="Scheduling optimization engine for polyamorous families",
    version="0.1.0",
)


@app.post("/optimize", response_model=OptimizationResponse)
async def optimize_schedule(request: OptimizationRequest) -> OptimizationResponse:
    """Run the maximin-fairness MILP solver against the supplied problem spec."""
    try:
        result = solve(request)
    except Exception as exc:  # pragma: no cover - safety net only
        logger.exception("optimization failed")
        raise HTTPException(status_code=500, detail=f"Optimization failed: {exc}") from exc

    feasibility = "feasible" if result.proposed_blocks else "infeasible"
    logger.info(
        "POST /optimize: persons=%d prefs=%d slots=%d vars=%d ms=%d status=%s blocks=%d",
        len(request.persons),
        len(request.partner_preferences),
        result.slot_count,
        result.variable_count,
        result.solver_time_ms,
        feasibility,
        len(result.proposed_blocks),
    )
    return result


@app.get("/health")
async def health() -> dict[str, str]:
    """Confirm the service is up and the HiGHS binding is importable."""
    try:
        import highspy  # noqa: F401

        solver = "highs"
    except ImportError:  # pragma: no cover
        solver = "missing"
    return {"status": "ok", "solver": solver}
