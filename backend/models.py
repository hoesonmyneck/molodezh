from sqlalchemy import Column, Index, Integer, String, Float, Boolean, DateTime, Text, ForeignKey
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
    """Legacy pre-computed cross-tabs (superseded by MicroAgg)."""
    __tablename__ = "cross_stats"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    filter_dim = Column(String, index=True)
    filter_val = Column(String, index=True)
    stat_dim = Column(String)
    stat_key = Column(String)
    value = Column(Float, default=0)


class MicroAgg(Base):
    """Core micro-aggregation (no okved/nationality — those are in OkvedAgg/NatAgg).
    One row per unique (session, region, district, age_group, age_val, gender, category)."""
    __tablename__ = "micro_agg"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    region_code = Column(String(20), default='')
    region_name = Column(String(120), default='')
    district_code = Column(String(20), default='')
    district_name = Column(String(120), default='')
    age_group = Column(String(10), default='')
    age_val = Column(Integer, default=0)
    gender = Column(String(30), default='')
    category = Column(String(60), default='')
    total_count = Column(Integer, default=0)
    working_count = Column(Integer, default=0)
    student_count = Column(Integer, default=0)
    tipo_count = Column(Integer, default=0)
    contract_count = Column(Integer, default=0)
    ip_count = Column(Integer, default=0)
    lsi_count = Column(Integer, default=0)
    unemployed_count = Column(Integer, default=0)
    uncovered_count = Column(Integer, default=0)
    under18_count = Column(Integer, default=0)
    foreign_count = Column(Integer, default=0)
    pregnant_count = Column(Integer, default=0)
    uhod_count = Column(Integer, default=0)
    berkut_count = Column(Integer, default=0)
    salary_sum = Column(Float, default=0.0)
    salary_count = Column(Integer, default=0)
    age_sum = Column(Float, default=0.0)
    age_count = Column(Integer, default=0)

    __table_args__ = (
        Index('ix_micro_agg_sid_reg',  'session_id', 'region_code'),
        Index('ix_micro_agg_sid_dist', 'session_id', 'district_code'),
        Index('ix_micro_agg_sid_agrp', 'session_id', 'age_group'),
        Index('ix_micro_agg_sid_gen',  'session_id', 'gender'),
        Index('ix_micro_agg_sid_cat',  'session_id', 'category'),
        Index('ix_micro_agg_sid_aval', 'session_id', 'age_val'),
    )


class OkvedAgg(Base):
    """OKVED breakdown aggregation. Grouped by core dims + okved."""
    __tablename__ = "okved_agg"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    region_code = Column(String(20), default='')
    district_code = Column(String(20), default='')
    age_group = Column(String(10), default='')
    age_val = Column(Integer, default=0)
    gender = Column(String(30), default='')
    category = Column(String(60), default='')
    okved = Column(String(220), default='')
    total_count = Column(Integer, default=0)
    working_count = Column(Integer, default=0)
    student_count = Column(Integer, default=0)
    tipo_count = Column(Integer, default=0)
    ip_count = Column(Integer, default=0)
    lsi_count = Column(Integer, default=0)
    unemployed_count = Column(Integer, default=0)
    uncovered_count = Column(Integer, default=0)
    under18_count = Column(Integer, default=0)
    foreign_count = Column(Integer, default=0)
    pregnant_count = Column(Integer, default=0)
    uhod_count = Column(Integer, default=0)
    berkut_count = Column(Integer, default=0)

    __table_args__ = (
        Index('ix_okved_agg_sid_reg',   'session_id', 'region_code'),
        Index('ix_okved_agg_sid_dist',  'session_id', 'district_code'),
        Index('ix_okved_agg_sid_okved', 'session_id', 'okved'),
    )


class NatAgg(Base):
    """Nationality breakdown aggregation. Grouped by core dims + nationality."""
    __tablename__ = "nat_agg"
    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("upload_sessions.id"))
    region_code = Column(String(20), default='')
    district_code = Column(String(20), default='')
    age_group = Column(String(10), default='')
    age_val = Column(Integer, default=0)
    gender = Column(String(30), default='')
    category = Column(String(60), default='')
    nationality = Column(String(120), default='')
    total_count = Column(Integer, default=0)
    working_count = Column(Integer, default=0)
    student_count = Column(Integer, default=0)
    tipo_count = Column(Integer, default=0)
    ip_count = Column(Integer, default=0)
    lsi_count = Column(Integer, default=0)
    unemployed_count = Column(Integer, default=0)
    uncovered_count = Column(Integer, default=0)
    under18_count = Column(Integer, default=0)
    foreign_count = Column(Integer, default=0)
    pregnant_count = Column(Integer, default=0)
    uhod_count = Column(Integer, default=0)
    berkut_count = Column(Integer, default=0)

    __table_args__ = (
        Index('ix_nat_agg_sid_reg',  'session_id', 'region_code'),
        Index('ix_nat_agg_sid_dist', 'session_id', 'district_code'),
        Index('ix_nat_agg_sid_nat',  'session_id', 'nationality'),
    )
