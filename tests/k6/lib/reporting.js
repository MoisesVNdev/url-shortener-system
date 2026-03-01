/**
 * REPORTING — Geração de Relatórios HTML e JSON
 * 
 * Este módulo centraliza a geração de relatórios para todos os testes,
 * garantindo formato consistente e facilidade de comparação histórica.
 */

import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

/**
 * Gera timestamp formatado para nome de arquivo.
 * 
 * Formato: YYYY-MM-DD-HHMMSS (ex: "2026-03-01-154832")
 * 
 * @returns {string} Timestamp formatado
 */
function buildTimestamp() {
  return new Date().toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "-")
    .slice(0, 19); // Ex: 2026-03-01-154832
}

/**
 * Constrói o sumário do teste em múltiplos formatos.
 * 
 * Formatos gerados:
 *   1. HTML: Relatório visual completo com gráficos
 *   2. JSON: Dados estruturados para análise programática
 *   3. stdout: Sumário colorido no console
 * 
 * Naming convention:
 *   {testName}-summary-{timestamp}.{ext}
 *   Exemplo: load_test-summary-2026-03-01-154832.html
 * 
 * Variáveis de ambiente:
 *   - RESULTS_DIR: Diretório de saída (padrão: "results")
 *   - RUN_TIMESTAMP: Timestamp fixo para múltiplos arquivos da mesma execução
 * 
 * @param {string} testName - Nome do teste (ex: "load_test", "spike_test")
 * @param {object} data - Dados do sumário do K6
 * @returns {object} Mapa de arquivos gerados
 */
export function buildSummary(testName, data) {
  const resultsDir = __ENV.RESULTS_DIR || "results";
  const timestamp = __ENV.RUN_TIMESTAMP || buildTimestamp();

  console.log(`[REPORT] Gerando relatórios para ${testName} → Timestamp: ${timestamp}`);

  return {
    [`${resultsDir}/${testName}-summary-${timestamp}.html`]: htmlReport(data),
    [`${resultsDir}/${testName}-summary-${timestamp}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: "  ", enableColors: true }),
  };
}