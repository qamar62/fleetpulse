'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  BarChart3,
  CalendarDays,
  Coins,
  Layers,
  LineChart as LineChartIcon,
  PieChart,
  TrendingUp,
  Users,
} from 'lucide-react'

import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { useAuth } from '@/lib/auth-context'
import { scopeQuery, type ScopeState } from '@/lib/scope'
import {
  CURRENCY_FALLBACK,
  fmtAxis,
  fmtDayShort,
  fmtMoney,
  fmtNumber,
  fmtPercent,
  platformColor,
  toNumber,
} from '@/lib/format'
import { Async, EmptyState, Panel, PageIntro } from '@/components/ui/kit'
import type { DriverPerformanceRow, VehiclePerformanceRow, WaterfallStep } from '@/lib/types'

/* Keys match AnalyticsView.HANDLERS on the backend. */
const VIEWS = [
  { key: 'profitability', label: 'Profitability', icon: Layers },
  { key: 'income-mix', label: 'Income mix', icon: PieChart },
  { key: 'platform-performance', label: 'Platforms', icon: BarChart3 },
  { key: 'day-of-week', label: 'Day of week', icon: CalendarDays },
  { key: 'distribution', label: 'Distribution', icon: Activity },
  { key: 'expense-to-income', label: 'Expense trend', icon: LineChartIcon },
  { key: 'cash-vs-platform', label: 'Cash vs platform', icon: Coins },
  { key: 'monthly-trend', label: 'Monthly trend', icon: TrendingUp },
  { key: 'comparison', label: 'Comparison', icon: Users },
] as const

type ViewKey = (typeof VIEWS)[number]['key']

const axisTick = { fontSize: 10, fill: 'var(--muted-foreground)' } as const
const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid var(--border)',
  fontSize: 11,
  background: 'var(--card)',
} as const

export function AnalyticsPage({ scope }: { scope: ScopeState }) {
  const [view, setView] = useState<ViewKey>('profitability')
  const query = useMemo(() => scopeQuery(scope), [scope])
  const { meta } = useAuth()
  const currency = meta?.currency ?? CURRENCY_FALLBACK

  return (
    <div>
      <PageIntro
        eyebrow="Analytics"
        title="Deep dives"
        description="Computed by the backend from recorded entries only. Ratios without a denominator show N/A rather than zero."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {VIEWS.map((item) => {
          const Icon = item.icon
          const on = item.key === view
          return (
            <button
              key={item.key}
              onClick={() => setView(item.key)}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[11px] font-medium transition ${
                on
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          )
        })}
      </div>

      <AnalyticsBody key={view} viewKey={view} query={query} currency={currency} />
    </div>
  )
}

function AnalyticsBody({
  viewKey,
  query,
  currency,
}: {
  viewKey: ViewKey
  query: Record<string, any>
  currency: string
}) {
  const result = useApi<any>(() => api.analytics<any>(viewKey, query), [
    viewKey,
    JSON.stringify(query),
  ])

  return (
    <Async query={result} loadingLabel="Loading analytics…">
      {(data) => {
        switch (viewKey) {
          case 'profitability':
            return <Profitability data={data} c={currency} />
          case 'income-mix':
            return <IncomeMix data={data} c={currency} />
          case 'platform-performance':
            return <PlatformPerformance data={data} c={currency} />
          case 'day-of-week':
            return <DayOfWeek data={data} c={currency} />
          case 'distribution':
            return <Distribution data={data} c={currency} />
          case 'expense-to-income':
            return <ExpenseTrend data={data} c={currency} />
          case 'cash-vs-platform':
            return <CashVsPlatform data={data} c={currency} />
          case 'monthly-trend':
            return <MonthlyTrend data={data} c={currency} />
          case 'comparison':
            return <Comparison data={data} c={currency} />
          default:
            return <EmptyState title="No renderer for this view" />
        }
      }}
    </Async>
  )
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[20px] font-semibold tracking-[-0.03em]">{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

interface Col {
  key: string
  label: string
  align?: 'right'
  render: (row: any) => React.ReactNode
}

function SimpleTable({ columns, rows }: { columns: Col[]; rows: any[] }) {
  if (!rows.length) return <EmptyState title="Nothing recorded in this period" />
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-[12px]">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-4 py-2.5 font-medium ${c.align === 'right' ? 'text-right' : ''}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-4 py-2.5 ${
                    c.align === 'right' ? 'text-right tabular-nums' : 'text-muted-foreground'
                  }`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartFrame({ height = 300, children }: { height?: number; children: any }) {
  return (
    <div className="px-5 py-4" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 1. Profitability waterfall                                          */
/* ------------------------------------------------------------------ */

function Profitability({
  data,
  c,
}: {
  data: { steps: WaterfallStep[]; operating_margin_pct: number | null; net_margin_pct: number | null }
  c: string
}) {
  const steps = data.steps ?? []
  if (!steps.length) return <EmptyState title="Nothing recorded in this period" />
  const max = Math.max(1, ...steps.map((s) => Math.abs(toNumber(s.amount) ?? 0)))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Operating margin"
          value={fmtPercent(data.operating_margin_pct)}
          hint="Operating profit ÷ gross income"
        />
        <Stat
          label="Net margin"
          value={fmtPercent(data.net_margin_pct)}
          hint="Net result ÷ gross income"
        />
      </div>

      <Panel
        title="From gross income to net result"
        description="Each step is a real total for the selected period."
      >
        <div className="space-y-4 px-5 py-5">
          {steps.map((step) => {
            const amount = toNumber(step.amount) ?? 0
            const width = (Math.abs(amount) / max) * 100
            const negative = step.kind === 'decrease'
            const total = step.kind === 'total'
            return (
              <div key={step.key}>
                <div className="mb-1.5 flex items-baseline justify-between text-[12px]">
                  <span className={total ? 'font-semibold' : 'text-muted-foreground'}>
                    {step.label}
                  </span>
                  <span
                    className={`tabular-nums font-medium ${
                      negative ? 'text-rose-500' : total ? '' : 'text-emerald-600'
                    }`}
                  >
                    {negative ? '−' : ''}
                    {fmtMoney(Math.abs(amount), c)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      negative ? 'bg-rose-400' : total ? 'bg-primary' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${Math.max(width, 1.5)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 2. Income mix                                                       */
/* ------------------------------------------------------------------ */

function IncomeMix({
  data,
  c,
}: {
  data: { granularity: string; platforms: string[]; series: any[] }
  c: string
}) {
  const platforms = data.platforms ?? []
  const series = (data.series ?? []).map((row) => {
    const out: Record<string, any> = { label: row.label, total: toNumber(row.total) ?? 0 }
    platforms.forEach((p) => {
      out[p] = toNumber(row.values?.[p]) ?? 0
    })
    return out
  })

  if (!series.length) return <EmptyState title="No income recorded in this period" />

  const totals = platforms.map((p) => ({
    platform: p,
    amount: series.reduce((sum, row) => sum + (row[p] ?? 0), 0),
  }))
  const grand = totals.reduce((s, t) => s + t.amount, 0)
  const byMonth = data.granularity === 'month'

  return (
    <div className="space-y-5">
      <Panel
        title="Platform mix over time"
        description={`Stacked by ${byMonth ? 'month' : 'day'} · ${series.length} buckets`}
      >
        <ChartFrame height={330}>
          <BarChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickFormatter={(v) => (byMonth ? String(v) : fmtDayShort(String(v)))}
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              interval={Math.max(0, Math.floor(series.length / 8))}
            />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={fmtAxis} width={40} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: any) => [fmtMoney(value, c), name]}
            />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
            {platforms.map((p, i) => (
              <Bar
                key={p}
                dataKey={p}
                stackId="mix"
                fill={platformColor(p, i)}
                radius={i === platforms.length - 1 ? [3, 3, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ChartFrame>
      </Panel>

      <Panel title="Period totals by platform">
        <SimpleTable
          rows={totals.filter((t) => t.amount > 0).sort((a, b) => b.amount - a.amount)}
          columns={[
            {
              key: 'platform',
              label: 'Platform',
              render: (r) => (
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: platformColor(r.platform, 0) }}
                  />
                  <span className="capitalize">{r.platform}</span>
                </span>
              ),
            },
            { key: 'amount', label: 'Income', align: 'right', render: (r) => fmtMoney(r.amount, c) },
            {
              key: 'share',
              label: 'Share',
              align: 'right',
              render: (r) => (grand > 0 ? fmtPercent((r.amount / grand) * 100) : 'N/A'),
            },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 3. Platform performance                                             */
/* ------------------------------------------------------------------ */

function PlatformPerformance({ data, c }: { data: any; c: string }) {
  const rows = (data.rows ?? []).filter((r: any) => (toNumber(r.income) ?? 0) > 0)
  if (!rows.length) return <EmptyState title="No platform income recorded in this period" />
  const chart = rows.map((r: any) => ({ ...r, value: toNumber(r.income) ?? 0 }))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label={data.includes_cash ? 'Gross income' : 'Gross income (excl. cash)'}
          value={fmtMoney(data.gross_income, c)}
          hint={
            data.includes_cash
              ? 'Cash counted alongside the platforms'
              : `${fmtMoney(data.cash_income, c)} cash collected, not counted here`
          }
        />
        <Stat
          label="Leading platform"
          value={data.leader ? String(data.leader.platform).toUpperCase() : 'N/A'}
          hint={
            data.leader
              ? `${fmtMoney(data.leader.income, c)} · ${fmtPercent(data.leader.share_pct)} share`
              : 'No income recorded'
          }
        />
      </div>

      <Panel title="Income by platform">
        <ChartFrame height={Math.max(220, chart.length * 54)}>
          <BarChart data={chart} layout="vertical" margin={{ left: 8, right: 16, top: 10, bottom: 0 }}>
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              tickFormatter={fmtAxis}
            />
            <YAxis
              type="category"
              dataKey="platform"
              width={78}
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              tickFormatter={(v) => String(v).toUpperCase()}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'var(--muted)' }}
              formatter={(value: any) => [fmtMoney(value, c), 'Income']}
            />
            <Bar dataKey="value" radius={[0, 5, 5, 0]}>
              {chart.map((r: any, i: number) => (
                <Cell key={r.platform} fill={platformColor(r.platform, i)} />
              ))}
            </Bar>
          </BarChart>
        </ChartFrame>
      </Panel>

      <Panel title="Platform detail">
        <SimpleTable
          rows={rows}
          columns={[
            {
              key: 'platform',
              label: 'Platform',
              render: (r) => <span className="font-medium capitalize text-foreground">{r.platform}</span>,
            },
            { key: 'income', label: 'Income', align: 'right', render: (r) => fmtMoney(r.income, c) },
            { key: 'share_pct', label: 'Share', align: 'right', render: (r) => fmtPercent(r.share_pct) },
            { key: 'entries', label: 'Entries', align: 'right', render: (r) => fmtNumber(r.entries) },
            {
              key: 'active_days',
              label: 'Active days',
              align: 'right',
              render: (r) => fmtNumber(r.active_days),
            },
            {
              key: 'average_per_active_day',
              label: 'Avg / active day',
              align: 'right',
              render: (r) => fmtMoney(r.average_per_active_day, c),
            },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 4. Day of week                                                      */
/* ------------------------------------------------------------------ */

function DayOfWeek({ data, c }: { data: any; c: string }) {
  const rows = data.rows ?? []
  if (!rows.some((r: any) => r.active_days > 0)) {
    return <EmptyState title="No earning days recorded in this period" />
  }
  const chart = rows.map((r: any) => ({
    weekday: String(r.weekday).slice(0, 3),
    average: toNumber(r.average_income) ?? 0,
  }))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat
          label="Strongest weekday"
          value={data.strongest_weekday ?? 'N/A'}
          hint="By average income per recorded day"
        />
        <Stat
          label="Weakest weekday"
          value={data.weakest_weekday ?? 'N/A'}
          hint="Weekdays with no records are excluded"
        />
      </div>

      <Panel
        title="Average income by weekday"
        description="Averaged over days that actually have earnings recorded."
      >
        <ChartFrame height={280}>
          <BarChart data={chart} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="weekday" tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={fmtAxis} width={40} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'var(--muted)' }}
              formatter={(value: any) => [fmtMoney(value, c), 'Average']}
            />
            <Bar dataKey="average" fill="#8b7bf0" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ChartFrame>
      </Panel>

      <Panel title="Weekday detail">
        <SimpleTable
          rows={rows}
          columns={[
            {
              key: 'weekday',
              label: 'Weekday',
              render: (r) => <span className="font-medium text-foreground">{r.weekday}</span>,
            },
            {
              key: 'active_days',
              label: 'Active days',
              align: 'right',
              render: (r) => fmtNumber(r.active_days),
            },
            { key: 'total_income', label: 'Total', align: 'right', render: (r) => fmtMoney(r.total_income, c) },
            { key: 'average_income', label: 'Average', align: 'right', render: (r) => fmtMoney(r.average_income, c) },
            { key: 'best', label: 'Best', align: 'right', render: (r) => fmtMoney(r.best, c) },
            { key: 'worst', label: 'Worst', align: 'right', render: (r) => fmtMoney(r.worst, c) },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 5. Distribution                                                     */
/* ------------------------------------------------------------------ */

function Distribution({ data, c }: { data: any; c: string }) {
  if (!data.count) return <EmptyState title="No earning days recorded in this period" />

  const buckets = (data.buckets ?? []).map((b: any) => ({
    range: `${fmtAxis(toNumber(b.from) ?? 0)}–${fmtAxis(toNumber(b.to) ?? 0)}`,
    count: b.count,
  }))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Recorded days" value={fmtNumber(data.count)} />
        <Stat label="High" value={fmtMoney(data.high, c)} />
        <Stat label="Low" value={fmtMoney(data.low, c)} />
        <Stat label="Average" value={fmtMoney(data.average, c)} />
        <Stat label="Median" value={fmtMoney(data.median, c)} />
      </div>

      <Panel
        title="How daily income is spread"
        description="Count of recorded days falling into each income band."
      >
        <ChartFrame height={320}>
          <BarChart data={buckets} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="range"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
              interval={0}
              angle={-18}
              dy={8}
              height={46}
            />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={axisTick} width={30} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'var(--muted)' }}
              formatter={(value: any) => [`${value} days`, 'Recorded days']}
            />
            <Bar dataKey="count" fill="#55cfa4" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ChartFrame>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 6. Expense-to-income trend                                          */
/* ------------------------------------------------------------------ */

function ExpenseTrend({ data, c }: { data: any; c: string }) {
  const series = (data.series ?? []).map((r: any) => ({
    date: r.date,
    income: toNumber(r.income) ?? 0,
    expenses: toNumber(r.expenses) ?? 0,
    ratio: r.expense_to_income_pct,
  }))
  if (!series.length) return <EmptyState title="Nothing recorded in this period" />
  const step = Math.max(0, Math.floor(series.length / 8))

  return (
    <div className="space-y-5">
      <Stat
        label="Period expense-to-income"
        value={fmtPercent(data.period_expense_to_income_pct)}
        hint="Operating expenses ÷ gross income across the whole period"
      />

      <Panel title="Income against expenses" description="Daily totals for the selected period.">
        <ChartFrame height={300}>
          <AreaChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="etiIncome" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#55cfa4" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#55cfa4" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="etiExpense" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef7a92" stopOpacity={0.26} />
                <stop offset="100%" stopColor="#ef7a92" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDayShort}
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              interval={step}
            />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={fmtAxis} width={40} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => fmtDayShort(String(v))}
              formatter={(value: any, name: any) => [
                fmtMoney(value, c),
                name === 'income' ? 'Income' : 'Expenses',
              ]}
            />
            <Area type="monotone" dataKey="income" stroke="#55cfa4" strokeWidth={2} fill="url(#etiIncome)" />
            <Area type="monotone" dataKey="expenses" stroke="#ef7a92" strokeWidth={2} fill="url(#etiExpense)" />
          </AreaChart>
        </ChartFrame>
      </Panel>

      <Panel
        title="Daily expense-to-income ratio"
        description="Days with no income have no ratio, so the line breaks rather than dropping to zero."
      >
        <ChartFrame height={240}>
          <LineChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDayShort}
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              interval={step}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={axisTick}
              tickFormatter={(v) => `${v}%`}
              width={40}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(v) => fmtDayShort(String(v))}
              formatter={(value: any) => [fmtPercent(value), 'Expense-to-income']}
            />
            <Line
              type="monotone"
              dataKey="ratio"
              stroke="#e8a33d"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ChartFrame>
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 7. Cash vs platform                                                 */
/* ------------------------------------------------------------------ */

function CashVsPlatform({ data, c }: { data: any; c: string }) {
  const series = (data.series ?? []).map((r: any) => ({
    date: r.date,
    cash: toNumber(r.cash) ?? 0,
    platform: toNumber(r.platform) ?? 0,
  }))

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cash income" value={fmtMoney(data.cash_income, c)} />
        <Stat label="Cash share" value={fmtPercent(data.cash_share_pct)} />
        <Stat label="Platform income" value={fmtMoney(data.platform_income, c)} />
        <Stat label="Platform share" value={fmtPercent(data.platform_share_pct)} />
      </div>

      <p className="text-[11px] text-muted-foreground">
        Both shares are measured against every dirham taken, so they do not move with the
        include-cash switch.{' '}
        {data.includes_cash
          ? 'Cash is currently counted as income across the rest of the app.'
          : 'Cash is currently left out of income across the rest of the app.'}
      </p>

      {series.length ? (
        <Panel
          title="Cash against platform income"
          description="Stacked daily totals — cash is everything not booked to a ride-hailing platform."
        >
          <ChartFrame height={310}>
            <BarChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={fmtDayShort}
                tickLine={false}
                axisLine={false}
                tick={axisTick}
                interval={Math.max(0, Math.floor(series.length / 8))}
              />
              <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={fmtAxis} width={40} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelFormatter={(v) => fmtDayShort(String(v))}
                formatter={(value: any, name: any) => [
                  fmtMoney(value, c),
                  name === 'cash' ? 'Cash' : 'Platform',
                ]}
              />
              <Legend wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
              <Bar dataKey="platform" stackId="src" fill="#6ca8ff" />
              <Bar dataKey="cash" stackId="src" fill="#ef7a92" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartFrame>
        </Panel>
      ) : (
        <EmptyState title="No income recorded in this period" />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 8. Monthly trend                                                    */
/* ------------------------------------------------------------------ */

function MonthlyTrend({ data, c }: { data: { series: any[] }; c: string }) {
  const series = (data.series ?? []).map((r) => ({
    label: r.label,
    gross_income: toNumber(r.gross_income) ?? 0,
    operating_expenses: toNumber(r.operating_expenses) ?? 0,
    payroll: toNumber(r.payroll) ?? 0,
    net_result: toNumber(r.net_result) ?? 0,
    operating_margin_pct: r.operating_margin_pct,
  }))
  if (!series.length) return <EmptyState title="No months with activity in this period" />

  return (
    <div className="space-y-5">
      <Panel title="Month over month" description="Gross income, what it costs, and what is left.">
        <ChartFrame height={330}>
          <BarChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} />
            <YAxis tickLine={false} axisLine={false} tick={axisTick} tickFormatter={fmtAxis} width={40} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: any, name: any) => [
                fmtMoney(value, c),
                String(name).replace(/_/g, ' '),
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 10, paddingTop: 10 }} />
            <Bar dataKey="gross_income" fill="#8b7bf0" radius={[3, 3, 0, 0]} />
            <Bar dataKey="operating_expenses" fill="#ef7a92" radius={[3, 3, 0, 0]} />
            <Bar dataKey="payroll" fill="#e8a33d" radius={[3, 3, 0, 0]} />
            <Bar dataKey="net_result" fill="#55cfa4" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartFrame>
      </Panel>

      <Panel title="Monthly detail">
        <SimpleTable
          rows={series}
          columns={[
            {
              key: 'label',
              label: 'Month',
              render: (r) => <span className="font-medium text-foreground">{r.label}</span>,
            },
            { key: 'gross_income', label: 'Gross income', align: 'right', render: (r) => fmtMoney(r.gross_income, c) },
            { key: 'operating_expenses', label: 'Expenses', align: 'right', render: (r) => fmtMoney(r.operating_expenses, c) },
            { key: 'payroll', label: 'Payroll', align: 'right', render: (r) => fmtMoney(r.payroll, c) },
            { key: 'net_result', label: 'Net result', align: 'right', render: (r) => fmtMoney(r.net_result, c) },
            {
              key: 'operating_margin_pct',
              label: 'Op. margin',
              align: 'right',
              render: (r) => fmtPercent(r.operating_margin_pct),
            },
          ]}
        />
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* 9. Comparison                                                       */
/* ------------------------------------------------------------------ */

function Comparison({
  data,
  c,
}: {
  data: { drivers: DriverPerformanceRow[]; vehicles: VehiclePerformanceRow[]; note: string }
  c: string
}) {
  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        {data.note}
      </p>

      <Panel title="Drivers" description={`${data.drivers?.length ?? 0} with activity in this period`}>
        <SimpleTable
          rows={data.drivers ?? []}
          columns={[
            {
              key: 'driver',
              label: 'Driver',
              render: (r) => <span className="font-medium text-foreground">{r.driver}</span>,
            },
            { key: 'vehicle', label: 'Vehicle', render: (r) => r.vehicle ?? '—' },
            { key: 'gross_income', label: 'Gross', align: 'right', render: (r) => fmtMoney(r.gross_income, c) },
            { key: 'operating_expenses', label: 'Expenses', align: 'right', render: (r) => fmtMoney(r.operating_expenses, c) },
            { key: 'operating_profit', label: 'Op. profit', align: 'right', render: (r) => fmtMoney(r.operating_profit, c) },
            { key: 'active_days', label: 'Active days', align: 'right', render: (r) => fmtNumber(r.active_days) },
            { key: 'average_per_day', label: 'Avg / day', align: 'right', render: (r) => fmtMoney(r.average_per_day, c) },
            { key: 'operating_margin_pct', label: 'Margin', align: 'right', render: (r) => fmtPercent(r.operating_margin_pct) },
          ]}
        />
      </Panel>

      <Panel title="Vehicles" description={`${data.vehicles?.length ?? 0} with activity in this period`}>
        <SimpleTable
          rows={data.vehicles ?? []}
          columns={[
            {
              key: 'vehicle',
              label: 'Vehicle',
              render: (r) => <span className="font-medium text-foreground">{r.vehicle}</span>,
            },
            { key: 'assigned_driver', label: 'Driver', render: (r) => r.assigned_driver ?? '—' },
            { key: 'gross_income', label: 'Gross', align: 'right', render: (r) => fmtMoney(r.gross_income, c) },
            { key: 'fuel', label: 'Fuel', align: 'right', render: (r) => fmtMoney(r.fuel, c) },
            { key: 'salik', label: 'Salik', align: 'right', render: (r) => fmtMoney(r.salik, c) },
            { key: 'maintenance', label: 'Maintenance', align: 'right', render: (r) => fmtMoney(r.maintenance, c) },
            { key: 'operating_profit', label: 'Op. profit', align: 'right', render: (r) => fmtMoney(r.operating_profit, c) },
            { key: 'income_per_active_day', label: 'Income / day', align: 'right', render: (r) => fmtMoney(r.income_per_active_day, c) },
          ]}
        />
      </Panel>
    </div>
  )
}
