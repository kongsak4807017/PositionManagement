FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN addgroup --system chro && adduser --system --ingroup chro chro

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p /data/hrops && chown -R chro:chro /app /data/hrops

USER chro

EXPOSE 8000

CMD ["uvicorn", "production:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
