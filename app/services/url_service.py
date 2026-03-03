import asyncio
import logging

from app.db.cassandra import get_session
from app.db.redis_client import get_redis
from app.services.cache import get_long_url_from_cache, set_url_in_cache
from app.services.shortcode import generate_shortcode

logger = logging.getLogger(__name__)

COUNTER_PREFIX = "counter:hits:"


async def create_short_url(long_url: str) -> str:
    """
    Gera um shortcode único e persiste a URL no Cassandra e no cache Redis.

    Args:
        long_url: URL original a ser encurtada.

    Returns:
        Shortcode gerado (ex.: 'D4p5').
    """
    redis = get_redis()
    shortcode = await generate_shortcode(redis)

    # Write no Cassandra (async via executor para não bloquear)
    cassandra_session = get_session()
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        None, cassandra_session.execute, cassandra_session.insert_stmt, [shortcode, long_url]
    )
    logger.info("Shortcode salvo no Cassandra: %s", shortcode)

    # Write-through cache
    await set_url_in_cache(shortcode, long_url)
    logger.debug("Shortcode cacheado no Redis: %s", shortcode)

    return shortcode


async def get_long_url(shortcode: str) -> str | None:
    """
    Recupera a URL original baseada no shortcode.

    Busca primeiro no cache Redis (90% dos casos), depois no Cassandra.

    Args:
        shortcode: Shortcode da URL.

    Returns:
        URL original ou None se não encontrada.
    """
    redis = get_redis()
    
    # 1. Cache hit
    cached = await get_long_url_from_cache(shortcode)
    if cached:
        await redis.incr(f"{COUNTER_PREFIX}{shortcode}")
        logger.debug("Cache hit para shortcode: %s", shortcode)
        return cached

    logger.debug("Cache miss para shortcode: %s", shortcode)

    # 2. Cache miss → Cassandra (async via executor)
    cassandra_session = get_session()
    loop = asyncio.get_running_loop()
    row = await loop.run_in_executor(
        None, lambda: cassandra_session.execute(cassandra_session.select_stmt, [shortcode])
    )
    row = row.one() if row else None

    if row:
        await set_url_in_cache(shortcode, row.long_url)
        await redis.incr(f"{COUNTER_PREFIX}{shortcode}")
        logger.debug("URL recuperada do Cassandra e cacheada: %s", shortcode)
        return row.long_url

    logger.warning("Shortcode não encontrado: %s", shortcode)
    return None