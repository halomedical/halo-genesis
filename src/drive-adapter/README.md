# Drive Adapter

`/src/drive-adapter` enforces the **Pass-Through Guarantee**.

- Handles document access through source-of-truth drives (for example, Google Drive or OneDrive).
- Prevents local persistence of medical PDFs in Layer A runtime.
- Supports secure streaming and scoped retrieval without duplicating clinical files.

## Governance Guardrail
Agents write config. Humans write code. No agent has write access to Layer A or C. All data must be scoped by practice_id.
