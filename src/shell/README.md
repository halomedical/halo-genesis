# Unified UI Shell

`/src/shell` is the **Unified UI** served to all practices via configuration.

- Frontend source for the web shell now lives directly in this folder.
- Build output is generated at `/src/shell/dist` and served by the Layer A server.
- Former `client` and `client-mobile` code is consolidated under this shell path.

## Expected Coupling
- The shell imports extension UI from Layer C via explicit module aliases (for example, admin and scribe entrypoints).
- Extensions call core APIs through stable adapters/contracts rather than direct ownership of Layer A internals.
- Activation remains configuration-driven through `registry/extensions.json` and practice config flags.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.
