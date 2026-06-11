# PDF Filler sidecar (Python)

Halo Genesis proxies PDF extraction and fill to this service. Deploy it separately from the Node monolith (Railway, Fly.io, Cloud Run, etc.).

**Full architecture, branch layout, Supabase cache, and security model:** [`docs/PDF_FILLER_INTEGRATION_BLUEPRINT.md`](../../docs/PDF_FILLER_INTEGRATION_BLUEPRINT.md).

Railway artifacts in this folder (`Dockerfile`, `railway.toml`, `start.sh`) are templates — copy them into the **pdf-filler** repo that contains `api.py`.

## Source

**Canonical repository:** [halomedical/pdf-mapper-endpoint](https://github.com/halomedical/pdf-mapper-endpoint) (`api.py`, `pdf_json_pipeline.py`). Deploy that repo on Railway; do not deploy halo-genesis for the extractor.

Legacy name: pdf-filler sidecar. Deployment templates in this folder mirror the mapper endpoint repo.

## Run locally

```bash
cd /path/to/pdf-filler
pip install -r requirements.txt
export GEMINI_API_KEY=...
python api.py
# listens on http://localhost:8000
```

## Genesis configuration

In halo-genesis `.env`:

```bash
PDF_FILLER_SERVICE_URL=http://localhost:8000
# optional shared secret for server-to-server calls
PDF_FILLER_SERVICE_SECRET=
```

## Endpoints (server-to-server)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness |
| POST | `/api/extract-schema` | multipart `file` → JSON Schema |
| POST | `/api/fill` | JSON `{ pdf_base64, schema, answers }` → PDF bytes |

The browser must **not** call the sidecar directly; only Express `/api/pdf-filler/*` does.
