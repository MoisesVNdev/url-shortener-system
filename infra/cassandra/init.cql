-- Criação do keyspace com replicação simples (ambiente local/dev)
CREATE KEYSPACE IF NOT EXISTS url_shortener
WITH replication = {
    'class': 'SimpleStrategy',
    'replication_factor': 1
};

USE url_shortener;

-- Criação da tabela
CREATE TABLE IF NOT EXISTS url (
    shortcode TEXT PRIMARY KEY,
    long_url  TEXT,
    created_at TIMESTAMP
);

-- TTL padrão de 10 anos = 315.360.000 segundos
-- aplicado por linha no INSERT, não na tabela