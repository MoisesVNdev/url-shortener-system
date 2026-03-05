import logging

import redis.asyncio as aioredis

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis = None


def get_redis() -> aioredis.Redis:
    """
    Obtém a conexão global com Redis.

    Inicializa na primeira chamada e retorna cached nas chamadas subsequentes.

    Returns:
        aioredis.Redis: Conexão com Redis.
    """
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            f"redis://{settings.REDIS_HOST}:{settings.REDIS_PORT}",
            encoding="utf-8",
            decode_responses=True,
            max_connections=200,
        )
        logger.info("Conexão com Redis estabelecida: %s:%d", settings.REDIS_HOST, settings.REDIS_PORT)
    return _redis
