import os
import pandas as pd
from collections import defaultdict
from datetime import datetime
from sqlalchemy.orm import Session
from models import (
    KpiStats, StatusBreakdown, RegionBreakdown, DistrictBreakdown,
    AgeDistribution, Categorization, GenderStats, OkvedStats,
    NationalityStats, UploadSession, CrossStats,
)


def _update(db: Session, session_id: int, progress: int, current_file: str = ""):
    db.query(UploadSession).filter(UploadSession.id == session_id).update(
        {"progress": progress, "status": "processing", "current_file": current_file}
    )
    db.commit()


def _cross(cross_counts, k, fmask, df, status_masks, ages_s, has_voz, age_group_ranges,
           opv_mask, student_mask, tipo_flag, estab_mask):
    """Accumulate cross-tab stats for one filter mask."""
    n_f = int(fmask.sum())
    if n_f == 0:
        return

    cross_counts[k + ("kpi", "total")] += n_f
    cross_counts[k + ("kpi", "working")] += int((opv_mask & fmask).sum())
    cross_counts[k + ("kpi", "students")] += int((student_mask & fmask).sum())
    cross_counts[k + ("kpi", "tipo")] += int((tipo_flag & fmask).sum())
    cross_counts[k + ("kpi", "active_contracts")] += int((estab_mask & fmask).sum())

    if "SMZ_3M" in df.columns:
        sal_f = pd.to_numeric(df.loc[fmask, "SMZ_3M"], errors="coerce").fillna(0).clip(lower=0)
        cross_counts[k + ("kpi", "salary_sum")] += float(sal_f[sal_f > 0].sum())
        cross_counts[k + ("kpi", "salary_count")] += int((sal_f > 0).sum())

    if has_voz:
        age_f = ages_s[fmask]
        valid = age_f[age_f > 0]
        cross_counts[k + ("kpi", "age_sum")] += float(valid.sum())
        cross_counts[k + ("kpi", "age_count")] += len(valid)

    for sname, smask in status_masks.items():
        cross_counts[k + ("status", sname)] += int((fmask & smask).sum())

    if "KATO_REG" in df.columns and "REGNAME" in df.columns:
        for (code, name), cnt in df.loc[fmask, ["KATO_REG", "REGNAME"]].groupby(
            ["KATO_REG", "REGNAME"]
        ).size().items():
            cross_counts[k + ("region", str(code))] += int(cnt)

    if "GENDER" in df.columns:
        for gen, cnt in df.loc[fmask, "GENDER"].fillna("Не указано").value_counts().items():
            cross_counts[k + ("gender", str(gen))] += int(cnt)

    if "SDU_TZHS" in df.columns:
        for cat, cnt in df.loc[fmask, "SDU_TZHS"].fillna("Не указано").value_counts().items():
            cross_counts[k + ("cat", str(cat))] += int(cnt)

    if has_voz:
        for grp, lo, hi in age_group_ranges:
            cross_counts[k + ("age_group", grp)] += int(
                ((ages_s[fmask] >= lo) & (ages_s[fmask] <= hi)).sum()
            )

    if "LVL1_NAME_RU" in df.columns:
        for nm, cnt in df.loc[fmask, "LVL1_NAME_RU"].dropna().value_counts().items():
            s = str(nm)
            if s not in ("nan", "None"):
                cross_counts[k + ("okved", s)] += int(cnt)

    if "NATIONALTY" in df.columns:
        for nat, cnt in df.loc[fmask, "NATIONALTY"].dropna().value_counts().items():
            cross_counts[k + ("nationality", str(nat))] += int(cnt)


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

    cross_counts: dict[tuple, float] = defaultdict(float)

    total_files = len(file_paths)

    for file_idx, file_path in enumerate(file_paths):
        file_name = os.path.basename(file_path)
        _update(db, session_id, int(file_idx / total_files * 80), file_name)

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

            # ── Cross-tab ─────────────────────────────────────────────────────
            status_masks = {
                "РАБОТАЮЩИЕ": opv_mask, "ИП": ip_mask, "ЛСИ": lsi_mask,
                "БЕРЕМЕННЫЕ": berem_mask, "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3": uhod_mask,
                "ПО УХОДУ ЗА РЕБЕНКОМ ИНВ": berkut_mask, "СТУДЕНТ": student_mask,
                "ИНОСТРАННЫЕ ГРАЖДАНЕ": foreign_mask,
                "ДЕТИ ОТ 14 ДО 18 ЛЕТ": age_under18,
                "НЕОХВАЧЕННЫЕ": uncov, "БЕЗРАБОТНЫЕ": unemployed,
            }
            args = (df, status_masks, ages_s, has_voz, age_group_ranges,
                    opv_mask, student_mask, tipo_flag, estab_mask)

            # Status filter dims
            for nm, m in status_masks.items():
                _cross(cross_counts, ("status", nm), m, *args)

            # Age group filter dims
            if has_voz:
                for grp, lo, hi in age_group_ranges:
                    _cross(cross_counts, ("age_group", grp),
                           (ages_s >= lo) & (ages_s <= hi), *args)

            # Region filter dims
            if "KATO_REG" in df.columns:
                reg_s = df["KATO_REG"].astype(str)
                for code in reg_s.unique():
                    if code not in ("nan", "None", ""):
                        _cross(cross_counts, ("region", code),
                               reg_s == code, *args)

            # Gender filter dims
            if "GENDER" in df.columns:
                gen_s = df["GENDER"].fillna("Не указано")
                for gen in gen_s.unique():
                    _cross(cross_counts, ("gender", str(gen)),
                           gen_s == gen, *args)

            # SDU_TZHS (category) filter dims
            if "SDU_TZHS" in df.columns:
                cat_s = df["SDU_TZHS"].fillna("Не указано")
                for cat in cat_s.unique():
                    _cross(cross_counts, ("cat", str(cat)),
                           cat_s == cat, *args)

            # OKVED filter dims
            if "LVL1_NAME_RU" in df.columns:
                ok_s = df["LVL1_NAME_RU"].astype(str)
                for nm in ok_s.unique():
                    if nm not in ("nan", "None", ""):
                        _cross(cross_counts, ("okved", nm),
                               ok_s == nm, *args)

            # Nationality filter dims
            if "NATIONALTY" in df.columns:
                nat_s = df["NATIONALTY"].astype(str)
                for nm in nat_s.unique():
                    if nm not in ("nan", "None", ""):
                        _cross(cross_counts, ("nationality", nm),
                               nat_s == nm, *args)

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

    # ── Save CrossStats ────────────────────────────────────────────────────────
    _update(db, session_id, 90, "Сохранение перекрёстных таблиц...")

    top20_ok = {k for k, _ in sorted(okved_counts.items(), key=lambda x: -x[1])[:20]}
    top20_nat = {k for k, _ in sorted(nationality_counts.items(), key=lambda x: -x[1])[:20]}

    batch = []
    for (fdim, fval, sdim, skey), value in cross_counts.items():
        if value == 0:
            continue
        if fdim == "okved" and fval not in top20_ok:
            continue
        if fdim == "nationality" and fval not in top20_nat:
            continue
        if sdim == "okved" and skey not in top20_ok:
            continue
        if sdim == "nationality" and skey not in top20_nat:
            continue
        batch.append(CrossStats(
            session_id=session_id,
            filter_dim=fdim, filter_val=fval,
            stat_dim=sdim, stat_key=skey,
            value=value,
        ))

    # Commit in chunks to avoid SQLite timeout on large batches
    chunk_size = 500
    for i in range(0, len(batch), chunk_size):
        db.bulk_save_objects(batch[i:i + chunk_size])
        db.commit()

    db.query(UploadSession).filter(UploadSession.id == session_id).update({
        "is_active": True, "status": "done", "progress": 100,
        "total_records": total_persons,
        "completed_at": datetime.utcnow(), "current_file": "",
    })
    db.commit()
