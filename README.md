# Halo Genesis (Layer A - Core)

This root is the **Immutable Shell**.

- Ownership: human-written only.
- Role: define and protect the stable core platform surface used by all practices.
- Scope: host foundational runtime, orchestration, and configuration entry points for Layer A.

## Expected Coupling
- Layer A may import extension modules from Layer C only through explicit extension entrypoints.
- Layer A provides shared APIs/contracts (auth, drive-adapter, agent-executor, orchestrator) consumed by extensions.
- Layer A does not embed extension business logic; extensions remain owned in `halo-components`.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.
Validation ping.
