import { useState, useEffect } from 'react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'

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
            {user.is_admin && <span style={{ background: 'var(--teal-light)', color: 'var(--teal)', padding: '2px 8px', borderRadius: 4, marginRight: 8, fontSize: 11, fontWeight: 600 }}>ADMIN</span>}
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

      <div style={{ padding: 20 }}>
        {page === 'dashboard' ? <Dashboard /> : <Admin />}
      </div>
    </div>
  )
}
