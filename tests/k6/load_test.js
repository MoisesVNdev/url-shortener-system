/**
 * LOAD TEST — Teste de Carga Normal com Ratio Realista
 * 
 * Objetivo:
 *   Simular a carga normal de operação do sistema com ratio realista de 10:1 (leitura:escrita),
 *   conforme requisito do projeto.
 * 
 * Características:
 *   - Cenário de escrita: 10 req/s (constant-arrival-rate)
 *   - Cenário de leitura: 90 req/s (constant-arrival-rate)
 *   - Duração: 1 minuto (configurável via TEST_DURATION)
 *   - Setup prévio: Cria 200 URLs de seed antes de iniciar (pool de leitura)
 * 
 * Ratio 10:1:
 *   Este ratio reflete o comportamento real de URL shorteners, onde a maioria das
 *   requisições são de redirecionamento (leitura) e uma minoria são de criação (escrita).
 * 
 * Métricas-chave:
 *   - http_req_duration (por cenário): Latência separada para escrita e leitura
 *   - errors: Taxa de erro geral do sistema
 *   - create_errors / redirect_errors: Taxa de erro por operação
 * 
 * Thresholds:
 *   - P95 escrita < 500ms
 *   - P95 leitura < 100ms
 *   - Taxa de erro geral < 1%
 *   - Taxa de validação de Location > 99%
 * 
 * Variáveis de ambiente:
 *   - BASE_URL: URL do sistema (padrão: http://localhost:80)
 *   - SEED_COUNT: Número de URLs criadas no setup (padrão: 200)
 *   - TEST_DURATION: Duração do teste (padrão: 60s)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";
import { buildSummary } from "./lib/reporting.js";
import { generateUrl, createSeedUrls } from "./lib/common.js";

// Métricas customizadas
const errorRate = new Rate("errors");                // Taxa de erro geral
const createErrors = new Rate("create_errors");      // Taxa de erro na criação
const redirectErrors = new Rate("redirect_errors");  // Taxa de erro no redirecionamento

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "200", 10);

export const options = {
  scenarios: {
    // Cenário 1: ESCRITA (10 req/s = 10% do tráfego total)
    write_scenario: { 
      executor: "constant-arrival-rate",  // Taxa constante de chegada
      rate: 10,                            // 10 requisições por segundo
      timeUnit: "1s",                      // Por segundo
      duration: __ENV.TEST_DURATION || "60s",
      preAllocatedVUs: 20,                 // VUs pré-alocados (otimização)
      maxVUs: 50,                          // Máximo de VUs se necessário
      exec: "createUrl"                    // Função a executar
    },
    
    // Cenário 2: LEITURA (90 req/s = 90% do tráfego total)
    read_scenario: { 
      executor: "constant-arrival-rate",
      rate: 90,                            // 90 requisições por segundo
      timeUnit: "1s",
      duration: __ENV.TEST_DURATION || "60s",
      preAllocatedVUs: 100,                // Mais VUs para simular leituras rápidas
      maxVUs: 200,
      exec: "redirectUrl"                  // Função a executar
    },
  },
  
  // Thresholds: Critérios de sucesso/falha do teste
  thresholds: {
    // Latência P95 para operações de escrita deve ser < 500ms
    "http_req_duration{scenario:write_scenario}": ["p(95)<500"],
    
    // Latência P95 para operações de leitura deve ser < 100ms (mais rápido!)
    "http_req_duration{scenario:read_scenario}": ["p(95)<100"],
    
    // Taxa de erro total do sistema deve ser < 1%
    errors: ["rate<0.01"],
    
    // Validação de Location deve passar em > 99% dos casos
    "checks{check:Location matches original URL}": ["rate>0.99"],
  },
};

/**
 * Setup: Cria um pool de URLs de seed antes do teste começar.
 * 
 * Por que isso é necessário?
 *   - Garante que o cenário de leitura tenha dados disponíveis desde o primeiro segundo
 *   - Evita o "cold start" onde o sistema não teria URLs para redirecionar
 *   - Usa batch requests para criar 200 URLs em ~2 segundos (20-30x mais rápido que sequencial)
 * 
 * Retorna:
 *   { urlMap: [{ shortcode, originalUrl }] } - Array de URLs disponíveis para leitura
 */
export function setup() {
  const urlMap = createSeedUrls(BASE_URL, SEED_COUNT);
  return { urlMap };
}

/**
 * createUrl: Função executada pelo cenário de ESCRITA.
 * 
 * Operação:
 *   - Cria uma nova URL encurtada via POST /api/v1/shorten
 *   - Valida se retornou HTTP 201 Created
 *   - Registra erros nas métricas customizadas
 *   - Aguarda 100ms entre requisições (throttling leve para realismo)
 */
export function createUrl(data) {
  const res = http.post(`${BASE_URL}/api/v1/shorten`, JSON.stringify({ url: generateUrl() }), {
    headers: { "Content-Type": "application/json" },
    tags: { operation: "create", scenario: "write" }, // Tags para análise granular
  });
  
  const success = check(res, { "create: status 201": (r) => r.status === 201 });
  errorRate.add(!success);        // Taxa de erro geral
  createErrors.add(!success);     // Taxa de erro específica de criação
  
  sleep(0.1); // 100ms de pausa
}

/**
 * redirectUrl: Função executada pelo cenário de LEITURA.
 * 
 * Operação:
 *   - Seleciona uma URL aleatória do pool de seeds criado no setup
 *   - Acessa o shortcode via GET /{shortcode}
 *   - Valida se retornou HTTP 302 Found
 *   - Valida se o header Location contém a URL original correta
 *   - Registra erros nas métricas customizadas
 *   - Aguarda 50ms entre requisições (leitura é mais rápida que escrita)
 */
export function redirectUrl(data) {
  // Seleciona uma entrada aleatória do pool de seeds
  const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];
  
  // Faz GET no shortcode sem seguir o redirect automaticamente
  const res = http.get(`${BASE_URL}/${entry.shortcode}`, { 
    redirects: 0, // Não seguir redirect (queremos validar o 302)
    tags: { operation: "redirect", scenario: "read" } 
  });
  
  const location = res.headers["Location"];
  
  // Validação dupla: status 302 + Location correto
  const success = check(res, {
    "redirect: status 302": (r) => r.status === 302,
    "Location matches original URL": (r) => location === entry.originalUrl,
  });
  
  errorRate.add(!success);        // Taxa de erro geral
  redirectErrors.add(!success);   // Taxa de erro específica de redirecionamento
  
  sleep(0.05); // 50ms de pausa (leitura é mais rápida)
}

export function handleSummary(data) {
  return buildSummary("load_test", data);
}