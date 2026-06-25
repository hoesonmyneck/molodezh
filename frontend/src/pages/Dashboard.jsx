import { useState, useEffect, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, ResponsiveContainer,
} from 'recharts'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  getKpis, getStatuses, getRegions,
  getAgeGroups, getCategorization, getGender, getOkved, getNkz, getNationality,
  getFamilyType, getEdu, getMigration, getFiltered, getIrm, getCkm,
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

function KpiCard({ title, main, sub, subLabel, onSubClick, activeFilter }) {
  return (
    <Card style={{ padding: '18px 20px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: TEAL, lineHeight: 1 }}>{fmt(main)}</span>
        {sub != null && (
          <div
            onClick={onSubClick}
            style={{
              lineHeight: 1.3, cursor: onSubClick ? 'pointer' : 'default',
              padding: '2px 6px', borderRadius: 5, alignSelf: 'flex-start',
              background: activeFilter ? TEAL : 'transparent',
              transition: 'background .15s',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: activeFilter ? '#fff' : '#374151' }}>{fmt(sub)}</div>
            <div style={{ fontSize: 10, color: activeFilter ? 'rgba(255,255,255,.8)' : 'var(--muted)', textTransform: 'uppercase' }}>{subLabel}</div>
          </div>
        )}
      </div>
    </Card>
  )
}

function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ overflowX: 'auto', overflowY: 'hidden', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 2, minWidth: 'max-content' }}>
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
  const dimLabel = { status: 'Статус', age_group: 'Возраст', region: 'Регион', gender: 'Пол', cat: 'Категория', okved: 'ОКЭД', nkz: 'НКЗ', nationality: 'Нац-сть', family_type: 'Тип семьи', vuz: 'ВУЗ', tipo: 'ТИПО', school: 'Школа' }
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
    <div>
    <ResponsiveContainer width="100%" height={220}>
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
    </div>
  )
}

function OkvedChart({ data, activeKeys, dimKey = 'okved', onToggle }) {
  if (!data?.length) return <EmptyState />
  const top = data.slice(0, 10)

  const renderLabel = ({ x, y, width, height, value, index }) => {
    const salary = top[index]?.avg_salary || 0
    const midY = y + height / 2
    return (
      <g key={index}>
        <text x={x + width + 6} y={midY - (salary > 0 ? 5 : 0)} fontSize={10} fill="#6b7280" dominantBaseline="middle">
          {fmt(value)}
        </text>
        {salary > 0 && (
          <text x={x + width + 6} y={midY + 7} fontSize={9} fill="#9ca3af" dominantBaseline="middle">
            {'СМЗ: ' + fmt(salary)}
          </text>
        )}
      </g>
    )
  }

  const chartH = top.length * 38 + 20

  return (
    <div>
    <ResponsiveContainer width="100%" height={chartH}>
      <BarChart data={top} layout="vertical" margin={{ top: 0, right: 120, left: 10, bottom: 0 }} barSize={16}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
        <YAxis dataKey="name" type="category" width={240} tick={{ fontSize: 10, fill: '#374151' }} axisLine={false} tickLine={false} />
        <Tooltip content={<BTooltip />} cursor={{ fill: '#f9fafb' }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}
          label={renderLabel}
          onClick={(d) => onToggle(dimKey, d.name)}
          style={{ cursor: 'pointer' }}
        >
          {top.map((e, i) => {
            const active = activeKeys.some(f => f.dim === dimKey && f.val === e.name)
            return <Cell key={i} fill={active ? TEAL_DARK : '#1a9099'} opacity={activeKeys.length && !active ? 0.45 : 1} />
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
  )
}

function DonutChart({ data, nameKey = 'category', valueKey = 'count', colorMap, labelMap, activeKeys, dimKey, onToggle, hideLegend }) {
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
      {!hideLegend && <div style={{ flex: 1 }}>
        {data.map((d, i) => {
          const isActive = activeKeys?.some(f => f.dim === dimKey && f.val === d[nameKey])
          const baseColor = colorMap ? (colorMap[d[nameKey]] || COLORS[i % COLORS.length]) : COLORS[i % COLORS.length]
          return (
            <div key={i}
              onClick={onToggle ? () => onToggle(dimKey, d[nameKey]) : undefined}
              style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, cursor: onToggle ? 'pointer' : 'default', borderRadius: 4, padding: '2px 4px', background: isActive ? '#e6f4f5' : 'transparent' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: isActive ? TEAL_DARK : baseColor }} />
                <span style={{ color: '#374151' }}>{d[nameKey]}</span>
              </div>
              <div style={{ fontWeight: 600, color: TEAL }}>{total ? ((d[valueKey] / total) * 100).toFixed(1) + '%' : '—'}</div>
            </div>
          )
        })}
      </div>}
    </div>
  )
}

function RegionTable({ data, activeKeys, onToggle }) {
  if (!data?.length) return <EmptyState />
  const total = data.reduce((s, r) => s + r.count, 0)
  return (
    <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Регион</th>
            <th style={{ ...th, textAlign: 'right' }}>Кол-во</th>
            <th style={{ ...th, textAlign: 'right' }}>%</th>
            <th style={{ ...th, textAlign: 'right' }}>СМЗ</th>
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
                <td style={{ padding: '8px 4px', textAlign: 'right', color: '#6b7280' }}>
                  {r.avg_salary > 0 ? fmt(r.avg_salary) : '—'}
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
    <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
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

function EduTable({ data, dimKey, activeKeys, onToggle, totalOverride }) {
  if (!data?.length) return <EmptyState />
  const total = totalOverride || data.reduce((s, r) => s + r.count, 0)
  return (
    <div style={{ overflowY: 'auto', maxHeight: 380 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Учебное заведение</th>
            <th style={{ ...th, textAlign: 'right' }}>Кол-во</th>
            <th style={{ ...th, textAlign: 'right' }}>%</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => {
            const isActive = activeKeys.some(f => f.dim === dimKey && f.val === r.name)
            return (
              <tr key={i}
                onClick={() => onToggle(dimKey, r.name)}
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

function MigrationChart({ data }) {
  const [view, setView] = useState('flow')
  if (!data?.length) return <EmptyState />

  const rows = [...data]
    .map(r => ({ ...r, balance: r.arrived - r.departed }))
    .sort((a, b) => b.arrived - a.arrived)

  const rowsBal = [...rows].sort((a, b) => b.balance - a.balance)

  const btnStyle = (v) => ({
    padding: '5px 14px', fontSize: 11, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${view === v ? TEAL : 'var(--border)'}`,
    borderRadius: 6,
    background: view === v ? TEAL : '#fff',
    color: view === v ? '#fff' : 'var(--muted)',
  })

  const FlowTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: '#1f2937', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: p.color }}>{p.name}: {fmt(p.value)}</div>
        ))}
      </div>
    )
  }

  const BalTip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    const v = payload[0].value
    return (
      <div style={{ background: '#1f2937', color: '#fff', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        <div style={{ color: v >= 0 ? '#4ade80' : '#f87171' }}>
          Сальдо: {v > 0 ? '+' : ''}{fmt(v)}
        </div>
      </div>
    )
  }

  const yWidth = 200

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button style={btnStyle('flow')} onClick={() => setView('flow')}>Прибытие / Отбытие</button>
        <button style={btnStyle('balance')} onClick={() => setView('balance')}>Сальдо</button>
      </div>

      {view === 'flow' && (
        <ResponsiveContainer width="100%" height={Math.max(420, rows.length * 44)}>
          <BarChart data={rows} layout="vertical"
            margin={{ top: 0, right: 55, left: 4, bottom: 0 }}
            barSize={10} barCategoryGap="30%">
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis dataKey="region" type="category" width={yWidth}
              tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
            <Tooltip content={<FlowTip />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="arrived" name="Прибыло" fill="#16a34a" radius={[0, 3, 3, 0]}
              label={{ position: 'right', fontSize: 10, fill: '#16a34a', formatter: fmt }} />
            <Bar dataKey="departed" name="Отбыло" fill="#dc2626" radius={[0, 3, 3, 0]}
              label={{ position: 'right', fontSize: 10, fill: '#dc2626', formatter: fmt }} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {view === 'balance' && (
        <ResponsiveContainer width="100%" height={Math.max(340, rowsBal.length * 30)}>
          <BarChart data={rowsBal} layout="vertical"
            margin={{ top: 0, right: 60, left: 4, bottom: 0 }}
            barSize={14}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
            <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis dataKey="region" type="category" width={yWidth}
              tick={{ fontSize: 11, fill: '#374151' }} axisLine={false} tickLine={false} />
            <Tooltip content={<BalTip />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="balance" name="Сальдо" radius={[0, 3, 3, 0]}
              label={{ position: 'right', fontSize: 10, fill: '#6b7280',
                formatter: (v) => (v > 0 ? '+' : '') + fmt(v) }}>
              {rowsBal.map((entry, i) => (
                <Cell key={i} fill={entry.balance >= 0 ? '#16a34a' : '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </>
  )
}

function IrmTable({ category }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)

  if (!category) return <EmptyState />
  const [regionCol, ...indCols] = category.columns
  const colClean = (col) => {
    if (col === 'ИРМ') return 'ИРМ'
    // "J1.«Образование и наука»" → "Образование и наука"
    const m = col.match(/[««""](.+?)[»»""]/)
    if (m) return m[1]
    return col
  }
  const isMainCol = (col) => /^J\d/.test(col) || col === 'ИРМ'

  const handleSort = (colIdx) => {
    if (sortCol === colIdx) setSortAsc(a => !a)
    else { setSortCol(colIdx); setSortAsc(true) }
  }

  const sortedRows = sortCol === null ? category.rows : [...category.rows].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol]
    if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
    return sortAsc ? String(av).localeCompare(String(bv), 'ru') : String(bv).localeCompare(String(av), 'ru')
  })

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th
              onClick={() => handleSort(0)}
              style={{ ...th, minWidth: 170, position: 'sticky', left: 0, background: '#fff', zIndex: 1, cursor: 'pointer', userSelect: 'none' }}
            >
              {regionCol} {sortCol === 0 ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            {indCols.map((col, i) => {
              const ci = i + 1
              const isMain = isMainCol(col)
              const sorted = sortCol === ci
              return (
                <th key={i} title={col}
                  onClick={() => handleSort(ci)}
                  style={{
                    ...th, textAlign: 'right', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                    fontWeight: isMain ? 700 : 600,
                    color: sorted ? TEAL_DARK : isMain ? TEAL : 'var(--muted)',
                    minWidth: 72,
                    background: sorted ? '#e6f4f5' : undefined,
                  }}
                >
                  {colClean(col)} {sorted ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid #f9fafb' }}>
              {row.map((val, ci) => {
                const col = category.columns[ci]
                const isMain = ci > 0 && isMainCol(col)
                return (
                  <td key={ci} style={{
                    padding: '7px 4px',
                    textAlign: ci === 0 ? 'left' : 'right',
                    fontWeight: isMain ? 700 : 400,
                    color: ci === 0 ? '#374151' : isMain ? TEAL : '#6b7280',
                    background: ci === 0 ? '#fff' : undefined,
                    position: ci === 0 ? 'sticky' : undefined,
                    left: ci === 0 ? 0 : undefined,
                    zIndex: ci === 0 ? 1 : undefined,
                  }}>
                    {ci === 0 ? val : typeof val === 'number' ? (val * 100).toFixed(3) : val}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CkmTable({ category }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortAsc, setSortAsc] = useState(true)

  if (!category) return <EmptyState />
  const [regionCol, ...indCols] = category.columns

  const handleSort = (colIdx) => {
    if (sortCol === colIdx) setSortAsc(a => !a)
    else { setSortCol(colIdx); setSortAsc(true) }
  }

  const sortedRows = sortCol === null ? category.rows : [...category.rows].sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol]
    if (typeof av === 'number' && typeof bv === 'number') return sortAsc ? av - bv : bv - av
    return sortAsc ? String(av).localeCompare(String(bv), 'ru') : String(bv).localeCompare(String(av), 'ru')
  })

  const fmtVal = (v) => {
    if (v == null) return '—'
    if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('ru-RU') : v.toFixed(2)
    return String(v)
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th
              onClick={() => handleSort(0)}
              style={{ ...th, minWidth: 170, position: 'sticky', left: 0, background: '#fff', zIndex: 1, cursor: 'pointer', userSelect: 'none' }}
            >
              {regionCol} {sortCol === 0 ? (sortAsc ? '↑' : '↓') : ''}
            </th>
            {indCols.map((col, i) => {
              const ci = i + 1
              const sorted = sortCol === ci
              const label = String(col).length > 14 ? String(col).slice(0, 13) + '…' : col
              return (
                <th key={i} title={String(col)}
                  onClick={() => handleSort(ci)}
                  style={{
                    ...th, textAlign: 'right', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
                    color: sorted ? TEAL_DARK : 'var(--muted)',
                    minWidth: 72,
                    background: sorted ? '#e6f4f5' : undefined,
                  }}
                >
                  {label} {sorted ? (sortAsc ? '↑' : '↓') : ''}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, ri) => (
            <tr key={ri} style={{ borderBottom: '1px solid #f9fafb' }}>
              {row.map((val, ci) => (
                <td key={ci} style={{
                  padding: '7px 4px',
                  textAlign: ci === 0 ? 'left' : 'right',
                  color: ci === 0 ? '#374151' : '#6b7280',
                  background: ci === 0 ? '#fff' : undefined,
                  position: ci === 0 ? 'sticky' : undefined,
                  left: ci === 0 ? 0 : undefined,
                  zIndex: ci === 0 ? 1 : undefined,
                }}>
                  {ci === 0 ? val : fmtVal(val)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Kazakhstan Leaflet Map ─────────────────────────────────────────────────────
const GEO_URL = '/kz-regions.geojson?v=2'

// canonical forms used as byNorm keys (GeoJSON name → canonical)
const EN_NORM = {
  // GeoJSON abbreviations
  'зко': 'западноказахстанская',
  'вко': 'восточноказахстанская',
  'ско': 'североказахстанская',
  // DB dash-abbreviations (В-КАЗАХСТАНСКАЯ etc. from some Excel files)
  'в-казахстанская': 'восточноказахстанская',
  'з-казахстанская': 'западноказахстанская',
  'с-казахстанская': 'североказахстанская',
  // city prefixes in GeoJSON and DB
  'г.шымкент': 'шымкент',
  'г.астана': 'астана',
  'г.алматы': 'алматы',
  // Kazakh-letter variants (DB uses Kazakh і/ұ, GeoJSON uses Russian ы/у)
  'жетісу': 'жетысу',   // DB: Жетісу (і=U+0456) → GeoJSON canonical: Жетысу
  'ұлытау': 'улытау',   // DB: ҰЛЫТАУ (ұ=U+04B0) → GeoJSON canonical: Улытау
  // geoBoundaries English names (if CDN fallback ever loads)
  'east kazakhstan': 'восточноказахстанская',
  'shyghys qazaqstan': 'восточноказахстанская',
  'west kazakhstan': 'западноказахстанская',
  'batys qazaqstan': 'западноказахстанская',
  'north kazakhstan': 'североказахстанская',
  'soltustik qazaqstan': 'североказахстанская',
  'south kazakhstan': 'туркестанская',
  'turkistan': 'туркестанская',
  'almaty region': 'алматинская',
  'aqmola': 'акмолинская',
  'aqtobe': 'актюбинская',
  'atyrau': 'атырауская',
  'karagandy': 'карагандинская',
  'kostanay': 'костанайская',
  'kyzylorda': 'кызылординская',
  'mangystau': 'мангистауская',
  'pavlodar': 'павлодарская',
  'zhambyl': 'жамбылская',
  'shymkent': 'шымкент',
  'astana': 'астана',
  'almaty': 'алматы',
}

function KazakhstanMap({ regions, activeKeys, onToggle }) {
  const [geoData, setGeoData] = useState(null)
  const [loadErr, setLoadErr] = useState(false)

  useEffect(() => {
    fetch(GEO_URL)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(setGeoData)
      .catch(() => setLoadErr(true))
  }, [])

  const norm = (s = '') => {
    if (!s) return ''
    const lower = s.toLowerCase().trim()
    if (EN_NORM[lower]) return EN_NORM[lower]
    return lower
      .replace(/oblast|oblysy|region|область|облысы|қаласы|province/gi, '')
      .replace(/[-\s]+/g, '')
      .replace(/[іІ]/g, 'и')   // Kazakh і → Russian и
      .replace(/[ұҰ]/g, 'у')   // Kazakh ұ → Russian у
      .replace(/[үҮ]/g, 'у')   // Kazakh ү → Russian у
  }

  const getFeatName = (f) =>
    f.properties.shapeName || f.properties.NAME_1 || f.properties.name || ''

  const byNorm = {}
  regions.forEach(r => { if (r.name) byNorm[norm(r.name)] = r })

  const findRegion = (name = '') => {
    if (!name) return null
    const n = norm(name)
    if (!n) return null
    if (byNorm[n]) return byNorm[n]
    for (const [k, v] of Object.entries(byNorm)) {
      if (k.length > 2 && (k.includes(n) || n.includes(k))) return v
    }
    return null
  }

  const maxCount = Math.max(...regions.map(r => r.count || 0), 1)

  const getStyle = (feature) => {
    const r = findRegion(getFeatName(feature))
    const isActive = r && activeKeys.some(f => f.dim === 'region' && f.val === r.code)
    const intensity = r ? r.count / maxCount : 0
    const lightness = Math.round(78 - intensity * 50)
    return {
      fillColor: isActive ? TEAL_DARK : r ? `hsl(182,73%,${lightness}%)` : '#e5e7eb',
      weight: 1.5,
      color: '#fff',
      fillOpacity: 0.88,
    }
  }

  const onEachFeature = (feature, layer) => {
    const name = getFeatName(feature)
    const r = findRegion(name)
    const label = r ? `<b>${r.name}</b><br/>${fmt(r.count)} чел.` : name
    layer.bindTooltip(label, { sticky: true, className: 'kz-tooltip' })
    if (r) {
      layer.on('click', () => onToggle('region', r.code))
      layer.on('mouseover', function () { this.setStyle({ fillOpacity: 0.65 }) })
      layer.on('mouseout',  function () { this.setStyle(getStyle(feature)) })
    }
  }

  if (loadErr) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 13 }}>
      Не удалось загрузить карту
    </div>
  )

  if (!geoData) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', fontSize: 13 }}>
      Загрузка карты…
    </div>
  )

  return (
    <MapContainer
      center={[48.5, 67.5]}
      zoom={4}
      style={{ height: 480, width: '100%' }}
      scrollWheelZoom={false}
      zoomControl
    >
      <InvalidateSize />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <GeoJSON
        key={`${JSON.stringify(activeKeys)}-${regions.length}`}
        data={geoData}
        style={getStyle}
        onEachFeature={onEachFeature}
      />
    </MapContainer>
  )
}

function InvalidateSize() {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    const t = setTimeout(() => map.invalidateSize(), 300)
    return () => clearTimeout(t)
  }, [map])
  return null
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
    cats: [], gender: [], familyType: [],
    edu: { vuz: [], tipo: [], school: [] },
    okved: [], nkz: [], nationality: [], migration: [],
  })
  const [activeFilters, setActiveFilters] = useState([])
  const [filteredData, setFilteredData] = useState(null)
  const [loading, setLoading] = useState(false)

  const [leftTab, setLeftTab] = useState('statuses')
  const [rightTab, setRightTab] = useState('age')
  const [eduTab, setEduTab] = useState('vuz')
  const [irmData, setIrmData] = useState([])
  const [irmTab, setIrmTab] = useState('')
  const [ckmData, setCkmData] = useState([])
  const [ckmTab, setCkmTab] = useState('')

  const loadBase = useCallback(async () => {
    try {
      const [k, s, r, a, c, g, ft, o, z, n, ev, et, es, mg] = await Promise.all([
        getKpis(), getStatuses(), getRegions(),
        getAgeGroups(), getCategorization(), getGender(), getFamilyType(), getOkved(), getNkz(), getNationality(),
        getEdu('vuz'), getEdu('tipo'), getEdu('school'), getMigration(),
      ])
      setBase({
        kpis: k.data, statuses: s.data, regions: r.data, ageGroups: a.data,
        cats: c.data, gender: g.data, familyType: ft.data,
        edu: { vuz: ev.data || [], tipo: et.data || [], school: es.data || [] },
        okved: o.data, nkz: z.data, nationality: n.data, migration: mg.data || [],
      })
    } catch {}
  }, [])

  useEffect(() => { loadBase() }, [loadBase])

  useEffect(() => {
    getIrm()
      .then(r => {
        const data = r.data || []
        setIrmData(data)
        if (data.length) setIrmTab(data[0].id)
      })
      .catch(e => console.error('IRM load error:', e))
  }, [])

  useEffect(() => {
    getCkm()
      .then(r => {
        const data = Array.isArray(r.data) ? r.data : []
        setCkmData(data)
        if (data.length) setCkmTab(data[0].id)
      })
      .catch(e => console.error('CKM load error:', e))
  }, [])

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
  const nkz = fd?.nkz || base.nkz
  const nationality = fd?.nationality || base.nationality
  const familyType = Array.isArray(fd?.family_type) ? fd.family_type : Array.isArray(base.familyType) ? base.familyType : []
  const vuzData    = Array.isArray(fd?.edu?.vuz)    ? fd.edu.vuz    : base.edu.vuz
  const tipoData   = Array.isArray(fd?.edu?.tipo)   ? fd.edu.tipo   : base.edu.tipo
  const schoolData = Array.isArray(fd?.edu?.school) ? fd.edu.school : base.edu.school

  const af = activeFilters

  return (
    <div>
  <FilterBanner filters={af} onRemove={removeFilter} onClear={clearFilters} />
  {loading && (
    <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
      Загрузка данных...
    </div>
  )}
<Card
  style={{
    padding: '18px 24px',
    marginBottom: 16,
    background: '#ffffff',
    borderRadius: 10,
    textAlign: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.08)'
  }}
>
  <div
    style={{
      fontSize: 15,
      color: '#666',
      fontWeight: 600
    }}
  >
    Население Республики Казахстан
  </div>

  <div
    style={{
      fontSize: 42,
      fontWeight: 700,
      color: '#147a80',
      marginTop: 8
    }}
  >
    20 562 993
  </div>

  <div
    style={{
      fontSize: 13,
      color: '#999',
      marginTop: 4
    }}
  >
    человек
  </div>
</Card>

{/* KPIs */}
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
      onSubClick={() => toggleFilter('status', 'АКТИВНЫЙ ТД')}
      activeFilter={af.some(f => f.dim === 'status' && f.val === 'АКТИВНЫЙ ТД')}
    />

    <KpiCard
      title="Средняя ЗП"
      main={kpis?.avg_salary}
    />

    <KpiCard
      title="ВУЗ"
      main={kpis?.students}
    />

    <KpiCard
      title="ТИПО"
      main={kpis?.tipo_count}
      onSubClick={() => toggleFilter('status', 'ТИПО')}
      activeFilter={af.some(f => f.dim === 'status' && f.val === 'ТИПО')}
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
    <Card style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
      <Tabs
        tabs={[
          { key: 'statuses', label: 'Статусы' },
          { key: 'regions', label: 'Регионы' },
          { key: 'okved', label: 'ОКЭД' },
          { key: 'nkz', label: 'НКЗ' },
          { key: 'nationality', label: 'Национальность' },
        ]}
        active={leftTab}
        onChange={setLeftTab}
      />

      {leftTab === 'statuses' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>Рейтинг статусов — нажмите для фильтрации</SectionTitle>
          <StatusChart data={statuses} activeKeys={af} onToggle={toggleFilter} />
        </div>
      )}

      {leftTab === 'regions' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>Регионы — нажмите для фильтрации</SectionTitle>
          <RegionTable data={regions} activeKeys={af} onToggle={toggleFilter} />
        </div>
      )}

      {leftTab === 'okved' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>ОКЭД — нажмите для фильтрации</SectionTitle>
          <OkvedChart data={okved} activeKeys={af} dimKey="okved" onToggle={toggleFilter} />
        </div>
      )}

      {leftTab === 'nkz' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>НКЗ — нажмите для фильтрации</SectionTitle>
          <OkvedChart data={nkz} activeKeys={af} dimKey="nkz" onToggle={toggleFilter} />
        </div>
      )}

      {leftTab === 'nationality' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>Национальность — нажмите для фильтрации</SectionTitle>
          <NationalityTable data={nationality} activeKeys={af} onToggle={toggleFilter} />
        </div>
      )}
    </Card>

    <Card style={{ padding: '16px 20px' }}>
      <SectionTitle>Карта регионов — нажмите для фильтрации</SectionTitle>

      <div style={{ position: 'relative', zIndex: 0, marginTop: 70 }}>
        <KazakhstanMap
          regions={regions}
          activeKeys={af}
          onToggle={toggleFilter}
        />
      </div>
    </Card>
  </div>
</div>

      {/* Age / Gender / Family type / Cat / Regions / Migration */}
      <Card style={{ padding: '16px 20px', marginBottom: 12, display: 'flex', flexDirection: 'column' }}>
        <Tabs tabs={[
          { key: 'age',           label: 'Возраст' },
          { key: 'gender',        label: 'Пол' },
          { key: 'family_type',   label: 'Тип семьи' },
          { key: 'cat',           label: 'Категоризация' },
          { key: 'regions_chart', label: 'Регионы' },
          { key: 'migration',     label: 'Миграция' },
        ]} active={rightTab} onChange={setRightTab} />

        {rightTab === 'age' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
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
        </div>}

        {rightTab === 'gender' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <SectionTitle>Распределение по полу — нажмите для фильтрации</SectionTitle>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <DonutChart data={gender} nameKey="gender" activeKeys={af} dimKey="gender" onToggle={toggleFilter} />
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
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
        </div>}

        {rightTab === 'family_type' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <SectionTitle>Тип семьи — нажмите для фильтрации</SectionTitle>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <DonutChart data={familyType} nameKey="family_type" activeKeys={af} dimKey="family_type" onToggle={toggleFilter} />
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {familyType.map((ft) => {
              const isActive = af.some(f => f.dim === 'family_type' && f.val === ft.family_type)
              return (
                <div key={ft.family_type} onClick={() => toggleFilter('family_type', ft.family_type)} style={{
                  background: isActive ? TEAL : 'var(--teal-light)', borderRadius: 8,
                  padding: '8px 12px', flex: '1 1 120px', textAlign: 'center', cursor: 'pointer',
                  border: isActive ? `2px solid ${TEAL_DARK}` : '2px solid transparent',
                }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: isActive ? '#fff' : TEAL }}>{fmt(ft.count)}</div>
                  <div style={{ fontSize: 10, color: isActive ? 'rgba(255,255,255,.8)' : 'var(--muted)', marginTop: 2 }}>{ft.family_type}</div>
                </div>
              )
            })}
          </div>
        </div>}

        {rightTab === 'cat' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
            <div>
              <SectionTitle>Категоризация домохозяйств — нажмите для фильтрации</SectionTitle>
              <DonutChart data={cats} nameKey="category" colorMap={CAT_COLORS} activeKeys={af} dimKey="cat" onToggle={toggleFilter} hideLegend />
            </div>
            <div>
              <CatTable data={cats} activeKeys={af} onToggle={toggleFilter} />
            </div>
          </div>
        )}

        {rightTab === 'regions_chart' && <>
          <SectionTitle>Количество молодежи по регионам</SectionTitle>
          <RegionsBarChart data={regions} />
        </>}

        {rightTab === 'migration' && <>
          <SectionTitle>Миграция по регионам</SectionTitle>
          <MigrationChart data={base.migration} />
        </>}
      </Card>

      {/* Education block */}
      <Card style={{ padding: '16px 20px', marginBottom: 12, display: 'flex', flexDirection: 'column', minHeight: 300 }}>
        <Tabs tabs={[
          { key: 'vuz',    label: 'ВУЗ' },
          { key: 'tipo',   label: 'ТИПО' },
          { key: 'school', label: 'Школа' },
        ]} active={eduTab} onChange={setEduTab} />
        {eduTab === 'vuz' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>ВУЗ — нажмите для фильтрации</SectionTitle>
          <EduTable data={vuzData} dimKey="vuz" activeKeys={af} onToggle={toggleFilter} totalOverride={kpis?.students} />
        </div>}
        {eduTab === 'tipo' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>ТИПО — нажмите для фильтрации</SectionTitle>
          <EduTable data={tipoData} dimKey="tipo" activeKeys={af} onToggle={toggleFilter} totalOverride={kpis?.tipo_count} />
        </div>}
        {eduTab === 'school' && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <SectionTitle>Школа — нажмите для фильтрации</SectionTitle>
          <EduTable data={schoolData} dimKey="school" activeKeys={af} onToggle={toggleFilter} />
        </div>}
      </Card>

      {/* IRM block */}
      {irmData.length > 0 && (
        <Card style={{ padding: '16px 20px', marginBottom: 12 }}>
          <Tabs
            tabs={irmData.map(d => ({ key: d.id, label: d.label }))}
            active={irmTab}
            onChange={setIrmTab}
          />
          <SectionTitle>
            {irmTab === 'ИРМ'
              ? 'Индекс развития молодёжи по регионам'
              : `${irmTab} — индикаторы по регионам`}
          </SectionTitle>
          <IrmTable category={irmData.find(d => d.id === irmTab)} />
        </Card>
      )}

      {/* CKM block */}
      {Array.isArray(ckmData) && ckmData.length > 0 && (
        <Card style={{ padding: '16px 20px', marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .6, color: 'var(--muted)', marginBottom: 14 }}>
            Национальный доклад
          </div>
          <Tabs
            tabs={ckmData.map(d => ({ key: d.id, label: d.label }))}
            active={ckmTab}
            onChange={setCkmTab}
          />
          <CkmTable category={ckmData.find(d => d.id === ckmTab)} />
        </Card>
      )}

    </div>
  )
}
