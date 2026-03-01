import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import { buildSummary } from "./reporting.js";

/**
 * SPIKE TEST
 * 
 * Objetivo: Verificar resiliência do sistema em picos repentinos e extremos de tráfego.
 * Simula situação de URL viral (ex.: link compartilhado em rede social).
 * 
 * Cenário:
 * - Tráfego normal (10 VUs) por 1 minuto
 * - SPIKE BRUTAL para 1000 VUs por 3 minutos
 * - Retorno ao normal (10 VUs) por 1 minuto
 * 
 * Quando executar:
 * - Para validar comportamento em campanhas virais
 * - Antes de eventos com tráfego imprevisível
 * - Para testar auto-scaling e circuit breakers
 * 
 * Como executar:
 *   k6 run tests/k6/spike_test.js
 *   k6 run -e BASE_URL=https://staging.exemplo.com tests/k6/spike_test.js
 * 
 * Observações:
 * - O sistema DEVE sobreviver ao spike sem downtime completo
 * - Taxa de erro pode aumentar durante o pico, mas deve se recuperar
 * - Monitore latências e se o sistema se recupera após o spike
 */

const errorRate = new Rate("errors");
const recoveryErrors = new Rate("recovery_errors"); // Erros durante recuperação
const spikeErrors = new Rate("spike_errors"); // Erros durante o spike
const serverErrors = new Counter("server_errors");
const timeoutErrors = new Counter("timeout_errors");
const responseTimes = new Trend("response_time_ms");

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "200", 10);

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
    { duration: "1m", target: 10 },    // Tráfego normal
    { duration: "10s", target: 1000 }, // SPIKE REPENTINO
    { duration: "3m", target: 1000 },  // Mantém o spike
    { duration: "10s", target: 10 },   // Queda brusca
    { duration: "2m", target: 10 },    // Recuperação - sistema deve voltar ao normal
  ],
  thresholds: {
    http_req_duration: ["p(99)<5000"], // p99 < 5s mesmo no spike
    spike_errors: ["rate<0.3"], // Até 30% de erros durante spike é aceitável
    recovery_errors: ["rate<0.05"], // Após spike, deve se recuperar
    "checks{check:Location matches original URL}": ["rate>0.90"], // 90% integridade em spike
  },
};

export function setup() {
  console.log(`[SPIKE] Criando ${SEED_COUNT} URLs de seed para teste de spike...`);
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

  return { urlMap, spikeStartTime: null };
}

export default function (data) {
  // Detecta fase do teste baseado no número de VUs ativas
  const currentVUs = __VU;
  const isSpike = __ITER > 6; // Aproximação da fase
  const isRecovery = __ITER > 180; // Aproximação da fase de recuperação

  // Spike test foca em LEITURA (shortcodes virais são acessados muitas vezes)
  if (!data.urlMap || data.urlMap.length === 0) {
    console.error("[SPIKE] Sem URLs disponíveis");
    return;
  }

  // Simula padrão de acesso viral: alguns URLs recebem maior parte do tráfego
  let entry;
  if (Math.random() < 0.8) {
    // 80% das requisições vão para os 5 primeiros (URLs "virais")
    entry = data.urlMap[Math.floor(Math.random() * Math.min(5, data.urlMap.length))];
  } else {
    // 20% distribuído no resto
    entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];
  }

  const startTime = Date.now();
  const res = http.get(`${BASE_URL}/${entry.shortcode}`, {
    redirects: 0,
    tags: { 
      operation: "redirect",
      phase: isRecovery ? "recovery" : (isSpike ? "spike" : "normal"),
    },
  });
  responseTimes.add(Date.now() - startTime);

  // Tratamento de erros
  let hasError = false;
  
  if (res.status === 0) {
    timeoutErrors.add(1);
    hasError = true;
  } else if (res.status >= 500) {
    serverErrors.add(1);
    hasError = true;
  } else {
    const locationHeader = res.headers["Location"];

    const success = check(res, {
      "spike: status 302": (r) => r.status === 302,
      "spike: has Location": (r) => locationHeader !== undefined,
      "Location matches original URL": (r) => locationHeader === entry.originalUrl,
    });
    hasError = !success;
  }

  errorRate.add(hasError);
  
  if (isSpike) {
    spikeErrors.add(hasError);
  } else if (isRecovery) {
    recoveryErrors.add(hasError);
  }

  // Durante spike, sem sleep (máxima pressão)
  // Durante recuperação, pequeno sleep
  if (!isSpike && isRecovery) {
    sleep(0.1);
  }
}

export function teardown(data) {
  console.log("[SPIKE] Spike test concluído");
  console.log("[SPIKE] Verifique se o sistema se recuperou completamente após o pico");
}

export function handleSummary(data) {
  return buildSummary("spike_test", data);
}
