import os
import pandas as pd
from collections import defaultdict
from datetime import datetime
from sqlalchemy.orm import Session
from models import (
    KpiStats, StatusBreakdown, RegionBreakdown, DistrictBreakdown,
    AgeDistribution, Categorization, GenderStats, OkvedStats,
    NationalityStats, UploadSession,
)


def _update(db: Session, session_id: int, progress: int, current_file: str = ""):
    db.query(UploadSession).filter(UploadSession.id == session_id).update(
        {"progress": progress, "status": "processing", "current_file": current_file}
    )
    db.commit()


def process_excel_files(session_id: int, file_paths: list, db: Session):
    _update(db, session_id, 0)

    total_persons = 0
    active_contracts = 0
    salary_sum = 0.0
    salary_count = 0
    students = 0
    tipo_count = 0
    age_histogram: dict[int, int] = defaultdict(int)

    STATUS_KEYS = [
        "РАБОТАЮЩИЕ", "ДЕТИ ДО 18 ЛЕТ", "НЕОХВАЧЕННЫЕ",
        "СТУДЕНТ", "ИП", "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3",
        "МНОГОДЕТНЫЕ", "ЛСИ", "ИНОСТРАННЫЕ ГРАЖДАНЕ",
        "БЕЗРАБОТНЫЕ", "БЕРЕМЕННЫЕ", "ПО УХОДУ ЗА РЕБЕНКОМ ИНВ",
    ]
    status_counts: dict[str, int] = {k: 0 for k in STATUS_KEYS}

    region_counts: dict[str, int] = defaultdict(int)
    region_names: dict[str, str] = {}
    district_counts: dict[tuple, int] = defaultdict(int)
    district_info: dict[tuple, dict] = {}

    age_group_ranges = [("14-17", 14, 17), ("18-24", 18, 24), ("25-29", 25, 29), ("30-35", 30, 35)]
    age_group_counts: dict[str, int] = {g: 0 for g, _, _ in age_group_ranges}

    cat_counts: dict[str, int] = defaultdict(int)
    gender_counts: dict[str, int] = defaultdict(int)
    okved_counts: dict[str, int] = defaultdict(int)
    nationality_counts: dict[str, int] = defaultdict(int)

    total_files = len(file_paths)

    for file_idx, file_path in enumerate(file_paths):
        file_name = os.path.basename(file_path)
        _update(db, session_id, int(file_idx / total_files * 85), file_name)

        try:
            xl = pd.ExcelFile(file_path)
        except Exception:
            continue

        for sheet_name in xl.sheet_names:
            try:
                df = pd.read_excel(xl, sheet_name=sheet_name)
            except Exception:
                continue

            df.columns = [c.strip() if isinstance(c, str) else str(c) for c in df.columns]
            total_persons += len(df)

            # Boolean flag masks
            def flag(col):
                if col in df.columns:
                    return (pd.to_numeric(df[col], errors="coerce").fillna(0) == 1)
                return pd.Series(False, index=df.index)

            opv_mask = flag("OPV")
            ip_mask = flag("IP")
            lsi_mask = flag("LSI")
            berem_mask = flag("BEREM")
            uhod_mask = flag("WOMAN_UHOD_DO3")
            berkut_mask = flag("IS_BERKUT")
            vuz_mask = flag("VUZ")
            school_mask = flag("SCHOOL")
            tipo_flag = flag("TIPO")
            berkut2 = flag("IS_BERKUT")

            status_counts["РАБОТАЮЩИЕ"] += int(opv_mask.sum())
            status_counts["ИП"] += int(ip_mask.sum())
            status_counts["ЛСИ"] += int(lsi_mask.sum())
            status_counts["БЕРЕМЕННЫЕ"] += int(berem_mask.sum())
            status_counts["ПО УХОДУ ЗА РЕБЕНКОМ ДО 3"] += int(uhod_mask.sum())
            status_counts["ПО УХОДУ ЗА РЕБЕНКОМ ИНВ"] += int(berkut_mask.sum())

            if "ESTABLISHED_POST" in df.columns:
                active_contracts += int(
                    (pd.to_numeric(df["ESTABLISHED_POST"], errors="coerce").fillna(0) == 1).sum()
                )

            # Salary
            if "SMZ_3M" in df.columns:
                sal = pd.to_numeric(df["SMZ_3M"], errors="coerce")
                sal = sal[sal > 0].dropna()
                salary_sum += float(sal.sum())
                salary_count += len(sal)

            # Age
            age_under18 = pd.Series(False, index=df.index)
            if "VOZRAST" in df.columns:
                ages_raw = pd.to_numeric(df["VOZRAST"], errors="coerce").dropna().astype(int)
                for age_val, cnt in ages_raw.value_counts().items():
                    age_histogram[int(age_val)] += int(cnt)
                age_under18 = pd.to_numeric(df.get("VOZRAST", pd.Series(dtype=float)), errors="coerce") < 18
                status_counts["ДЕТИ ДО 18 ЛЕТ"] += int(age_under18.sum())
                for grp, lo, hi in age_group_ranges:
                    age_group_counts[grp] += int(((ages_raw >= lo) & (ages_raw <= hi)).sum())

            # Students
            student_mask = vuz_mask | school_mask
            students += int(student_mask.sum())
            status_counts["СТУДЕНТ"] += int(student_mask.sum())

            tipo_count += int(tipo_flag.sum())

            # Foreign
            if "CITIZENSHIP" in df.columns:
                foreign_mask = ~df["CITIZENSHIP"].isin(["КАЗАХСТАН", "Казахстан", "казахстан"])
                status_counts["ИНОСТРАННЫЕ ГРАЖДАНЕ"] += int(foreign_mask.sum())
            else:
                foreign_mask = pd.Series(False, index=df.index)

            # Uncovered
            has_status = (
                opv_mask | age_under18 | student_mask | tipo_flag |
                ip_mask | uhod_mask | lsi_mask | berem_mask | berkut_mask | foreign_mask
            )
            status_counts["НЕОХВАЧЕННЫЕ"] += int((~has_status).sum())

            # Unemployed: adult, no status, no income
            if "VOZRAST" in df.columns:
                adult = pd.to_numeric(df["VOZRAST"], errors="coerce") >= 18
                unemployed = (
                    adult & ~opv_mask & ~student_mask & ~tipo_flag &
                    ~ip_mask & ~uhod_mask & ~lsi_mask & ~berem_mask & ~berkut_mask
                )
                status_counts["БЕЗРАБОТНЫЕ"] += int(unemployed.sum())

            # Regions
            if "KATO_REG" in df.columns and "REGNAME" in df.columns:
                for (code, name), cnt in df.groupby(["KATO_REG", "REGNAME"]).size().items():
                    sc = str(code)
                    region_counts[sc] += int(cnt)
                    region_names[sc] = str(name)

            # Districts
            if all(c in df.columns for c in ["KATO_REG", "REGNAME", "KATO_RAI", "RAINAME"]):
                for (rc, rn, dc, dn), cnt in df.groupby(
                    ["KATO_REG", "REGNAME", "KATO_RAI", "RAINAME"]
                ).size().items():
                    key = (str(rc), str(dc))
                    district_counts[key] += int(cnt)
                    district_info[key] = {
                        "reg_code": str(rc), "reg_name": str(rn),
                        "dist_code": str(dc), "dist_name": str(dn),
                    }

            # Categorization
            if "SDU_TZHS" in df.columns:
                for cat, cnt in df["SDU_TZHS"].fillna("Не указано").value_counts().items():
                    cat_counts[str(cat)] += int(cnt)

            # Gender
            if "GENDER" in df.columns:
                for gen, cnt in df["GENDER"].fillna("Не указано").value_counts().items():
                    gender_counts[str(gen)] += int(cnt)

            # OKVED
            if "LVL1_NAME_RU" in df.columns:
                for name, cnt in df["LVL1_NAME_RU"].dropna().value_counts().items():
                    if str(name) not in ("nan", "None"):
                        okved_counts[str(name)] += int(cnt)

            # Nationality
            if "NATIONALTY" in df.columns:
                for nat, cnt in df["NATIONALTY"].dropna().value_counts().items():
                    nationality_counts[str(nat)] += int(cnt)

    # Derived stats
    age_total = sum(age_histogram.values())
    avg_age = (
        sum(k * v for k, v in age_histogram.items()) / age_total if age_total > 0 else 0
    )
    cumsum = 0
    median_age = 0
    target = age_total / 2
    for age_val in sorted(age_histogram.keys()):
        cumsum += age_histogram[age_val]
        if cumsum >= target:
            median_age = age_val
            break

    avg_salary = salary_sum / salary_count if salary_count > 0 else 0

    # Deactivate previous sessions
    db.query(UploadSession).filter(UploadSession.is_active == True).update({"is_active": False})
    db.commit()

    # KPIs
    db.add(KpiStats(
        session_id=session_id,
        total_persons=total_persons,
        total_families=0,
        working=status_counts["РАБОТАЮЩИЕ"],
        active_contracts=active_contracts,
        avg_salary=round(avg_salary),
        students=students,
        tipo_count=tipo_count,
        avg_age=round(avg_age, 1),
        median_age=round(float(median_age), 1),
    ))

    # Statuses
    for name, count in status_counts.items():
        db.add(StatusBreakdown(session_id=session_id, status_name=name, count=count))

    # Regions
    for code, count in region_counts.items():
        db.add(RegionBreakdown(
            session_id=session_id, region_code=code,
            region_name=region_names.get(code, code), count=count,
        ))

    # Districts
    for key, count in district_counts.items():
        info = district_info.get(key, {})
        db.add(DistrictBreakdown(
            session_id=session_id,
            region_code=info.get("reg_code", ""),
            region_name=info.get("reg_name", ""),
            district_code=info.get("dist_code", ""),
            district_name=info.get("dist_name", ""),
            count=count,
        ))

    # Age groups
    for grp, lo, hi in age_group_ranges:
        db.add(AgeDistribution(
            session_id=session_id, age_group=grp,
            min_age=lo, max_age=hi, count=age_group_counts[grp],
        ))

    # Categorization
    for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
        db.add(Categorization(session_id=session_id, category=cat, count=count))

    # Gender
    for gen, count in gender_counts.items():
        db.add(GenderStats(session_id=session_id, gender=gen, count=count))

    # OKVED top-20
    for name, count in sorted(okved_counts.items(), key=lambda x: -x[1])[:20]:
        db.add(OkvedStats(session_id=session_id, okved_name=name, count=count))

    # Nationality top-20
    for nat, count in sorted(nationality_counts.items(), key=lambda x: -x[1])[:20]:
        db.add(NationalityStats(session_id=session_id, nationality=nat, count=count))

    db.commit()

    db.query(UploadSession).filter(UploadSession.id == session_id).update({
        "is_active": True,
        "status": "done",
        "progress": 100,
        "total_records": total_persons,
        "completed_at": datetime.utcnow(),
        "current_file": "",
    })
    db.commit()
