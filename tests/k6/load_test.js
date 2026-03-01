import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";
import { buildSummary } from "./reporting.js";

// Métricas customizadas
const errorRate = new Rate("errors");
const redirectSuccess = new Counter("redirect_success");
const createErrors = new Rate("create_errors");
const redirectErrors = new Rate("redirect_errors");
const timeoutErrors = new Counter("timeout_errors");
const serverErrors = new Counter("server_errors");

// Parametrização via variáveis de ambiente
const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "50", 10);
const WRITE_RATE = parseInt(__ENV.WRITE_RATE || "10", 10);
const READ_RATE = parseInt(__ENV.READ_RATE || "90", 10);
const TEST_DURATION = __ENV.TEST_DURATION || "60s";

/**
 * Gera ID aleatório com tamanho específico.
 */
function randomId(length) {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Gera URLs de tamanhos variados para simular cenários reais.
 * 30% URLs curtas, 50% médias, 20% longas.
 */
function generateUrl() {
  const templates = [
    // URLs curtas (30%)
    () => `https://example.com/${randomId(4)}`,
    () => `https://example.com/${randomId(4)}`,
    () => `https://example.com/${randomId(4)}`,
    // URLs médias com path (50%)
    () => `https://blog.example.com/posts/${randomId(6)}/artigo-com-titulo-longo-aqui`,
    () => `https://shop.example.com/produtos/${randomId(6)}?ref=homepage`,
    () => `https://app.example.com/dashboard/relatorio/${randomId(8)}`,
    () => `https://news.example.com/2024/tecnologia/${randomId(6)}-titulo-da-noticia`,
    () => `https://site.example.com/categoria/sub/${randomId(6)}`,
    // URLs longas com query string (20%)
    () => `https://example.com/search?q=${randomId(10)}&page=1&sort=asc&filter=${randomId(6)}&utm_source=google`,
    () => `https://analytics.example.com/track?campaign=${randomId(8)}&source=email&medium=cpc&term=${randomId(6)}&content=${randomId(10)}`,
  ];

  const fn = templates[Math.floor(Math.random() * templates.length)];
  return fn();
}

export const options = {
  scenarios: {
    // Escrita (criação de URLs)
    write_scenario: {
      executor: "constant-arrival-rate",
      rate: WRITE_RATE,
      timeUnit: "1s",
      duration: TEST_DURATION,
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: "createUrl",
    },
    // Leitura (redirecionamento de URLs)
    read_scenario: {
      executor: "constant-arrival-rate",
      rate: READ_RATE,
      timeUnit: "1s",
      duration: TEST_DURATION,
      preAllocatedVUs: 100,
      maxVUs: 200,
      exec: "redirectUrl",
    },
  },
  thresholds: {
    "http_req_duration{scenario:write_scenario}": ["p(95)<500"],
    "http_req_duration{scenario:read_scenario}": ["p(95)<100"],
    errors: ["rate<0.01"],
    create_errors: ["rate<0.02"],
    redirect_errors: ["rate<0.01"],
    "checks{check:Location matches original URL}": ["rate>0.99"], // Integridade dos dados
  },
};

/**
 * Setup: cria um pool inicial de URLs para garantir que os testes de leitura
 * tenham dados válidos desde o primeiro segundo.
 */
export function setup() {
  console.log(`[SETUP] Criando ${SEED_COUNT} URLs de seed no ambiente...`);
  const urlMap = []; // { shortcode, originalUrl }

  for (let i = 0; i < SEED_COUNT; i++) {
    const originalUrl = generateUrl();
    const payload = JSON.stringify({ url: originalUrl });

    const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
      headers: { "Content-Type": "application/json" },
      tags: { operation: "seed" },
    });

    if (res.status === 201) {
      const shortUrl = res.json("short_url");
      const shortcode = shortUrl.split("/").pop();
      urlMap.push({ shortcode, originalUrl });
    } else {
      console.warn(`[SETUP] Falha ao criar seed ${i}: status ${res.status}`);
    }
  }

  console.log(`[SETUP] ${urlMap.length}/${SEED_COUNT} URLs de seed criadas com sucesso`);
  return { urlMap };
}

/**
 * Teardown: executado ao final do teste (útil para limpeza).
 */
export function teardown(data) {
  console.log(`[TEARDOWN] Teste finalizado. Pool final: ${data.urlMap.length} URLs`);
}

export function createUrl(data) {
  const originalUrl = generateUrl();
  const payload = JSON.stringify({ url: originalUrl });

  const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
    headers: { "Content-Type": "application/json" },
    tags: { operation: "create", scenario: "write" },
  });

  // Tratamento de erros granular
  if (res.status === 0) {
    console.error(`[CREATE] Timeout ou conexão recusada: ${res.error}`);
    timeoutErrors.add(1);
    createErrors.add(1);
    errorRate.add(1);
    return;
  }

  if (res.status >= 500) {
    console.error(`[CREATE] Erro de servidor: ${res.status} - ${res.body}`);
    serverErrors.add(1);
    createErrors.add(1);
    errorRate.add(1);
    return;
  }

  const success = check(res, {
    "POST status 201": (r) => r.status === 201,
    "has short_url": (r) => r.json("short_url") !== undefined,
  });

  if (success) {
    const shortUrl = res.json("short_url");
    const shortcode = shortUrl.split("/").pop();
    // Armazena mapeamento shortcode → originalUrl para validação posterior
    data.urlMap.push({ shortcode, originalUrl });
  } else {
    createErrors.add(1);
  }

  errorRate.add(!success);
  sleep(0.1); // Pequeno sleep para comportamento mais realista
}

export function redirectUrl(data) {
  // Garante que sempre há URLs disponíveis (seed do setup)
  if (!data.urlMap || data.urlMap.length === 0) {
    console.error("[REDIRECT] Nenhuma URL disponível no pool");
    return;
  }

  const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];

  const res = http.get(`${BASE_URL}/${entry.shortcode}`, {
    redirects: 0, // não seguir o redirect, apenas verificar o 301/302
    tags: { operation: "redirect", scenario: "read" },
  });

  // Tratamento de erros granular
  if (res.status === 0) {
    console.error(`[REDIRECT] Timeout ou conexão recusada: ${res.error}`);
    timeoutErrors.add(1);
    redirectErrors.add(1);
    errorRate.add(1);
    return;
  }

  if (res.status >= 500) {
    console.error(`[REDIRECT] Erro de servidor: ${res.status} - ${res.body}`);
    serverErrors.add(1);
    redirectErrors.add(1);
    errorRate.add(1);
    return;
  }

  const locationHeader = res.headers["Location"];

  const success = check(res, {
    "redirect status 302": (r) => r.status === 302,
    "has Location header": (r) => locationHeader !== undefined,
    "Location matches original URL": (r) => locationHeader === entry.originalUrl,
  });

  if (success) {
    redirectSuccess.add(1);
  } else {
    redirectErrors.add(1);
    if (locationHeader && locationHeader !== entry.originalUrl) {
      console.error(`[REDIRECT] Integridade violada: esperado "${entry.originalUrl}", obtido "${locationHeader}"`);
    }
  }

  errorRate.add(!success);
  sleep(0.05); // Sleep menor para reads (mais frequentes)
}

export function handleSummary(data) {
  return buildSummary("load_test", data);
}