/**
 * SPIKE TEST — Teste de Resiliência a Picos Repentinos de Tráfego
 * 
 * Objetivo:
 *   Verificar como o sistema se comporta quando há um aumento repentino e extremo
 *   de tráfego, como um link viral compartilhado em redes sociais.
 * 
 * Características:
 *   - Carga: 10 VUs → 200 VUs → 10 VUs (spike 20x em Docker local)
 *   - Duração total: 7 minutos
 *   - Padrão de acesso: 80% das requisições em apenas 5 URLs "virais"
 *   - Operação: Apenas leitura (redirecionamento)
 * 
 * Estágios do teste:
 *   1. Normal (1 min):      10 VUs  → Tráfego baseline
 *   2. Ramp-up (10s):      200 VUs  → Aumento repentino (20x em 10 segundos!)
 *   3. Spike (3 min):      200 VUs  → Mantém pico máximo
 *   4. Ramp-down (10s):     10 VUs  → Queda repentina
 *   5. Recuperação (2 min): 10 VUs  → Valida se o sistema volta ao normal
 * 
 * Cenário realista:
 *   Imagine um link sendo compartilhado por um influencer com milhões de seguidores.
 *   Em poucos segundos, milhares de pessoas acessam o mesmo link simultaneamente.
 * 
 * O que observar:
 *   - O sistema sobrevive sem downtime total?
 *   - Qual é a latência durante o spike? (degradação aceitável?)
 *   - O sistema se recupera após o spike?
 *   - Taxa de erro volta ao normal na fase de recuperação?
 *   - Como o cache Redis se comporta com hot spotting?
 * 
 * Thresholds:
 *   - P99 latência < 5s (mesmo no spike)
 *   - Taxa de erro no spike < 30%
 *   - Taxa de erro na recuperação < 5%
 *   - Taxa de validação de Location > 70%
 * 
 * Quando executar:
 *   ✅ Antes de campanhas de marketing viral
 *   ✅ Testar auto-scaling e elasticidade
 *   ✅ Validar circuit breakers e rate limiters
 *   ✅ Simular link compartilhado em rede social
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";
import { buildSummary } from "./lib/reporting.js";
import { createSeedUrls } from "./lib/common.js";
import { getPhase } from "./lib/phase-detector.js";  // Corrigido: getPhase, não getCurrentPhase

// Métricas customizadas por fase
const errorRate = new Rate("errors");                  // Taxa de erro geral
const spikeErrors = new Rate("spike_errors");          // Erros durante o spike
const recoveryErrors = new Rate("recovery_errors");    // Erros durante a recuperação
const responseTimes = new Trend("response_time_ms");   // Tendência de tempo de resposta

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "200", 10);

export const options = {
  stages: [
    { duration: "1m", target: 10 },
    { duration: "10s", target: 200 },
    { duration: "3m", target: 200 },
    { duration: "10s", target: 10 },
    { duration: "2m", target: 10 },
  ],
  thresholds: {
    http_req_duration: ["p(99)<5000"],
    spike_errors: ["rate<0.30"],
    recovery_errors: ["rate<0.05"],
    "checks{check:Location matches original URL}": ["rate>0.70"],
  },
};

/**
 * Setup: Cria pool de URLs e registra timestamp de início.
 * 
 * O timestamp é usado para calcular em qual fase do teste estamos
 * (normal, ramp-up, spike, ramp-down, recovery) dinamicamente.
 */
export function setup() {
  const urlMap = createSeedUrls(BASE_URL, SEED_COUNT);
  return { urlMap, startTime: Date.now() };
}

/**
 * Função principal: Simula acesso a URLs "virais".
 * 
 * Hot Spotting:
 *   80% das requisições vão para apenas 5 URLs (Math.min(5, data.urlMap.length)).
 *   Isso simula o comportamento real de um link viral sendo acessado milhares de vezes.
 * 
 * Detecção de fase:
 *   A função getPhase calcula dinamicamente em qual fase do teste estamos,
 *   permitindo separar métricas por fase (spike vs recovery).
 */
export default function (data) {
  // Validação crítica: garante que há seeds disponíveis
  if (!data.urlMap || data.urlMap.length === 0) {
    errorRate.add(1);
    spikeErrors.add(1);
    console.error("[SPIKE] CRÍTICO: Nenhuma seed disponível no setup!");
    return;
  }
  
  // Detecta em qual fase do teste estamos
  const elapsed = Date.now() - data.startTime;
  const phase = getPhase(data.startTime, elapsed);
  
  // Seleciona uma das 5 primeiras URLs (hot spotting = 80% do tráfego em poucas URLs)
  const entry = data.urlMap[Math.floor(Math.random() * Math.min(5, data.urlMap.length))];

  // Validação: shortcode deve estar presente e válido
  if (!entry || !entry.shortcode || entry.shortcode.length < 4) {
    errorRate.add(1);
    if (phase === "spike") spikeErrors.add(1);
    if (phase === "recovery") recoveryErrors.add(1);
    console.error(`[SPIKE] Seed inválido no phase ${phase}:`, entry);
    return;
  }

  // Faz requisição com tag da fase para análise separada
  const res = http.get(`${BASE_URL}/${entry.shortcode}`, { 
    redirects: 0, 
    tags: { phase, operation: "redirect" } 
  });
  
  // Registra tempo de resposta
  responseTimes.add(res.timings.duration);

  const location = res.headers["Location"];
  
  const success = check(res, {
    "status 302": (r) => r.status === 302,
    "Location matches original URL": (r) => location === entry.originalUrl,
  });

  // Registra erros por fase
  errorRate.add(!success);
  if (phase === "spike") spikeErrors.add(!success);
  if (phase === "recovery") recoveryErrors.add(!success);

  // Durante o spike, não dorme (simula tráfego máximo)
  if (phase !== "spike") sleep(0.1);
}

export function handleSummary(data) {
  return buildSummary("spike_test", data);
}