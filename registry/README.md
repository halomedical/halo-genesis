# Registry Bridge

`/registry` is the **Bridge** between core orchestration and extension activation.

- Contains `extensions.json` as the activation manifest.
- Provides the configuration handoff point from Layer A runtime to Layer C modules.
- Enables practice-specific module activation through declarative config.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.