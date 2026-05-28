import { useState } from 'react'
import { login } from '../api'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handle = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await login(username, password)
      onLogin({ username: data.username, is_admin: data.is_admin }, data.access_token)
    } catch (err) {
      setError(err.response?.data?.detail || 'Ошибка входа')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(135deg, #0f5f64 0%, #147a80 50%, #1a9099 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '48px 40px',
        width: 360, boxShadow: '0 20px 60px rgba(0,0,0,.2)',
      }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--teal)', marginBottom: 4 }}>
          Молодежь РК
        </h1>
        <p style={{ color: 'var(--muted)', marginBottom: 32, fontSize: 13 }}>
          Система аналитики данных
        </p>

        <form onSubmit={handle}>
          <label style={labelStyle}>Логин</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Введите логин"
            style={inputStyle}
            autoFocus
          />

          <label style={{ ...labelStyle, marginTop: 16 }}>Пароль</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Введите пароль"
            style={inputStyle}
          />

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', marginTop: 24, padding: '12px',
              background: loading ? 'var(--muted)' : 'var(--teal)',
              color: '#fff', border: 'none', borderRadius: 8,
              fontSize: 15, fontWeight: 600, transition: 'background .2s',
            }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: 'var(--text)', marginBottom: 6,
}

const inputStyle = {
  width: '100%', padding: '10px 14px',
  border: '1px solid var(--border)', borderRadius: 8,
  fontSize: 14, outline: 'none', transition: 'border .15s',
}
