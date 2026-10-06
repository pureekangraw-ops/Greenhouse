# Genome and Lyra Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create testable server-side Genome and Lyra agent cores with evidence-aware responses.
**Architecture:** Shared policy runtime with isolated roles/modes, optional injected model and no implicit external execution.
**Tech Stack:** Node.js built-in test runner, ES modules, no dependencies.
**Spec:** docs/agents-design.md

## Global Constraints
- Preserve existing frontend mock behavior.
- No default endpoints, credentials, Work identities or commercial facts.
- Separate SHOP, OFFICE and Observatory contexts.
- Offline tests do not prove model quality or live integration.

## Review Focus
- Cross-customer/session leakage: isolated context and mode mismatch tests.
- Malformed provider output: reject unsafe fields and missing reply.
- Missing/expired evidence: no exact pin or browser proposal.
- Duplicate command/result mismatch: cannot mark complete from dispatch-only receipt.
- Provider outage: return a useful policy reply with UNKNOWN model status.

### Task 1: Policy and role prompts
**Files:** src/agents/policy.mjs, src/agents/prompts.mjs, test/agents.test.mjs
**Interfaces:** evaluateAgent(input, now) returns a trusted plan with agent/mode/action/status/reply/evidence/proposal; getPrompt(agent, mode) returns role prompt.
- [x] Write scenario tests; run node --test and observe missing implementation.
- [x] Implement policy and prompts; run whole suite.

### Task 2: Agent runtime
**Files:** src/agents/runtime.mjs, test/runtime.test.mjs
**Interfaces:** createAgent({agent,mode,provider,clock}).respond(input); optional provider receives system/context/policy and returns {reply}; actions remain policy-owned.
- [x] Write provider/role/context safety tests and observe failures.
- [x] Implement runtime and run npm test.

### Task 3: Training scenarios, documentation and CI
**Files:** training/scenarios.mjs, scripts/evaluate-agents.mjs, .github/workflows/agents.yml, package.json, docs/agents.md
- [x] Write cases for both roles; run offline policy evaluation.
- [x] Document use and unknown live/model boundaries; verify syntax, all tests and evaluation.
- [x] Review changes, create feature PR, inspect remote head and CI.

## Verification

`npm run check`, `npm test` (28/28), `npm run evaluate:agents` (16/16 offline policy scenarios), and `git diff --check` passed. Independent review found target identity, sensitive field, map action, and coordinate lifetime issues; regression tests first reproduced them and the final implementation passed. Model/provider and Hub/device E2E remain unverified.
