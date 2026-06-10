# PDF Filler sidecar (Python)

Halo Genesis proxies PDF extraction and fill to this service. Deploy it separately from the Node monolith (Railway, Fly.io, Cloud Run, etc.).

## Source

Implementation lives in the pdf-filler project (`api.py`, `pdf_json_pipeline.py`). Point deployment at that repo or copy these files into this directory.

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
