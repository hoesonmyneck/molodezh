import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend, ResponsiveContainer,
} from 'recharts'
import {
  getKpis, getStatuses, getRegions, getDistricts,
  getAgeGroups, getCategorization, getGender, getOkved, getNationality,
} from '../api'

const TEAL = '#147a80'
const COLORS = ['#147a80', '#1a9099', '#22b8c4', '#0f5f64', '#2dd4bf', '#0891b2', '#0e7490', '#67e8f9']
const CAT_COLORS = { A: '#ef4444', B: '#f97316', C: '#eab308', D: '#22c55e', 'Не указано': '#9ca3af' }

function fmt(n) {
  if (n == null) return '—'
  return Math.round(n).toLocaleString('ru-RU')
}

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
        <span style={{ fontSize: 28, fontWeight: 700, color: TEAL, lineHeight: 1 }}>
          {fmt(main)}
        </span>
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
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '8px 14px', fontSize: 12, fontWeight: 500,
            border: 'none', background: 'transparent',
            borderBottom: active === t.key ? `2px solid ${TEAL}` : '2px solid transparent',
            color: active === t.key ? TEAL : 'var(--muted)',
            marginBottom: -1, whiteSpace: 'nowrap',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Custom tooltip for status bar chart
function StatusTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#1f2937', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
      <div>{payload[0].payload.name}</div>
      <div style={{ fontWeight: 700 }}>{fmt(payload[0].value)}</div>
    </div>
  )
}

// Horizontal bar chart for statuses
function StatusChart({ data }) {
  if (!data?.length) return <EmptyState />
  const sorted = [...data].sort((a, b) => b.count - a.count)
  return (
    <ResponsiveContainer width="100%" height={Math.max(300, sorted.length * 38)}>
      <BarChart
        data={sorted}
        layout="vertical"
        margin={{ top: 0, right: 50, left: 10, bottom: 0 }}
        barSize={18}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis
          dataKey="name"
          type="category"
          width={210}
          tick={{ fontSize: 11, fill: '#374151' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<StatusTooltip />} cursor={{ fill: '#f9fafb' }} />
        <Bar dataKey="count" fill={TEAL} radius={[0, 4, 4, 0]}
          label={{ position: 'right', fontSize: 11, fill: '#6b7280', formatter: fmt }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

// Region table
function RegionTable({ data }) {
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
          {data.map((r) => (
            <tr key={r.code} style={{ borderBottom: '1px solid #f9fafb' }}>
              <td style={{ padding: '8px 4px' }}>{r.name}</td>
              <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600, color: TEAL }}>{fmt(r.count)}</td>
              <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                {total ? ((r.count / total) * 100).toFixed(1) + '%' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OkvedChart({ data }) {
  if (!data?.length) return <EmptyState />
  const top = data.slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height={Math.max(280, top.length * 36)}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 60, left: 10, bottom: 0 }} barSize={14}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis dataKey="name" type="category" width={240} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
        <Tooltip content={<StatusTooltip />} cursor={{ fill: '#f9fafb' }} />
        <Bar dataKey="count" fill="#1a9099" radius={[0, 4, 4, 0]}
          label={{ position: 'right', fontSize: 10, fill: '#6b7280', formatter: fmt }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function DonutChart({ data, nameKey = 'category', valueKey = 'count', colorMap }) {
  if (!data?.length) return <EmptyState />
  const total = data.reduce((s, d) => s + d[valueKey], 0)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <PieChart width={160} height={160}>
        <Pie data={data} dataKey={valueKey} nameKey={nameKey} cx="50%" cy="50%"
          innerRadius={45} outerRadius={75} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell
              key={i}
              fill={colorMap ? (colorMap[entry[nameKey]] || COLORS[i % COLORS.length]) : COLORS[i % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip formatter={(v) => fmt(v)} />
      </PieChart>
      <div style={{ flex: 1 }}>
        {data.map((d, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{
                width: 10, height: 10, borderRadius: 2,
                background: colorMap ? (colorMap[d[nameKey]] || COLORS[i % COLORS.length]) : COLORS[i % COLORS.length],
              }} />
              <span style={{ color: '#374151' }}>{d[nameKey]}</span>
            </div>
            <div style={{ fontWeight: 600, color: TEAL }}>
              {total ? ((d[valueKey] / total) * 100).toFixed(1) + '%' : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AgeBar({ data }) {
  if (!data?.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} barSize={32}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
        <XAxis dataKey="group" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [fmt(v), 'Чел.']} />
        <Bar dataKey="count" fill={TEAL} radius={[4, 4, 0, 0]}
          label={{ position: 'top', fontSize: 10, fill: '#6b7280', formatter: fmt }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

function EmptyState() {
  return (
    <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px 20px', fontSize: 13 }}>
      Нет данных. Загрузите Excel-файлы в разделе «Управление».
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: .6, color: 'var(--muted)', marginBottom: 14,
    }}>
      {children}
    </div>
  )
}

const th = { padding: '6px 4px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: 11 }

export default function Dashboard() {
  const [kpis, setKpis] = useState(null)
  const [statuses, setStatuses] = useState([])
  const [regions, setRegions] = useState([])
  const [ageGroups, setAgeGroups] = useState([])
  const [cats, setCats] = useState([])
  const [gender, setGender] = useState([])
  const [okved, setOkved] = useState([])
  const [nationality, setNationality] = useState([])

  const [leftTab, setLeftTab] = useState('statuses')
  const [rightTab, setRightTab] = useState('age')
  const [bottomTab, setBottomTab] = useState('cat')

  const load = useCallback(async () => {
    try {
      const [k, s, r, a, c, g, o, n] = await Promise.all([
        getKpis(), getStatuses(), getRegions(),
        getAgeGroups(), getCategorization(), getGender(), getOkved(), getNationality(),
      ])
      setKpis(k.data)
      setStatuses(s.data)
      setRegions(r.data)
      setAgeGroups(a.data)
      setCats(c.data)
      setGender(g.data)
      setOkved(o.data)
      setNationality(n.data)
    } catch {}
  }, [])

  useEffect(() => { load() }, [load])

  const noData = !kpis || kpis.no_data

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <KpiCard
          title="Количество ФЛ"
          main={kpis?.total_persons}
        />
        <KpiCard
          title="Работающие"
          main={kpis?.working}
          sub={kpis?.active_contracts}
          subLabel="Активный ТД"
        />
        <KpiCard
          title="Средняя ЗП"
          main={kpis?.avg_salary}
        />
        <KpiCard
          title="Обучающиеся"
          main={kpis?.students}
          sub={kpis?.tipo_count}
          subLabel="ТИПО"
        />
        <KpiCard
          title="Средний возраст"
          main={kpis?.avg_age != null ? Math.round(kpis.avg_age) : null}
          sub={kpis?.median_age != null ? Math.round(kpis.median_age) : null}
          subLabel="Медианный возраст"
        />
      </div>

      {/* Main panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>

        {/* Left panel */}
        <Card style={{ padding: '16px 20px' }}>
          <Tabs
            tabs={[
              { key: 'statuses', label: 'Статусы' },
              { key: 'regions', label: 'Область-Район' },
              { key: 'okved', label: 'ОКЭД' },
              { key: 'nationality', label: 'Национальность' },
            ]}
            active={leftTab}
            onChange={setLeftTab}
          />
          {leftTab === 'statuses' && (
            <>
              <SectionTitle>Рейтинг статусов</SectionTitle>
              <StatusChart data={statuses} />
            </>
          )}
          {leftTab === 'regions' && (
            <>
              <SectionTitle>Регионы</SectionTitle>
              <RegionTable data={regions} />
            </>
          )}
          {leftTab === 'okved' && (
            <>
              <SectionTitle>ОКЭД (топ-10)</SectionTitle>
              <OkvedChart data={okved} />
            </>
          )}
          {leftTab === 'nationality' && (
            <>
              <SectionTitle>Национальность (топ-15)</SectionTitle>
              <NationalityTable data={nationality} />
            </>
          )}
        </Card>

        {/* Right panel */}
        <Card style={{ padding: '16px 20px' }}>
          <Tabs
            tabs={[
              { key: 'age', label: 'Возраст' },
              { key: 'gender', label: 'Пол' },
            ]}
            active={rightTab}
            onChange={setRightTab}
          />
          {rightTab === 'age' && (
            <>
              <SectionTitle>Распределение по возрасту</SectionTitle>
              <AgeBar data={ageGroups} />
              {ageGroups.length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {ageGroups.map((g) => (
                    <div key={g.group} style={{
                      background: 'var(--teal-light)', borderRadius: 8,
                      padding: '10px 16px', flex: 1, textAlign: 'center', minWidth: 80,
                    }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: TEAL }}>{fmt(g.count)}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{g.group} лет</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {rightTab === 'gender' && (
            <>
              <SectionTitle>Распределение по полу</SectionTitle>
              <DonutChart data={gender} nameKey="gender" />
              <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
                {gender.map((g, i) => (
                  <div key={g.gender} style={{
                    background: 'var(--teal-light)', borderRadius: 8,
                    padding: '12px 16px', flex: 1, textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: TEAL }}>{fmt(g.count)}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{g.gender}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Bottom panel */}
      <Card style={{ padding: '16px 20px' }}>
        <Tabs
          tabs={[
            { key: 'cat', label: 'Категоризация (SDU_TZHS)' },
            { key: 'regions_chart', label: 'Регионы (график)' },
          ]}
          active={bottomTab}
          onChange={setBottomTab}
        />
        {bottomTab === 'cat' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div>
              <SectionTitle>Категоризация домохозяйств</SectionTitle>
              <DonutChart data={cats} nameKey="category" colorMap={CAT_COLORS} />
            </div>
            <div>
              <SectionTitle>Таблица</SectionTitle>
              <CatTable data={cats} />
            </div>
          </div>
        )}
        {bottomTab === 'regions_chart' && (
          <>
            <SectionTitle>Количество молодежи по регионам</SectionTitle>
            <RegionsBarChart data={regions} />
          </>
        )}
      </Card>
    </div>
  )
}

function NationalityTable({ data }) {
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
          {top.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
              <td style={{ padding: '7px 4px' }}>{r.nationality}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right', fontWeight: 600, color: TEAL }}>{fmt(r.count)}</td>
              <td style={{ padding: '7px 4px', textAlign: 'right', color: 'var(--muted)' }}>
                {total ? ((r.count / total) * 100).toFixed(1) + '%' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CatTable({ data }) {
  if (!data?.length) return null
  const total = data.reduce((s, d) => s + d.count, 0)
  const labels = { A: 'Очень бедные', B: 'Бедные', C: 'Ниже среднего', D: 'Средние и выше', 'Не указано': 'Не указано' }
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
        {data.map((d, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #f9fafb' }}>
            <td style={{ padding: '8px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: CAT_COLORS[d.category] || '#9ca3af' }} />
              <span>{d.category} {labels[d.category] ? `— ${labels[d.category]}` : ''}</span>
            </td>
            <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600, color: TEAL }}>{fmt(d.count)}</td>
            <td style={{ padding: '8px 4px', textAlign: 'right', color: 'var(--muted)' }}>
              {total ? ((d.count / total) * 100).toFixed(1) + '%' : '—'}
            </td>
          </tr>
        ))}
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
        <XAxis
          dataKey="name"
          tick={{ fontSize: 10, fill: '#374151' }}
          angle={-35}
          textAnchor="end"
          interval={0}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [fmt(v), 'Чел.']} />
        <Bar dataKey="count" fill={TEAL} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
