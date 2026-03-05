# Testes de Performance com K6

Suíte completa de testes de carga para o sistema de encurtamento de URLs.

**✅ Versão 2.0 — Refatorada com Comentários Detalhados**

Todos os arquivos de teste agora incluem comentários explicativos em português para facilitar
a compreensão do objetivo, funcionamento e métricas de cada teste.

---

## 📋 Visão Geral dos Testes

| Teste | Objetivo | Duração | Carga | Quando Executar |
|-------|----------|---------|-------|-----------------|
| **smoke_test.js** | Validação básica | 1 min | 2 VUs | Antes de qualquer teste, após deploys |
| **load_test.js** | Carga normal esperada | 1 min | 100 VUs | Validação de performance padrão |
| **stress_test.js** | Encontrar ponto de ruptura | 15 min | 50→1000 VUs | Dimensionar infra, antes de lançamentos |
| **spike_test.js** | Picos repentinos | 7 min | 10→1000→10 VUs | Testar resiliência a tráfego viral |
| **soak_test.js** | Estabilidade de longa duração | 8 horas | 50 VUs | Detectar memory leaks, antes de releases |

---

## 🚀 Como Executar

### Pré-requisitos

```bash
# Instalar k6 (Linux)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Ou via brew (macOS)
brew install k6
```

### 🎯 Execução Simplificada (Recomendado)

Use o script `run_k6.sh` para execução com 1 comando:

```bash
# Executar qualquer teste
cd tests/k6
./run_k6.sh smoke          # Teste rápido de validação
./run_k6.sh load           # Teste de carga normal
./run_k6.sh stress         # Teste de estresse
./run_k6.sh spike          # Teste de picos
./run_k6.sh soak           # Teste de resistência (8h)

# Abrir relatório HTML automaticamente após o teste
./run_k6.sh load --open-report
./run_k6.sh smoke -o

# Com variáveis de ambiente customizadas
BASE_URL=http://staging.exemplo.com ./run_k6.sh load
TEST_DURATION=30m ./run_k6.sh soak -o
```

**O script automaticamente:**
- ✅ Cria diretórios `logs/` e `results/` se não existirem
- ✅ Gera timestamp único para cada execução
- ✅ Salva logs estruturados em JSON
- ✅ Mostra onde ficaram os arquivos HTML/JSON gerados
- ✅ Abre o relatório HTML no navegador (com `--open-report`)

### 🔄 Execução Sequencial de Todos os Testes

Use o script `run_all_tests.sh` para executar **smoke, load, stress e spike** em sequência:

```bash
cd tests/k6

# Executar todos os testes (exceto soak) em sequência
./run_all_tests.sh

# Executar e abrir todos os relatórios HTML
./run_all_tests.sh --open-reports
./run_all_tests.sh -o

# Com URL customizada
BASE_URL=http://staging.exemplo.com ./run_all_tests.sh
```

**Características:**
- ⏱️ **Duração total:** ~24 minutos (sem soak)
- 🔄 **Ordem de execução:** smoke → load → stress → spike
- ⏸️ **Pausa de 15s entre testes** para estabilização do sistema
- 📊 **Resumo final** com taxa de sucesso/falha
- ✅ **Continua mesmo se um teste falhar**
- 🚫 **Não inclui soak_test** (8h) — execute manualmente se necessário

**Por que não incluir soak_test?**
- Dura **8 horas** (muito longo para execução em batch)
- Deve ser executado isoladamente, preferencialmente overnight
- Requer monitoramento dedicado para detectar memory leaks

**Para executar soak_test individualmente:**
```bash
./run_k6.sh soak  # ⚠️ Reservar 8 horas
```

### 📊 Como Acessar o `summary.html`

Após executar um teste, o relatório HTML fica em:

```
results/<nome_teste>-summary-<timestamp>.html
```

**Opção 1: Abrir automaticamente**
```bash
./run_k6.sh load --open-report
```

**Opção 2: Abrir manualmente**
```bash
# Linux
xdg-open results/load_test-summary-20260228-143000.html

# macOS
open results/load_test-summary-20260228-143000.html

# Windows (WSL)
explorer.exe results/load_test-summary-20260228-143000.html
```

**Opção 3: Via navegador**
- Navegue até a pasta do projeto
- Abra a pasta `tests/k6/results/`
- Clique duas vezes no arquivo `.html`

**Exemplo de localização completa:**
```
/home/moisesvn/Documentos/Estudo/Portfolio/Encurtador de URL/url-shortener-system/tests/k6/results/load_test-summary-20260228-143530.html
```

### Comandos Básicos (Sem o Script)

```bash
# Executar teste padrão (localhost)
k6 run tests/k6/smoke_test.js

# Executar com variáveis de ambiente customizadas
k6 run -e BASE_URL=https://staging.exemplo.com tests/k6/load_test.js

# Executar com output em JSON para análise posterior
k6 run --out json=results.json tests/k6/stress_test.js

# Executar com dashboard web (experimental)
k6 run --out web-dashboard tests/k6/load_test.js
```

### Logs Persistidos (Recomendado)

```bash
# Salvar logs estruturados em JSON
k6 run tests/k6/load_test.js \
  --log-output=file=logs/load-test.log \
  --log-format=json

# Salvar métricas completas para comparação histórica
k6 run tests/k6/load_test.js \
  --out json=results/load-test-$(date +%Y%m%d-%H%M%S).json
```

### Relatórios HTML e JSON via `handleSummary`

Todos os scripts em `tests/k6/` já exportam automaticamente:

- `results/<nome_teste>-summary-<timestamp>.html`
- `results/<nome_teste>-summary-<timestamp>.json`

Você pode customizar o diretório de saída:

```bash
k6 run tests/k6/load_test.js -e RESULTS_DIR=artifacts/k6
```

Você também pode fixar um timestamp para facilitar comparação entre arquivos da mesma execução:

```bash
k6 run tests/k6/load_test.js -e RUN_TIMESTAMP=20260228-220000
```

---

## 📊 Smoke Test

**Arquivo:** `smoke_test.js`

### Objetivo
Validação rápida de funcionalidade básica com carga mínima. Garante que não há bugs óbvios antes de testes mais pesados.

### Características
- **Carga:** 2 VUs
- **Duração:** 1 minuto
- **Operações:** Criação + redirecionamento de URLs

### Quando Executar
- ✅ Antes de qualquer teste de carga
- ✅ Após cada deploy em produção/staging
- ✅ No pipeline de CI/CD como validação básica
- ✅ Após mudanças em código crítico

### Exemplo de Uso

```bash
k6 run tests/k6/smoke_test.js
```

### Thresholds
- Taxa de erro < 1%
- P95 de latência < 1s

---

## ⚡ Load Test

**Arquivo:** `load_test.js` (refatorado)

### Objetivo
Simular carga normal de operação com ratio realista de 10:1 (leitura:escrita).

### Características
- **Carga:** 10 req/s escrita + 90 req/s leitura
- **Duração:** 1 minuto (configurável)
- **Setup:** Cria 50 URLs de seed antes de começar
- **Melhorias implementadas:**
  - ✅ Setup com pool inicial de dados para leitura desde o primeiro segundo
  - ✅ Parametrização via variáveis de ambiente
  - ✅ Tags para métricas granulares
  - ✅ Tratamento de erros detalhado (timeout, 5xx, etc)
  - ✅ Função teardown() para limpeza
  - ✅ `handleSummary` para gerar `summary.html` e `summary.json`

### Quando Executar
- ✅ Validação de performance após otimizações
- ✅ Antes de releases
- ✅ Comparação entre versões

### Exemplo de Uso

```bash
# Padrão
k6 run tests/k6/load_test.js

# Com parametrização
k6 run \
  -e BASE_URL=http://localhost:80 \
  -e SEED_COUNT=100 \
  -e WRITE_RATE=20 \
  -e READ_RATE=180 \
  -e TEST_DURATION=5m \
  tests/k6/load_test.js
```

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `BASE_URL` | http://localhost:80 | URL base do sistema |
| `SEED_COUNT` | 50 | Número de URLs criadas no setup |
| `WRITE_RATE` | 10 | Requisições/s de escrita |
| `READ_RATE` | 90 | Requisições/s de leitura |
| `TEST_DURATION` | 60s | Duração do teste |

### Thresholds
- P95 escrita < 500ms
- P95 leitura < 100ms
- Taxa de erro total < 1%

---

## 💪 Stress Test

**Arquivo:** `stress_test.js`

### Objetivo
Encontrar o ponto de ruptura do sistema aumentando carga progressivamente até falhar.

### Características
- **Carga:** Aumenta de 50 → 1000 VUs em estágios
- **Duração:** 15 minutos
- **Estágios:**
  1. 50 VUs (2 min) - Aquecimento
  2. 100 VUs (2 min) - Carga normal
  3. 300 VUs (3 min) - Aumentando pressão
  4. 600 VUs (3 min) - Pressão alta
  5. 1000 VUs (3 min) - Ponto de ruptura esperado
  6. 0 VUs (2 min) - Recuperação

### Quando Executar
- ✅ Para dimensionar infraestrutura (quantos servidores?)
- ✅ Antes de eventos com tráfego esperado alto
- ✅ Validar melhorias de escalabilidade
- ✅ Descobrir gargalos (CPU, memória, banco de dados)

### Exemplo de Uso

```bash
k6 run tests/k6/stress_test.js

# Com seed maior para testes mais longos
k6 run -e SEED_COUNT=500 tests/k6/stress_test.js
```

### O Que Observar
- ⚠️ Em que estágio o sistema começa a falhar?
- ⚠️ Como é a recuperação após reduzir carga?
- ⚠️ Taxa de erro cresce linearmente ou exponencialmente?
- ⚠️ Uso de CPU/memória/conexões de banco

### Thresholds
- P95 de latência < 2s (alerta de degradação)
- Taxa de erro < 10% (aceitável em stress test)

---

## 📈 Spike Test

**Arquivo:** `spike_test.js`

### Objetivo
Verificar resiliência do sistema a picos repentinos e extremos de tráfego (ex.: link viral).

### Características
- **Carga:** 10 VUs → 1000 VUs → 10 VUs
- **Duração:** 7 minutos
- **Padrão de acesso:** 80% das requisições em 5 URLs "virais"
- **Estágios:**
  1. 10 VUs (1 min) - Tráfego normal
  2. 1000 VUs (10s) - **SPIKE BRUTAL**
  3. 1000 VUs (3 min) - Mantém pressão
  4. 10 VUs (10s) - Queda brusca
  5. 10 VUs (2 min) - Recuperação

### Quando Executar
- ✅ Antes de campanhas de marketing viral
- ✅ Testar auto-scaling e elasticidade
- ✅ Validar circuit breakers e rate limiters
- ✅ Simular link compartilhado em rede social

### Exemplo de Uso

```bash
k6 run tests/k6/spike_test.js
```

### O Que Observar
- ⚠️ Sistema sobrevive sem downtime total?
- ⚠️ Latência durante o spike (degradação aceitável?)
- ⚠️ Sistema se recupera após o spike?
- ⚠️ Taxa de erro volta ao normal na fase de recuperação?

### Thresholds
- P99 < 5s mesmo no spike
- Taxa de erro no spike < 30%
- Taxa de erro na recuperação < 5%

---

## ⏱️ Soak Test (Endurance Test)

**Arquivo:** `soak_test.js`

### Objetivo
Detectar problemas que aparecem apenas após execução prolongada (memory leaks, degradação gradual).

### Características
- **Carga:** 50 VUs constantes
- **Duração:** 8 horas (padrão)
- **Foco:** Estabilidade de longa duração

### Problemas Detectados
- 🔍 Memory leaks (vazamento de memória)
- 🔍 Conexões não fechadas com banco de dados
- 🔍 Fragmentação de memória
- 🔍 Logs crescendo descontroladamente
- 🔍 Degradação gradual de performance
- 🔍 Problemas de garbage collection

### Quando Executar
- ✅ Antes de releases importantes
- ✅ Após mudanças em gerenciamento de recursos
- ✅ Periodicamente em staging (quinzenal/mensal)
- ✅ Testes noturnos automatizados

### Exemplo de Uso

```bash
# Teste padrão de 8 horas
k6 run tests/k6/soak_test.js

# Teste mais curto (4 horas)
k6 run -e TEST_DURATION=4h tests/k6/soak_test.js

# Teste overnight (12 horas)
k6 run -e TEST_DURATION=12h -e VUS=30 tests/k6/soak_test.js
```

### Variáveis de Ambiente

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `TEST_DURATION` | 8h | Duração do teste |
| `VUS` | 50 | Número de VUs simultâneos |
| `SEED_COUNT` | 500 | URLs criadas no setup |

### Como Analisar
1. Compare métricas da **primeira hora vs última hora**
2. Latência deve se manter **estável** ao longo do tempo
3. Taxa de erro **não deve aumentar** progressivamente
4. Monitore **uso de memória/CPU/conexões** durante todo o teste

### Thresholds
- P95 < 500ms (deve se manter estável por horas)
- Taxa de erro < 1% consistente

---

## 🔧 Variáveis de Ambiente Comuns

Todas as variáveis suportadas em todos os testes:

```bash
# URL base do sistema
BASE_URL=http://localhost:80

# Número de URLs criadas no setup (exceto smoke)
SEED_COUNT=50

# Duração do teste (load, soak)
TEST_DURATION=60s

# Taxa de escrita/leitura (load test)
WRITE_RATE=10
READ_RATE=90

# Número de VUs (soak test)
VUS=50
```

---

## 📈 Analisando Resultados

### Métricas Principais

- **http_req_duration:** Latência das requisições
- **http_req_failed:** Requisições que falharam
- **errors:** Taxa de erro customizada
- **create_errors / redirect_errors:** Erros por tipo de operação
- **timeout_errors / server_errors:** Erros por categoria

### Outputs Disponíveis

```bash
# Console (padrão)
k6 run tests/k6/load_test.js

# JSON (para análise programática)
k6 run --out json=results.json tests/k6/load_test.js

# InfluxDB (para grafana)
k6 run --out influxdb=http://localhost:8086/k6 tests/k6/load_test.js

# Cloud (k6 Cloud)
k6 cloud tests/k6/load_test.js

# Logs em arquivo + resumo HTML/JSON por handleSummary
k6 run tests/k6/load_test.js --log-output=file=logs/load-test.log --log-format=json
```

---

## 🎯 Estratégia de Testes Recomendada

### Fluxo de Validação

1. **Smoke Test** → Garante funcionalidade básica
2. **Load Test** → Valida performance em carga normal

---

## 📚 Estrutura do Código

### Arquitetura Modular

```
tests/k6/
├── smoke_test.js       # Validação básica
├── load_test.js        # Carga normal com ratio 10:1
├── stress_test.js      # Encontrar ponto de ruptura
├── spike_test.js       # Picos repentinos de tráfego
├── soak_test.js        # Estabilidade de longa duração
├── run_k6.sh           # Script wrapper de execução
└── lib/                # Biblioteca compartilhada
    ├── common.js       # Geração de URLs e seeds
    ├── metrics.js      # Factory de métricas (não usado atualmente)
    ├── phase-detector.js # Detecção de fase do spike test
    └── reporting.js    # Geração de relatórios HTML/JSON
```

### Comentários Explicativos

**Todos os arquivos agora incluem:**
- ✅ Cabeçalhos JSDoc explicando objetivo e características
- ✅ Comentários inline explicando lógica complexa
- ✅ Documentação de variáveis de ambiente
- ✅ Exemplos de uso e quando executar
- ✅ Thresholds e métricas explicados

**Benefícios:**
- Facilita onboarding de novos desenvolvedores
- Reduz tempo de compreensão do código
- Melhora manutenibilidade

---

## 🔧 Correções Críticas Implementadas (v2.0)

### 1. Imports Corrigidos
**Problema:** Todos os testes importavam `./reporting.js` (caminho incorreto).  
**Correção:** Atualizado para `./lib/reporting.js` em todos os arquivos.

### 2. Spike Test Corrigido
**Problema:** Importava função inexistente `getCurrentPhase`.  
**Correção:** 
- Função correta é `getPhase` de `./lib/phase-detector.js`
- Agora calcula `elapsed` corretamente antes de chamar a função

### 3. Comentários Completos
**Adicionados:** Comentários explicativos em português em todos os testes e bibliotecas.

---

## 💡 Boas Práticas

### Como Interpretar os Relatórios

Após executar um teste, o relatório HTML mostra:

1. **Overview:**
   - Requisições totais
   - Taxa de erro
   - Throughput (req/s)

2. **Métricas HTTP:**
   - `http_req_duration`: Latência das requisições
     - **P95 < 500ms (escrita)**: Excelente
     - **P95 < 100ms (leitura)**: Excelente
   - `http_req_failed`: Taxa de falha HTTP
     - **< 1%**: Aceitável
     - **> 5%**: Problema crítico

3. **Checks:**
   - `create: status 201`: Sucesso na criação
   - `redirect: status 302`: Sucesso no redirecionamento
   - `Location matches original URL`: Validação de integridade

4. **Métricas Customizadas:**
   - `errors`: Taxa de erro geral
   - `create_errors`: Erros específicos de criação
   - `redirect_errors`: Erros específicos de redirecionamento

### Comparação Entre Execuções

Para comparar performance entre versões:

```bash
# Executar teste base (versão antiga)
./run_k6.sh load

# Fazer mudanças no código

# Executar teste comparativo (versão nova)
./run_k6.sh load

# Comparar os arquivos JSON em results/
# Métricas-chave para comparar:
#   - http_req_duration (p95, p99)
#   - errors (rate)
#   - http_req_failed (rate)
```

### Quando Considerar o Teste Bem-Sucedido?

| Teste | Sucesso Se: |
|-------|-------------|
| **Smoke** | Taxa de erro < 1% + P95 < 1s |
| **Load** | P95 escrita < 500ms + P95 leitura < 100ms + erro < 1% |
| **Stress** | Sistema sobrevive até 600+ VUs sem colapso total |
| **Spike** | Taxa de erro no spike < 30% + recuperação < 5% |
| **Soak** | Latência estável por 8h + erro consistente < 1% |

---

## ⚠️ Troubleshooting

### Problema: "Module not found: ./reporting.js"
**Causa:** Versão antiga do código (antes da v2.0).  
**Solução:** Pull das últimas alterações ou corrigir import para `./lib/reporting.js`.

### Problema: "getCurrentPhase is not a function"
**Causa:** Spike test com import incorreto.  
**Solução:** Usar `getPhase` e calcular `elapsed` corretamente.

### Problema: Taxa de erro alta (> 10%)
**Causas possíveis:**
- Sistema não está rodando (verificar `docker compose ps`)
- Health check falhou (verificar logs com `docker compose logs`)
- Carga muito alta para infraestrutura atual
- Rate limiting ativado no Nginx

**Solução:**
```bash
# Verificar se sistema está UP
docker compose ps

# Verificar logs
docker compose logs app

# Testar endpoint manualmente
curl http://localhost/health

# Se necessário, reduzir carga do teste
k6 run -e WRITE_RATE=5 -e READ_RATE=45 tests/k6/load_test.js
```

### Problema: Soak test falha após várias horas
**Causas possíveis:**
- Memory leak no código Python
- Conexões do Cassandra não fechadas
- Pool Redis esgotado

**Solução:**
```bash
# Durante o teste, monitorar recursos
docker stats

# Verificar conexões abertas
docker exec url-shortener-cassandra nodetool info | grep "Native Connections"

# Verificar memória do Redis
docker exec url-shortener-redis redis-cli INFO memory
```

---

## 🎯 Estratégia de Testes Recomendada

### Fluxo de Validação

1. **Smoke Test** → Garante funcionalidade básica
2. **Load Test** → Valida performance em carga normal
3. **Stress Test** → Descobre limites e gargalos
4. **Spike Test** → Testa resiliência a picos
5. **Soak Test** → Valida estabilidade de longa duração

### Integração com CI/CD

```yaml
# Exemplo de pipeline
- smoke_test (sempre)
- load_test (em PRs)
- stress_test (antes de releases)
- spike_test (antes de eventos)
- soak_test (noturno, semanal)
```

Exemplo de upload dos artefatos gerados (`results/*.html`, `results/*.json`, `logs/*.log`):

```yaml
- name: Run k6 tests
  run: k6 run tests/k6/load_test.js --log-output=file=logs/load-test.log --log-format=json

- name: Upload k6 artifacts
  uses: actions/upload-artifact@v4
  with:
    name: k6-artifacts
    path: |
      results/*.html
      results/*.json
      logs/*.log
```

### Antes de Produção

✅ **Obrigatórios:**
- Smoke test passou
- Load test com latências aceitáveis
- Taxa de erro < 1%

⚠️ **Recomendados:**
- Stress test identificou capacidade máxima
- Spike test validou auto-scaling
- Soak test rodou por pelo menos 4h sem degradação

---

## 🛠️ Troubleshooting

### "connection refused"
→ Sistema não está rodando. Execute `docker-compose up -d`

### "too many open files"
→ Aumente limites do sistema: `ulimit -n 10000`

### Métricas muito ruins
→ Execute smoke test primeiro para validar funcionalidade
→ Verifique logs dos containers: `docker-compose logs -f`

### Soak test interrompido
→ Use `screen` ou `tmux` para sessões longas
→ Ou execute em container dedicado

---

## 📚 Referências

- [Documentação oficial k6](https://k6.io/docs/)
- [Tipos de testes de performance](https://k6.io/docs/test-types/introduction/)
- [Métricas do k6](https://k6.io/docs/using-k6/metrics/)
- [Thresholds](https://k6.io/docs/using-k6/thresholds/)
