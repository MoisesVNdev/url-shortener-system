#!/bin/bash
#
# Script wrapper para execução de testes K6
#
# Uso:
#   ./run_k6.sh <teste> [--open-report|-o]
#
# Exemplos:
#   ./run_k6.sh smoke            # Executa smoke test
#   ./run_k6.sh load -o          # Executa load test e abre relatório
#   BASE_URL=http://staging.com ./run_k6.sh stress  # Com URL customizada
#
# Testes disponíveis:
#   - smoke:  Validação básica (1 min, 2 VUs)
#   - load:   Carga normal 10:1 read/write (1 min, 100 VUs)
#   - stress: Ponto de ruptura (15 min, 50→1000 VUs)
#   - spike:  Picos repentinos (7 min, 10→1000→10 VUs)
#   - soak:   Estabilidade longa duração (8h, 50 VUs)
#

set -e  # Aborta em caso de erro

# ========== VALIDAÇÃO DE ARGUMENTOS ==========
TEST=$1
OPEN_REPORT=${2:-""}

if [ -z "$TEST" ]; then
  echo "❌ Erro: Nenhum teste especificado"
  echo ""
  echo "Uso: ./run_k6.sh <teste> [--open-report]"
  echo ""
  echo "Testes disponíveis:"
  echo "  smoke   - Validação básica (1 min)"
  echo "  load    - Carga normal (1 min)"
  echo "  stress  - Ponto de ruptura (15 min)"
  echo "  spike   - Picos repentinos (7 min)"
  echo "  soak    - Estabilidade longa duração (8h)"
  exit 1
fi

# Valida se o teste existe
VALID_TESTS=("smoke" "load" "stress" "spike" "soak")
if [[ ! " ${VALID_TESTS[@]} " =~ " ${TEST} " ]]; then
  echo "❌ Erro: Teste '$TEST' inválido"
  echo ""
  echo "Testes válidos: ${VALID_TESTS[@]}"
  exit 1
fi

# ========== CONFIGURAÇÃO DE DIRETÓRIOS ==========
# ========== CONFIGURAÇÃO DE DIRETÓRIOS ==========
BASE_DIR="$(dirname "$0")"
RESULTS_DIR="$BASE_DIR/results"
LOGS_DIR="$BASE_DIR/logs"

# Cria diretórios se não existirem
mkdir -p "$RESULTS_DIR" "$LOGS_DIR"

# ========== VALIDAÇÃO DE SISTEMA (HEALTH CHECK) ==========
BASE_URL=${BASE_URL:-http://localhost:80}

echo "🔍 Verificando se o sistema está disponível em ${BASE_URL}..."

if command -v curl > /dev/null 2>&1; then
  # Tenta acessar o health check com timeout de 5 segundos
  if curl -sf -m 5 "${BASE_URL}/health" > /dev/null 2>&1; then
    echo "✅ Sistema está UP e saudável"
  else
    echo "⚠️  Aviso: Health check falhou ou sistema não está disponível"
    echo "    Endpoint testado: ${BASE_URL}/health"
    echo "    O teste continuará, mas pode falhar se o sistema não estiver rodando"
    echo ""
    read -p "    Deseja continuar? (s/N) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Ss]$ ]]; then
      echo "❌ Teste abortado pelo usuário"
      exit 1
    fi
  fi
else
  echo "⚠️  curl não encontrado, pulando health check"
fi

echo ""

# ========== CONFIGURAÇÃO DE EXECUÇÃO ==========
TIMESTAMP=$(date +"%Y%m%d-%H%M%S")
LOG_FILE="$LOGS_DIR/${TEST}_test-${TIMESTAMP}.log"

echo "🚀 Executando ${TEST}_test.js (nível Sênior) | $(date)"
echo "📝 Logs em: $LOG_FILE"
echo ""

# ========== EXECUÇÃO DO TESTE K6 ==========

# ========== EXECUÇÃO DO TESTE K6 ==========
k6 run \
  --log-output=file=$LOG_FILE \
  --log-format=json \
  -e BASE_URL=${BASE_URL:-http://localhost:80} \
  -e RESULTS_DIR=$RESULTS_DIR \
  -e RUN_TIMESTAMP=$TIMESTAMP \
  "$BASE_DIR/${TEST}_test.js" | tee -a "$LOG_FILE"

# Captura o exit code do k6
K6_EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "─────────────────────────────────────────────────"

# ========== VERIFICAÇÃO DE RESULTADO ==========
if [ $K6_EXIT_CODE -eq 0 ]; then
  echo "✅ Teste concluído com SUCESSO!"
else
  echo "❌ Teste concluído com FALHA (exit code: $K6_EXIT_CODE)"
  echo "    Verifique os thresholds e logs para detalhes"
fi

echo "📊 Relatórios salvos em: $RESULTS_DIR"
echo "📝 Logs salvos em: $LOG_FILE"
echo ""

# ========== ABERTURA AUTOMÁTICA DE RELATÓRIO ==========

# ========== ABERTURA AUTOMÁTICA DE RELATÓRIO ==========
if [[ "$OPEN_REPORT" == "--open-report" || "$OPEN_REPORT" == "-o" ]]; then
  # Encontra o arquivo HTML mais recente do teste atual
  HTML_FILE=$(ls -t $RESULTS_DIR/${TEST}_test-summary-*.html 2>/dev/null | head -n1)
  
  if [ -n "$HTML_FILE" ]; then
    echo "📊 Abrindo relatório HTML: $HTML_FILE"
    
    # Tenta abrir com xdg-open (Linux) ou open (macOS)
    if command -v xdg-open > /dev/null 2>&1; then
      xdg-open "$HTML_FILE" 2>/dev/null &
    elif command -v open > /dev/null 2>&1; then
      open "$HTML_FILE"
    else
      echo "⚠️  Não foi possível abrir o relatório automaticamente"
      echo "    Abra manualmente: $HTML_FILE"
    fi
  else
    echo "⚠️  Arquivo HTML não encontrado em $RESULTS_DIR"
  fi
fi

# ========== LISTAGEM DE ARQUIVOS GERADOS ==========
echo "Arquivos gerados nesta execução:"
echo ""
ls -lh "$RESULTS_DIR"/*-${TIMESTAMP}.* "$LOG_FILE" 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# Retorna o exit code do k6 para pipelines CI/CD
exit $K6_EXIT_CODE