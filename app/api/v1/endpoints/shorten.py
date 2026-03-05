import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from app.core.config import settings
from app.schemas.url import ShortenRequest, ShortenResponse
from app.services.url_service import create_short_url

logger = logging.getLogger(__name__)

router = APIRouter()


SHORTEN_RESPONSES: dict[int | str, dict[str, Any]] = {
    201: {
        "description": "URL encurtada com sucesso.",
        "content": {
            "application/json": {
                "example": {"short_url": "http://localhost/Dx4p"}
            }
        },
    },
    400: {
        "description": "URL inválida ou malformada.",
        "content": {
            "application/json": {
                "example": {"detail": "URL inválida ou formato não suportado."}
            }
        },
    },
    422: {
        "description": "Erro na validação dos dados de entrada.",
        "content": {
            "application/json": {
                "example": {
                    "detail": [
                        {
                            "type": "value_error",
                            "loc": ["body", "url"],
                            "msg": "invalid url scheme",
                        }
                    ]
                }
            }
        },
    },
    500: {
        "description": "Erro interno ao criar o shortcode.",
        "content": {
            "application/json": {"example": {"detail": "Erro interno. Tente novamente."}}
        },
    },
}


@router.post("/shorten", response_model=ShortenResponse, status_code=201, responses=SHORTEN_RESPONSES)
async def shorten_url(body: ShortenRequest) -> ShortenResponse:
    """
    Encurta uma URL longa e retorna o shortcode gerado.

    Gera um shortcode único de base62 (apenas [0-9A-Za-z], mínimo 4 caracteres)
    e persiste o mapeamento no Cassandra com cache no Redis.

    Args:
        body: Objeto ShortenRequest contendo a URL a ser encurtada.

    Returns:
        ShortenResponse com a URL encurtada completa.

    Raises:
        HTTPException: 400 se URL inválida, 500 se erro interno.
    """
    try:
        shortcode = await create_short_url(str(body.url))
        return ShortenResponse(short_url=f"{settings.BASE_URL}/{shortcode}")
    except Exception as exc:
        logger.error("Erro ao criar shortcode: %s", str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Erro interno. Tente novamente.") from exc
