/**
 * PHASE DETECTOR — Detecção Dinâmica de Fase do Teste
 * 
 * Utilizado pelo spike_test.js para identificar em qual fase do teste estamos,
 * permitindo separar métricas por fase (normal, ramp-up, spike, ramp-down, recovery).
 */

/**
 * Identifica a fase atual do teste baseado no tempo decorrido.
 * 
 * Fases do Spike Test:
 *   - Normal (0-60s):       Tráfego baseline
 *   - Ramp-up (60-70s):     Aumento repentino
 *   - Spike (70-250s):      Pico máximo mantido
 *   - Ramp-down (250-260s): Queda repentina
 *   - Recovery (260s+):     Recuperação
 * 
 * @param {number} startTime - Timestamp de início do teste (milliseconds)
 * @param {number} elapsedMs - Tempo decorrido desde o início (milliseconds)
 * @returns {string} Nome da fase atual
 */
export function getPhase(startTime, elapsedMs) {
  const elapsed = elapsedMs / 1000;
  if (elapsed < 60) return "normal";
  if (elapsed < 70) return "ramp-up";
  if (elapsed < 250) return "spike";
  if (elapsed < 260) return "ramp-down";
  return "recovery";
}