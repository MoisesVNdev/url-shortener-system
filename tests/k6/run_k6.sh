#!/usr/bin/env bash

# Script para execução simplificada dos testes k6
# Uso: ./run_k6.sh <smoke|load|stress|spike|soak> [--open-report]

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detecta diretório raiz do projeto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Função de ajuda
show_help() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  K6 Test Runner - Sistema de Encurtamento de URLs${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Uso: ./run_k6.sh <teste> [opções]"
    echo ""
    echo "Testes disponíveis:"
    echo "  smoke   - Validação básica (2 VUs, 1 min)"
    echo "  load    - Carga normal (100 VUs, 1 min)"
    echo "  stress  - Ponto de ruptura (50→1000 VUs, 15 min)"
    echo "  spike   - Picos repentinos (10→1000→10 VUs, 7 min)"
    echo "  soak    - Estabilidade (50 VUs, 8 horas)"
    echo ""
    echo "Opções:"
    echo "  --open-report, -o    Abre o relatório HTML no navegador após o teste"
    echo "  --help, -h           Mostra esta ajuda"
    echo ""
    echo "Variáveis de ambiente opcionais:"
    echo "  BASE_URL             URL base do sistema (padrão: http://localhost:80)"
    echo "  SEED_COUNT           URLs criadas no setup (padrão: 50)"
    echo "  TEST_DURATION        Duração do teste (ex: 5m, 2h)"
    echo "  VUS                  Número de VUs (soak test)"
    echo ""
    echo "Exemplos:"
    echo "  ./run_k6.sh smoke"
    echo "  ./run_k6.sh load --open-report"
    echo "  BASE_URL=http://staging.exemplo.com ./run_k6.sh stress"
    echo "  TEST_DURATION=30m ./run_k6.sh soak -o"
    echo ""
}

# Validação de argumentos
if [[ $# -eq 0 ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
    show_help
    exit 0
fi

TEST_TYPE="$1"
OPEN_REPORT=false

# Processa argumentos adicionais
shift
while [[ $# -gt 0 ]]; do
    case $1 in
        --open-report|-o)
            OPEN_REPORT=true
            shift
            ;;
        *)
            echo -e "${RED}❌ Argumento desconhecido: $1${NC}"
            echo ""
            show_help
            exit 1
            ;;
    esac
done

# Valida tipo de teste
case "$TEST_TYPE" in
    smoke|load|stress|spike|soak)
        TEST_FILE="${TEST_TYPE}_test.js"
        ;;
    *)
        echo -e "${RED}❌ Tipo de teste inválido: $TEST_TYPE${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac

# Verifica se k6 está instalado
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}❌ k6 não está instalado!${NC}"
    echo ""
    echo "Instale com:"
    echo "  # Linux (Debian/Ubuntu)"
    echo "  sudo gpg -k"
    echo "  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69"
    echo "  echo \"deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main\" | sudo tee /etc/apt/sources.list.d/k6.list"
    echo "  sudo apt-get update && sudo apt-get install k6"
    echo ""
    echo "  # macOS"
    echo "  brew install k6"
    exit 1
fi

# Verifica se o arquivo de teste existe
if [[ ! -f "$TEST_FILE" ]]; then
    echo -e "${RED}❌ Arquivo não encontrado: $TEST_FILE${NC}"
    exit 1
fi

# Cria diretórios de output se não existirem
mkdir -p logs results

# Gera timestamp para os arquivos
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_FILE="logs/${TEST_TYPE}-test-${TIMESTAMP}.log"
BASE_URL_DISPLAY="${BASE_URL:-http://localhost:80}"

# Banner de início
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}🚀 Executando teste: ${YELLOW}${TEST_TYPE}${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}📋 Arquivo:${NC}       $TEST_FILE"
echo -e "${BLUE}🌐 URL base:${NC}      $BASE_URL_DISPLAY"
echo -e "${BLUE}📝 Log:${NC}           $LOG_FILE"
echo -e "${BLUE}⏰ Timestamp:${NC}     $TIMESTAMP"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Exporta timestamp para uso pelo handleSummary do k6
export RUN_TIMESTAMP="$TIMESTAMP"

# Executa k6
echo -e "${YELLOW}⏳ Executando k6...${NC}"
echo ""

if k6 run "$TEST_FILE" \
    --log-output="file=${LOG_FILE}" \
    --log-format=json; then
    
    # Teste passou
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅ Teste concluído com sucesso!${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # Localiza arquivos gerados pelo handleSummary
    HTML_REPORT=$(find results -name "${TEST_TYPE}_test-summary-${TIMESTAMP}.html" -print -quit 2>/dev/null || echo "")
    JSON_REPORT=$(find results -name "${TEST_TYPE}_test-summary-${TIMESTAMP}.json" -print -quit 2>/dev/null || echo "")
    
    echo ""
    echo -e "${BLUE}📊 Artefatos gerados:${NC}"
    echo -e "   📝 Log:  ${GREEN}$LOG_FILE${NC}"
    
    if [[ -n "$HTML_REPORT" ]]; then
        echo -e "   📊 HTML: ${GREEN}$HTML_REPORT${NC}"
    fi
    
    if [[ -n "$JSON_REPORT" ]]; then
        echo -e "   📋 JSON: ${GREEN}$JSON_REPORT${NC}"
    fi
    
    echo ""
    
    # Abre relatório HTML se solicitado
    if [[ "$OPEN_REPORT" == true ]] && [[ -n "$HTML_REPORT" ]]; then
        echo -e "${YELLOW}🌐 Abrindo relatório HTML no navegador...${NC}"

        OPEN_CMD=""
        if command -v xdg-open &> /dev/null; then
            OPEN_CMD="xdg-open"
        elif command -v open &> /dev/null; then
            OPEN_CMD="open"
        elif command -v wslview &> /dev/null; then
            OPEN_CMD="wslview"
        fi

        if [[ -n "$OPEN_CMD" ]]; then
            if "$OPEN_CMD" "$HTML_REPORT" >/dev/null 2>&1; then
                echo -e "${GREEN}✅ Relatório aberto com ${OPEN_CMD}.${NC}"
            else
                echo -e "${YELLOW}⚠️  Não foi possível abrir automaticamente (ambiente sem GUI ou sem app padrão).${NC}"
                echo -e "${BLUE}   Abra manualmente: $HTML_REPORT${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  Nenhum comando de abertura automática disponível (xdg-open/open/wslview).${NC}"
            echo -e "${BLUE}   Abra manualmente: $HTML_REPORT${NC}"
        fi
    elif [[ -n "$HTML_REPORT" ]]; then
        echo -e "${BLUE}💡 Para abrir o relatório HTML:${NC}"
        echo -e "   ./run_k6.sh $TEST_TYPE --open-report"
        echo -e "   ${BLUE}ou${NC}"
        echo -e "   xdg-open $HTML_REPORT"
    fi
    
    echo ""
    exit 0
else
    # Teste falhou
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}❌ Teste falhou ou thresholds não foram atingidos${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${BLUE}📝 Verifique os logs:${NC} $LOG_FILE"
    echo ""
    exit 1
fi
