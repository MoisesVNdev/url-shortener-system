#!/bin/bash
#
# Script para execução sequencial de todos os testes K6 (exceto soak)
#
# Uso:
#   ./run_all_tests.sh [--open-reports|-o]
#
# Exemplos:
#   ./run_all_tests.sh           # Executa todos os testes
#   ./run_all_tests.sh -o        # Executa e abre os relatórios HTML
#   BASE_URL=http://staging.com ./run_all_tests.sh  # Com URL customizada
#
# Testes executados (em ordem):
#   1. smoke  (1 min)   - Validação básica
#   2. load   (1 min)   - Carga normal 10:1 read/write
#   3. stress (15 min)  - Ponto de ruptura
#   4. spike  (7 min)   - Picos repentinos
#
# ⚠️  soak_test (8h) não está incluído — execute manualmente se necessário
#

set -e  # Aborta em caso de erro crítico (mas continua se teste individual falhar)

# ========== CONFIGURAÇÃO ==========
BASE_DIR="$(dirname "$0")"
OPEN_REPORTS=${1:-""}

# Testes a serem executados (ordem de complexidade crescente)
TESTS=("smoke" "load" "stress" "spike")

# Tempo de pausa entre testes (segundos)
PAUSE_BETWEEN_TESTS=15

# ========== VALIDAÇÃO DE SISTEMA ==========
BASE_URL=${BASE_URL:-http://localhost:80}

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  K6 Test Suite — Execução Sequencial                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "🎯 Target: ${BASE_URL}"
echo "📦 Testes: ${TESTS[@]}"
echo "⏱️  Duração estimada: ~24 minutos (sem soak)"
echo ""

# Verifica se o sistema está disponível
echo "🔍 Verificando disponibilidade do sistema..."

if command -v curl > /dev/null 2>&1; then
  if curl -sf -m 5 "${BASE_URL}/health" > /dev/null 2>&1; then
    echo "✅ Sistema está UP e saudável"
  else
    echo "❌ Erro: Health check falhou em ${BASE_URL}/health"
    echo "   Certifique-se de que a stack está rodando:"
    echo "   docker compose up -d"
    exit 1
  fi
else
  echo "⚠️  curl não encontrado, pulando health check"
fi

echo ""
echo "─────────────────────────────────────────────────────────────────"
echo ""

# ========== EXECUÇÃO DOS TESTES ==========
RESULTS=()
START_TIME=$(date +%s)

for i in "${!TESTS[@]}"; do
  TEST="${TESTS[$i]}"
  TEST_NUM=$((i + 1))
  TOTAL_TESTS=${#TESTS[@]}
  
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║  Teste $TEST_NUM/$TOTAL_TESTS: ${TEST^^}                                              ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  
  # Executa o teste via run_k6.sh (reutiliza a lógica existente)
  if "$BASE_DIR/run_k6.sh" "$TEST"; then
    RESULTS+=("✅ $TEST - SUCESSO")
    echo ""
    echo "✅ ${TEST^^} concluído com sucesso!"
  else
    RESULTS+=("❌ $TEST - FALHA")
    echo ""
    echo "❌ ${TEST^^} falhou, mas continuando com os próximos testes..."
  fi
  
  # Pausa entre testes (exceto após o último)
  if [ $TEST_NUM -lt $TOTAL_TESTS ]; then
    echo ""
    echo "⏸️  Aguardando ${PAUSE_BETWEEN_TESTS}s antes do próximo teste..."
    sleep $PAUSE_BETWEEN_TESTS
    echo ""
    echo "─────────────────────────────────────────────────────────────────"
    echo ""
  fi
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))
DURATION_MIN=$((DURATION / 60))
DURATION_SEC=$((DURATION % 60))

# ========== RESUMO FINAL ==========
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  RESUMO DA EXECUÇÃO                                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "⏱️  Duração total: ${DURATION_MIN} min ${DURATION_SEC} seg"
echo ""
echo "📊 Resultados:"
for result in "${RESULTS[@]}"; do
  echo "   $result"
done
echo ""

# Conta sucessos e falhas
SUCCESS_COUNT=$(echo "${RESULTS[@]}" | grep -o "✅" | wc -l)
FAIL_COUNT=$(echo "${RESULTS[@]}" | grep -o "❌" | wc -l)

echo "📈 Taxa de sucesso: $SUCCESS_COUNT/$TOTAL_TESTS testes passaram"
echo ""

# ========== ABERTURA DE RELATÓRIOS ==========
if [[ "$OPEN_REPORTS" == "--open-reports" || "$OPEN_REPORTS" == "-o" ]]; then
  echo "📊 Abrindo relatórios HTML..."
  echo ""
  
  RESULTS_DIR="$BASE_DIR/results"
  
  for test in "${TESTS[@]}"; do
    HTML_FILE=$(ls -t "$RESULTS_DIR/${test}_test-summary-"*.html 2>/dev/null | head -n1)
    
    if [ -n "$HTML_FILE" ]; then
      echo "   📄 Abrindo: $(basename "$HTML_FILE")"
      
      if command -v xdg-open > /dev/null 2>&1; then
        xdg-open "$HTML_FILE" 2>/dev/null &
      elif command -v open > /dev/null 2>&1; then
        open "$HTML_FILE"
      fi
      
      sleep 1  # Pequena pausa para não sobrecarregar o sistema
    fi
  done
  
  echo ""
fi

# ========== EXIT CODE ==========
if [ $FAIL_COUNT -eq 0 ]; then
  echo "✅ Todos os testes foram concluídos com SUCESSO!"
  echo ""
  echo "📂 Relatórios em: $BASE_DIR/results/"
  echo "📝 Logs em: $BASE_DIR/logs/"
  exit 0
else
  echo "⚠️  Alguns testes falharam. Verifique os relatórios e logs."
  echo ""
  echo "📂 Relatórios em: $BASE_DIR/results/"
  echo "📝 Logs em: $BASE_DIR/logs/"
  exit 1
fi
