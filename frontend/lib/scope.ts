'use client'

import type { Query } from './api'

export interface ScopeState {
  /** ISO month, e.g. "2025-12". Empty when a named range is used instead. */
  month: string
  /** A backend range name, "month" to use `month`, or "custom" for start/end. */
  range: string
  /** Inclusive ISO dates, only meaningful when `range` is "custom". */
  start: string
  end: string
  driver: number | null
  vehicle: number | null
  /**
   * Count cash collections as income. Off by default: cash is the one line that
   * cannot be reconciled against a platform statement, so counting it silently
   * would flatter every margin in the app.
   */
  includeCash: boolean
}

export const DEFAULT_SCOPE: ScopeState = {
  month: '',
  range: 'month',
  start: '',
  end: '',
  driver: null,
  vehicle: null,
  includeCash: false,
}

/** Where the cash preference is remembered between pages and reloads. */
export const INCLUDE_CASH_KEY = 'fleet-pulse.include-cash'

/**
 * The remembered cash preference, or false when there is nothing to read.
 *
 * Only safe to call from the browser, and only after mount - reading storage
 * during render would make the server and the first client render disagree.
 */
export function readIncludeCash(): boolean {
  try {
    return window.localStorage.getItem(INCLUDE_CASH_KEY) === 'true'
  } catch {
    // Private browsing and blocked storage both throw here. A preference this
    // small is not worth breaking the page over.
    return false
  }
}

export function writeIncludeCash(value: boolean): void {
  try {
    window.localStorage.setItem(INCLUDE_CASH_KEY, value ? 'true' : 'false')
  } catch {
    /* see readIncludeCash */
  }
}

/** True when a custom range is selected but not yet usable. */
export function customRangeIsIncomplete(scope: ScopeState): boolean {
  return scope.range === 'custom' && !(scope.start && scope.end && scope.start <= scope.end)
}

/** Turn the UI scope into the query parameters every backend endpoint accepts. */
export function scopeQuery(scope: ScopeState): Query {
  const query: Query = {}
  if (scope.range === 'custom') {
    // Send the pair or neither. A lone start would silently widen the window to
    // "everything since", which is not what a half-filled form means.
    if (scope.start && scope.end && scope.start <= scope.end) {
      query.start = scope.start
      query.end = scope.end
    } else if (scope.month) {
      query.month = scope.month
    }
  } else if (scope.range === 'month' && scope.month) {
    query.month = scope.month
  } else if (scope.range && scope.range !== 'month') {
    query.range = scope.range
  } else if (scope.month) {
    query.month = scope.month
  }
  if (scope.driver) query.driver = scope.driver
  if (scope.vehicle) query.vehicle = scope.vehicle
  // Sent only when on. The backend defaults to excluding cash, so an absent
  // parameter and `false` mean the same thing and the URL stays clean.
  if (scope.includeCash) query.include_cash = 'true'
  return query
}

export const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
]

/** Recent months for the month picker, newest first. */
export function monthOptions(count = 18, from = new Date()): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let i = 0; i < count; i += 1) {
    const value = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    options.push({
      value,
      label: cursor.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    })
    cursor.setMonth(cursor.getMonth() - 1)
  }
  return options
}

export function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** First and last day of a month as ISO dates. Seeds the custom inputs. */
export function monthBounds(month: string): { start: string; end: string } {
  const [year, index] = month.split('-').map(Number)
  if (!year || !index) return { start: '', end: '' }
  const last = new Date(year, index, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { start: `${year}-${pad(index)}-01`, end: `${year}-${pad(index)}-${pad(last)}` }
}
