import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import { buildSummary } from "./reporting.js";

/**
 * SMOKE TEST
 * 
 * Objetivo: Verificar funcionalidade básica com carga mínima.
 * Executa com 1-2 VUs por 1 minuto para garantir que não há bugs óbvios.
 * 
 * Quando executar:
 * - Antes de qualquer teste de carga
 * - Após cada deploy em produção
 * - Como validação rápida de sanidade
 * 
 * Como executar:
 *   k6 run tests/k6/smoke_test.js
 *   k6 run -e BASE_URL=https://staging.exemplo.com tests/k6/smoke_test.js
 */

const errorRate = new Rate("errors");

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";

/**
 * Gera ID aleatório com tamanho específico.
 */
function randomId(length) {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Gera URLs de tamanhos variados para simular cenários reais.
 */
function generateUrl() {
  const templates = [
    () => `https://example.com/${randomId(4)}`,
    () => `https://blog.example.com/posts/${randomId(6)}/artigo-com-titulo-longo`,
    () => `https://shop.example.com/produtos/${randomId(6)}?ref=homepage`,
    () => `https://example.com/search?q=${randomId(10)}&page=1&filter=${randomId(6)}`,
  ];

  const fn = templates[Math.floor(Math.random() * templates.length)];
  return fn();
}

export const options = {
  vus: 2,
  duration: "1m",
  thresholds: {
    errors: ["rate<0.01"], // Menos de 1% de erros
    http_req_duration: ["p(95)<1000"], // 95% das requisições em menos de 1s
    http_req_failed: ["rate<0.01"],
    "checks{check:Location matches original URL}": ["rate>0.99"], // Integridade
  },
};

export function setup() {
  console.log("[SMOKE] Iniciando smoke test - verificação básica de funcionalidade");
  
  // Cria 1 URL de teste
  const originalUrl = generateUrl();
  const payload = JSON.stringify({ url: originalUrl });

  const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  if (res.status !== 201) {
    console.error(`[SMOKE] Falha ao criar URL de teste: ${res.status}`);
    return { shortcode: null, originalUrl: null };
  }

  const shortcode = res.json("short_url").split("/").pop();
  console.log(`[SMOKE] URL de teste criada: ${shortcode}`);
  
  return { shortcode, originalUrl };
}

export default function (data) {
  // Testa criação de URL
  const originalUrl = generateUrl();
  const createPayload = JSON.stringify({ url: originalUrl });

  const createRes = http.post(`${BASE_URL}/api/v1/shorten`, createPayload, {
    headers: { "Content-Type": "application/json" },
    tags: { operation: "create" },
  });

  const createSuccess = check(createRes, {
    "create: status 201": (r) => r.status === 201,
    "create: has short_url": (r) => r.json("short_url") !== undefined,
  });

  errorRate.add(!createSuccess);

  if (!data.shortcode || !data.originalUrl) {
    console.error("[SMOKE] Sem dados para teste de redirect");
    return;
  }

  // Testa redirecionamento
  const redirectRes = http.get(`${BASE_URL}/${data.shortcode}`, {
    redirects: 0,
    tags: { operation: "redirect" },
  });

  const locationHeader = redirectRes.headers["Location"];

  const redirectSuccess = check(redirectRes, {
    "redirect: status 302": (r) => r.status === 302,
    "redirect: has Location": (r) => locationHeader !== undefined,
    "Location matches original URL": (r) => locationHeader === data.originalUrl,
  });

  errorRate.add(!redirectSuccess);

  sleep(1); // 1 segundo entre iterações
}

export function teardown(data) {
  console.log("[SMOKE] Smoke test concluído");
}

export function handleSummary(data) {
  return buildSummary("smoke_test", data);
}
