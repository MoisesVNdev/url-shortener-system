from datetime import datetime

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Resposta do endpoint de saúde básico da aplicação."""

    status: str = Field(
        ...,
        description="Status geral da aplicação: 'ok' se todos os serviços conectaram, 'degraded' caso contrário.",
        examples=["ok", "degraded"],
    )
    redis: str | None = Field(
        default=None,
        description="Status de conexão com Redis: 'connected' ou erro.",
        examples=["connected"],
    )
    cassandra: str | None = Field(
        default=None,
        description="Status de conexão com Cassandra: 'connected' ou erro.",
        examples=["connected"],
    )
    error: str | None = Field(
        default=None,
        description="Mensagem de erro detalhada (apenas em caso de falha).",
        examples=["Connection refused"],
    )


class ContainerHealthInfo(BaseModel):
    """Informações básicas de saúde de um container."""

    service: str
    type: str
    host: str
    port: int
    status: str
    latency_ms: float | None = None
    http_status: int | None = None
    version: str | None = None
    error: str | None = None
    details: dict[str, str | int | None] | None = None


class ContainersHealthSummary(BaseModel):
    """Resumo agregado das verificações de saúde."""

    total: int
    healthy: int
    unhealthy: int


class ContainersHealthResponse(BaseModel):
    """Resposta do endpoint de saúde dos containers."""

    status: str
    checked_at: datetime
    summary: ContainersHealthSummary
    containers: list[ContainerHealthInfo]