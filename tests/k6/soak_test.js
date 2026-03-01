/**
 * SOAK TEST (ENDURANCE TEST) — Teste de Estabilidade de Longa Duração
 * 
 * Objetivo:
 *   Detectar problemas que só aparecem após execução prolongada, como memory leaks,
 *   degradação gradual de performance, ou problemas de gerenciamento de recursos.
 * 
 * Características:
 *   - Carga constante: 50 VUs (configurável via VUS)
 *   - Duração: 8 horas (configurável via TEST_DURATION)
 *   - Ratio 10:1 (90% leitura, 10% escrita)
 *   - Setup prévio: 1000 URLs de seed
 * 
 * Problemas detectados por soak testing:
 *   🔍 Memory leaks (vazamento de memória)
 *   🔍 Conexões não fechadas com banco de dados
 *   🔍 Fragmentação de memória
 *   🔍 Logs crescendo descontroladamente
 *   🔍 Degradação gradual de performance
 *   🔍 Problemas de garbage collection
 *   🔍 Pool de conexões esgotando ao longo do tempo
 * 
 * Como analisar:
 *   1. Compare métricas da PRIMEIRA HORA vs ÚTIMA HORA
 *   2. Latência deve se manter ESTÁVEL ao longo do tempo
 *   3. Taxa de erro NÃO DEVE AUMENTAR progressivamente
 *   4. Monitore uso de memória/CPU/conexões durante todo o teste
 * 
 * Thresholds:
 *   - P95 latência < 500ms (deve se manter estável por horas)
 *   - Taxa de erro < 1% consistente
 *   - Taxa de falha HTTP < 1%
 *   - Taxa de validação de Location > 99%
 * 
 * Variáveis de ambiente:
 *   - BASE_URL: URL do sistema (padrão: http://localhost:80)
 *   - SEED_COUNT: Número de URLs criadas no setup (padrão: 1000)
 *   - TEST_DURATION: Duração do teste (padrão: 8h)
 *   - VUS: Número de VUs simultâneos (padrão: 50)
 * 
 * Quando executar:
 *   ✅ Antes de releases importantes
 *   ✅ Após mudanças em gerenciamento de recursos
 *   ✅ Periodicamente em staging (quinzenal/mensal)
 *   ✅ Testes noturnos automatizados
 * 
 * Exemplos de uso:
 *   # Teste padrão de 8 horas
 *   ./run_k6.sh soak
 * 
 *   # Teste mais curto (4 horas) para validação rápida
 *   TEST_DURATION=4h ./run_k6.sh soak
 * 
 *   # Teste overnight (12 horas) com menos VUs
 *   TEST_DURATION=12h VUS=30 ./run_k6.sh soak
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { buildSummary } from "./lib/reporting.js";
import { generateUrl, createSeedUrls } from "./lib/common.js";

// Métricas customizadas
const errorRate = new Rate("errors");                // Taxa de erro geral
const responseTimes = new Trend("response_time_ms");  // Tendência de tempo de resposta

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "1000", 10);  // Mais seeds para distribuir carga
const TEST_DURATION = __ENV.TEST_DURATION || "8h";
const VUS = parseInt(__ENV.VUS || "50", 10);

export const options = {
  vus: VUS,
  duration: TEST_DURATION,
  thresholds: {
    http_req_duration: ["p(95)<500"],
    errors: ["rate<0.01"],
    http_req_failed: ["rate<0.01"],
    "checks{check:Location matches original URL}": ["rate>0.99"],
  },
};

/**
 * Setup: Cria um grande pool de URLs de seed (1000 por padrão).
 * 
 * Por que 1000 URLs?
 *   Durante 8 horas com 50 VUs, haverá milhões de requisições.
 *   Um pool maior evita "hot spotting" (acessar sempre as mesmas URLs),
 *   tornando o teste mais realista.
 * 
 * O startTime é registrado para análise temporal (primeira hora vs última hora).
 */
export function setup() {
  console.log(`[SOAK] Iniciando soak de ${TEST_DURATION} com ${VUS} VUs`);
  const urlMap = createSeedUrls(BASE_URL, SEED_COUNT);
  return { urlMap, startTime: Date.now() };
}

/**
 * Função principal: Executada por cada VU durante 8 horas.
 * 
 * Simula tráfego realista com ratio 10:1 (leitura:escrita).
 * 
 * Importante:
 *   A latência e a taxa de erro devem se manter ESTÁVEIS ao longo do tempo.
 *   Se houver degradação gradual, é sinal de memory leak ou problema de recursos.
 */
export default function (data) {
  // 10% de chance de ser operação de escrita
  const isWrite = Math.random() < 0.1;
  
  // Seleciona uma URL aleatória do pool (distribuição uniforme)
  const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];

  if (isWrite) {
    // ========== OPERAÇÃO DE ESCRITA ==========
    const res = http.post(
      `${BASE_URL}/api/v1/shorten`, 
      JSON.stringify({ url: generateUrl() }),
      {
        headers: { "Content-Type": "application/json" },
        tags: { operation: "create" },
      }
    );
    
    // Registra tempo de resposta para detectar degradação ao longo do tempo
    responseTimes.add(res.timings.duration);
    
    const success = check(res, { "create: status 201": (r) => r.status === 201 });
    errorRate.add(!success);
    
  } else {
    // ========== OPERAÇÃO DE LEITURA ==========
    const res = http.get(
      `${BASE_URL}/${entry.shortcode}`, 
      { 
        redirects: 0, 
        tags: { operation: "redirect" } 
      }
    );
    
    // Registra tempo de resposta
    responseTimes.add(res.timings.duration);
    
    const location = res.headers["Location"];
    
    const success = check(res, {
      "redirect: status 302": (r) => r.status === 302,
      "Location matches original URL": (r) => location === entry.originalUrl,
    });
    
    errorRate.add(!success);
  }
  
  // Pausa de 100ms entre requisições
  sleep(0.1);
}

export function handleSummary(data) {
  return buildSummary("soak_test", data);
}