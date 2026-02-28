import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter } from "k6/metrics";

// Métricas customizadas
const errorRate = new Rate("errors");
const redirectSuccess = new Counter("redirect_success");

export const options = {
  scenarios: {
    // 10 req/s de escrita (criação)
    write_scenario: {
      executor: "constant-arrival-rate",
      rate: 10,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: "createUrl",
    },
    // 90 req/s de leitura (redirecionamento)
    read_scenario: {
      executor: "constant-arrival-rate",
      rate: 90,
      timeUnit: "1s",
      duration: "60s",
      preAllocatedVUs: 100,
      maxVUs: 200,
      exec: "redirectUrl",
    },
  },
  thresholds: {
    "http_req_duration{scenario:write_scenario}": ["p(95)<500"],
    "http_req_duration{scenario:read_scenario}": ["p(95)<100"],
    errors: ["rate<0.01"],
  },
};

const BASE_URL = "http://localhost:80";

// Pool de shortcodes criados durante o teste
const createdShortcodes = [];

export function createUrl() {
  const payload = JSON.stringify({
    url: `https://example.com/page-${Math.random().toString(36).substring(7)}`,
  });

  const res = http.post(`${BASE_URL}/api/v1/shorten`, payload, {
    headers: { "Content-Type": "application/json" },
  });

  const success = check(res, {
    "POST status 201": (r) => r.status === 201,
    "has short_url": (r) => r.json("short_url") !== undefined,
  });

  if (success) {
    const shortUrl = res.json("short_url");
    // Extrai apenas o shortcode para uso no read
    const shortcode = shortUrl.split("/").pop();
    createdShortcodes.push(shortcode);
  }

  errorRate.add(!success);
}

export function redirectUrl() {
  // Usa shortcodes já criados ou um shortcode fixo de seed
  const pool = createdShortcodes.length > 0 ? createdShortcodes : ["D4p5"];
  const shortcode = pool[Math.floor(Math.random() * pool.length)];

  const res = http.get(`${BASE_URL}/${shortcode}`, {
    redirects: 0, // não seguir o redirect, apenas verificar o 301/302
  });

  const success = check(res, {
    "redirect status 301 or 302": (r) => r.status === 301 || r.status === 302,
    "has Location header": (r) => r.headers["Location"] !== undefined,
  });

  if (success) redirectSuccess.add(1);
  errorRate.add(!success);
}