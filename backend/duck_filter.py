"""DuckDB-backed analytical queries for the filter endpoint.
DuckDB reads the SQLite file directly via its bundled SQLite scanner extension,
giving 5-20x speedup on GROUP BY queries over millions of rows.
Falls back to None on any error so the caller can use SQLAlchemy instead.
"""
from __future__ import annotations
import logging
from typing import Any

_log = logging.getLogger(__name__)

_STATUS_COL = {
    "РАБОТАЮЩИЕ":              "working_count",
    "АКТИВНЫЙ ТД":             "contract_count",
    "СТУДЕНТ":                 "student_count",
    "ТИПО":                    "tipo_count",
    "ИП":                      "ip_count",
    "ЛСИ":                     "lsi_count",
    "БЕЗРАБОТНЫЕ":             "unemployed_count",
    "НЕОХВАЧЕННЫЕ":            "uncovered_count",
    "ДЕТИ ОТ 14 ДО 18 ЛЕТ":  "under18_count",
    "ИНОСТРАННЫЕ ГРАЖДАНЕ":    "foreign_count",
    "БЕРЕМЕННЫЕ":              "pregnant_count",
    "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3": "uhod_count",
    "ПО УХОДУ ЗА ЛСИ":        "berkut_count",
    "ПОЛУЧАТЕЛИ АСП":          "asp_count",
    "ПЕНСИОНЕРЫ":              "pensioner_count",
    "КАНДАСЫ":                 "kandas_count",
    "МНОГОДЕТНЫЕ":             "mnogodetnyi_count",
    "ПОЛУЧАТЕЛИ ПОСОБИЙ":      "cbd_count",
}

_DIM_COL = {
    "region":      "region_code",
    "district":    "district_code",
    "age_group":   "age_group",
    "gender":      "gender",
    "cat":         "category",
    "okved":       "okved",
    "nkz":         "nkz",
    "nationality": "nationality",
    "family_type": "family_type",
}

# Which filter dimensions each table actually has
_TABLE_DIMS: dict[str, frozenset[str]] = {
    "micro_agg": frozenset(["region", "district", "age_group", "age_val",
                             "gender", "cat", "family_type"]),
    "okved_agg": frozenset(["region", "district", "age_group", "age_val",
                             "gender", "cat", "okved"]),
    "nkz_agg":   frozenset(["region", "district", "age_group", "age_val",
                             "gender", "cat", "nkz"]),
    "nat_agg":   frozenset(["region", "district", "age_group", "age_val",
                             "gender", "cat", "nationality"]),
    "edu_agg":   frozenset(["region", "district", "age_group", "age_val",
                             "gender", "cat", "vuz", "tipo", "school"]),
}


def _primary_table(filters: list[tuple[str, str]]) -> str:
    for dim, _ in filters:
        if dim == "okved":       return "okved_agg"
        if dim == "nkz":         return "nkz_agg"
        if dim == "nationality": return "nat_agg"
        if dim in ("vuz", "tipo", "school"): return "edu_agg"
    return "micro_agg"


def _build_where(
    sid: int,
    filters: list[tuple[str, str]],
    table_slug: str,
    alias: str,
) -> tuple[str, list, str]:
    """Return (where_clause, params, cnt_col_expr) for the given table.
    Filters for dimensions not present in the table are silently skipped,
    matching the SQLAlchemy hasattr() behaviour.
    """
    available = _TABLE_DIMS.get(table_slug, frozenset())
    conds = [f"{alias}.session_id = ?"]
    params: list = [sid]
    cnt = f"{alias}.total_count"

    for dim, val in filters:
        if dim == "status":
            col = _STATUS_COL.get(val)
            if col:
                cnt = f"{alias}.{col}"
                conds.append(f"{alias}.{col} > 0")
        elif dim in _DIM_COL:
            if dim not in available:
                continue
            col = _DIM_COL[dim]
            conds.append(f"{alias}.{col} = ?")
            params.append(val)
        elif dim in ("vuz", "tipo", "school"):
            if table_slug == "edu_agg":
                conds.append(f"{alias}.edu_type = ? AND {alias}.edu_name = ?")
                params.extend([dim, val])
        elif dim == "age_exact":
            if "age_val" in available:
                try:
                    conds.append(f"{alias}.age_val = ?")
                    params.append(int(val))
                except (ValueError, TypeError):
                    pass
        elif dim == "age_gte":
            if "age_val" in available:
                try:
                    conds.append(f"{alias}.age_val >= ? AND {alias}.age_val > 0")
                    params.append(int(val))
                except (ValueError, TypeError):
                    pass
        elif dim == "age_lte":
            if "age_val" in available:
                try:
                    conds.append(f"{alias}.age_val <= ? AND {alias}.age_val > 0")
                    params.append(int(val))
                except (ValueError, TypeError):
                    pass
        elif dim == "age_between":
            if "age_val" in available:
                try:
                    lo, hi = val.split(":")
                    conds.append(
                        f"{alias}.age_val >= ? AND {alias}.age_val <= ? AND {alias}.age_val > 0"
                    )
                    params.extend([int(lo), int(hi)])
                except Exception:
                    pass

    return " AND ".join(conds), params, cnt


def run_duck_filter(
    sid: int,
    filters: list[tuple[str, str]],
    db_path: str,
) -> dict[str, Any] | None:
    """Run all filter queries via DuckDB. Returns result dict or None on failure."""
    try:
        import duckdb
    except ImportError:
        return None

    primary = _primary_table(filters)

    try:
        conn = duckdb.connect(":memory:")
        try:
            # Attach the SQLite DB (SQLite extension is bundled in duckdb >= 0.8)
            try:
                conn.execute(f"ATTACH '{db_path}' AS db (TYPE SQLITE, READ_ONLY TRUE)")
            except Exception:
                conn.execute("INSTALL sqlite; LOAD sqlite")
                conn.execute(f"ATTACH '{db_path}' AS db (TYPE SQLITE, READ_ONLY TRUE)")

            def q(table_slug: str, extra_conds: list[str] | None = None, extra_params: list | None = None):
                alias = f"db.{table_slug}"
                w, p, cnt = _build_where(sid, filters, table_slug, alias)
                if extra_conds:
                    w += " AND " + " AND ".join(extra_conds)
                if extra_params:
                    p = p + extra_params
                return alias, w, p, cnt

            alias_p, where_p, params_p, cnt_p = q(primary)

            # ── KPIs ──────────────────────────────────────────────────────────
            row = conn.execute(f"""
                SELECT
                    SUM({cnt_p}),
                    SUM({alias_p}.working_count), SUM({alias_p}.student_count),
                    SUM({alias_p}.tipo_count),    SUM({alias_p}.contract_count),
                    SUM({alias_p}.salary_sum),    SUM({alias_p}.salary_count),
                    SUM({alias_p}.age_sum),       SUM({alias_p}.age_count)
                FROM {alias_p} WHERE {where_p}
            """, params_p).fetchone()

            total = int(row[0] or 0)
            if total == 0:
                return {"no_data": True}

            sal_s, sal_c = float(row[5] or 0), int(row[6] or 0)
            age_s, age_c = float(row[7] or 0), int(row[8] or 0)

            kpis = {
                "total_persons": total,
                "working":        int(row[1] or 0),
                "students":       int(row[2] or 0),
                "tipo_count":     int(row[3] or 0),
                "active_contracts": int(row[4] or 0),
                "avg_salary": round(sal_s / sal_c) if sal_c > 0 else 0,
                "avg_age":    round(age_s / age_c, 1) if age_c > 0 else 0,
                "median_age": None,
            }

            # ── Statuses ──────────────────────────────────────────────────────
            st = conn.execute(f"""
                SELECT
                    SUM({alias_p}.working_count),   SUM({alias_p}.student_count),
                    SUM({alias_p}.ip_count),         SUM({alias_p}.lsi_count),
                    SUM({alias_p}.unemployed_count), SUM({alias_p}.uncovered_count),
                    SUM({alias_p}.under18_count),    SUM({alias_p}.foreign_count),
                    SUM({alias_p}.pregnant_count),   SUM({alias_p}.uhod_count),
                    SUM({alias_p}.berkut_count),     SUM({alias_p}.asp_count),
                    SUM({alias_p}.pensioner_count),  SUM({alias_p}.kandas_count),
                    SUM({alias_p}.mnogodetnyi_count),SUM({alias_p}.cbd_count)
                FROM {alias_p} WHERE {where_p}
            """, params_p).fetchone()

            status_names = [
                "РАБОТАЮЩИЕ", "СТУДЕНТ", "ИП", "ЛСИ", "БЕЗРАБОТНЫЕ", "НЕОХВАЧЕННЫЕ",
                "ДЕТИ ОТ 14 ДО 18 ЛЕТ", "ИНОСТРАННЫЕ ГРАЖДАНЕ", "БЕРЕМЕННЫЕ",
                "ПО УХОДУ ЗА РЕБЕНКОМ ДО 3", "ПО УХОДУ ЗА ЛСИ", "ПОЛУЧАТЕЛИ АСП",
                "ПЕНСИОНЕРЫ", "КАНДАСЫ", "МНОГОДЕТНЫЕ", "ПОЛУЧАТЕЛИ ПОСОБИЙ",
            ]
            statuses_raw = {name: int(st[i] or 0) for i, name in enumerate(status_names)}

            # ── Regions ───────────────────────────────────────────────────────
            region_rows = conn.execute(f"""
                SELECT {alias_p}.region_code, {alias_p}.region_name,
                    SUM({cnt_p}) AS c,
                    SUM({alias_p}.salary_sum), SUM({alias_p}.salary_count)
                FROM {alias_p} WHERE {where_p}
                GROUP BY {alias_p}.region_code, {alias_p}.region_name
                ORDER BY c DESC
            """, params_p).fetchall()

            # ── Gender ────────────────────────────────────────────────────────
            gender_rows = conn.execute(f"""
                SELECT {alias_p}.gender, SUM({cnt_p}) AS c
                FROM {alias_p} WHERE {where_p}
                GROUP BY {alias_p}.gender
            """, params_p).fetchall()

            # ── Category ──────────────────────────────────────────────────────
            cat_rows = conn.execute(f"""
                SELECT {alias_p}.category, SUM({cnt_p}) AS c
                FROM {alias_p} WHERE {where_p}
                GROUP BY {alias_p}.category
                ORDER BY c DESC
            """, params_p).fetchall()

            # ── Age groups ────────────────────────────────────────────────────
            age_rows = conn.execute(f"""
                SELECT {alias_p}.age_group, SUM({cnt_p}) AS c
                FROM {alias_p} WHERE {where_p}
                GROUP BY {alias_p}.age_group
            """, params_p).fetchall()

            # ── Family type — always micro_agg ────────────────────────────────
            alias_m, where_m, params_m, cnt_m = q("micro_agg",
                [f"db.micro_agg.family_type != ''"])
            fam_rows = conn.execute(f"""
                SELECT db.micro_agg.family_type, SUM({cnt_m}) AS c
                FROM db.micro_agg WHERE {where_m}
                GROUP BY db.micro_agg.family_type
                ORDER BY c DESC
            """, params_m).fetchall()

            # ── OKVED ─────────────────────────────────────────────────────────
            alias_o, where_o, params_o, cnt_o = q("okved_agg",
                ["db.okved_agg.okved != ''"])
            okved_rows = conn.execute(f"""
                SELECT db.okved_agg.okved, SUM({cnt_o}) AS c,
                    SUM(db.okved_agg.salary_sum), SUM(db.okved_agg.salary_count)
                FROM db.okved_agg WHERE {where_o}
                GROUP BY db.okved_agg.okved
                ORDER BY c DESC
                LIMIT 20
            """, params_o).fetchall()

            # ── Nationality ───────────────────────────────────────────────────
            alias_n, where_n, params_n, cnt_n = q("nat_agg",
                ["db.nat_agg.nationality != ''"])
            nat_rows = conn.execute(f"""
                SELECT db.nat_agg.nationality, SUM({cnt_n}) AS c
                FROM db.nat_agg WHERE {where_n}
                GROUP BY db.nat_agg.nationality
                ORDER BY c DESC
                LIMIT 20
            """, params_n).fetchall()

            # ── NKZ ───────────────────────────────────────────────────────────
            alias_z, where_z, params_z, cnt_z = q("nkz_agg",
                ["db.nkz_agg.nkz != ''"])
            nkz_rows = conn.execute(f"""
                SELECT db.nkz_agg.nkz, SUM({cnt_z}) AS c,
                    SUM(db.nkz_agg.salary_sum), SUM(db.nkz_agg.salary_count)
                FROM db.nkz_agg WHERE {where_z}
                GROUP BY db.nkz_agg.nkz
                ORDER BY c DESC
                LIMIT 20
            """, params_z).fetchall()

            # ── Education ─────────────────────────────────────────────────────
            alias_e, where_e, params_e, cnt_e = q("edu_agg",
                ["db.edu_agg.edu_name != ''"])

            def _edu(edu_type_val: str):
                rows = conn.execute(f"""
                    SELECT db.edu_agg.edu_name, SUM({cnt_e}) AS c
                    FROM db.edu_agg
                    WHERE {where_e} AND db.edu_agg.edu_type = ?
                    GROUP BY db.edu_agg.edu_name
                    ORDER BY c DESC
                    LIMIT 100
                """, params_e + [edu_type_val]).fetchall()
                return [{"name": r[0], "count": int(r[1])} for r in rows]

            def _sal(r, i=2):
                s, n = float(r[i] or 0), int(r[i + 1] or 0)
                return round(s / n) if n > 0 else 0

            age_order = ["14-17", "18-24", "25-29", "30-35"]
            age_map = {r[0]: int(r[1]) for r in age_rows}

            return {
                "kpis": kpis,
                "statuses": [
                    {"name": k, "count": v}
                    for k, v in sorted(statuses_raw.items(), key=lambda x: -x[1])
                    if v > 0
                ],
                "regions": [
                    {"code": r[0], "name": r[1], "count": int(r[2]), "avg_salary": _sal(r)}
                    for r in region_rows
                ],
                "gender":        [{"gender":      r[0], "count": int(r[1])} for r in gender_rows],
                "family_type":   [{"family_type": r[0], "count": int(r[1])} for r in fam_rows],
                "categorization":[{"category":    r[0], "count": int(r[1])} for r in cat_rows],
                "age_groups":    [{"group": g, "count": age_map.get(g, 0)} for g in age_order],
                "okved": [{"name": r[0], "count": int(r[1]), "avg_salary": _sal(r)} for r in okved_rows],
                "nkz":   [{"name": r[0], "count": int(r[1]), "avg_salary": _sal(r)} for r in nkz_rows],
                "nationality": [{"nationality": r[0], "count": int(r[1])} for r in nat_rows],
                "edu": {
                    "vuz":    _edu("vuz"),
                    "tipo":   _edu("tipo"),
                    "school": _edu("school"),
                },
            }
        finally:
            conn.close()

    except Exception as exc:
        _log.warning("DuckDB filter failed, will fall back to SQLAlchemy: %s", exc)
        return None
