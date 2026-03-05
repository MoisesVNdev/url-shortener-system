from typing import Any

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import RedirectResponse

from app.services.url_service import get_long_url

router = APIRouter()


REDIRECT_RESPONSES: dict[int | str, dict[str, Any]] = {
    302: {
        "description": "Redirecionamento bem-sucedido para a URL original.",
        "headers": {
            "location": {
                "description": "URL original para a qual redirecionar.",
                "schema": {"type": "string"},
            }
        },
    },
    404: {
        "description": "Shortcode não encontrado no banco de dados.",
        "content": {
            "application/json": {
                "example": {"detail": "Shortcode não encontrado."}
            }
        },
    },
}


@router.get(
    "/{shortcode}",
    status_code=302,
    responses=REDIRECT_RESPONSES,
)
async def redirect_url(
    shortcode: str = Path(
        ...,
        pattern=r"^[0-9A-Za-z]{4,}$",
        min_length=4,
        description="Shortcode da URL encurtada. Deve conter apenas caracteres alfanuméricos.",
        examples=["Pa0qa7", "Dx4p"],
    )
) -> RedirectResponse:
    """
    Redireciona para a URL original com base no shortcode.

    Busca o shortcode no Cassandra e retorna um redirecionamento HTTP 302 (Found).
    O navegador seguirá automaticamente para a URL original.

    Args:
        shortcode: Código único da URL encurtada (4+ caracteres, [0-9A-Za-z]).

    Returns:
        RedirectResponse com status 302 e header Location apontando para a URL original.

    Raises:
        HTTPException: 404 se o shortcode não for encontrado.
    """
    long_url = await get_long_url(shortcode)
    if not long_url:
        raise HTTPException(status_code=404, detail="Shortcode não encontrado.")
    return RedirectResponse(url=long_url, status_code=302)
