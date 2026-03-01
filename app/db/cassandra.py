import logging
from dataclasses import dataclass
from typing import Any

from cassandra.auth import PlainTextAuthProvider
from cassandra.cluster import Cluster, PreparedStatement, Session
from cassandra.policies import DCAwareRoundRobinPolicy

from app.core.config import settings

logger = logging.getLogger(__name__)

_cluster = None
_session = None


@dataclass
class CassandraSession:
    """Wrapper seguro para session do Cassandra com prepared statements."""

    session: Session
    insert_stmt: PreparedStatement
    select_stmt: PreparedStatement

    def execute(self, stmt: PreparedStatement, values: list) -> Any:
        """Executa um prepared statement."""
        return self.session.execute(stmt, values)


def get_session() -> CassandraSession:
    """
    Obtém a conexão global com Cassandra.

    Inicializa na primeira chamada e retorna cached nas chamadas subsequentes.

    Returns:
        CassandraSession: Wrapper com session e prepared statements.

    Raises:
        Exception: Se a conexão falhar.
    """
    global _cluster, _session
    if _session is None:
        auth = (
            PlainTextAuthProvider(settings.CASSANDRA_USER, settings.CASSANDRA_PASSWORD)
            if settings.CASSANDRA_USER
            else None
        )

        try:
            _cluster = Cluster(
                contact_points=[settings.CASSANDRA_HOST],
                port=settings.CASSANDRA_PORT,
                load_balancing_policy=DCAwareRoundRobinPolicy(
                    local_dc=settings.CASSANDRA_DC
                ),
                auth_provider=auth,
                protocol_version=5,
            )
            session = _cluster.connect()
            logger.info("Conexão com Cassandra estabelecida.")

            # Inicializa o keyspace e tabela
            _initialize_schema(session)

            # Muda para o keyspace
            session.set_keyspace(settings.CASSANDRA_KEYSPACE)
            logger.info("Keyspace %s selecionado.", settings.CASSANDRA_KEYSPACE)

            # Prepared statements (compiladas uma vez, reutilizadas)
            insert_stmt = session.prepare(
                "INSERT INTO url (shortcode, long_url, created_at) "
                "VALUES (?, ?, toTimestamp(now())) USING TTL 315360000"
            )
            select_stmt = session.prepare(
                "SELECT long_url FROM url WHERE shortcode = ?"
            )

            _session = CassandraSession(
                session=session, insert_stmt=insert_stmt, select_stmt=select_stmt
            )
            logger.info("Prepared statements compilados com sucesso.")

        except Exception as exc:
            logger.error(
                "Falha ao conectar/inicializar Cassandra: %s", str(exc), exc_info=True
            )
            raise

    return _session


def _initialize_schema(session: Session) -> None:
    """
    Inicializa o keyspace e a tabela do Cassandra.

    Cria o keyspace com replicação simples (desenvolvimento) se não existir.
    Cria a tabela de URLs com TTL de 10 anos.

    Args:
        session: Objeto de sessão do Cassandra (sem keyspace definido).
    """
    try:
        # Cria o keyspace
        create_keyspace_cql = f"""
            CREATE KEYSPACE IF NOT EXISTS {settings.CASSANDRA_KEYSPACE}
            WITH replication = {{'class': 'SimpleStrategy', 'replication_factor': 1}}
            AND durable_writes = true
        """
        session.execute(create_keyspace_cql)
        logger.info("Keyspace %s criado ou já existe.", settings.CASSANDRA_KEYSPACE)

        # Muda para o keyspace
        session.set_keyspace(settings.CASSANDRA_KEYSPACE)

        # Cria a tabela
        create_table_cql = """
            CREATE TABLE IF NOT EXISTS url (
                shortcode TEXT PRIMARY KEY,
                long_url TEXT,
                created_at TIMESTAMP
            )
        """
        session.execute(create_table_cql)
        logger.info("Tabela 'url' criada ou já existe.")

    except Exception as exc:
        logger.error("Falha ao inicializar schema: %s", str(exc), exc_info=True)
        raise
