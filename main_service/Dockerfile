FROM python:3.11-slim

WORKDIR /app

# 台灣單一區域服務：container 一律跑台灣時間，datetime.now() 直接是 +8。
# slim image 沒帶 zoneinfo，要裝 tzdata 才認得 Asia/Taipei。
ENV TZ=Asia/Taipei

# libpq-dev/gcc 給 psycopg2（alembic 同步 driver）；tzdata 給時區。
RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc tzdata \
    && ln -fs /usr/share/zoneinfo/Asia/Taipei /etc/localtime \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt psycopg2-binary

COPY . .

EXPOSE 8000

# 啟動前先跑 migration，再起 gunicorn
CMD alembic upgrade head && \
    gunicorn main:app \
      -w 4 \
      -k uvicorn.workers.UvicornWorker \
      --bind 0.0.0.0:8000 \
      --timeout 120 \
      --access-logfile - \
      --error-logfile -
