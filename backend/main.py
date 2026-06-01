import os
import threading
from datetime import datetime, timedelta
from typing import List

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
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
    AgeDistribution, Categorization, CrossStats, DistrictBreakdown,
    GenderStats, KpiStats, NationalityStats, OkvedStats,
    RegionBreakdown, StatusBreakdown, UploadSession, User,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Молодежь РК")

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
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(RegionBreakdown)
        .filter(RegionBreakdown.session_id == sid)
        .order_by(RegionBreakdown.count.desc())
        .all()
    )
    return [{"code": r.region_code, "name": r.region_name, "count": r.count} for r in rows]


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
    sid = get_active_session_id(db)
    if not sid:
        return []
    rows = (
        db.query(OkvedStats)
        .filter(OkvedStats.session_id == sid)
        .order_by(OkvedStats.count.desc())
        .limit(20)
        .all()
    )
    return [{"name": r.okved_name, "count": r.count} for r in rows]


@app.get("/api/data/filter")
def get_filtered_data(
    dim: str,
    val: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sid = get_active_session_id(db)
    if not sid:
        return {"no_data": True}

    rows = (
        db.query(CrossStats)
        .filter(
            CrossStats.session_id == sid,
            CrossStats.filter_dim == dim,
            CrossStats.filter_val == val,
        )
        .all()
    )
    if not rows:
        return {"no_data": True}

    kpi_raw: dict = {}
    statuses: dict = {}
    regions: dict = {}
    gender: dict = {}
    cats: dict = {}
    age_groups: dict = {}

    for row in rows:
        if row.stat_dim == "kpi":
            kpi_raw[row.stat_key] = row.value
        elif row.stat_dim == "status":
            statuses[row.stat_key] = int(row.value)
        elif row.stat_dim == "region":
            regions[row.stat_key] = int(row.value)
        elif row.stat_dim == "gender":
            gender[row.stat_key] = int(row.value)
        elif row.stat_dim == "cat":
            cats[row.stat_key] = int(row.value)
        elif row.stat_dim == "age_group":
            age_groups[row.stat_key] = int(row.value)

    salary_s = kpi_raw.get("salary_sum", 0)
    salary_c = kpi_raw.get("salary_count", 0)
    age_s = kpi_raw.get("age_sum", 0)
    age_c = kpi_raw.get("age_count", 0)

    kpis = {
        "total_persons": int(kpi_raw.get("total", 0)),
        "working": int(kpi_raw.get("working", 0)),
        "students": int(kpi_raw.get("students", 0)),
        "tipo_count": int(kpi_raw.get("tipo", 0)),
        "active_contracts": int(kpi_raw.get("active_contracts", 0)),
        "avg_salary": round(salary_s / salary_c) if salary_c > 0 else 0,
        "avg_age": round(age_s / age_c, 1) if age_c > 0 else 0,
        "median_age": None,
        # raw values for client-side multi-filter aggregation
        "_salary_sum": salary_s,
        "_salary_count": salary_c,
        "_age_sum": age_s,
        "_age_count": age_c,
    }

    # separate okved / nationality from generic stat_dims
    okved: dict = {}
    nationality: dict = {}

    for row in rows:
        if row.stat_dim == "okved":
            okved[row.stat_key] = int(row.value)
        elif row.stat_dim == "nationality":
            nationality[row.stat_key] = int(row.value)

    region_name_map = {}
    if regions:
        reg_rows = (
            db.query(RegionBreakdown)
            .filter(
                RegionBreakdown.session_id == sid,
                RegionBreakdown.region_code.in_(list(regions.keys())),
            )
            .all()
        )
        region_name_map = {r.region_code: r.region_name for r in reg_rows}

    age_order = ["14-17", "18-24", "25-29", "30-35"]

    return {
        "kpis": kpis,
        "statuses": [
            {"name": k, "count": v}
            for k, v in sorted(statuses.items(), key=lambda x: -x[1])
        ],
        "regions": [
            {"code": k, "name": region_name_map.get(k, k), "count": v}
            for k, v in sorted(regions.items(), key=lambda x: -x[1])
        ],
        "gender": [{"gender": k, "count": v} for k, v in gender.items()],
        "categorization": [
            {"category": k, "count": v}
            for k, v in sorted(cats.items(), key=lambda x: -x[1])
        ],
        "age_groups": [
            {"group": g, "count": age_groups.get(g, 0)}
            for g in age_order
        ],
        "okved": [
            {"name": k, "count": v}
            for k, v in sorted(okved.items(), key=lambda x: -x[1])[:20]
        ],
        "nationality": [
            {"nationality": k, "count": v}
            for k, v in sorted(nationality.items(), key=lambda x: -x[1])[:20]
        ],
    }


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
