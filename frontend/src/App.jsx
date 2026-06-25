import { useState, useEffect, useCallback } from 'react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import { getRegions, getDistricts } from './api'

const TEAL = '#147a80'

const STATUS_OPTIONS = [
  'РАБОТАЮЩИЕ', 'АКТИВНЫЙ ТД', 'СТУДЕНТ', 'ТИПО', 'ИП', 'ЛСИ', 'БЕРЕМЕННЫЕ',
  'ПО УХОДУ ЗА РЕБЕНКОМ ДО 3', 'ПО УХОДУ ЗА ЛСИ',
  'ИНОСТРАННЫЕ ГРАЖДАНЕ', 'БЕЗРАБОТНЫЕ', 'НЕОХВАЧЕННЫЕ', 'ДЕТИ ОТ 14 ДО 18 ЛЕТ',
  'ПОЛУЧАТЕЛИ АСП', 'ПЕНСИОНЕРЫ', 'КАНДАСЫ', 'МНОГОДЕТНЫЕ', 'ПОЛУЧАТЕЛИ ПОСОБИЙ',
]

const AGE_OPTIONS = [
  { value: '', label: 'Все возрасты' },
  { value: 'group:14-17', label: '14–17 лет' },
  { value: 'group:18-24', label: '18–24 лет' },
  { value: 'group:25-29', label: '25–29 лет' },
  { value: 'group:30-35', label: '30–35 лет' },
  { value: 'lte:17', label: '< 18 лет' },
  { value: 'gte:18', label: '≥ 18 лет' },
  { value: 'gte:25', label: '≥ 25 лет' },
  { value: 'between:14:18', label: '14–18 лет' },
  { value: 'between:18:29', label: '18–29 лет' },
  ...Array.from({ length: 22 }, (_, i) => ({
    value: `exact:${14 + i}`,
    label: `${14 + i} лет`,
  })),
]

const selStyle = {
  height: 28,
  padding: '0 4px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 12,
  color: '#374151',
  background: '#fff',
  cursor: 'pointer',
  maxWidth: 150,
  minWidth: 90,
}

function parseGlobalFilters(obj) {
  const filters = []
  if (obj.region) filters.push({ dim: 'region', val: obj.region })
  if (obj.district) filters.push({ dim: 'district', val: obj.district })
  if (obj.gender) filters.push({ dim: 'gender', val: obj.gender })
  if (obj.status) filters.push({ dim: 'status', val: obj.status })
  if (obj.age) {
    const [type, ...rest] = obj.age.split(':')
    const val = rest.join(':')
    if (type === 'group') filters.push({ dim: 'age_group', val })
    else if (type === 'exact') filters.push({ dim: 'age_exact', val })
    else if (type === 'gte') filters.push({ dim: 'age_gte', val })
    else if (type === 'lte') filters.push({ dim: 'age_lte', val })
    else if (type === 'between') filters.push({ dim: 'age_between', val })
  }
  return filters
}

function GlobalFilterBar({ onChange }) {
  const [regions, setRegions] = useState([])
  const [districts, setDistricts] = useState([])
  const [sel, setSel] = useState({ region: '', district: '', gender: '', age: '', status: '' })
  const [exportModal, setExportModal] = useState(null)   // null | { columns, selected }
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    getRegions()
      .then(r => setRegions((r.data || []).slice().sort((a, b) => a.name.localeCompare(b.name, 'ru'))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (sel.region) {
      getDistricts(sel.region)
        .then(r => setDistricts((r.data || []).slice().sort((a, b) => a.district_name.localeCompare(b.district_name, 'ru'))))
        .catch(() => {})
    } else {
      setDistricts([])
    }
  }, [sel.region])

  const update = useCallback((key, val) => {
    setSel(prev => {
      const next = { ...prev, [key]: val }
      if (key === 'region') next.district = ''
      onChange(parseGlobalFilters(next))
      return next
    })
  }, [onChange])

  const reset = () => {
    const empty = { region: '', district: '', gender: '', age: '', status: '' }
    setSel(empty)
    setDistricts([])
    onChange([])
  }

  const hasAny = Object.values(sel).some(Boolean)

  const openExportModal = async () => {
    if (!sel.district) return
    setExportLoading(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/data/export/district/columns?district=${encodeURIComponent(sel.district)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) { alert('Данные для экспорта не найдены. Переобработайте файлы.'); return }
      const { columns } = await res.json()
      setExportModal({ columns, selected: new Set(columns.map(c => c.key)) })
    } catch { alert('Ошибка при получении списка полей') }
    finally { setExportLoading(false) }
  }

  const doDownload = async () => {
    if (!exportModal || !sel.district) return
    const cols = [...exportModal.selected].join(',')
    try {
      const token = localStorage.getItem('token')
      const url = `/api/data/export/district?district=${encodeURIComponent(sel.district)}&columns=${encodeURIComponent(cols)}`
      const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) { alert('Ошибка скачивания'); return }
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename\*?=(?:UTF-8'')?(.+)/i)
      const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `${sel.district}.xlsx`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = filename
      document.body.appendChild(a); a.click()
      document.body.removeChild(a)
      setExportModal(null)
    } catch { alert('Ошибка скачивания') }
  }

  const toggleCol = (col) => setExportModal(prev => {
    const next = new Set(prev.selected)
    next.has(col) ? next.delete(col) : next.add(col)
    return { ...prev, selected: next }
  })

  return (
    <div style={{
      background: '#f9fafb',
      borderBottom: '1px solid #e5e7eb',
      padding: '6px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      flexWrap: 'wrap',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: .4, marginRight: 4 }}>
        Фильтры:
      </span>

      {/* Region */}
      <select style={selStyle} value={sel.region} onChange={e => update('region', e.target.value)}>
        <option value="">Все регионы</option>
        {regions.map(r => (
          <option key={r.code} value={r.code}>{r.name}</option>
        ))}
      </select>

      {/* District */}
      <select
        style={{ ...selStyle, opacity: sel.region ? 1 : 0.5 }}
        value={sel.district}
        disabled={!sel.region}
        onChange={e => update('district', e.target.value)}
      >
        <option value="">Все районы</option>
        {districts.map(d => (
          <option key={d.district_code} value={d.district_code}>{d.district_name}</option>
        ))}
      </select>

      {/* Gender */}
      <select style={selStyle} value={sel.gender} onChange={e => update('gender', e.target.value)}>
        <option value="">Все (пол)</option>
        <option value="Мужской">Мужской</option>
        <option value="Женский">Женский</option>
      </select>

      {/* Age */}
      <select style={selStyle} value={sel.age} onChange={e => update('age', e.target.value)}>
        {AGE_OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {/* Status */}
      <select style={selStyle} value={sel.status} onChange={e => update('status', e.target.value)}>
        <option value="">Все статусы</option>
        {STATUS_OPTIONS.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>


      {hasAny && (
        <button
          onClick={reset}
          style={{
            background: 'transparent', border: 'none', color: TEAL,
            fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '0 4px',
          }}
        >
          Сбросить
        </button>
      )}

      {sel.region && sel.district && (
        <button
          onClick={openExportModal}
          disabled={exportLoading}
          style={{
            background: TEAL, border: 'none', color: '#fff',
            fontSize: 12, fontWeight: 600, cursor: exportLoading ? 'default' : 'pointer',
            padding: '4px 12px', borderRadius: 6, opacity: exportLoading ? 0.7 : 1,
          }}
        >
          {exportLoading ? 'Загрузка…' : 'Скачать Excel'}
        </button>
      )}

      {exportModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}
          onClick={e => { if (e.target === e.currentTarget) setExportModal(null) }}
        >
          <div style={{
            background: '#fff', borderRadius: 10, padding: 24, width: 480,
            maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,.18)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111' }}>
              Выберите поля для экспорта
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setExportModal(prev => ({ ...prev, selected: new Set(prev.columns.map(c => c.key)) }))}
                style={{ fontSize: 12, padding: '3px 10px', borderRadius: 5, border: '1px solid #d1d5db', cursor: 'pointer', background: '#f9fafb' }}
              >
                Выбрать все
              </button>
              <button
                onClick={() => setExportModal(prev => ({ ...prev, selected: new Set() }))}
                style={{ fontSize: 12, padding: '3px 10px', borderRadius: 5, border: '1px solid #d1d5db', cursor: 'pointer', background: '#f9fafb' }}
              >
                Снять все
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {exportModal.columns.map(col => (
                <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '3px 0' }}>
                  <input
                    type="checkbox"
                    checked={exportModal.selected.has(col.key)}
                    onChange={() => toggleCol(col.key)}
                    style={{ accentColor: TEAL, width: 15, height: 15 }}
                  />
                  {col.label}
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setExportModal(null)}
                style={{ fontSize: 13, padding: '6px 16px', borderRadius: 6, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff' }}
              >
                Отмена
              </button>
              <button
                onClick={doDownload}
                disabled={exportModal.selected.size === 0}
                style={{
                  fontSize: 13, fontWeight: 600, padding: '6px 16px', borderRadius: 6,
                  border: 'none', cursor: exportModal.selected.size === 0 ? 'default' : 'pointer',
                  background: exportModal.selected.size === 0 ? '#9ca3af' : TEAL, color: '#fff',
                }}
              >
                Скачать ({exportModal.selected.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const NAV = {
  background: '#fff',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 24px',
  height: 54,
  position: 'sticky',
  top: 0,
  zIndex: 100,
  boxShadow: '0 1px 4px rgba(0,0,0,.06)',
}

function NavBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'var(--teal)' : 'transparent',
        color: active ? '#fff' : 'var(--muted)',
        border: 'none',
        padding: '6px 14px',
        borderRadius: 6,
        fontSize: 13,
        fontWeight: 500,
        transition: 'all .15s',
      }}
    >
      {children}
    </button>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [globalFilters, setGlobalFilters] = useState([])

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (token && userData) {
      try { setUser(JSON.parse(userData)) } catch {}
    }
  }, [])

  const handleLogin = (userData, token) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
    setPage('dashboard')
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  if (!user) return <Login onLogin={handleLogin} />

  return (
    <div style={{ minHeight: '100vh' }}>
      <nav style={NAV}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img
  src="/jastar-logo.jpg"
  alt="Jastar"
  style={{ height: 42, marginRight: 12 }}
/>
          <NavBtn active={page === 'dashboard'} onClick={() => setPage('dashboard')}>
            Дашборд
          </NavBtn>
          {user.is_admin && (
            <NavBtn active={page === 'admin'} onClick={() => setPage('admin')}>
              Управление
            </NavBtn>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: 'var(--muted)', fontSize: 13 }}>
            {user.is_admin && (
              <span style={{
                background: 'var(--teal-light)', color: 'var(--teal)',
                padding: '2px 8px', borderRadius: 4, marginRight: 8,
                fontSize: 11, fontWeight: 600,
              }}>
                ADMIN
              </span>
            )}
            {user.username}
          </span>
          <button
            onClick={handleLogout}
            style={{
              background: 'transparent', color: 'var(--danger)',
              border: '1px solid var(--danger)', padding: '5px 12px',
              borderRadius: 6, fontSize: 13,
            }}
          >
            Выйти
          </button>
        </div>
      </nav>

      {page === 'dashboard' && (
        <div style={{ position: 'sticky', top: 54, zIndex: 99 }}>
          <GlobalFilterBar onChange={setGlobalFilters} />
        </div>
      )}

      <div style={{ padding: 20 }}>
        {page === 'dashboard'
          ? <Dashboard globalFilters={globalFilters} />
          : <Admin />
        }
      </div>
    </div>
  )
}
