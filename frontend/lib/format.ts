import type { CellFormat, Money } from './types'

export const CURRENCY_FALLBACK = 'AED'

/** DRF sends money as a string on model serializers and a number on analytics. */
export function toNumber(value: Money | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * The backend returns `null` — not `0` — when a ratio has no denominator.
 * Rendering that as 0 would invent a fact, so every formatter says so out loud.
 */
export const NOT_AVAILABLE = 'N/A'

export function fmtMoney(value: Money | undefined, currency = CURRENCY_FALLBACK): string {
  const n = toNumber(value)
  if (n === null) return NOT_AVAILABLE
  return `${currency} ${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Compact form for chart axes and tight cards: AED 477.6k */
export function fmtMoneyShort(value: Money | undefined, currency = CURRENCY_FALLBACK): string {
  const n = toNumber(value)
  if (n === null) return NOT_AVAILABLE
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${currency} ${(n / 1_000).toFixed(1)}k`
  return `${currency} ${n.toFixed(0)}`
}

export function fmtAxis(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

export function fmtPercent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE
  return `${value.toFixed(digits)}%`
}

export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NOT_AVAILABLE
  return value.toLocaleString('en-US')
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return NOT_AVAILABLE
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDayShort(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return NOT_AVAILABLE
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Render a report/KPI cell using the `format` hint the backend supplies. */
export function fmtCell(
  value: unknown,
  format: CellFormat | undefined,
  currency = CURRENCY_FALLBACK,
): string {
  if (value === null || value === undefined || value === '') return NOT_AVAILABLE
  switch (format) {
    case 'money':
      return fmtMoney(value as Money, currency)
    case 'percent':
      return fmtPercent(Number(value))
    case 'number':
      return fmtNumber(Number(value))
    case 'date':
      return fmtDate(String(value))
    default:
      return String(value)
  }
}

/**
 * Change label for a KPI. When the backend says there is nothing to compare
 * against, we say that rather than printing a misleading 0%.
 */
export function changeLabel(kpi?: {
  change_pct: number | null
  has_comparison: boolean
}): { text: string; direction: 'up' | 'down' | 'flat' | 'none' } {
  if (!kpi || !kpi.has_comparison || kpi.change_pct === null) {
    return { text: 'No comparison data', direction: 'none' }
  }
  const pct = kpi.change_pct
  if (pct === 0) return { text: 'No change', direction: 'flat' }
  return {
    text: `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
    direction: pct > 0 ? 'up' : 'down',
  }
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** Stable palette so a platform keeps its colour across every chart. */
export const PLATFORM_COLORS: Record<string, string> = {
  careem: '#9b7bff',
  uber: '#59d8b0',
  bolt: '#f5b94f',
  yango: '#6ca8ff',
  cash: '#f27b9b',
}

export const CHART_PALETTE = [
  '#55cfa4',
  '#8f77ed',
  '#f0b84d',
  '#6ca8ff',
  '#f27b9b',
  '#4ec9c0',
  '#d0a2f7',
]

export function platformColor(key: string, index = 0): string {
  return PLATFORM_COLORS[key] ?? CHART_PALETTE[index % CHART_PALETTE.length]
}
