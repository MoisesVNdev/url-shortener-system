import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import { buildSummary } from "./reporting.js";

/**
 * STRESS TEST
 * 
 * Objetivo: Encontrar o ponto de ruptura do sistema aumentando a carga progressivamente.
 * Aumenta de 10 VUs até 1000+ para identificar limites de capacidade.
 * 
 * Quando executar:
 * - Para dimensionar infraestrutura
 * - Antes de lançamentos com tráfego esperado alto
 * - Para validar melhorias de performance
 * 
 * Como executar:
 *   k6 run tests/k6/stress_test.js
 *   k6 run -e BASE_URL=https://staging.exemplo.com tests/k6/stress_test.js
 * 
 * Observações:
 * - O sistema deve suportar pelo menos os 3 primeiros estágios
 * - Falhas no estágio 4-5 são esperadas (esse é o objetivo)
 * - Monitore uso de CPU, memória, conexões de banco durante o teste
 */

const errorRate = new Rate("errors");
const createErrors = new Rate("create_errors");
const redirectErrors = new Rate("redirect_errors");
const serverErrors = new Counter("server_errors");
const timeoutErrors = new Counter("timeout_errors");
const responseTimes = new Trend("response_time_ms");

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "100", 10);

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
    () => `https://example.com/${randomId(4)}`,
    () => `https://example.com/${randomId(4)}`,
    () => `https://blog.example.com/posts/${randomId(6)}/artigo-com-titulo-longo-aqui`,
    () => `https://shop.example.com/produtos/${randomId(6)}?ref=homepage`,
    () => `https://app.example.com/dashboard/relatorio/${randomId(8)}`,
    () => `https://news.example.com/2024/tecnologia/${randomId(6)}-titulo-da-noticia`,
    () => `https://site.example.com/categoria/sub/${randomId(6)}`,
    () => `https://example.com/search?q=${randomId(10)}&page=1&sort=asc&filter=${randomId(6)}&utm_source=google`,
    () => `https://analytics.example.com/track?campaign=${randomId(8)}&source=email&medium=cpc&term=${randomId(6)}&content=${randomId(10)}`,
  ];

  const fn = templates[Math.floor(Math.random() * templates.length)];
  return fn();
}

export const options = {
  stages: [
    { duration: "2m", target: 50 },   // Aquecimento
    { duration: "2m", target: 100 },  // Carga normal
    { duration: "3m", target: 300 },  // Aumentando pressão
    { duration: "3m", target: 600 },  // Pressão alta
    { duration: "3m", target: 1000 }, // Ponto de ruptura esperado
    { duration: "2m", target: 0 },    // Recuperação (cooldown)
  ],
  thresholds: {
    // Não definimos thresholds rígidos - queremos ver onde quebra
    http_req_duration: ["p(95)<2000"], // Alertar se p95 > 2s
    errors: ["rate<0.1"], // Até 10% de erros é aceitável em stress test
    "checks{check:Location matches original URL}": ["rate>0.95"], // 95% integridade em stress
  },
};

export function setup() {
  console.log(`[STRESS] Criando ${SEED_COUNT} URLs de seed...`);
  const urlMap = [];

  for (let i = 0; i < SEED_COUNT; i++) {
    const originalUrl = generateUrl();
    const payload = JSON.stringify({ url: originalUrl });

    const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
      headers: { "Content-Type": "application/json" },
    });

    if (res.status === 201) {
      const shortcode = res.json("short_url").split("/").pop();
      urlMap.push({ shortcode, originalUrl });
    }
  }

  console.log(`[STRESS] ${urlMap.length} URLs criadas. Iniciando stress test...`);
  return { urlMap };
}

export default function (data) {
  // Ratio 1:9 (escrita:leitura)
  const isWrite = Math.random() < 0.1;

  if (isWrite) {
    // Criação de URL
    const originalUrl = generateUrl();
    const payload = JSON.stringify({ url: originalUrl });

    const startTime = Date.now();
    const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
      headers: { "Content-Type": "application/json" },
      tags: { operation: "create" },
    });
    responseTimes.add(Date.now() - startTime);

    if (res.status === 0) {
      timeoutErrors.add(1);
      createErrors.add(1);
      errorRate.add(1);
    } else if (res.status >= 500) {
      serverErrors.add(1);
      createErrors.add(1);
      errorRate.add(1);
    } else {
      const success = check(res, {
        "create: status 201": (r) => r.status === 201,
      });
      
      if (success && data.urlMap) {
        const shortcode = res.json("short_url").split("/").pop();
        data.urlMap.push({ shortcode, originalUrl });
      }
      
      errorRate.add(!success);
      createErrors.add(!success);
    }
  } else {
    // Redirecionamento
    if (!data.urlMap || data.urlMap.length === 0) {
      return;
    }

    const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];
    const shortcode = entry.shortcode;
    
    const startTime = Date.now();
    const res = http.get(`${BASE_URL}/${entry.shortcode}`, {
      redirects: 0,
      tags: { operation: "redirect" },
    });
    responseTimes.add(Date.now() - startTime);

    if (res.status === 0) {
      timeoutErrors.add(1);
      redirectErrors.add(1);
      errorRate.add(1);
    } else if (res.status >= 500) {
      serverErrors.add(1);
      redirectErrors.add(1);
      errorRate.add(1);
    } else {
      const locationHeader = res.headers["Location"];

      const success = check(res, {
        "redirect: status 302": (r) => r.status === 302,
        "redirect: has Location": (r) => locationHeader !== undefined,
        "Location matches original URL": (r) => locationHeader === entry.originalUrl,
      });

      errorRate.add(!success);
      redirectErrors.add(!success);
    }
  }

  sleep(0.1);
}

export function teardown(data) {
  console.log("[STRESS] Stress test concluído");
  console.log(`[STRESS] Total de URLs no pool: ${data.urlMap.length}`);
}

export function handleSummary(data) {
  return buildSummary("stress_test", data);
}
