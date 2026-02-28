"""Testes para os endpoints da API."""

import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock, patch

from app.main import app


@pytest.fixture
def client():
    """Cliente de teste para a API FastAPI."""
    return TestClient(app)


def test_health_endpoint(client):
    """Testa que o endpoint /health retorna status ok."""
    # Act
    response = client.get("/health")
    
    # Assert
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_shorten_endpoint_returns_201():
    """Testa que POST /api/v1/shorten retorna 201."""
    # Arrange
    payload = {"url": "https://example.com/pagina-muito-longa"}
    
    mock_redis = AsyncMock()
    mock_redis.incr = AsyncMock(return_value=14_776_337)
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.set = AsyncMock(return_value=True)
    
    mock_session = MagicMock()
    mock_session.execute = MagicMock()
    mock_session.insert_stmt = MagicMock()
    
    with patch("app.api.v1.endpoints.shorten.get_redis", return_value=mock_redis), \
         patch("app.api.v1.endpoints.shorten.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.set_url_in_cache", new_callable=AsyncMock):
        
        client = TestClient(app)
        
        # Act
        response = client.post("/api/v1/shorten", json=payload)
        
        # Assert
        assert response.status_code == 201
        assert "short_url" in response.json()


@pytest.mark.asyncio
async def test_shorten_endpoint_invalid_url_returns_422():
    """Testa que POST /api/v1/shorten com URL inválida retorna 422."""
    # Arrange
    payload = {"url": "not-a-valid-url"}
    
    client = TestClient(app)
    
    # Act
    response = client.post("/api/v1/shorten", json=payload)
    
    # Assert
    assert response.status_code == 422  # Validation error


@pytest.mark.asyncio
async def test_redirect_endpoint_returns_302():
    """Testa que GET /{shortcode} retorna 302 quando URL existe."""
    # Arrange
    shortcode = "D4p5"
    expected_url = "https://example.com/pagina-muito-longa"
    
    mock_session = MagicMock()
    mock_row = MagicMock()
    mock_row.long_url = expected_url
    
    mock_result_set = MagicMock()
    mock_result_set.one = MagicMock(return_value=mock_row)
    mock_session.execute = MagicMock(return_value=mock_result_set)
    mock_session.select_stmt = MagicMock()
    
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=expected_url)
    mock_redis.set = AsyncMock(return_value=True)
    
    with patch("app.api.v1.endpoints.redirect.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_long_url_from_cache", new_callable=AsyncMock, return_value=expected_url):
        
        client = TestClient(app)
        
        # Act
        response = client.get(f"/{shortcode}", follow_redirects=False)
        
        # Assert
        assert response.status_code == 302
        assert response.headers["location"] == expected_url


@pytest.mark.asyncio
async def test_redirect_endpoint_returns_404_when_not_found():
    """Testa que GET /{shortcode} retorna 404 quando URL não existe."""
    # Arrange
    shortcode = "XXXX"
    
    mock_session = MagicMock()
    mock_result_set = MagicMock()
    mock_result_set.one = MagicMock(return_value=None)
    mock_session.execute = MagicMock(return_value=mock_result_set)
    mock_session.select_stmt = MagicMock()
    
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=None)
    
    with patch("app.api.v1.endpoints.redirect.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_long_url_from_cache", new_callable=AsyncMock, return_value=None):
        
        client = TestClient(app)
        
        # Act
        response = client.get(f"/{shortcode}")
        
        # Assert
        assert response.status_code == 404
