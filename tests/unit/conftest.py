"""Fixtures compartilhadas para testes unitários."""

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def mock_redis():
    """Mock do cliente Redis com métodos async."""
    redis = AsyncMock()
    redis.get = AsyncMock(return_value=None)
    redis.set = AsyncMock(return_value=True)
    redis.incr = AsyncMock(return_value=14_776_337)
    redis.setnx = AsyncMock(return_value=True)
    redis.delete = AsyncMock(return_value=1)
    return redis


@pytest.fixture
def mock_cassandra_session():
    """Mock da sessão do Cassandra com prepared statements."""
    session = MagicMock()
    
    # Simula ResultSet com .one() method
    mock_row = MagicMock()
    mock_row.long_url = "https://example.com/pagina-muito-longa"
    
    mock_result_set = MagicMock()
    mock_result_set.one = MagicMock(return_value=mock_row)
    
    session.execute = MagicMock(return_value=mock_result_set)
    session.insert_stmt = MagicMock()
    session.select_stmt = MagicMock()
    return session


@pytest.fixture
def mock_cassandra_wrapper():
    """Mock do wrapper CassandraSession com dataclass."""
    from dataclasses import dataclass
    
    @dataclass
    class MockCassandraSession:
        session: MagicMock
        insert_stmt: MagicMock
        select_stmt: MagicMock
        
        def execute(self, stmt, values):  # noqa: ARG002
            mock_row = MagicMock()
            mock_row.long_url = "https://example.com/pagina-muito-longa"
            
            mock_result_set = MagicMock()
            mock_result_set.one = MagicMock(return_value=mock_row)
            
            return mock_result_set
    
    session = MagicMock()
    insert_stmt = MagicMock()
    select_stmt = MagicMock()
    
    return MockCassandraSession(
        session=session,
        insert_stmt=insert_stmt,
        select_stmt=select_stmt
    )


@pytest.fixture
def anyio_backend():
    """Configura pytest-asyncio para usar asyncio como backend."""
    return "asyncio"
