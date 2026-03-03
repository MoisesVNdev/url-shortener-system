from fastapi import APIRouter

from app.api.v1.endpoints import containers_health, debug, redirect, shorten

router = APIRouter()
router.include_router(shorten.router, prefix="/api/v1", tags=["shorten"])
router.include_router(containers_health.router, prefix="/api/v1", tags=["health"])
router.include_router(debug.router, prefix="/api/v1", tags=["debug"])
router.include_router(redirect.router, tags=["redirect"])
