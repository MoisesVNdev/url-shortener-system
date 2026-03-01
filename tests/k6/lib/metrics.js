import { Rate, Counter, Trend } from "k6/metrics";

/**
 * Factory de métricas centralizadas - Padrão Sênior/Enterprise
 * Evita duplicação de código e garante nomes consistentes em todos os testes.
 */
export function createMetrics() {
  return {
    // Métricas gerais
    errorRate: new Rate("errors"),
    responseTimes: new Trend("response_time_ms"),

    // Por operação
    createErrors: new Rate("create_errors"),
    redirectErrors: new Rate("redirect_errors"),

    // Erros específicos
    serverErrors: new Counter("server_errors"),
    timeoutErrors: new Counter("timeout_errors"),

    // Por fase (Spike / Recovery)
    spikeErrors: new Rate("spike_errors"),
    recoveryErrors: new Rate("recovery_errors"),

    // Sucesso e temporais
    redirectSuccess: new Counter("redirect_success"),
    hourlyErrors: new Rate("hourly_errors"),
  };
}

/**
 * Helper para registrar requisição de forma consistente (latência + erros)
 */
export function recordRequest(metrics, res, operation = "redirect", phase = null) {
  const latency = res.timings ? res.timings.duration : Date.now() - (res.requestStart || Date.now());
  metrics.responseTimes.add(latency);

  let hasError = false;

  if (res.status === 0) {
    metrics.timeoutErrors.add(1);
    hasError = true;
  } else if (res.status >= 500) {
    metrics.serverErrors.add(1);
    hasError = true;
  }

  // Métricas por fase
  if (phase === "spike") metrics.spikeErrors.add(hasError);
  if (phase === "recovery") metrics.recoveryErrors.add(hasError);

  // Métricas por operação
  metrics.errorRate.add(hasError);
  if (operation === "create") metrics.createErrors.add(hasError);
  if (operation === "redirect") metrics.redirectErrors.add(hasError);

  return !hasError;
}