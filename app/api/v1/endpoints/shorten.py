import logging

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.url import ShortenRequest, ShortenResponse
from app.services.url_service import create_short_url

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/shorten", response_model=ShortenResponse, status_code=201)
async def shorten_url(body: ShortenRequest) -> ShortenResponse:
    """Encurta uma URL longa e retorna o shortcode gerado."""
    try:
        shortcode = await create_short_url(str(body.url))
        return ShortenResponse(short_url=f"{settings.BASE_URL}/{shortcode}")
    except Exception as exc:
        logger.error("Erro ao criar shortcode: %s", str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Erro interno. Tente novamente.") from exc
