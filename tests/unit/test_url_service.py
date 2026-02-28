"""Testes para o serviço de URLs (criar e recuperar)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.url_service import create_short_url, get_long_url


@pytest.mark.asyncio
async def test_create_short_url_returns_string():
    """Garante que create_short_url retorna um shortcode (string)."""
    # Arrange
    test_url = "https://example.com/pagina-muito-longa"
    
    mock_redis = AsyncMock()
    mock_redis.incr = AsyncMock(return_value=14_776_337)
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.set = AsyncMock(return_value=True)
    
    mock_session = MagicMock()
    mock_session.execute = MagicMock()
    mock_session.insert_stmt = MagicMock()
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.set_url_in_cache", new_callable=AsyncMock):
        
        # Act
        shortcode = await create_short_url(test_url)
        
        # Assert
        assert isinstance(shortcode, str)
        assert len(shortcode) >= 4


@pytest.mark.asyncio
async def test_create_short_url_calls_cassandra_insert():
    """Verifica que create_short_url insere no Cassandra."""
    # Arrange
    test_url = "https://example.com/pagina-muito-longa"
    
    mock_redis = AsyncMock()
    mock_redis.incr = AsyncMock(return_value=14_776_337)
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.set = AsyncMock(return_value=True)
    
    mock_session = MagicMock()
    mock_session.execute = MagicMock()
    mock_session.insert_stmt = MagicMock()
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.set_url_in_cache", new_callable=AsyncMock):
        
        # Act
        await create_short_url(test_url)
        
        # Assert
        mock_session.execute.assert_called_once()


@pytest.mark.asyncio
async def test_create_short_url_calls_cache_set():
    """Verifica que create_short_url escreve no cache Redis."""
    # Arrange
    test_url = "https://example.com/pagina-muito-longa"
    
    mock_redis = AsyncMock()
    mock_redis.incr = AsyncMock(return_value=14_776_337)
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.set = AsyncMock(return_value=True)
    
    mock_session = MagicMock()
    mock_session.execute = MagicMock()
    mock_session.insert_stmt = MagicMock()
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.set_url_in_cache", new_callable=AsyncMock) as mock_cache:
        
        # Act
        await create_short_url(test_url)
        
        # Assert
        mock_cache.assert_called_once()


@pytest.mark.asyncio
async def test_get_long_url_cache_hit():
    """Testa que get_long_url retorna URL do cache quando ela existe."""
    # Arrange
    shortcode = "D4p5"
    expected_url = "https://example.com/pagina-muito-longa"
    
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value=expected_url)
    
    mock_session = MagicMock()
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_long_url_from_cache", new_callable=AsyncMock, return_value=expected_url):
        
        # Act
        result = await get_long_url(shortcode)
        
        # Assert
        assert result == expected_url


@pytest.mark.asyncio
async def test_get_long_url_cache_miss_hits_cassandra():
    """Testa que get_long_url busca no Cassandra quando cache falha."""
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
    mock_redis.set = AsyncMock(return_value=True)
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_long_url_from_cache", new_callable=AsyncMock, return_value=None), \
         patch("app.services.url_service.set_url_in_cache", new_callable=AsyncMock):
        
        # Act
        result = await get_long_url(shortcode)
        
        # Assert
        assert result == expected_url


@pytest.mark.asyncio
async def test_get_long_url_returns_none_when_not_found():
    """Testa que get_long_url retorna None quando shortcode não existe."""
    # Arrange
    shortcode = "XXXX"
    
    mock_session = MagicMock()
    mock_result_set = MagicMock()
    mock_result_set.one = MagicMock(return_value=None)
    mock_session.execute = MagicMock(return_value=mock_result_set)
    mock_session.select_stmt = MagicMock()
    
    mock_redis = AsyncMock()
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_long_url_from_cache", new_callable=AsyncMock, return_value=None):
        
        # Act
        result = await get_long_url(shortcode)
        
        # Assert
        assert result is None


@pytest.mark.asyncio
async def test_get_long_url_caches_after_cassandra_hit():
    """Verifica que get_long_url escreve URL no cache após hit no Cassandra."""
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
    mock_redis.set = AsyncMock(return_value=True)
    
    with patch("app.services.url_service.get_redis", return_value=mock_redis), \
         patch("app.services.url_service.get_session", return_value=mock_session), \
         patch("app.services.url_service.get_long_url_from_cache", new_callable=AsyncMock, return_value=None), \
         patch("app.services.url_service.set_url_in_cache", new_callable=AsyncMock) as mock_cache:
        
        # Act
        await get_long_url(shortcode)
        
        # Assert
        mock_cache.assert_called_once()
