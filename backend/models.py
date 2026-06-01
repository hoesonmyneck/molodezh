from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
from datetime import datetime
from database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class UploadSession(Base):
    __tablename__ = "upload_sessions"
    id = Column(Integer, primary_key=True, index=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    status = Column(String, default="pending")  # pending, processing, done, error
    files_count = Column(Integer, default=0)
    total_records = Column(Integer, default=0)
    progress = Column(Integer, default=0)
    current_file = Column(String, default="")
    error_message = Column(Text, nullable=True)
    is_active = Column(Boolean, default=False)


class KpiStats(Base):
    __tablename__ = "kpi_stats"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    total_persons = Column(Integer, default=0)
    total_families = Column(Integer, default=0)
    working = Column(Integer, default=0)
    active_contracts = Column(Integer, default=0)
    avg_salary = Column(Float, default=0)
    students = Column(Integer, default=0)
    tipo_count = Column(Integer, default=0)
    avg_age = Column(Float, default=0)
    median_age = Column(Float, default=0)


class StatusBreakdown(Base):
    __tablename__ = "status_breakdown"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    status_name = Column(String)
    count = Column(Integer, default=0)


class RegionBreakdown(Base):
    __tablename__ = "region_breakdown"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    region_code = Column(String)
    region_name = Column(String)
    count = Column(Integer, default=0)


class DistrictBreakdown(Base):
    __tablename__ = "district_breakdown"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    region_code = Column(String)
    region_name = Column(String)
    district_code = Column(String)
    district_name = Column(String)
    count = Column(Integer, default=0)


class AgeDistribution(Base):
    __tablename__ = "age_distribution"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    age_group = Column(String)
    min_age = Column(Integer, default=0)
    max_age = Column(Integer, default=0)
    count = Column(Integer, default=0)


class Categorization(Base):
    __tablename__ = "categorization"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    category = Column(String)
    count = Column(Integer, default=0)


class GenderStats(Base):
    __tablename__ = "gender_stats"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    gender = Column(String)
    count = Column(Integer, default=0)


class OkvedStats(Base):
    __tablename__ = "okved_stats"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    okved_name = Column(String)
    count = Column(Integer, default=0)


class NationalityStats(Base):
    __tablename__ = "nationality_stats"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    nationality = Column(String)
    count = Column(Integer, default=0)


class CrossStats(Base):
    """Legacy pre-computed cross-tabs (superseded by PersonRecord)."""
    __tablename__ = "cross_stats"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    filter_dim = Column(String, index=True)
    filter_val = Column(String, index=True)
    stat_dim = Column(String)
    stat_key = Column(String)
    value = Column(Float, default=0)


class PersonRecord(Base):
    """Individual-level record enabling AND-intersection multi-filter queries."""
    __tablename__ = "person_records"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"), index=True)
    region_code = Column(String(20), index=True, default='')
    region_name = Column(String(120), default='')
    age_group = Column(String(10), index=True, default='')
    gender = Column(String(30), index=True, default='')
    category = Column(String(60), index=True, default='')
    okved = Column(String(220), index=True, default='')
    nationality = Column(String(120), index=True, default='')
    is_working = Column(Integer, default=0)
    is_student = Column(Integer, default=0)
    is_tipo = Column(Integer, default=0)
    has_contract = Column(Integer, default=0)
    is_ip = Column(Integer, default=0)
    is_lsi = Column(Integer, default=0)
    is_unemployed = Column(Integer, default=0)
    is_uncovered = Column(Integer, default=0)
    is_under18 = Column(Integer, default=0)
    is_foreign = Column(Integer, default=0)
    is_pregnant = Column(Integer, default=0)
    is_uhod = Column(Integer, default=0)
    is_berkut = Column(Integer, default=0)
    salary = Column(Float, default=0.0)
    age_val = Column(Integer, default=0)
