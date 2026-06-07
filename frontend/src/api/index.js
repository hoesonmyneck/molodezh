import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.reload()
    }
    return Promise.reject(err)
  }
)

export const login = (username, password) =>
  api.post('/auth/login', { username, password })

export const createUser = (username, password) =>
  api.post('/auth/users', { username, password })

export const listUsers = () => api.get('/auth/users')
export const deleteUser = (id) => api.delete(`/auth/users/${id}`)

export const uploadFiles = (formData) =>
  api.post('/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })

export const getProgress = (sessionId) => api.get(`/upload/progress/${sessionId}`)
export const getSessions = () => api.get('/upload/sessions')
export const reprocessSession = (sessionId) => api.post(`/admin/reprocess/${sessionId}`)
export const resetSession = (sessionId) => api.post(`/admin/reset-session/${sessionId}`)
export const cleanupUploads = () => api.post('/admin/cleanup-uploads')
export const getDiskStats   = () => api.get('/admin/disk-stats')
export const cleanupDb      = () => api.post('/admin/cleanup-db')

export const getKpis = () => api.get('/data/kpis')
export const getStatuses = () => api.get('/data/statuses')
export const getRegions = () => api.get('/data/regions')
export const getDistricts = (regionCode) =>
  api.get('/data/districts', { params: regionCode ? { region_code: regionCode } : {} })
export const getAgeGroups = () => api.get('/data/age-groups')
export const getCategorization = () => api.get('/data/categorization')
export const getGender = () => api.get('/data/gender')
export const getOkved = () => api.get('/data/okved')
export const getNkz = () => api.get('/data/nkz')
export const getFamilyType = () => api.get('/data/family-type')
export const getEdu = (edu_type) => api.get('/data/edu', { params: { edu_type } })
export const getMigration = () => api.get('/data/migration')
export const getNationality = () => api.get('/data/nationality')
export const getFiltered = (filters) =>
  api.get('/data/filter', {
    params: new URLSearchParams(filters.map(({ dim, val }) => ['f', `${dim}:${val}`])),
  })
