FROM python:3.11-slim

WORKDIR /app

# psycopg2 給 alembic (同步 driver)
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt psycopg2-binary

COPY . .

EXPOSE 8000

# 啟動前先跑 migration
CMD alembic upgrade head && \
    gunicorn main:app \
      -w 4 \
      -k uvicorn.workers.UvicornWorker \
      --bind 0.0.0.0:8000 \
      --timeout 120 \
      --access-logfile - \
      --error-logfile -
