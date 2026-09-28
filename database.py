import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "chro_pipeline.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_schema():
    conn = get_db()
    cur = conn.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS provinces (
        province_code TEXT PRIMARY KEY,
        province_name_th TEXT NOT NULL,
        health_region TEXT DEFAULT "1"
    );

    CREATE TABLE IF NOT EXISTS organizational_units (
        unit_id TEXT PRIMARY KEY,
        unit_name TEXT NOT NULL,
        unit_type_label TEXT NOT NULL,
        province_code TEXT NOT NULL,
        amphur_name TEXT,
        FOREIGN KEY (province_code) REFERENCES provinces(province_code)
    );

    CREATE TABLE IF NOT EXISTS milestones (
        milestone_code TEXT PRIMARY KEY,
        milestone_name_th TEXT NOT NULL,
        milestone_phase TEXT NOT NULL,
        default_sla_days INTEGER NOT NULL,
        responsible_role TEXT NOT NULL,
        description TEXT
    );

    CREATE TABLE IF NOT EXISTS bottleneck_tags (
        tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag_name TEXT NOT NULL UNIQUE,
        tag_category TEXT,
        severity_level TEXT DEFAULT "MEDIUM"
    );

    CREATE TABLE IF NOT EXISTS position_pipeline (
        position_id TEXT PRIMARY KEY,
        unit_id TEXT NOT NULL,
        position_name_th TEXT NOT NULL,
        cadre_group TEXT NOT NULL,
        specialist_name TEXT,
        employment_type TEXT NOT NULL,
        vacant_date TEXT NOT NULL,
        vacant_reason TEXT NOT NULL,
        management_channel TEXT NOT NULL,
        current_milestone TEXT NOT NULL,
        milestone_entry_date TEXT NOT NULL,
        sla_days INTEGER NOT NULL,
        bottleneck_tag_id INTEGER,
        hrops_synced INTEGER DEFAULT 0,
        remarks TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (unit_id) REFERENCES organizational_units(unit_id),
        FOREIGN KEY (current_milestone) REFERENCES milestones(milestone_code),
        FOREIGN KEY (bottleneck_tag_id) REFERENCES bottleneck_tags(tag_id)
    );

    CREATE TABLE IF NOT EXISTS pipeline_event_history (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id TEXT NOT NULL,
        from_milestone TEXT,
        to_milestone TEXT NOT NULL,
        transition_date TEXT NOT NULL,
        updated_by_user TEXT NOT NULL,
        reference_doc_no TEXT,
        bottleneck_tag_id INTEGER,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES position_pipeline(position_id)
    );
    """)
    conn.commit()
    conn.close()
    print("Database schema created.")

if __name__ == "__main__":
    init_schema()
