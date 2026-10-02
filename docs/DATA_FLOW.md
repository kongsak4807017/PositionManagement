# CHRO HR1 — Data Flow, Database and User Governance

เอกสารนี้กำหนด **source of truth**, การเกิดข้อมูล, monthly reconciliation, RBAC และ audit trail สำหรับระบบ CHRO HR1

## 1. Data sources

ระบบรับข้อมูลหลัก 2 ชุด และไม่ให้ชุดใดเขียนทับอีกชุดโดยตรง

1. **HROPS Monthly Baseline** — ไฟล์ `.xlsx` ประมาณ 50 MB นำเข้าเดือนละครั้ง โดยงานบริหารทรัพยากรบุคคลของสำนักงานเขตสุขภาพ
2. **Operational Vacancy Data** — ข้อมูล workflow ที่ สสจ. / รพศ. / รพท. บันทึกระหว่างการบริหารตำแหน่งว่างแต่ละตำแหน่ง

## 2. End-to-end data flow

```mermaid
flowchart TD
    A[HROPS Central] -->|Monthly XLSX ~50 MB| B[Regional HR Upload]
    B --> C[Immutable HROPS File Store]
    C --> D[HROPS Import Run]
    D --> E[Staging Rows]
    E --> F{Schema / Code / Duplicate Validation}
    F -->|Pass| G[Monthly HROPS Snapshot]
    F -->|Exception| X[Reconciliation Exception Queue]
    G --> H[Position Identity Matching]
    H --> I[Position Master]

    U[SSJ / Regional-General Hospital / General Hospital HR User] --> L[Login]
    L --> M[JWT + Role + Data Scope]
    M --> N[Vacancy Case]
    N --> O[Vacancy Event Timeline]
    O --> P[Documents / Approval References]
    N --> I

    I --> Q[Monthly Reconciliation]
    G --> Q
    Q --> R{Difference Detected?}
    R -->|No| S[Confirmed Baseline]
    R -->|Yes| X
    X --> T[Regional HR Review]
    T --> S

    S --> V[Dashboard / SLA / Aging / Bottleneck]
    O --> V
    V --> W[Executive / Province / Hospital Views]
```

### Core rule

- HROPS = **authoritative monthly baseline**
- Area-entered data = **authoritative operational workflow history**
- `Position Master` = stable identity of a position
- `Vacancy Case` = one vacancy episode; the same position can have multiple cases over time
- `Vacancy Event` = immutable timeline of actions/status changes
- Monthly import creates a **new snapshot**; it never destroys the prior month

## 3. HROPS import state

```mermaid
stateDiagram-v2
    [*] --> RECEIVED
    RECEIVED --> STAGING: file accepted + SHA256
    STAGING --> VALIDATING
    VALIDATING --> REJECTED: schema/data errors
    VALIDATING --> RECONCILING: validation passed
    RECONCILING --> REVIEW_REQUIRED: unmatched / material differences
    RECONCILING --> CONFIRMED: no material exception
    REVIEW_REQUIRED --> CONFIRMED: Regional HR approves reconciliation
    REJECTED --> [*]
    CONFIRMED --> [*]
```

The uploaded original file is retained as immutable evidence with filename, baseline month, SHA-256, size, uploader and timestamp.

## 4. Vacancy workflow

```mermaid
flowchart LR
    V0[Vacancy Detected] --> V1[M1 Confirm Vacancy / Intent]
    V1 --> V2[M2 Review / Approval]
    V2 --> A{Retirement vacancy?}
    A -->|Yes| B{บค.สป. approved use?}
    B -->|No| C[WAITING_APPROVAL]
    C --> B
    B -->|Yes| D[Record document no. / date / usable-from date]
    A -->|No| E[M3 Ready for action]
    D --> E
    E --> F[M4 Recruitment]
    F --> G[M5 Selection / Appointment]
    G --> H[M6 Report for duty + HROPS update]
    H --> I[FILLED / Close Vacancy Case]
```

For retirement vacancies, the approval check is a workflow gate rather than a cosmetic checkbox. The event must retain the approval document reference and effective date.

## 5. Database relationship

```mermaid
erDiagram
    PROVINCES ||--o{ ORGANIZATIONAL_UNITS : contains
    PROVINCES ||--o{ USERS : scopes
    ORGANIZATIONAL_UNITS ||--o{ USERS : scopes
    ORGANIZATIONAL_UNITS ||--o{ POSITIONS : owns
    USERS ||--o{ HROPS_IMPORT_RUNS : uploads
    HROPS_IMPORT_RUNS ||--o{ HROPS_STAGING_ROWS : contains
    HROPS_IMPORT_RUNS ||--o{ HROPS_POSITION_SNAPSHOTS : publishes
    POSITIONS ||--o{ HROPS_POSITION_SNAPSHOTS : matched_to
    POSITIONS ||--o{ VACANCY_CASES : has
    ORGANIZATIONAL_UNITS ||--o{ VACANCY_CASES : responsible_for
    USERS ||--o{ VACANCY_CASES : creates
    VACANCY_CASES ||--o{ VACANCY_EVENTS : timeline
    USERS ||--o{ VACANCY_EVENTS : acts
    USERS ||--o{ AUDIT_LOGS : produces
```

## 6. User roles and data scope

| Role | Scope | HROPS import | Operational write | Audit | Typical user |
|---|---|---:|---:|---:|---|
| `MOPH_ADMIN` | Region-wide | Yes | Yes | Yes | Central/system administrator |
| `REGION_ADMIN` | Region-wide | Yes | Yes | Yes | Regional HR / CHRO admin |
| `REGION_EXECUTIVE` | Region-wide | No | No | No | CHRO executive |
| `PROVINCE_ADMIN` | Own province | No | Yes | No | สสจ. |
| `HOSPITAL_HR` | Own organization | No | Yes | No | รพศ. / รพท. / permitted hospital |
| `AUDITOR` | Region-wide | No | No | Yes | Audit / governance reviewer |

### Scope enforcement

```mermaid
flowchart TD
    A[User Login] --> B[Verify password]
    B --> C[Issue signed JWT]
    C --> D[API request]
    D --> E[Load user role + scope]
    E --> F{Role}
    F -->|MOPH / Region Admin| G[All Region 1]
    F -->|Executive / Auditor| H[All Region 1 Read Only]
    F -->|Province Admin| I[province_code only]
    F -->|Hospital HR| J[unit_id only]
    G --> K[Database query/write]
    H --> K
    I --> K
    J --> K
    K --> L[Audit log on sensitive action]
```

A UI filter is **not** a security boundary. Scope is enforced again inside the API before each write.

## 7. Reconciliation rules

Recommended comparison keys in order:

1. stable `CHRO Position ID`
2. HROPS position number
3. organizational unit code + position attributes where an explicit mapping is approved

Monthly comparison should identify:

- newly created position
- filled → vacant
- vacant → filled
- position type/name/level change
- organizational-unit change
- HROPS record disappeared
- local vacancy closed but HROPS still vacant
- local vacancy active but HROPS shows filled
- unmatched HROPS row

No mismatch should silently modify a historical `Vacancy Case`.

## 8. Hierarchical process status per position

Every active vacancy case has two separate workflow dimensions:

- `current_milestone` = lifecycle milestone (M1–M6)
- `process_level + process_status` = where the case is currently being considered and what decision/action is pending

```mermaid
flowchart LR
    H[รพ./หน่วยงานต้นทาง] --> P1[บค.สสจ. ตรวจสอบ]
    P1 --> P2[CHRO จังหวัด พิจารณา]
    P2 --> R1[CHRO เขต พิจารณา]
    R1 --> M[สป. / ส่วนกลาง]
    M --> A1[อนุมัติ บรรจุผู้สอบแข่งขัน]
    M --> A2[อนุมัติ บรรจุผู้ได้รับคัดเลือก]
    M --> A3[อนุมัติ ปรับปรุง]
    M --> A4[อนุมัติ ยุบกำหนดตำแหน่งสูงขึ้น]
    M --> A5[อนุมัติ รับย้าย / รับโอน]
    M --> A6[อนุมัติ เลื่อน / เกลี่ย]
    M --> A7[อนุมัติ เปลี่ยนตำแหน่ง / ประเภทการจ้าง]
    M --> A8[อนุมัติ จ้างทดแทน / อื่นๆ]
    A1 --> D[ดำเนินการเสร็จสิ้น]
    A2 --> D
    A3 --> D
    A4 --> D
    A5 --> D
    A6 --> D
    A7 --> D
    A8 --> D
```

### Process-level write permissions

| User role | จังหวัด | เขต | สป. | เสร็จสิ้น |
|---|---:|---:|---:|---:|
| `HOSPITAL_HR` | Yes | No | No | No |
| `PROVINCE_ADMIN` | Yes | Yes (ส่งต่อ/ระบุว่าถึงเขต) | No | No |
| `REGION_ADMIN` | Yes | Yes | Yes | Yes |
| `MOPH_ADMIN` | Yes | Yes | Yes | Yes |
| Executive / Auditor | Read only | Read only | Read only | Read only |

For transfer/accept-transfer statuses, `process_detail` stores the person/reference detail requested by the operational workflow. Every change is also written to the vacancy event/audit trail.

## 9. Audit minimum

Record at least:

- successful / failed login
- user creation and role/scope change
- HROPS upload/import/confirmation
- vacancy creation
- every workflow/status change
- retirement-use approval
- administrative changes

Audit rows are append-only application records. Production database access should additionally be logged at infrastructure level.
