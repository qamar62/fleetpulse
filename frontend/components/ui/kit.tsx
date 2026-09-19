'use client'

import type { ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Inbox,
  Loader2,
  Minus,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import { changeLabel } from '@/lib/format'
import type { ApiError } from '@/lib/api'

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title?: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-border/70 bg-card shadow-sm ${className}`}>
      {(title || action) && (
        <div className="flex flex-col justify-between gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-center">
          <div>
            {title && <h3 className="text-[14px] font-semibold">{title}</h3>}
            {description && (
              <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
      <div>
        <p className="mb-2 text-[11px] text-muted-foreground">{eyebrow}</p>
        <h2 className="text-[28px] font-semibold tracking-[-0.04em]">{title}</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Async states                                                        */
/* ------------------------------------------------------------------ */

export function Loading({ label = 'Loading data…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-[12px] text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-6 py-10 text-center">
      <AlertTriangle className="size-6 text-destructive" />
      <div>
        <p className="text-[13px] font-semibold text-foreground">Could not load this data</p>
        <p className="mt-1 max-w-md text-[11px] text-muted-foreground">{error.message}</p>
        {error.status > 0 && (
          <p className="mt-1 text-[10px] text-muted-foreground/70">HTTP {error.status}</p>
        )}
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-medium hover:bg-muted"
        >
          <RefreshCw className="size-3.5" />
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  title = 'Nothing recorded yet',
  description = 'There is no data in the selected period.',
  children,
}: {
  title?: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Inbox className="size-5" />
      </span>
      <p className="text-[13px] font-semibold">{title}</p>
      <p className="max-w-sm text-[11px] text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}

/** Render loading / error / empty / content for one query in a single place. */
export function Async<T>({
  query,
  children,
  empty,
  loadingLabel,
}: {
  query: { data: T | null; error: ApiError | null; initialLoading: boolean; reload: () => void }
  children: (data: T) => ReactNode
  empty?: ReactNode
  loadingLabel?: string
}) {
  if (query.initialLoading) return <Loading label={loadingLabel} />
  if (query.error) return <ErrorState error={query.error} onRetry={query.reload} />
  if (query.data === null) return empty ?? <EmptyState />
  return <>{children(query.data)}</>
}

/* ------------------------------------------------------------------ */
/* Metrics                                                            */
/* ------------------------------------------------------------------ */

export function MetricCard({
  label,
  value,
  icon: Icon,
  kpi,
  note,
  /** Explicit change text when the figure has no period-over-period KPI. */
  changeText,
  invertColors = false,
}: {
  label: string
  value: string
  icon: LucideIcon
  kpi?: { change_pct: number | null; has_comparison: boolean }
  note?: string
  changeText?: string
  /** For costs, where "up" is bad news. */
  invertColors?: boolean
}) {
  const change = changeLabel(kpi)
  const direction = changeText ? 'none' : change.direction
  const good = invertColors ? direction === 'down' : direction === 'up'
  const tone =
    direction === 'none' || direction === 'flat'
      ? 'text-muted-foreground'
      : good
        ? 'text-emerald-600'
        : 'text-rose-600'

  return (
    <div className="group rounded-xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)] transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <span className="flex size-7 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-3.5" />
          </span>
          {label}
        </div>
      </div>
      <div className="font-mono text-[21px] font-semibold tracking-tight text-foreground">
        {value}
      </div>
      <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${tone}`}>
        {direction === 'up' && <ArrowUpRight className="size-3" />}
        {direction === 'down' && <ArrowDownRight className="size-3" />}
        {direction === 'flat' && <Minus className="size-3" />}
        {changeText ?? change.text}
        {note && <span className="font-normal text-muted-foreground"> · {note}</span>}
      </div>
    </div>
  )
}

export function StatusPill({ value, label }: { value: string; label?: string }) {
  const good = ['active', 'recorded', 'completed', 'settled', 'success'].includes(value)
  const warn = ['on_leave', 'maintenance', 'pending', 'pending_review', 'partial', 'skip'].includes(
    value,
  )
  const tone = good
    ? 'bg-emerald-500/10 text-emerald-600'
    : warn
      ? 'bg-amber-500/10 text-amber-600'
      : 'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${tone}`}>
      {label ?? value}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

export function Pagination({
  page,
  totalPages,
  count,
  pageSize,
  onChange,
  noun = 'records',
}: {
  page: number
  totalPages: number
  count: number
  pageSize: number
  onChange: (page: number) => void
  noun?: string
}) {
  const first = count === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, count)
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
      <span>
        Showing {first}–{last} of {count.toLocaleString('en-US')} {noun}
      </span>
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded-md border border-border px-2.5 py-1.5 font-medium disabled:opacity-40"
        >
          Previous
        </button>
        <span className="px-2">
          Page {page} of {Math.max(totalPages, 1)}
        </span>
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="rounded-md border border-border px-2.5 py-1.5 font-medium disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string[]
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {label}
      {children}
      {hint && !error?.length ? (
        <span className="mt-1 block text-[10px] font-normal normal-case text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {error?.length ? (
        <span className="mt-1 block text-[10px] font-normal normal-case text-destructive">
          {error.join(' ')}
        </span>
      ) : null}
    </label>
  )
}

export const inputClass =
  'mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[11px] font-normal normal-case tracking-normal text-foreground outline-none focus:ring-2 focus:ring-[#55cfa4]/40'

export function FormError({ error }: { error: ApiError | null }) {
  if (!error) return null
  return (
    <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
      {error.message}
    </div>
  )
}

/** Border + background classes for an insight tone. */
export function toneClass(tone: string): string {
  const map: Record<string, string> = {
    positive: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-700 border-amber-500/25',
    critical: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
    neutral: 'bg-muted text-muted-foreground border-border',
    info: 'bg-[#8f77ed]/10 text-[#7860d5] border-[#8f77ed]/20',
  }
  return map[tone] ?? map.neutral
}
