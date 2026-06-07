import { useState, useEffect, useRef } from 'react'
import {
  createUser, listUsers, deleteUser,
  uploadFiles, getProgress, getSessions, reprocessSession, resetSession,
  cleanupUploads, getDiskStats, cleanupDb,
} from '../api'

function Card({ children, style }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 10,
      boxShadow: '0 1px 4px rgba(0,0,0,.08)',
      border: '1px solid var(--border)',
      padding: '20px 24px', ...style,
    }}>
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 style={{ fontSize: 14, fontWeight: 700, color: '#1f2937', marginBottom: 16 }}>
      {children}
    </h2>
  )
}

function Btn({ onClick, children, variant = 'primary', disabled, style }) {
  const colors = {
    primary: { bg: 'var(--teal)', fg: '#fff' },
    danger:  { bg: '#ef4444', fg: '#fff' },
    outline: { bg: 'transparent', fg: 'var(--teal)', border: '1px solid var(--teal)' },
  }
  const c = colors[variant] || colors.primary
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#d1d5db' : c.bg,
        color: disabled ? '#9ca3af' : c.fg,
        border: c.border || 'none',
        padding: '8px 16px', borderRadius: 7,
        fontSize: 13, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// ── User management ──────────────────────────────────────────────────────────
function UserSection() {
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    try { const { data } = await listUsers(); setUsers(data) } catch {}
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setMsg(''); setErr('')
    if (!username || !password) { setErr('Заполните оба поля'); return }
    try {
      await createUser(username, password)
      setMsg(`Пользователь «${username}» создан`)
      setUsername(''); setPassword('')
      load()
    } catch (ex) {
      setErr(ex.response?.data?.detail || 'Ошибка')
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Удалить пользователя «${name}»?`)) return
    try { await deleteUser(id); load() } catch {}
  }

  return (
    <Card>
      <SectionTitle>Пользователи</SectionTitle>

      <form onSubmit={handleCreate} style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Логин"
          style={inp}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          style={inp}
        />
        <Btn>Создать</Btn>
      </form>

      {msg && <div style={{ color: 'green', fontSize: 13, marginBottom: 10 }}>{msg}</div>}
      {err && <div style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 10 }}>{err}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={th}>Логин</th>
            <th style={th}>Роль</th>
            <th style={th}>Создан</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ borderBottom: '1px solid #f9fafb' }}>
              <td style={td}>{u.username}</td>
              <td style={td}>
                <span style={{
                  background: u.is_admin ? '#dbeafe' : '#f3f4f6',
                  color: u.is_admin ? '#1d4ed8' : '#6b7280',
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                }}>
                  {u.is_admin ? 'Admin' : 'User'}
                </span>
              </td>
              <td style={td}>{u.created_at ? new Date(u.created_at).toLocaleDateString('ru-RU') : '—'}</td>
              <td style={td}>
                {!u.is_admin && (
                  <Btn variant="danger" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => handleDelete(u.id, u.username)}>
                    Удалить
                  </Btn>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// ── Upload section ────────────────────────────────────────────────────────────
function UploadSection() {
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [progress, setProgress] = useState(null)
  const [sessions, setSessions] = useState([])
  const fileRef = useRef()
  const pollRef = useRef()

  const loadSessions = async () => {
    try { const { data } = await getSessions(); setSessions(data) } catch {}
  }

  useEffect(() => { loadSessions() }, [])

  const poll = (sid) => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await getProgress(sid)
        setProgress(data)
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(pollRef.current)
          setUploading(false)
          loadSessions()
        }
      } catch {
        clearInterval(pollRef.current)
        setUploading(false)
      }
    }, 2000)
  }

  const handleReset = async (sid) => {
    if (!confirm(`Сбросить статус сессии #${sid}? Это остановит "зависшую" обработку.`)) return
    try {
      await resetSession(sid)
      loadSessions()
    } catch (ex) {
      alert(ex.response?.data?.detail || 'Ошибка сброса')
    }
  }

  const handleReprocess = async (sid) => {
    if (!confirm(`Перезапустить обработку сессии #${sid}? Текущие данные этой сессии будут удалены и пересчитаны.`)) return
    setUploading(true)
    setSessionId(sid)
    setProgress({ status: 'processing', progress: 0, current_file: 'Перезапуск обработки...' })
    try {
      await reprocessSession(sid)
      poll(sid)
    } catch (ex) {
      setProgress({ status: 'error', error_message: ex.response?.data?.detail || 'Ошибка перезапуска' })
      setUploading(false)
    }
  }

  const handleCleanup = async () => {
    if (!confirm('Удалить все загруженные Excel-файлы с диска? Обработанные данные в БД останутся.')) return
    try {
      const { data } = await cleanupUploads()
      alert(`Очищено ${data.deleted_sessions.length} папок, освобождено ~${data.freed_mb} МБ`)
    } catch (ex) {
      alert(ex.response?.data?.detail || 'Ошибка очистки')
    }
  }

  const handleUpload = async () => {
    if (!files.length) return
    setUploading(true)
    setProgress({ status: 'uploading', progress: 0, current_file: 'Загрузка файлов...' })

    const fd = new FormData()
    for (const f of files) fd.append('files', f)

    try {
      const { data } = await uploadFiles(fd)
      setSessionId(data.session_id)
      setProgress({ status: 'processing', progress: 0, current_file: 'Начало обработки...' })
      poll(data.session_id)
    } catch (ex) {
      setProgress({ status: 'error', error_message: ex.response?.data?.detail || 'Ошибка загрузки' })
      setUploading(false)
    }
  }

  const statusColors = { done: '#22c55e', error: '#ef4444', processing: 'var(--teal)', pending: '#f59e0b' }
  const statusLabels = { done: 'Готово', error: 'Ошибка', processing: 'Обработка', pending: 'Ожидание' }

  return (
    <Card style={{ marginTop: 16 }}>
      <SectionTitle>Загрузка данных (Excel)</SectionTitle>

      <div style={{ marginBottom: 16, padding: 16, border: '2px dashed var(--border)', borderRadius: 8, textAlign: 'center' }}>
        <input
          type="file"
          multiple
          accept=".xlsx,.xls"
          ref={fileRef}
          style={{ display: 'none' }}
          onChange={(e) => setFiles(Array.from(e.target.files))}
        />
        <button
          onClick={() => fileRef.current.click()}
          style={{
            background: 'var(--teal-light)', color: 'var(--teal)',
            border: '1px solid var(--teal)', padding: '10px 20px',
            borderRadius: 7, fontSize: 13, fontWeight: 500,
          }}
        >
          Выбрать файлы (.xlsx)
        </button>
        {files.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {files.map((f, i) => (
              <div key={i} style={{ fontSize: 12, color: '#374151', margin: '3px 0' }}>
                📄 {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            ))}
          </div>
        )}
      </div>

      <Btn
        onClick={handleUpload}
        disabled={!files.length || uploading}
        style={{ width: '100%', padding: '10px' }}
      >
        {uploading ? 'Обработка...' : `Загрузить ${files.length ? `(${files.length} файл${files.length > 1 ? 'а' : ''})` : ''}`}
      </Btn>

      {progress && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13 }}>
            <span style={{ color: statusColors[progress.status] || 'var(--muted)', fontWeight: 600 }}>
              {statusLabels[progress.status] || progress.status}
            </span>
            <span style={{ color: 'var(--muted)' }}>{progress.progress}%</span>
          </div>
          <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{
              background: progress.status === 'error' ? '#ef4444' : 'var(--teal)',
              height: '100%', width: `${progress.progress}%`,
              transition: 'width .4s',
            }} />
          </div>
          {progress.current_file && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
              {progress.current_file}
            </div>
          )}
          {progress.status === 'done' && (
            <div style={{ fontSize: 13, color: '#22c55e', marginTop: 8 }}>
              ✓ Обработано записей: {(progress.total_records || 0).toLocaleString('ru-RU')}
            </div>
          )}
          {progress.status === 'error' && (
            <div style={{ fontSize: 13, color: '#ef4444', marginTop: 8 }}>
              ✗ {progress.error_message}
            </div>
          )}
        </div>
      )}

      {sessions.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>История загрузок</div>
            <Btn variant="danger" style={{ padding: '4px 10px', fontSize: 11 }} onClick={handleCleanup}>
              Очистить диск
            </Btn>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={th}>Дата</th>
                <th style={th}>Файлы</th>
                <th style={th}>Записей</th>
                <th style={th}>Статус</th>
                <th style={th}>Активная</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f9fafb' }}>
                  <td style={td}>{new Date(s.started_at).toLocaleString('ru-RU')}</td>
                  <td style={td}>{s.files_count}</td>
                  <td style={td}>{(s.total_records || 0).toLocaleString('ru-RU')}</td>
                  <td style={td}>
                    <span style={{ color: statusColors[s.status] || 'var(--muted)', fontWeight: 600 }}>
                      {statusLabels[s.status] || s.status}
                    </span>
                  </td>
                  <td style={td}>{s.is_active ? '✓' : ''}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Btn
                        variant="outline"
                        style={{ padding: '4px 10px', fontSize: 11 }}
                        disabled={uploading || s.status === 'processing'}
                        onClick={() => handleReprocess(s.id)}
                      >
                        Перезапустить
                      </Btn>
                      {s.status === 'processing' && (
                        <Btn
                          variant="danger"
                          style={{ padding: '4px 10px', fontSize: 11 }}
                          onClick={() => handleReset(s.id)}
                        >
                          Сбросить
                        </Btn>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

// ── Disk management ──────────────────────────────────────────────────────────
function DiskSection() {
  const [stats, setStats] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = async () => {
    try { const { data } = await getDiskStats(); setStats(data) } catch {}
  }

  useEffect(() => { load() }, [])

  const handleCleanupUploads = async () => {
    if (!confirm('Удалить все загруженные Excel-файлы с диска? Обработанные данные в БД останутся.')) return
    setBusy(true); setMsg('')
    try {
      const { data } = await cleanupUploads()
      setMsg(`Файлы очищены, освобождено ~${data.freed_mb} МБ`)
      load()
    } catch (ex) { setMsg(ex.response?.data?.detail || 'Ошибка') }
    finally { setBusy(false) }
  }

  const handleCleanupDb = async () => {
    if (!confirm('Удалить все старые сессии из БД (будет оставлена только активная) и сжать базу данных? Это освободит значительное место на диске.')) return
    setBusy(true); setMsg('')
    try {
      const { data } = await cleanupDb()
      if (data.error) { setMsg(data.error) }
      else setMsg(`Удалено ${data.deleted_sessions} сессий, освобождено ~${data.freed_mb} МБ (БД: ${data.db_mb_before} → ${data.db_mb_after} МБ)`)
      load()
    } catch (ex) { setMsg(ex.response?.data?.detail || 'Ошибка') }
    finally { setBusy(false) }
  }

  const usedPct = stats ? Math.round(stats.used_mb / stats.total_mb * 100) : 0
  const barColor = usedPct > 85 ? '#ef4444' : usedPct > 65 ? '#f59e0b' : '#22c55e'

  return (
    <Card style={{ marginTop: 16 }}>
      <SectionTitle>Диск и база данных</SectionTitle>

      {stats && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            <span>Занято {stats.used_mb} МБ из {stats.total_mb} МБ</span>
            <span style={{ color: usedPct > 85 ? '#ef4444' : 'var(--muted)' }}>Свободно {stats.free_mb} МБ ({100 - usedPct}%)</span>
          </div>
          <div style={{ background: '#f3f4f6', borderRadius: 4, height: 8, overflow: 'hidden' }}>
            <div style={{ background: barColor, height: '100%', width: `${usedPct}%`, transition: 'width .4s' }} />
          </div>
          {stats.db_mb != null && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              БД: {stats.db_mb} МБ
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <Btn variant="outline" disabled={busy} onClick={handleCleanupUploads} style={{ fontSize: 12 }}>
          Очистить Excel-файлы
        </Btn>
        <Btn variant="danger" disabled={busy} onClick={handleCleanupDb} style={{ fontSize: 12 }}>
          Очистить БД (старые сессии)
        </Btn>
      </div>

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, color: msg.startsWith('Ошибка') || msg.includes('не удался') ? '#ef4444' : '#22c55e' }}>
          {msg}
        </div>
      )}
    </Card>
  )
}

const inp = {
  padding: '8px 12px', border: '1px solid var(--border)',
  borderRadius: 7, fontSize: 13, width: 180,
}
const th = { padding: '6px 8px', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: 11 }
const td = { padding: '8px 8px', verticalAlign: 'middle' }

export default function Admin() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      
      <UserSection />
      <UploadSection />
      <DiskSection />
    </div>
  )
}
