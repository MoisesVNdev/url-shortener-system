from fastapi import APIRouter

from app.api.v1.endpoints import redirect, shorten

router = APIRouter()
router.include_router(shorten.router, prefix="/api/v1", tags=["shorten"])
router.include_router(redirect.router, tags=["redirect"])
