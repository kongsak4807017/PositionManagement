# CHRO HR1 Position Management

ระบบติดตามการบริหารตำแหน่ง เขตสุขภาพที่ 1 (CHRO-HR1) สำหรับติดตาม Position Pipeline, Milestone M1–M6, SLA, bottleneck และประวัติการเปลี่ยนสถานะ

## Architecture

- Frontend: HTML + Tailwind CSS
- API: FastAPI
- Database: SQLite (prototype)
- Container: Docker / Docker Compose

## Run locally

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python init_db.py
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open http://127.0.0.1:8000

## Docker

```bash
docker build -t chro-hr1 .
docker run --rm -p 8000:8000 chro-hr1
```

## GitHub Pages

`docs/` contains a static preview. GitHub Pages can host only the static preview; the FastAPI/SQLite write API requires a server or container runtime.

## Source

Prepared from the CHRO HR1 Google Drive deployment bundle on 2026-09-28.