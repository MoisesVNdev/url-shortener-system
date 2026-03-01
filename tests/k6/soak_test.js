import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import { buildSummary } from "./reporting.js";

/**
 * SOAK TEST (ENDURANCE TEST)
 * 
 * Objetivo: Detectar problemas que aparecem apenas após execução prolongada.
 * Executa carga constante e moderada por várias horas.
 * 
 * Problemas detectados:
 * - Memory leaks (vazamento de memória)
 * - Conexões não fechadas com banco de dados
 * - Fragmentação de memória
 * - Logs crescendo descontroladamente
 * - Degradação gradual de performance
 * - Problemas de garbage collection
 * 
 * Quando executar:
 * - Antes de releases importantes
 * - Após mudanças em gerenciamento de recursos
 * - Periodicamente em staging (ex.: quinzenalmente)
 * 
 * Como executar:
 *   k6 run tests/k6/soak_test.js
 *   k6 run -e TEST_DURATION=4h tests/k6/soak_test.js  # Teste mais curto
 *   k6 run -e TEST_DURATION=12h tests/k6/soak_test.js # Teste overnight
 * 
 * Análise:
 * - Compare métricas da primeira hora vs última hora
 * - Latência deve se manter estável
 * - Taxa de erro não deve aumentar com o tempo
 * - Monitore uso de memória, conexões abertas, disco
 */

const errorRate = new Rate("errors");
const createErrors = new Rate("create_errors");
const redirectErrors = new Rate("redirect_errors");
const serverErrors = new Counter("server_errors");
const timeoutErrors = new Counter("timeout_errors");
const responseTimes = new Trend("response_time_ms");
const hourlyErrors = new Rate("hourly_errors"); // Para comparação temporal

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "500", 10);
const TEST_DURATION = __ENV.TEST_DURATION || "8h"; // Padrão: 8 horas
const VUS = parseInt(__ENV.VUS || "50", 10); // Carga moderada constante

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
  vus: VUS,
  duration: TEST_DURATION,
  thresholds: {
    http_req_duration: ["p(95)<500"], // Deve se manter estável por horas
    errors: ["rate<0.01"], // Taxa baixa de erros consistente
    http_req_failed: ["rate<0.01"],
    "checks{check:Location matches original URL}": ["rate>0.99"], // Integridade
  },
};

let testStartTime = 0;

export function setup() {
  console.log(`[SOAK] Iniciando soak test de ${TEST_DURATION}`);
  console.log(`[SOAK] Criando ${SEED_COUNT} URLs de seed para pool inicial...`);
  
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

    // Sleep para não sobrecarregar durante setup
    if (i % 50 === 0) {
      sleep(0.5);
    }
  }

  console.log(`[SOAK] ${urlMap.length} URLs criadas`);
  console.log("[SOAK] ⚠️  IMPORTANTE: Monitore uso de memória/CPU durante todo o teste");
  console.log("[SOAK] ⚠️  Compare primeira hora vs última hora para detectar degradação");
  
  return { urlMap, startTime: Date.now() };
}

export default function (data) {
  // Ratio 1:9 (escrita:leitura) - padrão real de uso
  const isWrite = Math.random() < 0.1;

  if (!testStartTime) {
    testStartTime = data.startTime;
  }

  // Calcula tempo decorrido para análise temporal
  const elapsedHours = (Date.now() - data.startTime) / (1000 * 60 * 60);
  const hourBucket = Math.floor(elapsedHours);

  if (isWrite) {
    // Criação de URL
    const originalUrl = generateUrl();
    const payload = JSON.stringify({ url: originalUrl });

    const startTime = Date.now();
    const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
      headers: { "Content-Type": "application/json" },
      tags: { 
        operation: "create",
        hour: `hour_${hourBucket}`,
      },
    });
    const latency = Date.now() - startTime;
    responseTimes.add(latency);

    let hasError = false;

    if (res.status === 0) {
      console.warn(`[SOAK] Timeout na hora ${elapsedHours.toFixed(2)} - latency tentada: ${latency}ms`);
      timeoutErrors.add(1);
      hasError = true;
    } else if (res.status >= 500) {
      console.warn(`[SOAK] Erro 5xx na hora ${elapsedHours.toFixed(2)}: ${res.status}`);
      serverErrors.add(1);
      hasError = true;
    } else {
      const success = check(res, {
        "create: status 201": (r) => r.status === 201,
        "create: has short_url": (r) => r.json("short_url") !== undefined,
      });
      
      if (success && data.urlMap) {
        const shortcode = res.json("short_url").split("/").pop();
        data.urlMap.push({ shortcode, originalUrl });
        
        // Limita pool para não crescer indefinidamente em testes longos
        if (data.urlMap.length > 10000) {
          data.urlMap.shift();
        }
      }
      
      hasError = !success;
    }

    errorRate.add(hasError);
    createErrors.add(hasError);
    hourlyErrors.add(hasError);

  } else {
    // Redirecionamento
    if (!data.urlMap || data.urlMap.length === 0) {
      console.error("[SOAK] Pool de URLs vazio");
      return;
    }

    const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];
    
    const startTime = Date.now();
    const res = http.get(`${BASE_URL}/${entry.shortcode}`, {
      redirects: 0,
      tags: { 
        operation: "redirect",
        hour: `hour_${hourBucket}`,
      },
    });
    const latency = Date.now() - startTime;
    responseTimes.add(latency);

    let hasError = false;

    if (res.status === 0) {
      console.warn(`[SOAK] Timeout na hora ${elapsedHours.toFixed(2)} - latency tentada: ${latency}ms`);
      timeoutErrors.add(1);
      hasError = true;
    } else if (res.status >= 500) {
      console.warn(`[SOAK] Erro 5xx na hora ${elapsedHours.toFixed(2)}: ${res.status}`);
      serverErrors.add(1);
      hasError = true;
    } else {
      const locationHeader = res.headers["Location"];

      const success = check(res, {
        "redirect: status 302": (r) => r.status === 302,
        "redirect: has Location": (r) => locationHeader !== undefined,
        "Location matches original URL": (r) => locationHeader === entry.originalUrl,
      });
      
      hasError = !success;
    }

    errorRate.add(hasError);
    redirectErrors.add(hasError);
    hourlyErrors.add(hasError);
  }

  sleep(0.1); // Comportamento realista
}

export function teardown(data) {
  const durationMs = Date.now() - data.startTime;
  const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(2);
  
  console.log(`[SOAK] Soak test concluído após ${durationHours}h`);
  console.log(`[SOAK] Pool final: ${data.urlMap.length} URLs`);
  console.log("[SOAK] Analise as métricas por hora para detectar degradação temporal");
}

export function handleSummary(data) {
  return buildSummary("soak_test", data);
}
