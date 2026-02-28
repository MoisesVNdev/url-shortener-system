from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import RedirectResponse

from app.services.url_service import get_long_url

router = APIRouter()


@router.get("/{shortcode}")
async def redirect_url(
    shortcode: str = Path(..., pattern=r"^[0-9A-Za-z]{4,}$", min_length=4)
):
    """Redireciona para a URL original com base no shortcode."""
    long_url = await get_long_url(shortcode)
    if not long_url:
        raise HTTPException(status_code=404, detail="Shortcode não encontrado.")
    return RedirectResponse(url=long_url, status_code=302)
