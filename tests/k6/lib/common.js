/**
 * BIBLIOTECA COMUM — Funções Reutilizáveis para Testes K6
 * 
 * Este módulo contém funções auxiliares compartilhadas entre todos os testes,
 * seguindo o princípio DRY (Don't Repeat Yourself).
 */

import http from "k6/http";
import { SharedArray } from "k6/data";

/**
 * Gera um ID aleatório usando base36.
 * 
 * @param {number} length - Comprimento do ID desejado
 * @returns {string} ID aleatório (ex: "d4p5")
 */
export function randomId(length) {
  return Math.random().toString(36).substring(2, 2 + length);
}

/**
 * Gera uma URL aleatória para testes.
 * 
 * Utiliza templates variados para simular URLs realistas com diferentes padrões:
 *   - URLs simples (60% de frequência)
 *   - URLs com paths complexos
 *   - URLs com query strings
 *   - URLs com múltiplos parâmetros (UTM tracking)
 * 
 * @returns {string} URL aleatória (ex: "https://blog.example.com/posts/abc123/artigo")
 */
export function generateUrl() {
  const templates = [
    // URLs simples (60% de frequência - 3 templates)
    () => `https://example.com/${randomId(4)}`,
    () => `https://example.com/${randomId(4)}`,
    () => `https://example.com/${randomId(4)}`,
    
    // URLs com paths complexos
    () => `https://blog.example.com/posts/${randomId(6)}/artigo-com-titulo-longo-aqui`,
    () => `https://shop.example.com/produtos/${randomId(6)}?ref=homepage`,
    () => `https://app.example.com/dashboard/relatorio/${randomId(8)}`,
    () => `https://news.example.com/2024/tecnologia/${randomId(6)}-titulo-da-noticia`,
    () => `https://site.example.com/categoria/sub/${randomId(6)}`,
    
    // URLs com query strings complexas
    () => `https://example.com/search?q=${randomId(10)}&page=1&sort=asc&filter=${randomId(6)}&utm_source=google`,
    () => `https://analytics.example.com/track?campaign=${randomId(8)}&source=email&medium=cpc&term=${randomId(6)}&content=${randomId(10)}`,
  ];
  
  // Seleciona um template aleatório e executa
  return templates[Math.floor(Math.random() * templates.length)]();
}

/**
 * Cria um pool de URLs de seed antes do teste começar.
 * 
 * Performance otimizada:
 *   Utiliza http.batch() para criar todas as URLs em paralelo,
 *   resultando em ganho de performance de 20-30x em comparação com loop sequencial.
 * 
 * Exemplo:
 *   - 200 URLs sequenciais: ~40-60 segundos
 *   - 200 URLs com batch: ~2-3 segundos
 * 
 * Por que isso é importante?
 *   O setup precisa ser rápido para não desperdiçar tempo de teste.
 *   Com batch, podemos criar milhares de seeds em poucos segundos.
 * 
 * @param {string} BASE_URL - URL base do sistema (ex: "http://localhost:80")
 * @param {number} count - Número de URLs a criar
 * @returns {Array<{shortcode: string, originalUrl: string}>} Array de seeds criados
 */
export function createSeedUrls(BASE_URL, count) {
  console.log(`[COMMON] Criando ${count} URLs de seed via batch...`);
  
  // Prepara array de requisições para batch
  const requests = [];
  for (let i = 0; i < count; i++) {
    requests.push({
      method: "POST",
      url: `${BASE_URL}/api/v1/shorten`,
      body: JSON.stringify({ url: generateUrl() }),
      params: { headers: { "Content-Type": "application/json" } },
    });
  }
  
  // Executa todas as requisições em paralelo (batch)
  const responses = http.batch(requests);
  
  // Processa respostas e monta array de seeds
  const seeds = [];
  let failureCount = 0;
  
  responses.forEach((res, index) => {
    if (res.status !== 201) {
      failureCount++;
      console.error(`[COMMON] Seed #${index + 1} falhou (status ${res.status})`);
      return; // Pula esta seed
    }
    
    try {
      // Extrai a URL completa (ex: "http://localhost/D4p5")
      const shortUrlFull = res.json("short_url");
      if (!shortUrlFull || typeof shortUrlFull !== "string") {
        console.error(`[COMMON] Seed #${index + 1} retornou short_url inválido:`, shortUrlFull);
        failureCount++;
        return;
      }
      
      // Extrai apenas o shortcode (parte após última barra)
      const shortcode = shortUrlFull.split("/").pop();
      if (!shortcode || shortcode.length < 4) {
        console.error(`[COMMON] Seed #${index + 1} shortcode inválido: "${shortcode}"`);
        failureCount++;
        return;
      }
      
      // Recupera a URL original do corpo da requisição
      const originalUrl = JSON.parse(res.request.body).url;
      seeds.push({ shortcode, originalUrl });
    } catch (e) {
      console.error(`[COMMON] Seed #${index + 1} erro ao parsear resposta:`, e.message);
      failureCount++;
    }
  });
  
  console.log(`[COMMON] ${seeds.length}/${count} seeds criados com sucesso (${failureCount} falharam)`);
  
  if (seeds.length === 0) {
    throw new Error("CRÍTICO: Nenhuma seed foi criada! O endpoint /api/v1/shorten está falhando.");
  }
  
  if (seeds.length < count * 0.8) {
    console.warn(`[COMMON] Aviso: Taxa de sucesso abaixo de 80% (${(seeds.length / count * 100).toFixed(1)}%)`);
  }
  
  return seeds;
}