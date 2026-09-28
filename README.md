# CHRO HR1 Position Management

ระบบติดตามการบริหารตำแหน่ง เขตสุขภาพที่ 1 (CHRO-HR1) สำหรับ Position Pipeline, Milestone M1–M6, SLA, bottleneck, governance escalation และ audit trail

## GitHub Pages — Full Interactive Preview v2

Preview v2 เป็น static interactive prototype ที่ทำงานบน GitHub Pages โดยไม่ต้องมี backend และเก็บการเปลี่ยนแปลงไว้ใน browser ผ่าน `localStorage`.

### Functional preview

- Executive dashboard: KPI, WIP, M1–M6 funnel, province progress และ priority escalation
- Position management: search/filter, create, edit, delete (Regional Admin), milestone update และ HROPS flag
- Audit timeline: create/update/transition history พร้อมผู้ดำเนินการ เลขเอกสาร และหมายเหตุ
- Analytics: aging, bottleneck ranking, SLA by province และ milestone × SLA matrix
- Governance: CHRO escalation queue และ local action notes
- Role simulation: Executive, Regional Admin, Provincial Gatekeeper และ Hospital HR พร้อม scope/permission ต่างกัน
- Data tools: CSV export, JSON backup/restore และ reset-to-seed
- Seed dataset: 22 demo positions จาก CHRO HR1 webapp bundle

> Preview v2 เป็น workflow prototype ไม่ใช่ production database. Google Sheets live sync, authentication และ HROPS integration ยังแสดงสถานะเป็น Not connected อย่างชัดเจน.

## Full FastAPI prototype

Repository ยังเก็บ FastAPI + SQLite prototype สำหรับทดสอบ server-side API.

### Run locally

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python init_db.py
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open http://127.0.0.1:8000

### Docker

```bash
docker build -t chro-hr1 .
docker run --rm -p 8000:8000 chro-hr1
```

## Repository structure

- `index.html` — GitHub Pages v2 entrypoint
- `assets/v2-data.js` — static seed/master data
- `assets/v2-app.js` — interactive preview engine
- `static/index.html` — original FastAPI frontend
- `main.py` — FastAPI API
- `database.py`, `init_db.py` — SQLite schema/seed
- `.github/workflows/ci.yml` — backend + static preview CI

## Data governance note

Production implementation should replace browser-local persistence with authenticated central storage, explicit RBAC, audit logging, backup/recovery and approved HROPS/Google Workspace integration.
