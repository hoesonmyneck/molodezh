import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts'
import {
  getKpis, getStatuses, getRegions,
  getAgeGroups, getCategorization, getGender, getOkved, getNationality,
  getFiltered,
} from '../api'

const TEAL = '#147a80'
const TEAL_DARK = '#0f5f64'
const COLORS = ['#147a80', '#1a9099', '#22b8c4', '#0f5f64', '#2dd4bf', '#0891b2', '#0e7490', '#67e8f9']
const CAT_COLORS  = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', E: '#ef4444', 'Не указано': '#9ca3af' }
const CAT_LABELS  = { A: 'Отличный', B: 'Хороший', C: 'Средний', D: 'Критический', E: 'Экстренный' }

const AGE_ORDER = ['14-17', '18-24', '25-29', '30-35']

function fmt(n) {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

// ── Primitives ────────────────────────────────────────────────────────────────
function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      boxShadow: '0 1px 4px rgba(0,0,0,.08)',
      border: '1px solid var(--border)', ...style,
    }}>
      {children}
    </div>
  )
}

function KpiCard({ title, main, sub, subLabel }) {
  return (
    <Card style={{ padding: '18px 20px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: TEAL, lineHeight: 1 }}>{fmt(main)}</span>
        {sub != null && (
          <div style={{ lineHeight: 1.3 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{fmt(sub)}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{subLabel}</div>
          </div>
        )}
      </div>
    </Card>
  )
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} style={{
          padding: '8px 14px', fontSize: 12, fontWeight: 500,
          border: 'none', background: 'transparent',
          borderBottom: active === t.key ? `2px solid ${TEAL}` : '2px solid transparent',
          color: active === t.key ? TEAL : 'var(--muted)',
          marginBottom: -1, whiteSpace: 'nowrap', cursor: 'pointer',
        }}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: 'var(--muted)', marginBottom: 14 }}>
      {children}
    </div>
  )
}

const th = { padding: '6px 4px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: 11 }

function EmptyState() {
  return <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 20px', fontSize: 13 }}>Нет данных. Загрузите Excel-файлы в разделе «Управление».</div>
}

// ── Filter banner ─────────────────────────────────────────────────────────────
function FilterBanner({ filters, onRemove, onClear }) {
  if (!filters.length) return null
  const dimLabel = { status: 'Статус', age_group: 'Возраст', region: 'Регион', gender: 'Пол', cat: 'Категория', okved: 'ОКЭД', nationality: 'Нац-сть' }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
      background: '#e6f4f5', border: `1px solid ${TEAL}`,
      borderRadius: 8, padding: '8px 14px', marginBottom: 14,
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: TEAL, textTransform: 'uppercase', letterSpacing: .4 }}>Фильтр:</span>
      {filters.map(f => (
        <span key={`${f.dim}:${f.val}`} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: TEAL, color: '#fff', borderRadius: 20,
          padding: '3px 10px 3px 12px', fontSize: 12, fontWeight: 500,
        }}>
          <span style={{ fontSize: 10, opacity: .75 }}>{dimLabel[f.dim] || f.dim}:</span>
          {f.val}
          <button onClick={() => onRemove(f.dim, f.val)} style={{
            background: 'none', border: 'none', color: '#fff', cursor: 'pointer',
            fontWeight: 700, fontSize: 13, padding: 0, lineHeight: 1, opacity: .8,
          }}>✕</button>
        </span>
      ))}
      {filters.length > 1 && (
        <span style={{ fontSize: 10, color: TEAL_DARK, marginLeft: 4, fontWeight: 600 }}>AND</span>
      )}
      <button onClick={onClear} style={{
        marginLeft: 'auto', border: 'none', background: 'transparent',
        cursor: 'pointer', color: TEAL_DARK, fontSize: 11, fontWeight: 600,
      }}>Сбросить всё</button>
    </div>
  )
}

// ── Clickable row helper ──────────────────────────────────────────────────────
function clickStyle(isActive) {
  return {
    cursor: 'pointer',
    background: isActive ? '#e6f4f5' : undefined,
    transition: 'background .1s',
  }
}

// ── Charts ────────────────────────────────────────────────────────────────────
function BTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1f2937', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
      <div>{payload[0].payload.name || payload[0].payload.group || payload[0].payload.gender || payload[0].payload.nationality}</div>
      <div style={{ fontWeight: 700 }}>{fmt(payload[0].value)}</div>
    </div>
  )
}

function StatusChart({ data, activeKeys, onToggle }) {
  if (!data?.length) return <EmptyState />
  const sorted = [...data].sort((a, b) => b.count - a.count)
  return (
    <ResponsiveContainer width="100%" height={Math.max(300, sorted.length * 38)}>
      <BarChart data={sorted} layout="vertical" margin={{ top: 0, right: 50, left: 10, bottom: 0 }} barSize={18}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis dataKey="name" type="category" width={210} tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
        <Tooltip content={<BTooltip />} cursor={{ fill: '#f0fafa' }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}
          label={{ position: 'right', fontSize: 11, fill: '#6b7280', formatter: fmt }}
          onClick={(d) => onToggle('status', d.name)}
          style={{ cursor: 'pointer' }}
        >
          {sorted.map((e, i) => {
            const active = activeKeys.some(f => f.dim === 'status' && f.val === e.name)
            return <Cell key={i} fill={active ? TEAL_DARK : TEAL} opacity={activeKeys.length && !active ? 0.45 : 1} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function AgeBar({ data, activeKeys, onToggle }) {
  if (!data?.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barSize={32}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="group" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [fmt(v), 'Чел.']} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}
          label={{ position: 'top', fontSize: 10, fill: '#6b7280', formatter: fmt }}
          onClick={(d) => onToggle('age_group', d.group)}
          style={{ cursor: 'pointer' }}
        >
          {data.map((e, i) => {
            const active = activeKeys.some(f => f.dim === 'age_group' && f.val === e.group)
            return <Cell key={i} fill={active ? TEAL_DARK : TEAL} opacity={activeKeys.length && !active ? 0.45 : 1} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function OkvedChart({ data, activeKeys, onToggle }) {
  if (!data?.length) return <EmptyState />
  const top = data.slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, top.length * 36)}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 60, left: 10, bottom: 0 }} barSize={14}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis dataKey="name" type="category" width={240} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
        <Tooltip content={<BTooltip />} cursor={{ fill: '#f9fafb' }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}
          label={{ position: 'right', fontSize: 10, fill: '#6b7280', formatter: fmt }}
          onClick={(d) => onToggle('okved', d.name)}
          style={{ cursor: 'pointer' }}
        >
          {top.map((e, i) => {
            const active = activeKeys.some(f => f.dim === 'okved' && f.val === e.name)
            return <Cell key={i} fill={active ? TEAL_DARK : '#1a9099'} opacity={activeKeys.length && !active ? 0.45 : 1} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function DonutChart({ data, nameKey = 'category', valueKey = 'count', colorMap, labelMap, activeKeys, dimKey, onToggle }) {
  if (!data?.length) return <EmptyState />
  const total = data.reduce((s, d) => s + d[valueKey], 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <PieChart width={160} height={160}>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="50%"
          innerRadius={45} outerRadius={75} paddingAngle={2}
          onClick={onToggle ? (d) => onToggle(dimKey, d[nameKey]) : undefined}
          style={{ cursor: onToggle ? 'pointer' : 'default' }}
        >
          {data.map((entry, i) => {
            const isActive = activeKeys?.some(f => f.dim === dimKey && f.val === entry[nameKey])
            const baseColor = colorMap ? (colorMap[entry[nameKey]] || COLORS[i % COLORS.length]) : COLORS[i % COLORS.length]
            return <Cell key={i} fill={isActive ? TEAL_DARK : baseColor} opacity={activeKeys?.length && !isActive ? 0.5 : 1} />
          })}
        </Pie>
        <Tooltip formatter={(v) => fmt(v)} />
      </PieChart>
      <div style={{ flex: 1 }}>
        {data.map((d, i) => {
          const isActive = activeKeys?.some(f => f.dim === dimKey && f.val === d[nameKey])
          const baseColor = colorMap ? (colorMap[d[nameKey]] || COLORS[i % COLORS.length]) : COLORS[i % COLORS.length]
          return (
            <div key={i}
              onClick={onToggle ? () => onToggle(dimKey, d[nameKey]) : undefined}
              style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, cursor: onToggle ? 'pointer' : 'default', borderRadius: 4, padding: '2px 4px', background: isActive ? '#e6f4f5' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: isActive ? TEAL_DARK : baseColor }} />
                <span style={{ color: '#374151' }}>{labelMap?.[d[nameKey]] || d[nameKey]}</span>
              </div>
              <div style={{ fontWeight: 600, color: TEAL }}>{total ? ((d[valueKey] / total) * 100).toFixed(1) + '%' : '—'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RegionTable({ data, activeKeys, onToggle }) {
  if (!data?.length) return <EmptyState />
  const total = data.reduce((s, r) => s + r.count, 0)
  return (
    <div style={{ overflowY: 'auto', maxHeight: 380 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Регион</th>
            <th style={{ ...th, textAlign: 'right' }}>Количество</th>
            <th style={{ ...th, textAlign: 'right' }}>%</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => {
            const isActive = activeKeys.some(f => f.dim === 'region' && f.val === r.code)
            return (
              <tr key={r.code}
                onClick={() => onToggle('region', r.code)}
                style={{ borderBottom: '1px solid #f9fafb', ...clickStyle(isActive) }}>
                <td style={{ padding: '8px 4px' }}>{r.name}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600, color: TEAL }}>{fmt(r.count)}</td>
                <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                  {total ? ((r.count / total) * 100).toFixed(1) + '%' : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function NationalityTable({ data, activeKeys, onToggle }) {
  if (!data?.length) return <EmptyState />
  const top = data.slice(0, 15)
  const total = data.reduce((s, d) => s + d.count, 0)
  return (
    <div style={{ overflowY: 'auto', maxHeight: 380 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Национальность</th>
            <th style={{ ...th, textAlign: 'right' }}>Количество</th>
            <th style={{ ...th, textAlign: 'right' }}>%</th>
          </tr>
        </thead>
        <tbody>
          {top.map((r, i) => {
            const isActive = activeKeys.some(f => f.dim === 'nationality' && f.val === r.nationality)
            return (
              <tr key={i}
                onClick={() => onToggle('nationality', r.nationality)}
                style={{ borderBottom: '1px solid #f9fafb', ...clickStyle(isActive) }}>
                <td style={{ padding: '7px 4px' }}>{r.nationality}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 600, color: TEAL }}>{fmt(r.count)}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                  {total ? ((r.count / total) * 100).toFixed(1) + '%' : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CatTable({ data, activeKeys, onToggle }) {
  if (!data?.length) return null
  const total = data.reduce((s, d) => s + d.count, 0)
  const labels = CAT_LABELS
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={th}>Категория</th>
          <th style={{ ...th, textAlign: 'right' }}>Количество</th>
          <th style={{ ...th, textAlign: 'right' }}>%</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d, i) => {
          const isActive = activeKeys.some(f => f.dim === 'cat' && f.val === d.category)
          return (
            <tr key={i}
              onClick={() => onToggle('cat', d.category)}
              style={{ borderBottom: '1px solid #f9fafb', ...clickStyle(isActive) }}>
              <td style={{ padding: '8px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: CAT_COLORS[d.category] || '#9ca3af' }} />
                <span>{d.category} {labels[d.category] ? `— ${labels[d.category]}` : ''}</span>
              </td>
              <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600, color: TEAL }}>{fmt(d.count)}</td>
              <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                {total ? ((d.count / total) * 100).toFixed(1) + '%' : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RegionsBarChart({ data }) {
  if (!data?.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 60 }} barSize={24}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#374151' }} angle={-35} textAnchor="end" interval={0} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [fmt(v), 'Чел.']} />
        <Bar dataKey="count" fill={TEAL} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function Dashboard({ globalFilters = [] }) {
  const [base, setBase] = useState({
    kpis: null, statuses: [], regions: [], ageGroups: [],
    cats: [], gender: [], okved: [], nationality: [],
  })
  const [activeFilters, setActiveFilters] = useState([])
  const [filteredData, setFilteredData] = useState(null)
  const [loading, setLoading] = useState(false)

  const [leftTab, setLeftTab] = useState('statuses')
  const [rightTab, setRightTab] = useState('age')
  const [bottomTab, setBottomTab] = useState('cat')

  const loadBase = useCallback(async () => {
    try {
      const [k, s, r, a, c, g, o, n] = await Promise.all([
        getKpis(), getStatuses(), getRegions(),
        getAgeGroups(), getCategorization(), getGender(), getOkved(), getNationality(),
      ])
      setBase({ kpis: k.data, statuses: s.data, regions: r.data, ageGroups: a.data, cats: c.data, gender: g.data, okved: o.data, nationality: n.data })
    } catch {}
  }, [])

  useEffect(() => { loadBase() }, [loadBase])

  useEffect(() => {
    const all = [...globalFilters, ...activeFilters]
    if (!all.length) { setFilteredData(null); return }
    setLoading(true)
    getFiltered(all)
      .then(r => {
        const d = r.data
        setFilteredData(d && !d.no_data ? d : null)
      })
      .catch(() => setFilteredData(null))
      .finally(() => setLoading(false))
  }, [globalFilters, activeFilters])

  const toggleFilter = (dim, val) => {
    setActiveFilters(prev => {
      const exists = prev.some(f => f.dim === dim && f.val === val)
      return exists ? prev.filter(f => !(f.dim === dim && f.val === val)) : [...prev, { dim, val }]
    })
  }
  const removeFilter = (dim, val) => setActiveFilters(prev => prev.filter(f => !(f.dim === dim && f.val === val)))
  const clearFilters = () => { setActiveFilters([]); setFilteredData(null) }

  const fd = filteredData
  const kpis = fd?.kpis || base.kpis
  const statuses = fd?.statuses || base.statuses
  const regions = fd?.regions || base.regions
  const ageGroups = fd?.age_groups || base.ageGroups
  const gender = fd?.gender || base.gender
  const cats = fd?.categorization || base.cats
  const okved = fd?.okved || base.okved
  const nationality = fd?.nationality || base.nationality

  const af = activeFilters

  return (
    <div>
      <FilterBanner filters={af} onRemove={removeFilter} onClear={clearFilters} />
      {loading && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Загрузка данных...</div>}

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KpiCard title="Количество ФЛ" main={kpis?.total_persons} />
        <KpiCard title="Работающие" main={kpis?.working} sub={kpis?.active_contracts} subLabel="Активный ТД" />
        <KpiCard title="Средняя ЗП" main={kpis?.avg_salary} />
        <KpiCard title="ВУЗ" main={kpis?.students} sub={kpis?.tipo_count} subLabel="ТИПО" />
        <KpiCard
          title="Средний возраст"
          main={kpis?.avg_age != null ? Math.round(kpis.avg_age) : null}
          sub={kpis?.median_age != null ? Math.round(kpis.median_age) : null}
          subLabel="Медианный возраст"
        />
      </div>

      {/* Main panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card style={{ padding: '16px 20px' }}>
          <Tabs tabs={[
            { key: 'statuses', label: 'Статусы' },
            { key: 'regions', label: 'Регионы' },
            { key: 'okved', label: 'ОКЭД' },
            { key: 'nationality', label: 'Национальность' },
          ]} active={leftTab} onChange={setLeftTab} />

          {leftTab === 'statuses' && <>
            <SectionTitle>Рейтинг статусов — нажмите для фильтрации</SectionTitle>
            <StatusChart data={statuses} activeKeys={af} onToggle={toggleFilter} />
          </>}
          {leftTab === 'regions' && <>
            <SectionTitle>Регионы — нажмите для фильтрации</SectionTitle>
            <RegionTable data={regions} activeKeys={af} onToggle={toggleFilter} />
          </>}
          {leftTab === 'okved' && <>
            <SectionTitle>ОКЭД (топ-10) — нажмите для фильтрации</SectionTitle>
            <OkvedChart data={okved} activeKeys={af} onToggle={toggleFilter} />
          </>}
          {leftTab === 'nationality' && <>
            <SectionTitle>Национальность (топ-15) — нажмите для фильтрации</SectionTitle>
            <NationalityTable data={nationality} activeKeys={af} onToggle={toggleFilter} />
          </>}
        </Card>

        <Card style={{ padding: '16px 20px' }}>
          <Tabs tabs={[
            { key: 'age', label: 'Возраст' },
            { key: 'gender', label: 'Пол' },
          ]} active={rightTab} onChange={setRightTab} />

          {rightTab === 'age' && <>
            <SectionTitle>Распределение по возрасту — нажмите для фильтрации</SectionTitle>
            <AgeBar data={ageGroups} activeKeys={af} onToggle={toggleFilter} />
            {ageGroups.length > 0 && (
              <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {ageGroups.map((g) => {
                  const isActive = af.some(f => f.dim === 'age_group' && f.val === g.group)
                  return (
                    <div key={g.group} onClick={() => toggleFilter('age_group', g.group)} style={{
                      background: isActive ? TEAL : 'var(--teal-light)',
                      borderRadius: 8, padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 80,
                      cursor: 'pointer', border: isActive ? `2px solid ${TEAL_DARK}` : '2px solid transparent',
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: isActive ? '#fff' : TEAL }}>{fmt(g.count)}</div>
                      <div style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,.8)' : 'var(--muted)', marginTop: 2 }}>{g.group} лет</div>
                    </div>
                  )
                })}
              </div>
            )}
          </>}

          {rightTab === 'gender' && <>
            <SectionTitle>Распределение по полу — нажмите для фильтрации</SectionTitle>
            <DonutChart data={gender} nameKey="gender" activeKeys={af} dimKey="gender" onToggle={toggleFilter} />
            <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
              {gender.map((g) => {
                const isActive = af.some(f => f.dim === 'gender' && f.val === g.gender)
                return (
                  <div key={g.gender} onClick={() => toggleFilter('gender', g.gender)} style={{
                    background: isActive ? TEAL : 'var(--teal-light)', borderRadius: 8,
                    padding: '12px 16px', flex: 1, textAlign: 'center', cursor: 'pointer',
                    border: isActive ? `2px solid ${TEAL_DARK}` : '2px solid transparent',
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: isActive ? '#fff' : TEAL }}>{fmt(g.count)}</div>
                    <div style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,.8)' : 'var(--muted)', marginTop: 2 }}>{g.gender}</div>
                  </div>
                )
              })}
            </div>
          </>}
        </Card>
      </div>

      {/* Bottom panel */}
      <Card style={{ padding: '16px 20px' }}>
        <Tabs tabs={[
          { key: 'cat', label: 'Категоризация (SDU_TZHS)' },
          { key: 'regions_chart', label: 'Регионы (график)' },
        ]} active={bottomTab} onChange={setBottomTab} />

        {bottomTab === 'cat' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div>
              <SectionTitle>Категоризация домохозяйств — нажмите для фильтрации</SectionTitle>
              <DonutChart data={cats} nameKey="category" colorMap={CAT_COLORS} labelMap={CAT_LABELS} activeKeys={af} dimKey="cat" onToggle={toggleFilter} />
            </div>
            <div>
              <SectionTitle>Таблица</SectionTitle>
              <CatTable data={cats} activeKeys={af} onToggle={toggleFilter} />
            </div>
          </div>
        )}
        {bottomTab === 'regions_chart' && <>
          <SectionTitle>Количество молодежи по регионам</SectionTitle>
          <RegionsBarChart data={regions} />
        </>}
      </Card>
    </div>
  )
}
