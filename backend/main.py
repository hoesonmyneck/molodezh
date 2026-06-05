import os
import threading
from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import (
    AgeDistribution, Categorization, DistrictBreakdown, EduAgg,
    GenderStats, KpiStats, MicroAgg, MigrationStats, NatAgg, NationalityStats, NkzAgg, OkvedAgg, OkvedStats,
    RegionBreakdown, StatusBreakdown, UploadSession, User,
)

Base.metadata.create_all(bind=engine)

# Runtime migrations: add columns that may not exist in older DB schemas
from sqlalchemy import text as _text
_NEW_COLS = [
    ("asp_count",        "INTEGER DEFAULT 0"),
    ("pensioner_count",  "INTEGER DEFAULT 0"),
    ("kandas_count",     "INTEGER DEFAULT 0"),
    ("mnogodetnyi_count","INTEGER DEFAULT 0"),
    ("cbd_count",        "INTEGER DEFAULT 0"),
]
_migrations = [
    ("okved_agg", "region_name",    "VARCHAR(120) DEFAULT ''"),
    ("okved_agg", "contract_count", "INTEGER DEFAULT 0"),
    ("okved_agg", "salary_sum",     "FLOAT DEFAULT 0.0"),
    ("okved_agg", "salary_count",   "INTEGER DEFAULT 0"),
    ("okved_agg", "age_sum",        "FLOAT DEFAULT 0.0"),
    ("okved_agg", "age_count",      "INTEGER DEFAULT 0"),
    ("nat_agg",   "region_name",    "VARCHAR(120) DEFAULT ''"),
    ("nat_agg",   "contract_count", "INTEGER DEFAULT 0"),
    ("nat_agg",   "salary_sum",     "FLOAT DEFAULT 0.0"),
    ("nat_agg",   "salary_count",   "INTEGER DEFAULT 0"),
    ("nat_agg",   "age_sum",        "FLOAT DEFAULT 0.0"),
    ("nat_agg",   "age_count",      "INTEGER DEFAULT 0"),
] + [
    (tbl, col, typ)
    for tbl in ("micro_agg", "okved_agg", "nat_agg")
    for col, typ in _NEW_COLS
] + [
    ("micro_agg", "family_type", "VARCHAR(120) DEFAULT ''"),
    ("nkz_agg",  "salary_sum",   "FLOAT DEFAULT 0.0"),
    ("nkz_agg",  "salary_count", "INTEGER DEFAULT 0"),
    ("nkz_agg",  "age_sum",      "FLOAT DEFAULT 0.0"),
    ("nkz_agg",  "age_count",    "INTEGER DEFAULT 0"),
]
with engine.connect() as _conn:
    for _tbl, _col, _typ in _migrations:
        try:
            _conn.execute(_text(f"ALTER TABLE {_tbl} ADD COLUMN {_col} {_typ}"))
            _conn.commit()
        except Exception:
            pass

app = FastAPI(title="Молодежь РК")

# ── In-memory filter cache (cleared on reprocess/upload) ─────────────────────
_filter_cache: dict = {}
_filter_cache_lock = threading.Lock()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_KEY = "molodezh-rk-2024-xZ9secret"
ALGORITHM = "HS256"
TOKEN_MINUTES = 60 * 8

pwd_context = CryptContext(schemes=["sha256_crypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

DATA_DIR = "/data" if os.path.isdir("/data") else os.path.dirname(__file__)
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ── startup: ensure admin exists ─────────────────────────────────────────────
def _create_admin():
    from database import SessionLocal
    db = SessionLocal()
    if not db.query(User).filter(User.username == "admin").first():
        db.add(User(
            username="admin",
            password_hash=pwd_context.hash("admin"),
            is_admin=True,
        ))
        db.commit()
    db.close()

_create_admin()


# ── auth helpers ──────────────────────────────────────────────────────────────
def _make_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_MINUTES)
    return jwt.encode({"sub": username, "exp": expire}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_admin(current_user: User = Depends(get_current_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin required")
    return current_user


def get_active_session_id(db: Session):
    s = db.query(UploadSession).filter(UploadSession.is_active == True).first()
    return s.id if s else None


# ── Pydantic schemas ──────────────────────────────────────────────────────────
class LoginReq(BaseModel):
    username: str
    password: str

class CreateUserReq(BaseModel):
    username: str
    password: str


# ── Auth routes ───────────────────────────────────────────────────────────────
@app.post("/api/auth/login")
def login(req: LoginReq, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not pwd_context.verify(req.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Неверный логин или пароль")
    return {
        "access_token": _make_token(user.username),
        "token_type": "bearer",
        "is_admin": user.is_admin,
        "username": user.username,
    }


@app.post("/api/auth/users")
def create_user(
    req: CreateUserReq,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Пользователь уже существует")
    u = User(username=req.username, password_hash=pwd_context.hash(req.password), is_admin=False)
    db.add(u)
    db.commit()
    db.refresh(u)
    return {"id": u.id, "username": u.username}


@app.get("/api/auth/users")
def list_users(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    users = db.query(User).order_by(User.id).all()
    return [
        {"id": u.id, "username": u.username, "is_admin": u.is_admin,
         "created_at": u.created_at}
        for u in users
    ]


@app.delete("/api/auth/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if user.username == "admin":
        raise HTTPException(status_code=400, detail="Нельзя удалить admin")
    db.delete(user)
    db.commit()
    return {"ok": True}


# ── Upload routes ─────────────────────────────────────────────────────────────
@app.post("/api/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    session = UploadSession(files_count=len(files), status="pending", progress=0)
    db.add(session)
    db.commit()
    db.refresh(session)

    session_dir = os.path.join(UPLOAD_DIR, str(session.id))
    os.makedirs(session_dir, exist_ok=True)

    file_paths = []
    for f in files:
        safe_name = os.path.basename(f.filename or "file.xlsx")
        dst = os.path.join(session_dir, safe_name)
        with open(dst, "wb") as out:
            while True:
                chunk = await f.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        file_paths.append(dst)

    def _run():
        from database import SessionLocal
        from processor import process_excel_files
        db2 = SessionLocal()
        try:
            process_excel_files(session.id, file_paths, db2)
        except Exception as exc:
            db2.query(UploadSession).filter(UploadSession.id == session.id).update(
                {"status": "error", "error_message": str(exc)[:500]}
            )
            db2.commit()
        finally:
            db2.close()

    with _filter_cache_lock:
        _filter_cache.clear()
    threading.Thread(target=_run, daemon=True).start()
    return {"session_id": session.id, "files": len(files)}


@app.get("/api/upload/progress/{session_id}")
def upload_progress(
    session_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    s = db.query(UploadSession).filter(UploadSession.id == session_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "status": s.status,
        "progress": s.progress,
        "total_records": s.total_records,
        "current_file": s.current_file,
        "error_message": s.error_message,
    }


@app.post("/api/admin/reset-session/{session_id}")
def reset_session_status(
    session_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Force-reset a stuck 'processing' session so it can be reprocessed."""
    sess = db.query(UploadSession).filter(UploadSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    db.query(UploadSession).filter(UploadSession.id == session_id).update({
        "status": "error", "error_message": "Сброшено вручную", "progress": 0, "current_file": "",
    })
    db.commit()
    return {"ok": True}


@app.post("/api/admin/reprocess/{session_id}")
def reprocess_session(
    session_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Re-run processing on already-uploaded files without re-uploading from browser."""
    sess = db.query(UploadSession).filter(UploadSession.id == session_id).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Сессия не найдена")
    if sess.status == "processing":
        raise HTTPException(status_code=400, detail="Сессия уже обрабатывается")

    session_dir = os.path.join(UPLOAD_DIR, str(session_id))
    if not os.path.isdir(session_dir):
        raise HTTPException(status_code=400, detail="Файлы сессии не найдены на диске")

    file_paths = sorted([
        os.path.join(session_dir, f)
        for f in os.listdir(session_dir)
        if f.lower().endswith((".xlsx", ".xls"))
    ])
    if not file_paths:
        raise HTTPException(status_code=400, detail="Нет Excel-файлов в директории сессии")

    with _filter_cache_lock:
        _filter_cache.clear()

    for model in [KpiStats, StatusBreakdown, RegionBreakdown, DistrictBreakdown,
                  AgeDistribution, Categorization, GenderStats, OkvedStats,
                  NationalityStats, MicroAgg, OkvedAgg, NatAgg, NkzAgg, EduAgg, MigrationStats]:
        db.query(model).filter(model.session_id == session_id).delete(synchronize_session=False)
    db.commit()

    db.query(UploadSession).filter(UploadSession.id == session_id).update({
        "status": "pending", "progress": 0, "current_file": "",
        "is_active": False, "error_message": None, "total_records": 0,
    })
    db.commit()

    def _run():
        from database import SessionLocal
        from processor import process_excel_files
        db2 = SessionLocal()
        try:
            process_excel_files(session_id, file_paths, db2)
        except Exception as exc:
            db2.query(UploadSession).filter(UploadSession.id == session_id).update(
                {"status": "error", "error_message": str(exc)[:500]}
            )
            db2.commit()
        finally:
            db2.close()

    threading.Thread(target=_run, daemon=True).start()
    return {"session_id": session_id, "files": len(file_paths)}


@app.get("/api/upload/sessions")
def list_sessions(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    sessions = db.query(UploadSession).order_by(UploadSession.id.desc()).limit(10).all()
    return [
        {
            "id": s.id, "status": s.status, "files_count": s.files_count,
            "total_records": s.total_records, "started_at": s.started_at,
            "completed_at": s.completed_at, "is_active": s.is_active,
        }
        for s in sessions
    ]


# ── Data endpoints ────────────────────────────────────────────────────────────
@app.get("/api/data/kpis")
def get_kpis(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return {"no_data": True}
    kpi = db.query(KpiStats).filter(KpiStats.session_id == sid).first()
    if not kpi:
        return {"no_data": True}
    return {
        "total_persons": kpi.total_persons,
        "total_families": kpi.total_families,
        "working": kpi.working,
        "active_contracts": kpi.active_contracts,
        "avg_salary": kpi.avg_salary,
        "students": kpi.students,
        "tipo_count": kpi.tipo_count,
        "avg_age": kpi.avg_age,
        "median_age": kpi.median_age,
    }


@app.get("/api/data/statuses")
def get_statuses(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(StatusBreakdown)
        .filter(StatusBreakdown.session_id == sid)
        .order_by(StatusBreakdown.count.desc())
        .all()
    )
    return [{"name": r.status_name, "count": r.count} for r in rows]


@app.get("/api/data/regions")
def get_regions(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from sqlalchemy import func
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(
            MicroAgg.region_code, MicroAgg.region_name,
            func.sum(MicroAgg.total_count).label("c"),
            func.sum(MicroAgg.salary_sum).label("sal_sum"),
            func.sum(MicroAgg.salary_count).label("sal_cnt"),
        )
        .filter(MicroAgg.session_id == sid, MicroAgg.region_code != '')
        .group_by(MicroAgg.region_code, MicroAgg.region_name)
        .order_by(func.sum(MicroAgg.total_count).desc())
        .all()
    )
    return [
        {
            "code": r.region_code, "name": r.region_name, "count": int(r.c),
            "avg_salary": round(float(r.sal_sum) / int(r.sal_cnt)) if (r.sal_cnt and int(r.sal_cnt) > 0) else 0,
        }
        for r in rows
    ]


@app.get("/api/data/districts")
def get_districts(
    region_code: str = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sid = get_active_session_id(db)
    if not sid:
        return []
    q = db.query(DistrictBreakdown).filter(DistrictBreakdown.session_id == sid)
    if region_code:
        q = q.filter(DistrictBreakdown.region_code == region_code)
    rows = q.order_by(DistrictBreakdown.count.desc()).all()
    return [
        {
            "region_code": r.region_code, "region_name": r.region_name,
            "district_code": r.district_code, "district_name": r.district_name,
            "count": r.count,
        }
        for r in rows
    ]


@app.get("/api/data/age-groups")
def get_age_groups(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(AgeDistribution)
        .filter(AgeDistribution.session_id == sid)
        .order_by(AgeDistribution.min_age)
        .all()
    )
    return [{"group": r.age_group, "count": r.count} for r in rows]


@app.get("/api/data/categorization")
def get_categorization(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(Categorization)
        .filter(Categorization.session_id == sid)
        .order_by(Categorization.count.desc())
        .all()
    )
    return [{"category": r.category, "count": r.count} for r in rows]


@app.get("/api/data/gender")
def get_gender(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = db.query(GenderStats).filter(GenderStats.session_id == sid).all()
    return [{"gender": r.gender, "count": r.count} for r in rows]


@app.get("/api/data/okved")
def get_okved(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from sqlalchemy import func
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(
            OkvedAgg.okved,
            func.sum(OkvedAgg.total_count).label("c"),
            func.sum(OkvedAgg.salary_sum).label("sal_sum"),
            func.sum(OkvedAgg.salary_count).label("sal_cnt"),
        )
        .filter(OkvedAgg.session_id == sid, OkvedAgg.okved != '')
        .group_by(OkvedAgg.okved)
        .order_by(func.sum(OkvedAgg.total_count).desc())
        .limit(20)
        .all()
    )
    return [
        {
            "name": r.okved, "count": int(r.c),
            "avg_salary": round(float(r.sal_sum) / int(r.sal_cnt)) if (r.sal_cnt and int(r.sal_cnt) > 0) else 0,
        }
        for r in rows
    ]


@app.get("/api/data/nkz")
def get_nkz(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from sqlalchemy import func
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(
            NkzAgg.nkz,
            func.sum(NkzAgg.total_count).label("c"),
            func.sum(NkzAgg.salary_sum).label("sal_sum"),
            func.sum(NkzAgg.salary_count).label("sal_cnt"),
        )
        .filter(NkzAgg.session_id == sid, NkzAgg.nkz != '')
        .group_by(NkzAgg.nkz)
        .order_by(func.sum(NkzAgg.total_count).desc())
        .limit(20)
        .all()
    )
    return [
        {
            "name": r.nkz, "count": int(r.c),
            "avg_salary": round(float(r.sal_sum) / int(r.sal_cnt)) if (r.sal_cnt and int(r.sal_cnt) > 0) else 0,
        }
        for r in rows
    ]


@app.get("/api/data/family-type")
def get_family_type(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    from sqlalchemy import func
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(MicroAgg.family_type, func.sum(MicroAgg.total_count).label("c"))
        .filter(MicroAgg.session_id == sid, MicroAgg.family_type != '')
        .group_by(MicroAgg.family_type)
        .order_by(func.sum(MicroAgg.total_count).desc())
        .all()
    )
    return [{"family_type": r.family_type, "count": int(r.c)} for r in rows]


@app.get("/api/data/edu")
def get_edu(
    edu_type: str = "vuz",
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    from sqlalchemy import func
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(EduAgg.edu_name, func.sum(EduAgg.total_count).label("c"))
        .filter(EduAgg.session_id == sid, EduAgg.edu_type == edu_type, EduAgg.edu_name != '')
        .group_by(EduAgg.edu_name)
        .order_by(func.sum(EduAgg.total_count).desc())
        .all()
    )
    return [{"name": r.edu_name, "count": int(r.c)} for r in rows]


_STATUS_COUNT_COL = {
    "РАБОТАЮЩИЕ": "working_count",
    "АКТИВНЫЙ ТД": "contract_count",
    "СТУДЕНТ": "student_count",
    "ТИПО": "tipo_count",
    "ИП": "ip_count",
    "ЛСИ": "lsi_count",
    "БЕЗРАБОТНЫЕ": "unemployed_count",
    "НЕОХВАЧЕННЫЕ": "uncovered_count",
    "ДЕТИ ОТ 14 ДО 18 ЛЕТ": "under18_count",
    "ИНОСТРАННЫЕ ГРАЖДАНЕ": "foreign_count",
    "БЕРЕМЕННЫЕ": "pregnant_count",
    "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3": "uhod_count",
    "ПО УХОДУ ЗА ЛСИ": "berkut_count",
    "ПОЛУЧАТЕЛИ АСП": "asp_count",
    "ПЕНСИОНЕРЫ": "pensioner_count",
    "КАНДАСЫ": "kandas_count",
    "МНОГОДЕТНЫЕ": "mnogodetnyi_count",
    "ПОЛУЧАТЕЛИ ПОСОБИЙ": "cbd_count",
}
_DIM_COL = {
    "region": "region_code",
    "district": "district_code",
    "age_group": "age_group",
    "gender": "gender",
    "cat": "category",
    "okved": "okved",
    "nkz": "nkz",
    "nationality": "nationality",
    "family_type": "family_type",
}


def _get_primary_table(filters, sid, db):
    """Route to OkvedAgg/NatAgg/NkzAgg/EduAgg when those dims are in the filter list."""
    for dim, _ in filters:
        if dim == "okved":
            return OkvedAgg, db.query(OkvedAgg).filter(OkvedAgg.session_id == sid)
        if dim == "nkz":
            return NkzAgg, db.query(NkzAgg).filter(NkzAgg.session_id == sid)
        if dim == "nationality":
            return NatAgg, db.query(NatAgg).filter(NatAgg.session_id == sid)
        if dim in ("vuz", "tipo", "school"):
            return EduAgg, db.query(EduAgg).filter(EduAgg.session_id == sid)
    return MicroAgg, db.query(MicroAgg).filter(MicroAgg.session_id == sid)


def _build_filtered_query(q, T, filters):
    """Apply all filter dimensions as WHERE clauses to query on model T.
    Returns (q, cnt_col) where cnt_col is total_count or a specific status count."""
    cnt_col = T.total_count
    for dim, val in filters:
        if dim == "status":
            col_name = _STATUS_COUNT_COL.get(val)
            if col_name and hasattr(T, col_name):
                cnt_col = getattr(T, col_name)
                q = q.filter(getattr(T, col_name) > 0)
        elif dim in _DIM_COL:
            attr = _DIM_COL[dim]
            if hasattr(T, attr):
                q = q.filter(getattr(T, attr) == val)
        elif dim in ("vuz", "tipo", "school"):
            if hasattr(T, "edu_type") and hasattr(T, "edu_name"):
                q = q.filter(T.edu_type == dim, T.edu_name == val)
        elif dim == "age_exact":
            try:
                if hasattr(T, "age_val"):
                    q = q.filter(T.age_val == int(val))
            except (ValueError, TypeError):
                pass
        elif dim == "age_gte":
            try:
                v = int(val)
                if hasattr(T, "age_val"):
                    q = q.filter(T.age_val >= v, T.age_val > 0)
            except (ValueError, TypeError):
                pass
        elif dim == "age_lte":
            try:
                v = int(val)
                if hasattr(T, "age_val"):
                    q = q.filter(T.age_val <= v, T.age_val > 0)
            except (ValueError, TypeError):
                pass
        elif dim == "age_between":
            try:
                lo, hi = val.split(":")
                if hasattr(T, "age_val"):
                    q = q.filter(T.age_val >= int(lo), T.age_val <= int(hi), T.age_val > 0)
            except Exception:
                pass
    return q, cnt_col


@app.get("/api/data/filter")
def get_filtered_data(
    f: List[str] = Query(default=[]),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sid = get_active_session_id(db)
    if not sid:
        return {"no_data": True}

    filters = []
    for item in f:
        if ":" in item:
            dim, val = item.split(":", 1)
            filters.append((dim.strip(), val.strip()))
    if not filters:
        return {"no_data": True}

    # ── Cache check ───────────────────────────────────────────────────────────
    cache_key = (sid, tuple(sorted(f)))
    with _filter_cache_lock:
        if cache_key in _filter_cache:
            return _filter_cache[cache_key]

    from sqlalchemy import func

    # ── Primary table: MicroAgg normally; OkvedAgg/NatAgg when that dim is filtered ──
    T, base_q = _get_primary_table(filters, sid, db)
    q, cnt_col = _build_filtered_query(base_q, T, filters)
    c = lambda name: getattr(T, name)  # noqa: E731

    kpi = q.with_entities(
        func.sum(cnt_col).label("total"),
        func.sum(c("working_count")).label("working"),
        func.sum(c("student_count")).label("students"),
        func.sum(c("tipo_count")).label("tipo"),
        func.sum(c("contract_count")).label("contracts"),
        func.sum(c("salary_sum")).label("sal_sum"),
        func.sum(c("salary_count")).label("sal_cnt"),
        func.sum(c("age_sum")).label("age_sum"),
        func.sum(c("age_count")).label("age_cnt"),
    ).first()

    if not kpi or (kpi.total or 0) == 0:
        return {"no_data": True}

    sal_s = float(kpi.sal_sum or 0)
    sal_c = int(kpi.sal_cnt or 0)
    age_s = float(kpi.age_sum or 0)
    age_c = int(kpi.age_cnt or 0)

    kpis = {
        "total_persons": int(kpi.total or 0),
        "working": int(kpi.working or 0),
        "students": int(kpi.students or 0),
        "tipo_count": int(kpi.tipo or 0),
        "active_contracts": int(kpi.contracts or 0),
        "avg_salary": round(sal_s / sal_c) if sal_c > 0 else 0,
        "avg_age": round(age_s / age_c, 1) if age_c > 0 else 0,
        "median_age": None,
    }

    st = q.with_entities(
        func.sum(c("working_count")).label("working"),
        func.sum(c("student_count")).label("student"),
        func.sum(c("ip_count")).label("ip"),
        func.sum(c("lsi_count")).label("lsi"),
        func.sum(c("unemployed_count")).label("unemployed"),
        func.sum(c("uncovered_count")).label("uncovered"),
        func.sum(c("under18_count")).label("under18"),
        func.sum(c("foreign_count")).label("foreign"),
        func.sum(c("pregnant_count")).label("pregnant"),
        func.sum(c("uhod_count")).label("uhod"),
        func.sum(c("berkut_count")).label("berkut"),
        func.sum(c("asp_count")).label("asp"),
        func.sum(c("pensioner_count")).label("pensioner"),
        func.sum(c("kandas_count")).label("kandas"),
        func.sum(c("mnogodetnyi_count")).label("mnogodetnyi"),
        func.sum(c("cbd_count")).label("cbd"),
    ).first()

    statuses_raw = {
        "РАБОТАЮЩИЕ": int(st.working or 0),
        "СТУДЕНТ": int(st.student or 0),
        "ИП": int(st.ip or 0),
        "ЛСИ": int(st.lsi or 0),
        "БЕЗРАБОТНЫЕ": int(st.unemployed or 0),
        "НЕОХВАЧЕННЫЕ": int(st.uncovered or 0),
        "ДЕТИ ОТ 14 ДО 18 ЛЕТ": int(st.under18 or 0),
        "ИНОСТРАННЫЕ ГРАЖДАНЕ": int(st.foreign or 0),
        "БЕРЕМЕННЫЕ": int(st.pregnant or 0),
        "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3": int(st.uhod or 0),
        "ПО УХОДУ ЗА ЛСИ": int(st.berkut or 0),
        "ПОЛУЧАТЕЛИ АСП": int(st.asp or 0),
        "ПЕНСИОНЕРЫ": int(st.pensioner or 0),
        "КАНДАСЫ": int(st.kandas or 0),
        "МНОГОДЕТНЫЕ": int(st.mnogodetnyi or 0),
        "ПОЛУЧАТЕЛИ ПОСОБИЙ": int(st.cbd or 0),
    }

    region_rows = (
        q.with_entities(
            c("region_code"), c("region_name"), func.sum(cnt_col).label("c"),
            func.sum(c("salary_sum")).label("sal_sum"),
            func.sum(c("salary_count")).label("sal_cnt"),
        )
        .group_by(c("region_code"), c("region_name"))
        .order_by(func.sum(cnt_col).desc()).all()
    )
    gender_rows = (
        q.with_entities(c("gender"), func.sum(cnt_col).label("c"))
        .group_by(c("gender")).all()
    )
    cat_rows = (
        q.with_entities(c("category"), func.sum(cnt_col).label("c"))
        .group_by(c("category")).order_by(func.sum(cnt_col).desc()).all()
    )
    age_rows = (
        q.with_entities(c("age_group"), func.sum(cnt_col).label("c"))
        .group_by(c("age_group")).all()
    )

    # family_type always from MicroAgg
    qf_base = db.query(MicroAgg).filter(MicroAgg.session_id == sid)
    qf, cnt_col_f = _build_filtered_query(qf_base, MicroAgg, filters)
    fam_rows = (
        qf.filter(MicroAgg.family_type != '')
        .with_entities(MicroAgg.family_type, func.sum(cnt_col_f).label("c"))
        .group_by(MicroAgg.family_type)
        .order_by(func.sum(cnt_col_f).desc())
        .all()
    )

    # ── OKVED and Nationality always from their dedicated tables ─────────────
    qo, cnt_col_o = _build_filtered_query(
        db.query(OkvedAgg).filter(OkvedAgg.session_id == sid), OkvedAgg, filters)
    okved_rows = (
        qo.filter(OkvedAgg.okved != "")
        .with_entities(
            OkvedAgg.okved, func.sum(cnt_col_o).label("c"),
            func.sum(OkvedAgg.salary_sum).label("sal_sum"),
            func.sum(OkvedAgg.salary_count).label("sal_cnt"),
        )
        .group_by(OkvedAgg.okved)
        .order_by(func.sum(cnt_col_o).desc())
        .limit(20).all()
    )

    qn, cnt_col_n = _build_filtered_query(
        db.query(NatAgg).filter(NatAgg.session_id == sid), NatAgg, filters)
    nat_rows = (
        qn.filter(NatAgg.nationality != "")
        .with_entities(NatAgg.nationality, func.sum(cnt_col_n).label("c"))
        .group_by(NatAgg.nationality)
        .order_by(func.sum(cnt_col_n).desc())
        .limit(20).all()
    )

    qz, cnt_col_z = _build_filtered_query(
        db.query(NkzAgg).filter(NkzAgg.session_id == sid), NkzAgg, filters)
    nkz_rows = (
        qz.filter(NkzAgg.nkz != "")
        .with_entities(
            NkzAgg.nkz, func.sum(cnt_col_z).label("c"),
            func.sum(NkzAgg.salary_sum).label("sal_sum"),
            func.sum(NkzAgg.salary_count).label("sal_cnt"),
        )
        .group_by(NkzAgg.nkz)
        .order_by(func.sum(cnt_col_z).desc())
        .limit(20).all()
    )

    def _edu_rows(edu_type_val):
        qe, cnt_col_e = _build_filtered_query(
            db.query(EduAgg).filter(EduAgg.session_id == sid, EduAgg.edu_type == edu_type_val),
            EduAgg, filters,
        )
        rows = (
            qe.filter(EduAgg.edu_name != '')
            .with_entities(EduAgg.edu_name, func.sum(cnt_col_e).label("c"))
            .group_by(EduAgg.edu_name)
            .order_by(func.sum(cnt_col_e).desc())
            .limit(100)
            .all()
        )
        return [{"name": r.edu_name, "count": int(r.c)} for r in rows]

    age_order = ["14-17", "18-24", "25-29", "30-35"]
    age_map = {r.age_group: int(r.c) for r in age_rows}

    def _avg_sal(row):
        s, n = float(row.sal_sum or 0), int(row.sal_cnt or 0)
        return round(s / n) if n > 0 else 0

    result = {
        "kpis": kpis,
        "statuses": [
            {"name": k, "count": v}
            for k, v in sorted(statuses_raw.items(), key=lambda x: -x[1])
            if v > 0
        ],
        "regions": [
            {"code": r.region_code, "name": r.region_name, "count": int(r.c), "avg_salary": _avg_sal(r)}
            for r in region_rows
        ],
        "gender": [{"gender": r.gender, "count": int(r.c)} for r in gender_rows],
        "family_type": [{"family_type": r.family_type, "count": int(r.c)} for r in fam_rows],
        "categorization": [{"category": r.category, "count": int(r.c)} for r in cat_rows],
        "age_groups": [{"group": g, "count": age_map.get(g, 0)} for g in age_order],
        "okved": [{"name": r.okved, "count": int(r.c), "avg_salary": _avg_sal(r)} for r in okved_rows],
        "nkz": [{"name": r.nkz, "count": int(r.c), "avg_salary": _avg_sal(r)} for r in nkz_rows],
        "nationality": [{"nationality": r.nationality, "count": int(r.c)} for r in nat_rows],
        "edu": {
            "vuz":    _edu_rows("vuz"),
            "tipo":   _edu_rows("tipo"),
            "school": _edu_rows("school"),
        },
    }

    with _filter_cache_lock:
        _filter_cache[cache_key] = result
    return result


@app.get("/api/data/migration")
def get_migration(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(MigrationStats)
        .filter(MigrationStats.session_id == sid)
        .order_by(MigrationStats.departed.desc())
        .all()
    )
    return [{"region": r.region_name, "departed": r.departed, "arrived": r.arrived} for r in rows]


@app.get("/api/data/nationality")
def get_nationality(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(NationalityStats)
        .filter(NationalityStats.session_id == sid)
        .order_by(NationalityStats.count.desc())
        .limit(20)
        .all()
    )
    return [{"nationality": r.nationality, "count": r.count} for r in rows]


# ── Serve frontend build ───────────────────────────────────────────────────────
FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(full_path: str):
        index = os.path.join(FRONTEND_DIST, "index.html")
        return FileResponse(index)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
