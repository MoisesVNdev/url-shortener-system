from pydantic import AnyHttpUrl, BaseModel, ConfigDict


class ShortenRequest(BaseModel):
    """Schema de entrada para encurtamento de URL."""

    model_config = ConfigDict(str_strip_whitespace=True)
    url: AnyHttpUrl


class ShortenResponse(BaseModel):
    """Schema de resposta com a URL encurtada."""

    short_url: str
