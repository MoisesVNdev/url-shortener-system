import asyncio
import logging
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter
from redis.exceptions import RedisError

from app.core.config import settings
from app.db.cassandra import get_session
from app.db.redis_client import get_redis
from app.schemas.health import ContainerHealthInfo, ContainersHealthResponse, ContainersHealthSummary

logger = logging.getLogger(__name__)

router = APIRouter()


async def _check_http_container(
    service_name: str,
    host: str,
    port: int,
    path: str,
) -> ContainerHealthInfo:
    """Verifica a saúde de um serviço HTTP via endpoint de health."""
    url = f"http://{host}:{port}{path}"
    start = time.perf_counter()

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(url)

        latency_ms = round((time.perf_counter() - start) * 1000, 2)
        status = "healthy" if response.status_code < 400 else "unhealthy"

        return ContainerHealthInfo(
            service=service_name,
            type="http",
            host=host,
            port=port,
            status=status,
            latency_ms=latency_ms,
            http_status=response.status_code,
            details={"health_url": url},
        )
    except (httpx.HTTPError, OSError, TimeoutError) as exc:
        logger.warning("Falha no health HTTP de %s: %s", service_name, str(exc))
        return ContainerHealthInfo(
            service=service_name,
            type="http",
            host=host,
            port=port,
            status="unhealthy",
            error=str(exc),
            details={"health_url": url},
        )


async def _check_redis_container() -> ContainerHealthInfo:
    """Verifica conectividade e versão do Redis."""
    start = time.perf_counter()
    host = settings.REDIS_HOST
    port = settings.REDIS_PORT

    try:
        redis = get_redis()
        await redis.ping()
        info = await redis.info("server")
        latency_ms = round((time.perf_counter() - start) * 1000, 2)

        return ContainerHealthInfo(
            service="redis",
            type="redis",
            host=host,
            port=port,
            status="healthy",
            latency_ms=latency_ms,
            version=info.get("redis_version"),
            details={"mode": info.get("redis_mode")},
        )
    except (RedisError, OSError, TimeoutError) as exc:
        logger.warning("Falha no health do Redis: %s", str(exc))
        return ContainerHealthInfo(
            service="redis",
            type="redis",
            host=host,
            port=port,
            status="unhealthy",
            error=str(exc),
        )


async def _check_cassandra_container() -> ContainerHealthInfo:
    """Verifica conectividade e versão do Cassandra sem bloquear o event loop."""
    start = time.perf_counter()
    host = settings.CASSANDRA_HOST
    port = settings.CASSANDRA_PORT

    try:
        cassandra_session = get_session()
        loop = asyncio.get_running_loop()

        def _query_version() -> str | None:
            row = cassandra_session.session.execute("SELECT release_version FROM system.local").one()
            return row.release_version if row else None

        version = await loop.run_in_executor(None, _query_version)
        latency_ms = round((time.perf_counter() - start) * 1000, 2)

        return ContainerHealthInfo(
            service="cassandra",
            type="cassandra",
            host=host,
            port=port,
            status="healthy",
            latency_ms=latency_ms,
            version=version,
            details={"keyspace": settings.CASSANDRA_KEYSPACE},
        )
    except (OSError, TimeoutError, RuntimeError) as exc:
        logger.warning("Falha no health do Cassandra: %s", str(exc))
        return ContainerHealthInfo(
            service="cassandra",
            type="cassandra",
            host=host,
            port=port,
            status="unhealthy",
            error=str(exc),
        )


@router.get("/containers/health", response_model=ContainersHealthResponse)
async def containers_health() -> ContainersHealthResponse:
    """Retorna o estado de saúde dos containers principais do ambiente."""
    checks = await asyncio.gather(
        _check_http_container(
            service_name="web1",
            host=settings.WEB1_HOST,
            port=settings.WEB_APP_PORT,
            path=settings.WEB_HEALTH_PATH,
        ),
        _check_http_container(
            service_name="web2",
            host=settings.WEB2_HOST,
            port=settings.WEB_APP_PORT,
            path=settings.WEB_HEALTH_PATH,
        ),
        _check_http_container(
            service_name="nginx",
            host=settings.NGINX_HOST,
            port=settings.NGINX_PORT,
            path=settings.NGINX_HEALTH_PATH,
        ),
        _check_redis_container(),
        _check_cassandra_container(),
    )

    healthy = sum(1 for item in checks if item.status == "healthy")
    unhealthy = len(checks) - healthy
    overall_status = "healthy" if unhealthy == 0 else "degraded"

    return ContainersHealthResponse(
        status=overall_status,
        checked_at=datetime.now(timezone.utc),
        summary=ContainersHealthSummary(total=len(checks), healthy=healthy, unhealthy=unhealthy),
        containers=list(checks),
    )