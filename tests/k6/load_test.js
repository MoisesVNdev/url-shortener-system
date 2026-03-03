/**
 * LOAD TEST — URL Shortener API
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Cenários disponíveis (selecionar via K6_SCENARIO):
 *
 *   smoke  → Validação rápida: saúde da API + 1 ciclo criar/redirecionar
 *            2 VUs, 1 minuto — rode antes de qualquer teste de carga
 *
 *   load   → Carga normal com ratio 10:1 (leitura:escrita)
 *            escrita: 10 req/s | leitura: 90 req/s — duração configurável
 *
 *   stress → Encontra o ponto de quebra com rampa agressiva (ratio 10:1 mantido)
 *            escrita: 10→50 req/s | leitura: 90→450 req/s
 *
 *   soak   → Detecta vazamentos de memória com carga baixa e longa duração
 *            escrita: 5 req/s  | leitura: 45 req/s — 30 minutos
 *
 *   all    → Todos os cenários em sequência
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Execução:
 *
 *   # Dentro do Docker (recomendado):
 *   K6_SCENARIO=smoke  docker compose --profile testing run --rm k6
 *   K6_SCENARIO=load   docker compose --profile testing run --rm k6
 *   K6_SCENARIO=stress docker compose --profile testing run --rm k6
 *   K6_SCENARIO=soak   docker compose --profile testing run --rm k6
 *
 *   # Local (requer k6 instalado):
 *   K6_SCENARIO=load BASE_URL=http://localhost:80 k6 run load_test.js
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Variáveis de ambiente:
 *   BASE_URL      → URL base do sistema        (padrão: http://nginx)
 *   K6_SCENARIO   → Cenário a executar         (padrão: load)
 *   SEED_COUNT    → URLs criadas no setup      (padrão: 200)
 *   TEST_DURATION → Duração do cenário load    (padrão: 60s)
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
const SCENARIO    = __ENV.K6_SCENARIO   || "load";

// ── Seleção dinâmica de cenários ─────────────────────────────────────────────
// Um cenário só é ativado se K6_SCENARIO bater com seu nome ou for "all".
// Cenários inativos recebem startTime impossível para serem ignorados pelo K6.
function active(name) {
  return SCENARIO === "all" || SCENARIO === name;
}

function maybeDisable(name) {
  return active(name) ? {} : { startTime: "87600h" }; // ~10 anos no futuro
}

// ── Definição dos cenários ───────────────────────────────────────────────────
const scenarios = {

  // ── Smoke: validação rápida antes de qualquer teste de carga ──────────────
  smoke: {
    executor: "constant-vus",
    vus: 2,
    duration: "1m",
    exec: "smokeTest",
    tags: { scenario: "smoke" },
    ...maybeDisable("smoke"),
  },

  // ── Load: carga normal — ratio 10:1 (leitura:escrita) ─────────────────────
  write_scenario: {
    executor: "constant-arrival-rate",
    rate: 10,                              // 10 req/s (10% do total)
    timeUnit: "1s",
    duration: __ENV.TEST_DURATION || "60s",
    preAllocatedVUs: 20,
    maxVUs: 50,
    exec: "createUrl",
    tags: { scenario: "load" },
    ...maybeDisable("load"),
  },

  read_scenario: {
    executor: "constant-arrival-rate",
    rate: 90,                              // 90 req/s (90% do total)
    timeUnit: "1s",
    duration: __ENV.TEST_DURATION || "60s",
    preAllocatedVUs: 100,
    maxVUs: 200,
    exec: "redirectUrl",
    tags: { scenario: "load" },
    ...maybeDisable("load"),
  },

  // ── Stress: rampa agressiva mantendo o ratio 10:1 ─────────────────────────
  stress_write: {
    executor: "ramping-arrival-rate",
    startRate: 10,
    timeUnit: "1s",
    preAllocatedVUs: 50,
    maxVUs: 150,
    stages: [
      { duration: "2m", target: 20  },    // aquecimento
      { duration: "3m", target: 30  },
      { duration: "3m", target: 50  },    // ponto de pressão
      { duration: "2m", target: 0   },    // cool-down
    ],
    exec: "createUrl",
    tags: { scenario: "stress" },
    ...maybeDisable("stress"),
  },

  stress_read: {
    executor: "ramping-arrival-rate",
    startRate: 90,
    timeUnit: "1s",
    preAllocatedVUs: 200,
    maxVUs: 500,
    stages: [
      { duration: "2m", target: 180 },
      { duration: "3m", target: 270 },
      { duration: "3m", target: 450 },    // 5x a carga normal
      { duration: "2m", target: 0   },
    ],
    exec: "redirectUrl",
    tags: { scenario: "stress" },
    ...maybeDisable("stress"),
  },

  // ── Soak: carga baixa por longa duração — detecta memory leak ─────────────
  soak_write: {
    executor: "constant-arrival-rate",
    rate: 5,                               // 5 req/s escrita
    timeUnit: "1s",
    duration: "30m",
    preAllocatedVUs: 10,
    maxVUs: 30,
    exec: "createUrl",
    tags: { scenario: "soak" },
    ...maybeDisable("soak"),
  },

  soak_read: {
    executor: "constant-arrival-rate",
    rate: 45,                              // 45 req/s leitura (ratio 10:1 mantido)
    timeUnit: "1s",
    duration: "30m",
    preAllocatedVUs: 60,
    maxVUs: 120,
    exec: "redirectUrl",
    tags: { scenario: "soak" },
    ...maybeDisable("soak"),
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

// ── Cenário: Smoke ────────────────────────────────────────────────────────────
/**
 * Valida que a API está saudável e consegue executar 1 ciclo completo
 * antes de qualquer teste de carga. Falha aqui = não prosseguir.
 */
export function smokeTest(data) {
  // 1. Health check
  const health = http.get(`${BASE_URL}/health`, {
    tags: { operation: "health", scenario: "smoke" },
  });
  check(health, {
    "smoke: /health status 200":   (r) => r.status === 200,
    "smoke: redis connected":      (r) => JSON.parse(r.body)?.redis === "connected",
    "smoke: cassandra connected":  (r) => JSON.parse(r.body)?.cassandra === "connected",
  });
  errorRate.add(health.status !== 200);

  sleep(0.5);

  // 2. Ciclo criar → redirecionar (valida o fluxo end-to-end)
  const post = http.post(
    `${BASE_URL}/api/v1/shorten`,
    JSON.stringify({ url: generateUrl() }),
    { headers: { "Content-Type": "application/json" }, tags: { operation: "create", scenario: "smoke" } }
  );
  const ok = check(post, { "smoke: create status 201": (r) => r.status === 201 });
  errorRate.add(!ok);

  if (ok) {
    const shortcode = JSON.parse(post.body)?.short_code;
    if (shortcode) {
      sleep(0.1);
      const redirect = http.get(`${BASE_URL}/${shortcode}`, {
        redirects: 0,
        tags: { operation: "redirect", scenario: "smoke" },
      });
      check(redirect, { "smoke: redirect status 302": (r) => r.status === 302 });
      errorRate.add(redirect.status !== 302);
    }
  }

  sleep(1);
}

// ── Cenário: Escrita (todos os testes de carga) ───────────────────────────────
/**
 * Cria uma nova URL encurtada via POST /api/v1/shorten.
 * Executado pelo write_scenario, stress_write e soak_write.
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

// ── Cenário: Leitura (todos os testes de carga) ───────────────────────────────
/**
 * Redireciona via GET /{shortcode} sem seguir o redirect (valida 302 + Location).
 * Executado pelo read_scenario, stress_read e soak_read.
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