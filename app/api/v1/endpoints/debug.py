import asyncio
import logging

from fastapi import APIRouter, HTTPException, Query

from app.db.cassandra import get_session
from app.db.redis_client import get_redis
from app.schemas.url import DebugResponse, TopShortcode, UrlRecord

logger = logging.getLogger(__name__)
router = APIRouter()

COUNTER_PREFIX = "counter:hits:"


@router.get("/debug/urls", response_model=DebugResponse, tags=["debug"])
async def debug_urls(
    limit: int = Query(default=50, ge=1, le=500, description="Máximo de registros retornados"),
    top: int = Query(default=10, ge=1, le=100, description="Quantidade de shortcodes mais acessados"),
):
    """
    Endpoint de diagnóstico. Retorna registros do Cassandra e rankings do Redis.
    
    ⚠️ Não expor em produção.

    Args:
        limit: Máximo de registros retornados do Cassandra (1-500).
        top: Quantidade de shortcodes mais acessados a retornar (1-100).

    Returns:
        DebugResponse contendo total de registros, lista de URLs e top shortcodes.

    Raises:
        HTTPException: Se ocorrer erro ao consultar Cassandra ou Redis.
    """
    try:
        cassandra_session = get_session()
        loop = asyncio.get_running_loop()

        # Full scan limitado — aceitável para debug
        rows = await loop.run_in_executor(
            None,
            lambda: list(
                cassandra_session.session.execute(
                    f"SELECT shortcode, long_url, created_at FROM url LIMIT {limit}"
                )
            ),
        )

        records = [
            UrlRecord(
                shortcode=row.shortcode,
                long_url=row.long_url,
                created_at=row.created_at,
            )
            for row in rows
        ]

        # Busca contadores de acesso no Redis para os shortcodes retornados
        redis = get_redis()
        top_shortcodes: list[TopShortcode] = []

        if records:
            keys = [f"{COUNTER_PREFIX}{r.shortcode}" for r in records]
            counts = await redis.mget(*keys)

            scored = sorted(
                [
                    TopShortcode(shortcode=r.shortcode, hits=int(count or 0))
                    for r, count in zip(records, counts)
                ],
                key=lambda x: x.hits,
                reverse=True,
            )
            top_shortcodes = scored[:top]

        logger.info("Endpoint de debug consultado: %d registros, top %d", len(records), top)
        return DebugResponse(
            total=len(records),
            records=records,
            top_shortcodes=top_shortcodes,
        )

    except Exception as exc:
        logger.error("Erro no endpoint de debug: %s", str(exc), exc_info=True)
        raise HTTPException(status_code=500, detail="Erro ao consultar dados de debug.") from exc
