import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
# 1. Adicione a importação do Instrumentator
from prometheus_fastapi_instrumentator import Instrumentator  # noqa: F401, E402

from app.api.v1.router import router as v1_router
from app.db.cassandra import get_session
from app.db.redis_client import get_redis
from app.schemas.health import HealthResponse

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):  # noqa: ARG001
    """
    Gerencia o ciclo de vida da aplicação: inicializa e encerra conexões.
    """
    logger.info("Inicializando aplicação...")
    try:
        get_session()
        logger.info("✓ Cassandra inicializado com sucesso.")
        get_redis()
        logger.info("✓ Redis inicializado com sucesso.")
    except OSError as exc:
        logger.error("Falha na inicialização de banco de dados: %s", str(exc), exc_info=True)
        raise

    yield

    logger.info("Finalizando aplicação...")
    try:
        redis = get_redis()
        await redis.aclose()
        logger.info("✓ Conexão Redis encerrada.")

        session = get_session()
        session.session.cluster.shutdown()
        logger.info("✓ Cluster Cassandra desligado.")
    except OSError as exc:
        logger.warning("Erro ao finalizar: %s", str(exc))


app = FastAPI(title="URL Shortener", lifespan=lifespan)

# 2. Inicialize e exponha as métricas na sua aplicação
Instrumentator().instrument(app).expose(app)

@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    """
    Endpoint de verificação de saúde da aplicação com check de dependências.

    Verifica conectividade com Redis e Cassandra. Retorna status 'ok' se ambos
    os serviços responderam, ou 'degraded' se houver qualquer erro.

    Returns:
        HealthResponse contendo status geral e status específico de cada serviço.
    """
    try:
        # Verificar Redis
        redis = get_redis()
        await redis.ping()

        # Verificar Cassandra
        session = get_session()
        session.execute(session.select_stmt, ["__health_check__"])

        return HealthResponse(
            status="ok",
            redis="connected",
            cassandra="connected",
        )
    except (OSError, RuntimeError) as exc:  # noqa: BLE001\n        logger.warning(\"Health check falhou: %s\", str(exc))
        return HealthResponse(
            status="degraded",
            error=str(exc),
        )

app.include_router(v1_router)