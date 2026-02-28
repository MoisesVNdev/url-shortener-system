"""Testes para geração e decodificação de shortcodes."""

import pytest
from unittest.mock import AsyncMock

from app.services.shortcode import generate_shortcode, decode_shortcode, COUNTER_START


@pytest.mark.asyncio
async def test_generate_shortcode_returns_string_with_min_4_chars(mock_redis):
    """Garante que generate_shortcode retorna string com mínimo 4 caracteres."""
    # Arrange
    mock_redis.incr = AsyncMock(return_value=COUNTER_START + 1)
    
    # Act
    shortcode = await generate_shortcode(mock_redis)
    
    # Assert
    assert isinstance(shortcode, str)
    assert len(shortcode) >= 4


@pytest.mark.asyncio
async def test_generate_shortcode_initializes_counter_on_first_call(mock_redis):
    """Verifica que o contador Redis é inicializado na primeira chamada."""
    # Arrange
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.incr = AsyncMock(return_value=COUNTER_START + 1)
    
    # Act
    await generate_shortcode(mock_redis)
    
    # Assert
    mock_redis.setnx.assert_called_once_with("url:counter", COUNTER_START)


@pytest.mark.asyncio
async def test_generate_shortcode_increments_counter(mock_redis):
    """Verifica que o contador Redis é incrementado."""
    # Arrange
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.incr = AsyncMock(return_value=COUNTER_START + 1)
    
    # Act
    await generate_shortcode(mock_redis)
    
    # Assert
    mock_redis.incr.assert_called_once_with("url:counter")


@pytest.mark.asyncio
async def test_generate_shortcode_produces_unique_shortcodes(mock_redis):
    """Garante que shortcodes gerados são únicos (números diferentes)."""
    # Arrange
    counter_values = [COUNTER_START + 1, COUNTER_START + 2, COUNTER_START + 3]
    mock_redis.setnx = AsyncMock(return_value=True)
    mock_redis.incr = AsyncMock(side_effect=counter_values)
    
    # Act
    shortcode1 = await generate_shortcode(mock_redis)
    shortcode2 = await generate_shortcode(mock_redis)
    shortcode3 = await generate_shortcode(mock_redis)
    
    # Assert
    assert shortcode1 != shortcode2
    assert shortcode2 != shortcode3
    assert shortcode1 != shortcode3


def test_decode_shortcode_returns_int_when_valid():
    """Valida que decode_shortcode retorna inteiro para shortcode válido."""
    # Arrange
    shortcode = "D4p5"
    
    # Act
    result = decode_shortcode(shortcode)
    
    # Assert
    assert isinstance(result, int)
    assert result > 0


def test_decode_shortcode_returns_none_when_invalid():
    """Valida que decode_shortcode retorna None para shortcode inválido."""
    # Arrange
    invalid_shortcode = "INVALID_NOT_ENCODED"
    
    # Act
    result = decode_shortcode(invalid_shortcode)
    
    # Assert
    assert result is None


def test_decode_shortcode_roundtrip():
    """Testa encode/decode roundtrip: number → shortcode → number."""
    from app.services.shortcode import hashids
    
    # Arrange
    original_number = 14_776_337
    
    # Act
    shortcode = hashids.encode(original_number)
    decoded_number = decode_shortcode(shortcode)
    
    # Assert
    assert decoded_number == original_number


@pytest.mark.asyncio
async def test_generate_shortcode_never_returns_empty_string(mock_redis):
    """Garante que o shortcode nunca é string vazia."""
    # Arrange
    for counter in range(COUNTER_START, COUNTER_START + 100):
        mock_redis.incr = AsyncMock(return_value=counter)
        
        # Act
        shortcode = await generate_shortcode(mock_redis)
        
        # Assert
        assert shortcode
        assert len(shortcode) > 0
