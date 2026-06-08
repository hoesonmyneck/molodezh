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

  useEffect(() => {
    getRegions().then(r => setRegions(r.data || [])).catch(() => {})
  }, [])

  useEffect(() => {
    if (sel.region) {
      getDistricts(sel.region).then(r => setDistricts(r.data || [])).catch(() => {})
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

  const handleExport = async () => {
    const districtCode = sel.district
    if (!districtCode) return
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/data/export/district?district=${encodeURIComponent(districtCode)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) return
      const blob = await res.blob()
      const cd = res.headers.get('content-disposition') || ''
      const match = cd.match(/filename\*?=(?:UTF-8'')?(.+)/i)
      const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `${districtCode}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      document.body.appendChild(a); a.click()
      document.body.removeChild(a); URL.revokeObjectURL(url)
    } catch {}
  }

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

      {sel.region && sel.district && (
        <button
          onClick={handleExport}
          style={{
            background: TEAL, border: 'none', color: '#fff',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            padding: '4px 12px', borderRadius: 6,
          }}
        >
          Скачать Excel
        </button>
      )}

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
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--teal)', marginRight: 12 }}>
            Молодежь РК
          </span>
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
