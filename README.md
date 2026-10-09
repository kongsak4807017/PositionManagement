# CHRO HR1 Position Management

## J18 baseline (September 2569)

GitHub Pages loads the verified Region 1 J18/HROPS baseline dated **1 September 2569**.

- Total positions: **39,607**
- Occupied: **36,027**
- Vacant: **3,580**
- Public preview excludes person-level identifiers and compensation fields.
- J18 baseline data is kept separate from operational workflow fields (M1-M6, SLA, bottlenecks), which must be maintained by responsible HR users.


ระบบบริหารตำแหน่งว่าง เขตสุขภาพที่ 1 — **Position Master + HROPS Monthly Baseline + Vacancy Workflow + Audit Trail**

Repository นี้มี 2 surface แยกกัน:

1. **GitHub Pages Full Interactive Preview v2** — prototype สำหรับทดสอบ UX/workflow โดยใช้ browser `localStorage`
2. **Production Server Foundation v3** — FastAPI + PostgreSQL + JWT login + RBAC/data scope + audit + HROPS immutable upload registry

## Data architecture

หลักการสำคัญคือ **HROPS ไม่เขียนทับข้อมูล workflow ของพื้นที่**

- HROPS `.xlsx` รายเดือน = authoritative baseline snapshot
- สสจ. / รพศ. / รพท. = operational vacancy workflow
- Position = stable identity
- Vacancy Case = เหตุการณ์ตำแหน่งว่างหนึ่งรอบ
- Vacancy Event = timeline แบบ append-only
- ทุกเดือนทำ reconciliation ระหว่าง snapshot กับ Position/Vacancy state

ดู Mermaid flow, HROPS state, RBAC และ ER diagram: [`docs/DATA_FLOW.md`](docs/DATA_FLOW.md)

## Production roles

| Role | Data scope | Write |
|---|---|---:|
| `MOPH_ADMIN` | Region-wide | Yes |
| `REGION_ADMIN` | Region-wide | Yes |
| `REGION_EXECUTIVE` | Region-wide | No |
| `PROVINCE_ADMIN` | Own province | Yes |
| `HOSPITAL_HR` | Own organization | Yes |
| `AUDITOR` | Region-wide audit/read | No |

Scope enforcement อยู่ที่ API ไม่ใช่แค่การซ่อนเมนูใน UI

## Production stack

- FastAPI
- PostgreSQL 16
- SQLAlchemy
- JWT access token
- bcrypt password hashing
- Nginx TLS reverse proxy
- Docker Compose
- persistent HROPS file volume
- append-only application audit log

## Local server test

```bash
docker compose up -d --build
docker compose exec chro-hr1-app python production.py init-reference
docker compose exec chro-hr1-app python production.py bootstrap-admin \
  --username admin \
  --password 'ChangeThisStrongPassword' \
  --full-name 'CHRO Administrator' \
  --role REGION_ADMIN
```

Open `http://127.0.0.1:8000`

- `/` — authenticated production console
- `/docs` — OpenAPI
- `/healthz` — health endpoint

## Ministry server deployment

See [`docs/DEPLOYMENT_MOPH.md`](docs/DEPLOYMENT_MOPH.md).

```bash
cp .env.example .env
# edit secrets/hostname/TLS settings
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build
```

No production password, database password or JWT secret is stored in the repository.

## HROPS monthly upload

Monthly update is designed for **`REGION_ADMIN` (บค.สำนักงานเขตสุขภาพ)** and `MOPH_ADMIN`.

Production UI flow:

```text
Login as REGION_ADMIN
  -> choose baseline month
  -> select J.18 .xlsx
  -> JavaScript validates extension/size and shows upload progress
  -> POST /api/hrops/imports
  -> server stores original file + SHA-256
  -> openpyxl read_only reads Sheet 2 "เขต 1"
  -> validate technical header row 6
  -> UPSERT Position Master inside database transaction
  -> write monthly HROPS Position Snapshot + Audit Log
  -> COMMIT on success / ROLLBACK database changes on processing failure
  -> show Insert / Update / Unchanged / Vacant / Skipped + Import History
```

### Large file support

The expected monthly J.18 file is approximately **36–50 MB**. The implementation does **not** parse this workbook in the browser. JavaScript only handles selection, role check, upload progress, timeout and result display; workbook processing happens on the server.

- browser pre-check: up to 95 MB
- application default `MAX_HROPS_UPLOAD_MB`: 100 MB
- Nginx `client_max_body_size`: 120 MB
- upload / processing timeout: 15 minutes
- server upload copy: 1 MB chunks
- Excel reader: `openpyxl(load_workbook(..., read_only=True, data_only=True))`
- duplicate same-month/same-SHA upload: rejected
- HROPS updates Position Master; it does not overwrite Vacancy Workflow/Event data entered byพื้นที่

This design is suitable for the current 36–50 MB file range. Actual Ministry server sizing should still be load-tested with the real monthly workbook before production cutover.


## Production database model

The production schema in `production.py` includes:

- `provinces`
- `organizational_units`
- `users`
- `positions`
- `hrops_import_runs`
- `hrops_staging_rows`
- `hrops_position_snapshots`
- `vacancy_cases`
- `vacancy_events`
- `audit_logs`

For retirement vacancies, the operational event can record:

- approval status
- approval document number
- approval document date
- date the position becomes usable

## Repository structure

```text
production.py                Production API/database/auth/RBAC
docs/DATA_FLOW.md            Mermaid data flow, RBAC, ERD
docs/DEPLOYMENT_MOPH.md      Ministry server deployment/security guide
deploy/docker-compose.prod.yml
deploy/nginx.conf
.env.example
Dockerfile
index.html                   GitHub Pages Preview v2
assets/                      GitHub Pages preview assets
main.py / database.py        Legacy FastAPI/SQLite prototype retained for reference
```

## GitHub Pages Preview v2

The static preview remains available and is intentionally isolated from the production database/authentication stack. It is a workflow prototype, not a security boundary or production database.

## Production governance note

Before real personnel data is loaded, the deployment should pass the Ministry/organizational security, privacy, infrastructure, backup/restore, user-access and HROPS data-dictionary approval process.
