import logging

from app.core.config import settings
from app.db.redis_client import get_redis

logger = logging.getLogger(__name__)

CACHE_PREFIX = "cache:url:"


async def get_long_url_from_cache(shortcode: str) -> str | None:
    """
    Recupera a URL do cache Redis.

    Args:
        shortcode: Shortcode da URL.

    Returns:
        URL armazenada ou None se não encontrada ou expirada.
    """
    redis = get_redis()
    return await redis.get(f"{CACHE_PREFIX}{shortcode}")


async def set_url_in_cache(shortcode: str, long_url: str) -> None:
    """
    Armazena a URL no cache Redis com TTL configurável.

    Args:
        shortcode: Shortcode da URL.
        long_url: URL original a ser cacheada.
    """
    redis = get_redis()
    await redis.set(f"{CACHE_PREFIX}{shortcode}", long_url, ex=settings.CACHE_TTL)
    logger.debug("URL cacheada com TTL %d segundos: %s", settings.CACHE_TTL, shortcode)