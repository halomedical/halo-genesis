# Unified UI Shell

`/src/shell` is the **Unified UI** served to all practices via configuration.

- Delivers one shared interface baseline across practices.
- Uses configuration to control practice-specific behavior rather than forking core UI.
- Keeps Layer A UI stable while enabling modular extension points.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.
