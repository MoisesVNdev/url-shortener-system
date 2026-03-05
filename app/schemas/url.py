from datetime import datetime

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field


class ShortenRequest(BaseModel):
    """Schema de entrada para encurtamento de URL."""

    model_config = ConfigDict(str_strip_whitespace=True)
    url: AnyHttpUrl = Field(
        ...,
        description="URL longa a ser encurtada. Deve ser uma URL válida (http/https).",
        examples=["https://www.example.com/very/long/url/path?param=value"],
    )


class ShortenResponse(BaseModel):
    """Schema de resposta com a URL encurtada."""

    short_url: str = Field(
        ...,
        description="URL encurtada completa em formato http(s)://host/shortcode.",
        examples=["http://localhost/Dx4p"],
    )


# --- Schemas do endpoint de debug ---


class UrlRecord(BaseModel):
    """Representa um registro da tabela url no Cassandra."""

    shortcode: str
    long_url: str
    created_at: datetime


class TopShortcode(BaseModel):
    """Shortcode com seu contador de acessos."""

    shortcode: str
    hits: int


class DebugResponse(BaseModel):
    """Resposta completa do endpoint de debug."""

    total: int
    records: list[UrlRecord]
    top_shortcodes: list[TopShortcode]
