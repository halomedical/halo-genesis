# Copy this Dockerfile into the pdf-filler repository root for Railway deploy.
# halo-genesis does not ship the Python implementation here.

FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN chmod +x /app/start.sh

RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

CMD ["/app/start.sh"]
