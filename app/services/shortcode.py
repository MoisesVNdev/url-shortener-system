import logging

from hashids import Hashids

from app.core.config import settings

logger = logging.getLogger(__name__)

hashids = Hashids(
    salt=settings.HASHIDS_SALT,
    alphabet="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    min_length=4,
)

COUNTER_KEY = "url:counter"
COUNTER_START = 14_776_336  # HashIds encode: garante shortcodes de 4+ chars


async def generate_shortcode(redis) -> str:
    """
    Gera um shortcode único via contador Redis + HashIds.

    Usa Redis INCR para gerar números sequenciais únicos, depois codifica
    com HashIds para obter uma string base62 com mínimo 4 caracteres.

    Args:
        redis: Cliente Redis async.

    Returns:
        Shortcode único (ex.: 'D4p5').
    """
    # Inicializa o counter na primeira execução
    await redis.setnx(COUNTER_KEY, COUNTER_START)
    number = await redis.incr(COUNTER_KEY)
    shortcode = hashids.encode(number)
    logger.debug("Shortcode gerado: %s (número: %d)", shortcode, number)
    return shortcode


def decode_shortcode(shortcode: str) -> int | None:
    """
    Decodifica um shortcode para seu número original.

    Args:
        shortcode: Shortcode a decodificar.

    Returns:
        Número original ou None se o shortcode for inválido.
    """
    result = hashids.decode(shortcode)
    return result[0] if result else None