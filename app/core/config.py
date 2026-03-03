from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configurações da aplicação carregadas via variáveis de ambiente."""

    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    BASE_URL: str = "http://localhost"

    CASSANDRA_HOST: str = "cassandra"
    CASSANDRA_PORT: int = 9042
    CASSANDRA_KEYSPACE: str = "url_shortener"
    CASSANDRA_DC: str = "datacenter1"
    CASSANDRA_USER: str = ""
    CASSANDRA_PASSWORD: str = ""

    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379

    # No Docker Compose, o DNS padrão das réplicas é o nome do serviço (`web`).
    WEB1_HOST: str = "web"
    WEB2_HOST: str = "web"
    WEB_APP_PORT: int = 8000
    WEB_HEALTH_PATH: str = "/health"
    NGINX_HOST: str = "nginx"
    NGINX_PORT: int = 80
    NGINX_HEALTH_PATH: str = "/health"

    HASHIDS_SALT: str = ""
    CACHE_TTL: int = 86400

    model_config = {"env_file": ".env"}


settings = Settings()
