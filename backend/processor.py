import os
import pandas as pd
from collections import defaultdict
from datetime import datetime
from sqlalchemy.orm import Session
from models import (
    KpiStats, StatusBreakdown, RegionBreakdown, DistrictBreakdown,
    AgeDistribution, Categorization, GenderStats, OkvedStats,
    NationalityStats, UploadSession, PersonRecord,
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
        "РАБОТАЮЩИЕ", "ДЕТИ ОТ 14 ДО 18 ЛЕТ", "НЕОХВАЧЕННЫЕ",
        "СТУДЕНТ", "ИП", "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3",
        "ЛСИ", "ИНОСТРАННЫЕ ГРАЖДАНЕ",
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

            def flag(col):
                if col in df.columns:
                    return pd.to_numeric(df[col], errors="coerce").fillna(0) == 1
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
            estab_mask = flag("ESTABLISHED_POST")

            status_counts["РАБОТАЮЩИЕ"] += int(opv_mask.sum())
            status_counts["ИП"] += int(ip_mask.sum())
            status_counts["ЛСИ"] += int(lsi_mask.sum())
            status_counts["БЕРЕМЕННЫЕ"] += int(berem_mask.sum())
            status_counts["ПО УХОДУ ЗА РЕБЕНКОМ ДО 3"] += int(uhod_mask.sum())
            status_counts["ПО УХОДУ ЗА РЕБЕНКОМ ИНВ"] += int(berkut_mask.sum())
            active_contracts += int(estab_mask.sum())

            if "SMZ_3M" in df.columns:
                sal = pd.to_numeric(df["SMZ_3M"], errors="coerce")
                sal = sal[sal > 0].dropna()
                salary_sum += float(sal.sum())
                salary_count += len(sal)

            ages_s = pd.Series(0.0, index=df.index)
            has_voz = "VOZRAST" in df.columns
            age_under18 = pd.Series(False, index=df.index)
            unemployed = pd.Series(False, index=df.index)
            if has_voz:
                ages_s = pd.to_numeric(df["VOZRAST"], errors="coerce").fillna(0)
                for av, cnt in ages_s[ages_s > 0].astype(int).value_counts().items():
                    age_histogram[int(av)] += int(cnt)
                age_under18 = (ages_s > 0) & (ages_s < 18)
                status_counts["ДЕТИ ОТ 14 ДО 18 ЛЕТ"] += int(age_under18.sum())
                for grp, lo, hi in age_group_ranges:
                    age_group_counts[grp] += int(((ages_s >= lo) & (ages_s <= hi)).sum())

            student_mask = vuz_mask | school_mask
            students += int(student_mask.sum())
            status_counts["СТУДЕНТ"] += int(student_mask.sum())
            tipo_count += int(tipo_flag.sum())

            if "CITIZENSHIP" in df.columns:
                foreign_mask = ~df["CITIZENSHIP"].isin(["КАЗАХСТАН", "Казахстан", "казахстан"])
                status_counts["ИНОСТРАННЫЕ ГРАЖДАНЕ"] += int(foreign_mask.sum())
            else:
                foreign_mask = pd.Series(False, index=df.index)

            has_status = (
                opv_mask | age_under18 | student_mask | tipo_flag |
                ip_mask | uhod_mask | lsi_mask | berem_mask | berkut_mask | foreign_mask
            )
            uncov = ~has_status
            status_counts["НЕОХВАЧЕННЫЕ"] += int(uncov.sum())

            if has_voz:
                adult = ages_s >= 18
                unemployed = (
                    adult & ~opv_mask & ~student_mask & ~tipo_flag &
                    ~ip_mask & ~uhod_mask & ~lsi_mask & ~berem_mask & ~berkut_mask
                )
                status_counts["БЕЗРАБОТНЫЕ"] += int(unemployed.sum())

            if "KATO_REG" in df.columns and "REGNAME" in df.columns:
                for (code, name), cnt in df.groupby(["KATO_REG", "REGNAME"]).size().items():
                    sc = str(code)
                    region_counts[sc] += int(cnt)
                    region_names[sc] = str(name)

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

            if "SDU_TZHS" in df.columns:
                for cat, cnt in df["SDU_TZHS"].fillna("Не указано").value_counts().items():
                    cat_counts[str(cat)] += int(cnt)

            if "GENDER" in df.columns:
                for gen, cnt in df["GENDER"].fillna("Не указано").value_counts().items():
                    gender_counts[str(gen)] += int(cnt)

            if "LVL1_NAME_RU" in df.columns:
                for nm, cnt in df["LVL1_NAME_RU"].dropna().value_counts().items():
                    if str(nm) not in ("nan", "None"):
                        okved_counts[str(nm)] += int(cnt)

            if "NATIONALTY" in df.columns:
                for nat, cnt in df["NATIONALTY"].dropna().value_counts().items():
                    nationality_counts[str(nat)] += int(cnt)

            # ── PersonRecord rows for this sheet ──────────────────────────────
            age_grp = pd.Series('', index=df.index)
            if has_voz:
                for grp, lo, hi in age_group_ranges:
                    age_grp[(ages_s >= lo) & (ages_s <= hi)] = grp

            reg_code = df["KATO_REG"].astype(str).fillna('') if "KATO_REG" in df.columns else pd.Series('', index=df.index)
            reg_name = df["REGNAME"].astype(str).fillna('') if "REGNAME" in df.columns else pd.Series('', index=df.index)
            gen_col = df["GENDER"].fillna('Не указано').astype(str) if "GENDER" in df.columns else pd.Series('Не указано', index=df.index)
            cat_col = df["SDU_TZHS"].fillna('Не указано').astype(str) if "SDU_TZHS" in df.columns else pd.Series('Не указано', index=df.index)
            okved_col = df["LVL1_NAME_RU"].fillna('').astype(str) if "LVL1_NAME_RU" in df.columns else pd.Series('', index=df.index)
            nat_col = df["NATIONALTY"].fillna('').astype(str) if "NATIONALTY" in df.columns else pd.Series('', index=df.index)
            sal_col = pd.to_numeric(df["SMZ_3M"], errors="coerce").fillna(0).clip(lower=0) if "SMZ_3M" in df.columns else pd.Series(0.0, index=df.index)
            age_int = ages_s.astype(int) if has_voz else pd.Series(0, index=df.index)

            rec_df = pd.DataFrame({
                "session_id": session_id,
                "region_code": reg_code,
                "region_name": reg_name,
                "age_group": age_grp,
                "gender": gen_col,
                "category": cat_col,
                "okved": okved_col,
                "nationality": nat_col,
                "is_working": opv_mask.astype(int),
                "is_student": student_mask.astype(int),
                "is_tipo": tipo_flag.astype(int),
                "has_contract": estab_mask.astype(int),
                "is_ip": ip_mask.astype(int),
                "is_lsi": lsi_mask.astype(int),
                "is_unemployed": unemployed.astype(int),
                "is_uncovered": uncov.astype(int),
                "is_under18": age_under18.astype(int),
                "is_foreign": foreign_mask.astype(int),
                "is_pregnant": berem_mask.astype(int),
                "is_uhod": uhod_mask.astype(int),
                "is_berkut": berkut_mask.astype(int),
                "salary": sal_col,
                "age_val": age_int,
            })

            # Clean up sentinel strings from pandas
            for col in ("region_code", "region_name", "gender", "category", "okved", "nationality", "age_group"):
                rec_df[col] = rec_df[col].replace({"nan": "", "None": ""})

            records = rec_df.to_dict("records")
            chunk = 5000
            for i in range(0, len(records), chunk):
                db.bulk_insert_mappings(PersonRecord, records[i:i + chunk])
            db.commit()

    # ── Global derived stats ───────────────────────────────────────────────────
    age_total = sum(age_histogram.values())
    avg_age = sum(k * v for k, v in age_histogram.items()) / age_total if age_total > 0 else 0
    cumsum = 0
    median_age = 0
    for av in sorted(age_histogram):
        cumsum += age_histogram[av]
        if cumsum >= age_total / 2:
            median_age = av
            break
    avg_salary = salary_sum / salary_count if salary_count > 0 else 0

    db.query(UploadSession).filter(UploadSession.is_active == True).update({"is_active": False})
    db.commit()

    db.add(KpiStats(
        session_id=session_id, total_persons=total_persons, total_families=0,
        working=status_counts["РАБОТАЮЩИЕ"], active_contracts=active_contracts,
        avg_salary=round(avg_salary), students=students, tipo_count=tipo_count,
        avg_age=round(avg_age, 1), median_age=round(float(median_age), 1),
    ))
    for name, count in status_counts.items():
        db.add(StatusBreakdown(session_id=session_id, status_name=name, count=count))
    for code, count in region_counts.items():
        db.add(RegionBreakdown(session_id=session_id, region_code=code,
                               region_name=region_names.get(code, code), count=count))
    for key, count in district_counts.items():
        info = district_info.get(key, {})
        db.add(DistrictBreakdown(
            session_id=session_id,
            region_code=info.get("reg_code", ""), region_name=info.get("reg_name", ""),
            district_code=info.get("dist_code", ""), district_name=info.get("dist_name", ""),
            count=count,
        ))
    for grp, lo, hi in age_group_ranges:
        db.add(AgeDistribution(session_id=session_id, age_group=grp,
                               min_age=lo, max_age=hi, count=age_group_counts[grp]))
    for cat, count in sorted(cat_counts.items(), key=lambda x: -x[1]):
        db.add(Categorization(session_id=session_id, category=cat, count=count))
    for gen, count in gender_counts.items():
        db.add(GenderStats(session_id=session_id, gender=gen, count=count))
    for nm, count in sorted(okved_counts.items(), key=lambda x: -x[1])[:20]:
        db.add(OkvedStats(session_id=session_id, okved_name=nm, count=count))
    for nat, count in sorted(nationality_counts.items(), key=lambda x: -x[1])[:20]:
        db.add(NationalityStats(session_id=session_id, nationality=nat, count=count))
    db.commit()

    db.query(UploadSession).filter(UploadSession.id == session_id).update({
        "is_active": True, "status": "done", "progress": 100,
        "total_records": total_persons,
        "completed_at": datetime.utcnow(), "current_file": "",
    })
    db.commit()
