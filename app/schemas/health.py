from datetime import datetime

from pydantic import BaseModel


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