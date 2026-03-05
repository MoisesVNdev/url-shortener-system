/**
 * STRESS TEST — Encontrar o Ponto de Ruptura do Sistema
 * 
 * Objetivo:
 *   Aumentar a carga progressivamente até o sistema começar a falhar, identificando
 *   o limite máximo de throughput antes da degradação ou colapso.
 * 
 * Características:
 *   - Carga progressiva: 50 → 100 → 150 → 250 → 400 VUs
 *   - Duração total: 15 minutos (6 estágios)
 *   - Ratio 10:1 (90% leitura, 10% escrita)
 *   - Setup prévio: 300 URLs de seed
 * 
 * Estágios do teste:
 *   1. Aquecimento (2 min):    50 VUs  → Valida operação normal
 *   2. Carga baixa (2 min):   100 VUs  → Início do estresse
 *   3. Carga média (3 min):   150 VUs  → Sistema sob pressão
 *   4. Carga alta (3 min):    250 VUs  → Possível início de degradação
 *   5. Carga extrema (3 min): 400 VUs  → Ruptura esperada aqui
 *   6. Recuperação (2 min):     0 VUs  → Valida se o sistema recupera
 * 
 * O que observar:
 *   - Em qual estágio a taxa de erro começa a subir?
 *   - A latência cresce linearmente ou exponencialmente?
 *   - O sistema consegue se recuperar após reduzir a carga?
 *   - Uso de CPU, memória, conexões do banco de dados
 * 
 * Thresholds:
 *   - P95 latência < 3s (aceitável sob estresse em Docker local)
 *   - Taxa de erro < 15% (esperado em stress test com infra limitada)
 *   - Taxa de validação de Location > 85%
 * 
 * Quando executar:
 *   ✅ Para dimensionar infraestrutura (quantos servidores?)
 *   ✅ Antes de eventos com tráfego esperado alto
 *   ✅ Validar melhorias de escalabilidade
 *   ✅ Descobrir gargalos (CPU, memória, banco de dados)
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";
import { buildSummary } from "./lib/reporting.js";
import { generateUrl, createSeedUrls } from "./lib/common.js";

// Métricas customizadas
const errorRate = new Rate("errors");                // Taxa de erro geral
const responseTimes = new Trend("response_time_ms");  // Tendência de tempo de resposta

const BASE_URL = __ENV.BASE_URL || "http://localhost:80";
const SEED_COUNT = parseInt(__ENV.SEED_COUNT || "300", 10);

export const options = {
  stages: [
    { duration: "2m", target: 50 },
    { duration: "2m", target: 100 },
    { duration: "3m", target: 150 },
    { duration: "3m", target: 250 },
    { duration: "3m", target: 400 },
    { duration: "2m", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<3000"],
    errors: ["rate<0.15"],
    "checks{check:Location matches original URL}": ["rate>0.85"],
  },
};

export function setup() {
  const urlMap = createSeedUrls(BASE_URL, SEED_COUNT);
  return { urlMap };
}

/**
 * Função principal: Executada por cada VU.
 * 
 * Simula tráfego realista com ratio 10:1 (leitura:escrita).
 * A cada iteração, há 10% de chance de fazer uma escrita e 90% de fazer uma leitura.
 */
export default function (data) {
  // Validação crítica: garante que há seeds disponíveis
  if (!data.urlMap || data.urlMap.length === 0) {
    errorRate.add(1);
    console.error("[STRESS] CRÍTICO: Nenhuma seed disponível no setup!");
    return;
  }
  
  // 10% de chance de ser operação de escrita (Math.random() < 0.1)
  const isWrite = Math.random() < 0.1;
  
  // Seleciona uma URL aleatória do pool de seeds
  const entry = data.urlMap[Math.floor(Math.random() * data.urlMap.length)];
  
  // Validação: shortcode deve estar presente e válido
  if (!entry || !entry.shortcode || entry.shortcode.length < 4) {
    errorRate.add(1);
    console.error(`[STRESS] Seed inválido:`, entry);
    return;
  }

  if (isWrite) {
    // ========== OPERAÇÃO DE ESCRITA ==========
    const res = http.post(
      `${BASE_URL}/api/v1/shorten`, 
      JSON.stringify({ url: generateUrl() }), 
      { 
        headers: { "Content-Type": "application/json" }, 
        tags: { operation: "create" } 
      }
    );
    
    // Registra tempo de resposta para análise de tendência
    responseTimes.add(res.timings.duration);
    
    const success = check(res, { 
      "create: status 201": (r) => r.status === 201,
      "create: short_url presente": (r) => !!r.json("short_url"),
    });
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
  return buildSummary("stress_test", data);
}