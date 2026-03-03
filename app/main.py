import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
# 1. Adicione a importação do Instrumentator
from prometheus_fastapi_instrumentator import Instrumentator

from app.api.v1.router import router as v1_router
from app.db.cassandra import get_session
from app.db.redis_client import get_redis

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

@app.get("/health")
async def health():
    """Endpoint de verificação de saúde da aplicação com check de dependências."""
    try:
        # Verificar Redis
        redis = get_redis()
        await redis.ping()

        # Verificar Cassandra
        session = get_session()
        session.execute(session.select_stmt, ["__health_check__"])

        return {"status": "ok", "redis": "connected", "cassandra": "connected"}
    except Exception as exc:
        logger.warning("Health check falhou: %s", str(exc))
        return {
            "status": "degraded",
            "error": str(exc),
        }

app.include_router(v1_router)