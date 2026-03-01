/**
 * SMOKE TEST — Validação Básica do Sistema
 * 
 * Objetivo:
 *   Garantir que as funcionalidades básicas (criar URL + redirecionar) estão operacionais
 *   antes de executar testes de carga mais pesados.
 * 
 * Características:
 *   - Carga mínima: 2 VUs (Virtual Users) simultâneos
 *   - Duração: 1 minuto
 *   - Operações: Criação de URLs + Redirecionamento
 * 
 * Quando executar:
 *   ✅ Antes de qualquer teste de performance
 *   ✅ Após deploys em produção/staging
 *   ✅ No pipeline de CI/CD como gate de qualidade
 *   ✅ Após mudanças em código crítico
 * 
 * Thresholds:
 *   - Taxa de erro geral < 1%
 *   - P95 de latência < 1000ms
 *   - Taxa de falha HTTP < 1%
 *   - Validação de Location > 99%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";
import { buildSummary } from "./lib/reporting.js";
import { generateUrl } from "./lib/common.js";

// Métrica customizada para rastrear taxa de erro
const errorRate = new Rate("errors");
const BASE_URL = __ENV.BASE_URL || "http://localhost:80";

export const options = {
  vus: 2,
  duration: "1m",
  thresholds: {
    errors: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
    http_req_failed: ["rate<0.01"],
    "checks{check:Location matches original URL}": ["rate>0.99"],
  },
};

/**
 * Setup: Cria uma URL de teste antes de iniciar o teste principal.
 * 
 * Esta função roda uma única vez antes do teste começar e prepara
 * dados necessários para validação do redirecionamento.
 */
export function setup() {
  console.log("[SMOKE] Iniciando smoke test (nível sênior)");
  
  // Gera uma URL aleatória para teste
  const originalUrl = generateUrl();
  
  // Cria o encurtamento
  const res = http.post(`${BASE_URL}/api/v1/shorten`, JSON.stringify({ url: originalUrl }), {
    headers: { "Content-Type": "application/json" },
  });
  
  // Validação crítica: Se o setup falhar, todo o teste deve abortar
  if (res.status !== 201) throw new Error("Falha no setup do smoke test");
  
  // Extrai o shortcode da resposta (ex: "http://localhost/D4p5" → "D4p5")
  const shortcode = res.json("short_url").split("/").pop();
  
  return { shortcode, originalUrl };
}

/**
 * Função principal do teste: Executada por cada VU repetidamente durante 1 minuto.
 * 
 * Fluxo de cada iteração:
 *   1. Cria uma nova URL encurtada
 *   2. Acessa o shortcode criado no setup para validar redirecionamento
 *   3. Aguarda 1 segundo antes da próxima iteração
 */
export default function (data) {
  // ========== OPERAÇÃO 1: CRIAR URL ==========
  const createRes = http.post(`${BASE_URL}/api/v1/shorten`, JSON.stringify({ url: generateUrl() }), {
    headers: { "Content-Type": "application/json" },
    tags: { operation: "create" }, // Tag para análise separada no relatório
  });
  
  // Valida se a criação retornou HTTP 201 Created
  const createOk = check(createRes, { "create: status 201": (r) => r.status === 201 });
  errorRate.add(!createOk); // Incrementa taxa de erro se falhou

  // ========== OPERAÇÃO 2: REDIRECIONAR URL ==========
  // Usa o shortcode criado no setup (garantido como válido)
  const redirectRes = http.get(`${BASE_URL}/${data.shortcode}`, { 
    redirects: 0, // Não seguir redirect automaticamente (queremos validar o 302)
    tags: { operation: "redirect" } 
  });
  
  // Extrai o header Location (deve conter a URL original)
  const location = redirectRes.headers["Location"];
  
  // Valida status 302 e se o Location aponta para a URL original
  const redirectOk = check(redirectRes, {
    "redirect: status 302": (r) => r.status === 302,
    "Location matches original URL": (r) => location === data.originalUrl,
  });
  errorRate.add(!redirectOk);

  // Aguarda 1 segundo entre iterações (simula usuário humano)
  sleep(1);
}

export function handleSummary(data) {
  return buildSummary("smoke_test", data);
}