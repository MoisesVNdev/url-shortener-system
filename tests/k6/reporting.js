import { textSummary } from "https://jslib.k6.io/k6-summary/0.1.0/index.js";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";

function buildTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function buildSummary(testName, data) {
  const resultsDir = __ENV.RESULTS_DIR || "results";
  const timestamp = __ENV.RUN_TIMESTAMP || buildTimestamp();

  return {
    [`${resultsDir}/${testName}-summary-${timestamp}.html`]: htmlReport(data),
    [`${resultsDir}/${testName}-summary-${timestamp}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: "  ", enableColors: true }),
  };
}
