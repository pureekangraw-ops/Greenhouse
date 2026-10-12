/** HERMES diagnostic policy v0.1: deterministic safety gate, no model calls or side effects. */
export const INPUT_SCHEMA = "ygg.hermes.diagnostic.v1";
export const OUTPUT_SCHEMA = "ygg.hermes.assessment.v1";
const kinds = new Set(["TEST_FAILURE", "BUILD_FAILURE", "RUNTIME_FAILURE", "TRANSIENT", "UNKNOWN"]);
const redact = (s) => String(s).replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]").replace(/((?:token|password|secret|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
export function sanitizeEnvelope(raw) {
  if (!raw || raw.schema !== INPUT_SCHEMA || typeof raw.workId !== "string" || !/^WORK-[\w-]+$/.test(raw.workId) || typeof raw.checkpoint !== "string" || !/^[\w-]+$/.test(raw.checkpoint)) throw new TypeError("Invalid diagnostic envelope");
  const logs = Array.isArray(raw.logs) ? raw.logs.slice(0, 40).map(x => redact(String(x).slice(0, 1200))) : [];
  return Object.freeze({schema: INPUT_SCHEMA, workId: raw.workId, checkpoint: raw.checkpoint, runnerId: redact(raw.runnerId ?? "unknown"), failureKind: kinds.has(raw.failureKind) ? raw.failureKind : "UNKNOWN", summary: redact(String(raw.summary ?? "").slice(0, 500)), logs, changedFiles: Array.isArray(raw.changedFiles) ? raw.changedFiles.filter(x => typeof x === "string" && !x.includes("..") && !x.startsWith("/")).slice(0, 20) : [], attempt: Number.isInteger(raw.attempt) && raw.attempt >= 0 ? raw.attempt : 0 });
}
export function assessDiagnostic(raw, policy = {}) {
  const input = sanitizeEnvelope(raw);
  const evidence = input.logs.map((_, i) => `logs[${i}]`).slice(0, 5);
  const retryAllowed = input.failureKind === "TRANSIENT" && policy.allowIdempotentRetry === true && Number.isInteger(policy.retryBudget) && policy.retryBudget > 0 && input.attempt < policy.retryBudget;
  const nextAction = retryAllowed ? "RETRY_ONCE" : input.logs.length ? "REQUEST_MORE_LOGS" : "ESCALATE";
  return {schema: OUTPUT_SCHEMA, workId: input.workId, checkpoint: input.checkpoint, classification: input.failureKind, hypothesis: retryAllowed ? "Possible transient failure; authorized bounded retry" : "Insufficient verified evidence for automatic repair", evidence, nextAction, confidence: "LOW", patchProposal: null};
}
