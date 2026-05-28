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

export const getKpis = () => api.get('/data/kpis')
export const getStatuses = () => api.get('/data/statuses')
export const getRegions = () => api.get('/data/regions')
export const getDistricts = (regionCode) =>
  api.get('/data/districts', { params: regionCode ? { region_code: regionCode } : {} })
export const getAgeGroups = () => api.get('/data/age-groups')
export const getCategorization = () => api.get('/data/categorization')
export const getGender = () => api.get('/data/gender')
export const getOkved = () => api.get('/data/okved')
export const getNationality = () => api.get('/data/nationality')
