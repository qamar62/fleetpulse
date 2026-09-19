'use client'

import type {
  AuditEntry,
  CurrentUser,
  Dashboard,
  Driver,
  DriverPerformanceRow,
  Earning,
  Expense,
  ImportAnalysis,
  ImportBatch,
  ImportResult,
  Meta,
  Paginated,
  PerformanceResponse,
  Report,
  ReportDescriptor,
  Settlement,
  Vehicle,
  VehiclePerformanceRow,
} from './types'

export const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000/api'
).replace(/\/+$/, '')

const ACCESS_KEY = 'fleetpulse.access'
const REFRESH_KEY = 'fleetpulse.refresh'

/* ------------------------------------------------------------------ */
/* Token storage                                                       */
/* ------------------------------------------------------------------ */

export const tokens = {
  access(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(ACCESS_KEY)
  },
  refresh(): string | null {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh?: string) {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(ACCESS_KEY, access)
    if (refresh) window.localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(ACCESS_KEY)
    window.localStorage.removeItem(REFRESH_KEY)
  },
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number
  detail: unknown
  fields: Record<string, string[]>

  constructor(status: number, detail: unknown) {
    super(ApiError.describe(status, detail))
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.fields = ApiError.collectFields(detail)
  }

  static describe(status: number, detail: unknown): string {
    if (status === 0) {
      return 'Cannot reach the API. Is the Django server running on ' + API_BASE + '?'
    }
    if (typeof detail === 'string' && detail) return detail
    if (detail && typeof detail === 'object') {
      const d = detail as Record<string, any>
      if (typeof d.detail === 'string') return d.detail
      if (typeof d.error === 'string') return d.error
      const first = Object.entries(d)[0]
      if (first) {
        const [key, value] = first
        const text = Array.isArray(value) ? value.join(' ') : String(value)
        return key === 'non_field_errors' ? text : `${key}: ${text}`
      }
    }
    return `Request failed (HTTP ${status}).`
  }

  static collectFields(detail: unknown): Record<string, string[]> {
    const out: Record<string, string[]> = {}
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      for (const [key, value] of Object.entries(detail as Record<string, any>)) {
        if (key === 'detail') continue
        out[key] = Array.isArray(value) ? value.map(String) : [String(value)]
      }
    }
    return out
  }
}

/* ------------------------------------------------------------------ */
/* Core request                                                        */
/* ------------------------------------------------------------------ */

export type Query = Record<string, string | number | boolean | null | undefined>

export function buildUrl(path: string, query?: Query): string {
  const url = new URL(
    API_BASE + (path.startsWith('/') ? path : `/${path}`),
    typeof window === 'undefined' ? 'http://localhost' : window.location.origin,
  )
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  return url.toString()
}

let refreshInFlight: Promise<boolean> | null = null

async function refreshAccessToken(): Promise<boolean> {
  const refresh = tokens.refresh()
  if (!refresh) return false
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch(buildUrl('/auth/token/refresh/'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh }),
        })
        if (!response.ok) return false
        const data = await response.json()
        if (!data?.access) return false
        tokens.set(data.access, data.refresh)
        return true
      } catch {
        return false
      } finally {
        // Let the next 401 start a fresh attempt.
        setTimeout(() => {
          refreshInFlight = null
        }, 0)
      }
    })()
  }
  return refreshInFlight
}

interface RequestOptions {
  method?: string
  query?: Query
  body?: unknown
  /** Send as multipart instead of JSON. */
  form?: FormData
  /** Skip the Authorization header (login, health). */
  anonymous?: boolean
  signal?: AbortSignal
  /** Internal: prevents an infinite refresh loop. */
  _retried?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, form, anonymous, signal } = options
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (!anonymous) {
    const access = tokens.access()
    if (access) headers.Authorization = `Bearer ${access}`
  }

  let payload: BodyInit | undefined
  if (form) {
    payload = form // let the browser set the multipart boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), { method, headers, body: payload, signal })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error
    throw new ApiError(0, null)
  }

  if (response.status === 401 && !anonymous && !options._retried) {
    if (await refreshAccessToken()) {
      return request<T>(path, { ...options, _retried: true })
    }
    tokens.clear()
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('fleetpulse:unauthorized'))
    }
  }

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) throw new ApiError(response.status, data)
  return data as T
}

/** Download an endpoint that returns a file (CSV exports, the import template). */
export async function download(path: string, query: Query | undefined, filename: string) {
  const headers: Record<string, string> = {}
  const access = tokens.access()
  if (access) headers.Authorization = `Bearer ${access}`

  const response = await fetch(buildUrl(path, query), { headers })
  if (!response.ok) {
    let detail: unknown = null
    try {
      detail = await response.json()
    } catch {
      /* the body was not JSON; the status is enough */
    }
    throw new ApiError(response.status, detail)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export const api = {
  /* auth */
  login: (username: string, password: string) =>
    request<{ access: string; refresh: string }>('/auth/token/', {
      method: 'POST',
      body: { username, password },
      anonymous: true,
    }),
  me: () => request<CurrentUser>('/auth/me/'),
  health: () => request<{ status: string }>('/health/', { anonymous: true }),
  meta: () => request<Meta>('/meta/'),

  /* analytics */
  dashboard: (query: Query) => request<Dashboard>('/analytics/dashboard/', { query }),
  analytics: <T = any>(key: string, query: Query) =>
    request<T>(`/analytics/${key}/`, { query }),
  insights: (query: Query) =>
    request<{ scope: any; insights: Dashboard['insights'] }>('/analytics/insights/', { query }),

  /* reports */
  reportCatalogue: () => request<{ reports: ReportDescriptor[] }>('/reports/'),
  report: (key: string, query: Query) => request<Report>(`/reports/${key}/`, { query }),
  reportCsv: (key: string, query: Query) =>
    download(`/reports/${key}/`, { ...query, format: 'csv' }, `fleetpulse-${key}.csv`),

  /* collections */
  drivers: (query?: Query) => request<Paginated<Driver>>('/drivers/', { query }),
  vehicles: (query?: Query) => request<Paginated<Vehicle>>('/vehicles/', { query }),
  earnings: (query?: Query) => request<Paginated<Earning>>('/earnings/', { query }),
  expenses: (query?: Query) => request<Paginated<Expense>>('/expenses/', { query }),
  payroll: (query?: Query) => request<Paginated<Settlement>>('/payroll/', { query }),
  importBatches: (query?: Query) => request<Paginated<ImportBatch>>('/imports/', { query }),
  auditLog: (query?: Query) => request<Paginated<AuditEntry>>('/audit-log/', { query }),

  /* per-resource summaries */
  driverPerformance: (query: Query) =>
    request<PerformanceResponse<DriverPerformanceRow>>('/drivers/performance/', { query }),
  vehiclePerformance: (query: Query) =>
    request<PerformanceResponse<VehiclePerformanceRow>>('/vehicles/performance/', { query }),
  earningsSummary: (query: Query) => request<any>('/earnings/summary/', { query }),
  expensesSummary: (query: Query) => request<Report>('/expenses/summary/', { query }),
  payrollSummary: (query: Query) => request<Report>('/payroll/summary/', { query }),

  /* writes */
  create: <T>(resource: string, body: unknown) =>
    request<T>(`/${resource}/`, { method: 'POST', body }),
  update: <T>(resource: string, id: number, body: unknown) =>
    request<T>(`/${resource}/${id}/`, { method: 'PATCH', body }),
  remove: (resource: string, id: number) =>
    request<void>(`/${resource}/${id}/`, { method: 'DELETE' }),

  /* csv export of a collection */
  exportCsv: (resource: string, query: Query) =>
    download(`/${resource}/export/`, query, `fleetpulse-${resource}.csv`),

  /* import wizard */
  importTemplate: () =>
    download('/imports/template/', undefined, 'fleetpulse_import_template.csv'),
  importAnalyze: (form: FormData) =>
    request<ImportAnalysis>('/imports/analyze/', { method: 'POST', form }),
  importCommit: (form: FormData) =>
    request<ImportResult>('/imports/commit/', { method: 'POST', form }),
}
