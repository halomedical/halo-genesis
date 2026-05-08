# Agent Executor

`/src/agent-executor` is the central hub for all LLM calls and usage metering.

- Routes model requests through a single execution boundary.
- Captures usage, cost, and telemetry for governance and billing.
- Standardizes invocation patterns for all downstream agents and modules.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.
