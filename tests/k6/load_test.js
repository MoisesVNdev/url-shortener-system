/**
 * LOAD TEST — URL Shortener API
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Objetivo:
 *   Simular carga normal esperada em produção com ratio 10:1 (leitura:escrita)
 *   - Escrita: 10 req/s  (10% do tráfego)
 *   - Leitura: 90 req/s  (90% do tráfego)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Execução:
 *
 *   # Via Docker (envia métricas ao Prometheus):
 *   docker compose --profile testing up k6
 *
 *   # Via script local (gera relatórios HTML/JSON):
 *   ./tests/k6/run_k6.sh load
 *   ./tests/k6/run_k6.sh load --open-report
 *
 *   # Via k6 diretamente:
 *   k6 run tests/k6/load_test.js
 *   BASE_URL=http://localhost:80 k6 run tests/k6/load_test.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Variáveis de ambiente:
 *   BASE_URL      → URL base do sistema        (padrão: http://nginx)
 *   SEED_COUNT    → URLs criadas no setup      (padrão: 200)
 *   TEST_DURATION → Duração do teste           (padrão: 60s)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Thresholds (SLOs):
 *   P95 escrita          < 500ms
 *   P95 leitura          < 100ms
 *   P99 geral            < 1000ms
 *   Taxa de erro         < 1%
 *   Validação Location   > 99%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import { buildSummary } from "./lib/reporting.js";
import { generateUrl, createSeedUrls } from "./lib/common.js";

// ── Métricas customizadas ────────────────────────────────────────────────────
const errorRate        = new Rate("errors");                  // Taxa de erro geral
const createErrors     = new Rate("create_errors");           // Taxa de erro na criação
const redirectErrors   = new Rate("redirect_errors");         // Taxa de erro no redirecionamento
const cacheHits        = new Counter("cache_hits");           // Hits no cache Redis
const shortenDuration  = new Trend("shorten_duration",  true);// Latência da operação de escrita
const redirectDuration = new Trend("redirect_duration", true);// Latência da operação de leitura

// ── Configuração ─────────────────────────────────────────────────────────────
const BASE_URL    = __ENV.BASE_URL      || "http://nginx";
const SEED_COUNT  = parseInt(__ENV.SEED_COUNT  || "200", 10);

// ── Definição dos cenários ───────────────────────────────────────────────────
const scenarios = {
  // ── Escrita: 10 req/s (10% do tráfego) ────────────────────────────────────
  write_scenario: {
    executor: "constant-arrival-rate",
    rate: 10,                              // 10 req/s (10% do total)
    timeUnit: "1s",
    duration: __ENV.TEST_DURATION || "60s",
    preAllocatedVUs: 20,
    maxVUs: 50,
    exec: "createUrl",
    tags: { scenario: "write" },
  },

  // ── Leitura: 90 req/s (90% do tráfego) ────────────────────────────────────
  read_scenario: {
    executor: "constant-arrival-rate",
    rate: 90,                              // 90 req/s (90% do total)
    timeUnit: "1s",
    duration: __ENV.TEST_DURATION || "60s",
    preAllocatedVUs: 100,
    maxVUs: 200,
    exec: "redirectUrl",
    tags: { scenario: "read" },
  },
};

// ── Thresholds (SLOs) ────────────────────────────────────────────────────────
export const options = {
  scenarios,
  thresholds: {
    // Latência por tipo de operação
    "http_req_duration{scenario:write_scenario}": ["p(95)<500"],
    "http_req_duration{scenario:read_scenario}":  ["p(95)<100"],

    // Latência global (P99 — captura picos extremos)
    http_req_duration: ["p(99)<1000"],

    // Taxas de erro
    errors:           ["rate<0.01"],   // < 1% de erro geral
    create_errors:    ["rate<0.01"],
    redirect_errors:  ["rate<0.01"],

    // Integridade do redirecionamento
    "checks{check:Location matches original URL}": ["rate>0.99"],

    // Latência medida pelas métricas customizadas (Trend)
    shorten_duration:  ["p(95)<500"],
    redirect_duration: ["p(95)<100"],
  },
};

// ── Setup: pool de URLs de seed ───────────────────────────────────────────────
/**
 * Cria 200 URLs antes do teste iniciar (configurável via SEED_COUNT).
 *
 * Por que é necessário:
 *   - Garante dados disponíveis no cenário de leitura desde o 1° segundo
 *   - Evita cold start no Redis (cache aquecido)
 *   - Usa batch requests: ~2s para criar 200 URLs (20-30x mais rápido que sequencial)
 *
 * Retorna: { urlMap: [{ shortcode, originalUrl }] }
 */
export function setup() {
  const urlMap = createSeedUrls(BASE_URL, SEED_COUNT);
  return { urlMap };
}

// ── Cenário: Escrita ──────────────────────────────────────────────────────────
/**
 * Cria uma nova URL encurtada via POST /api/v1/shorten.
 * Executado pelo write_scenario.
 */
export function createUrl() {
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/shorten`,
    JSON.stringify({ url: generateUrl() }),
    {
      headers: { "Content-Type": "application/json" },
      tags: { operation: "create", scenario: "write" },
    }
  );
  shortenDuration.add(Date.now() - start);

  const success = check(res, { "create: status 201": (r) => r.status === 201 });
  errorRate.add(!success);
  createErrors.add(!success);

  sleep(0.1); // 100ms think time
}

// ── Cenário: Leitura ──────────────────────────────────────────────────────────
/**
 * Redireciona via GET /{shortcode} sem seguir o redirect (valida 302 + Location).
 * Executado pelo read_scenario.
 */
export function redirectUrl(data) {
  // Seleciona URL aleatória do pool criado no setup()
  const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];

  const start = Date.now();
  const res = http.get(`${BASE_URL}/${entry.shortcode}`, {
    redirects: 0,  // não seguir o redirect — valida o 302 diretamente
    tags: { operation: "redirect", scenario: "read" },
  });
  redirectDuration.add(Date.now() - start);

  const location = res.headers["Location"];

  // Detecta cache hit pelo header (adicione X-Cache no seu serviço se ainda não tiver)
  if (res.headers["X-Cache"] === "HIT") {
    cacheHits.add(1);
  }

  const success = check(res, {
    "redirect: status 302":             (r) => r.status === 302,
    "Location matches original URL":    (r) => location === entry.originalUrl,
  });
  errorRate.add(!success);
  redirectErrors.add(!success);

  sleep(0.05); // 50ms think time (leitura é mais rápida que escrita)
}

// ── Sumário final ─────────────────────────────────────────────────────────────
export function handleSummary(data) {
  return buildSummary("load_test", data);
}