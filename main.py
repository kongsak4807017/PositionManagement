from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, date
from pathlib import Path
from database import get_db

app = FastAPI(title="CHRO Region 1 Position Tracking API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

def calculate_sla_details(entry_date_str: str, sla_days: int):
    try:
        entry_date = datetime.strptime(entry_date_str[:10], "%Y-%m-%d").date()
    except Exception:
        entry_date = date.today()
    today = date.today()
    days_in_stage = (today - entry_date).days
    days_left = sla_days - days_in_stage
    if days_left < 0:
        status = "BREACHED"
    elif days_left <= 5:
        status = "WARNING"
    else:
        status = "NORMAL"
    return days_in_stage, days_left, status

@app.get("/healthz")
def healthz():
    return {"status": "ok", "service": "chro-hr1-position-management"}

@app.get("/api/overview")
def get_overview():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT p.*, u.province_code, pr.province_name_th
        FROM position_pipeline p
        JOIN organizational_units u ON p.unit_id = u.unit_id
        JOIN provinces pr ON u.province_code = pr.province_code
    """)
    rows = cur.fetchall()

    total = len(rows)
    completed = in_pipeline = breached = warning = normal = 0
    funnel = {"M1": 0, "M2": 0, "M3": 0, "M4": 0, "M5": 0, "M6": 0}
    province_map = {}
    for code, name in [("50","เชียงใหม่"), ("51","ลำพูน"), ("52","ลำปาง"), ("54","แพร่"),
                       ("55","น่าน"), ("56","พะเยา"), ("57","เชียงราย"), ("58","แม่ฮ่องสอน")]:
        province_map[code] = {
            "province_code": code, "province_name_th": name, "total": 0,
            "wip": 0, "completed": 0, "breached": 0
        }

    top_escalations = []
    for r in rows:
        m = r["current_milestone"]
        if m in funnel:
            funnel[m] += 1
        p_code = r["province_code"]
        if p_code in province_map:
            province_map[p_code]["total"] += 1

        days_in_stage, days_left, sla_status = calculate_sla_details(r["milestone_entry_date"], r["sla_days"])
        if m == "M6":
            completed += 1
            if p_code in province_map:
                province_map[p_code]["completed"] += 1
        else:
            in_pipeline += 1
            if p_code in province_map:
                province_map[p_code]["wip"] += 1

        if sla_status == "BREACHED" and m != "M6":
            breached += 1
            if p_code in province_map:
                province_map[p_code]["breached"] += 1
            top_escalations.append({
                "position_id": r["position_id"],
                "position_name_th": r["position_name_th"],
                "cadre_group": r["cadre_group"],
                "specialist_name": r["specialist_name"],
                "province_name_th": r["province_name_th"],
                "unit_id": r["unit_id"],
                "current_milestone": m,
                "days_in_stage": days_in_stage,
                "days_overdue": abs(days_left),
                "remarks": r["remarks"],
            })
        elif sla_status == "WARNING" and m != "M6":
            warning += 1
        elif m != "M6":
            normal += 1

    conn.close()
    top_escalations.sort(key=lambda x: x["days_overdue"], reverse=True)
    return {
        "summary": {
            "total_positions": total,
            "in_pipeline": in_pipeline,
            "completed": completed,
            "sla_breached": breached,
            "sla_warning": warning,
            "sla_normal": normal,
            "completion_rate_pct": round((completed / total * 100), 1) if total > 0 else 0,
        },
        "funnel": funnel,
        "provinces": list(province_map.values()),
        "top_escalations": top_escalations[:6],
    }

@app.get("/api/positions")
def list_positions(
    province: Optional[str] = None,
    unit_id: Optional[str] = None,
    cadre: Optional[str] = None,
    milestone: Optional[str] = None,
    sla_status: Optional[str] = None,
    q: Optional[str] = None,
):
    conn = get_db()
    cur = conn.cursor()
    sql = """
        SELECT p.*, u.unit_name, u.unit_type_label, u.province_code, pr.province_name_th,
               m.milestone_name_th, b.tag_name as bottleneck_name
        FROM position_pipeline p
        JOIN organizational_units u ON p.unit_id = u.unit_id
        JOIN provinces pr ON u.province_code = pr.province_code
        JOIN milestones m ON p.current_milestone = m.milestone_code
        LEFT JOIN bottleneck_tags b ON p.bottleneck_tag_id = b.tag_id
        WHERE 1=1
    """
    params = []
    if province:
        sql += " AND u.province_code = ?"
        params.append(province)
    if unit_id:
        sql += " AND p.unit_id = ?"
        params.append(unit_id)
    if cadre:
        sql += " AND p.cadre_group = ?"
        params.append(cadre)
    if milestone:
        sql += " AND p.current_milestone = ?"
        params.append(milestone)
    if q:
        sql += " AND (p.position_id LIKE ? OR p.position_name_th LIKE ? OR p.specialist_name LIKE ? OR u.unit_name LIKE ?)"
        term = f"%{q}%"
        params.extend([term, term, term, term])

    cur.execute(sql, params)
    rows = cur.fetchall()
    conn.close()

    results = []
    for r in rows:
        days_in_stage, days_left, status = calculate_sla_details(r["milestone_entry_date"], r["sla_days"])
        if sla_status and status != sla_status:
            continue
        item = dict(r)
        item["days_in_stage"] = days_in_stage
        item["days_left"] = days_left
        item["sla_status"] = status
        results.append(item)
    return {"total": len(results), "positions": results}

@app.get("/api/positions/{position_id}")
def get_position_detail(position_id: str):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT p.*, u.unit_name, u.unit_type_label, u.province_code, pr.province_name_th,
               m.milestone_name_th, b.tag_name as bottleneck_name
        FROM position_pipeline p
        JOIN organizational_units u ON p.unit_id = u.unit_id
        JOIN provinces pr ON u.province_code = pr.province_code
        JOIN milestones m ON p.current_milestone = m.milestone_code
        LEFT JOIN bottleneck_tags b ON p.bottleneck_tag_id = b.tag_id
        WHERE p.position_id = ?
    """, (position_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Position not found")

    position = dict(row)
    days_in_stage, days_left, status = calculate_sla_details(position["milestone_entry_date"], position["sla_days"])
    position["days_in_stage"] = days_in_stage
    position["days_left"] = days_left
    position["sla_status"] = status

    cur.execute("""
        SELECT h.*, b.tag_name as bottleneck_name
        FROM pipeline_event_history h
        LEFT JOIN bottleneck_tags b ON h.bottleneck_tag_id = b.tag_id
        WHERE h.position_id = ?
        ORDER BY h.transition_date DESC
    """, (position_id,))
    history = [dict(h) for h in cur.fetchall()]
    conn.close()
    return {"position": position, "history": history}

class TransitionRequest(BaseModel):
    to_milestone: str
    transition_date: Optional[str] = None
    reference_doc_no: Optional[str] = None
    bottleneck_tag_id: Optional[int] = None
    notes: Optional[str] = None
    updated_by_user: str = "HR Officer"
    hrops_synced: Optional[int] = 0

@app.post("/api/positions/{position_id}/transition")
def transition_position(position_id: str, req: TransitionRequest):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT current_milestone FROM position_pipeline WHERE position_id = ?", (position_id,))
    current = cur.fetchone()
    if not current:
        conn.close()
        raise HTTPException(status_code=404, detail="Position not found")

    from_milestone = current["current_milestone"]
    cur.execute("SELECT default_sla_days FROM milestones WHERE milestone_code = ?", (req.to_milestone,))
    m_info = cur.fetchone()
    sla_days = m_info["default_sla_days"] if m_info else 30
    trans_date = req.transition_date or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry_date = trans_date[:10]

    cur.execute("""
        UPDATE position_pipeline
        SET current_milestone = ?, milestone_entry_date = ?, sla_days = ?,
            bottleneck_tag_id = ?, hrops_synced = ?, remarks = COALESCE(?, remarks),
            updated_at = CURRENT_TIMESTAMP
        WHERE position_id = ?
    """, (req.to_milestone, entry_date, sla_days, req.bottleneck_tag_id, req.hrops_synced, req.notes, position_id))

    cur.execute("""
        INSERT INTO pipeline_event_history (
            position_id, from_milestone, to_milestone, transition_date,
            updated_by_user, reference_doc_no, bottleneck_tag_id, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        position_id, from_milestone, req.to_milestone, trans_date,
        req.updated_by_user, req.reference_doc_no, req.bottleneck_tag_id, req.notes,
    ))
    conn.commit()
    conn.close()
    return {"status": "success", "position_id": position_id, "current_milestone": req.to_milestone}

@app.get("/api/analytics/bottlenecks")
def get_bottleneck_analytics():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        SELECT b.tag_name, b.severity_level, COUNT(p.position_id) as count
        FROM bottleneck_tags b
        LEFT JOIN position_pipeline p
          ON p.bottleneck_tag_id = b.tag_id
         AND p.current_milestone != 'M6'
        GROUP BY b.tag_id, b.tag_name, b.severity_level
        ORDER BY count DESC
    """)
    bottlenecks = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT milestone_entry_date, sla_days FROM position_pipeline WHERE current_milestone != 'M6'")
    rows = cur.fetchall()
    conn.close()

    aging = {"range_0_30": 0, "range_31_60": 0, "range_over_60": 0}
    for r in rows:
        days, _, _ = calculate_sla_details(r["milestone_entry_date"], r["sla_days"])
        if days <= 30:
            aging["range_0_30"] += 1
        elif days <= 60:
            aging["range_31_60"] += 1
        else:
            aging["range_over_60"] += 1
    return {"bottlenecks": bottlenecks, "aging": aging}

@app.get("/api/masters")
def get_master_data():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM provinces ORDER BY province_code")
    provinces = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM organizational_units ORDER BY province_code, unit_type_label, unit_name")
    units = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM milestones ORDER BY milestone_code")
    milestones = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM bottleneck_tags ORDER BY tag_id")
    bottlenecks = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"provinces": provinces, "units": units, "milestones": milestones, "bottlenecks": bottlenecks}

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
def serve_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "CHRO Region 1 Position Tracking API running. Visit /docs for OpenAPI specs."}
