'use client'

import { useMemo } from 'react'
import {
  Activity,
  BarChart3,
  CircleDollarSign,
  Download,
  Fuel,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { scopeQuery, type ScopeState } from '@/lib/scope'
import type { Dashboard } from '@/lib/types'
import {
  fmtAxis,
  fmtDate,
  fmtDayShort,
  fmtMoney,
  fmtMoneyShort,
  fmtNumber,
  fmtPercent,
  platformColor,
} from '@/lib/format'
import { Async, EmptyState, MetricCard, Panel, toneClass } from '@/components/ui/kit'

export function DashboardPage({
  scope,
  onNavigate,
}: {
  scope: ScopeState
  onNavigate: (label: string) => void
}) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const dashboard = useApi<Dashboard>(
    (signal) => api.dashboard(query) as Promise<Dashboard>,
    [JSON.stringify(query)],
  )

  return (
    <Async query={dashboard} loadingLabel="Loading dashboard…">
      {(data) => <DashboardBody data={data} scope={scope} onNavigate={onNavigate} />}
    </Async>
  )
}

function DashboardBody({
  data,
  scope,
  onNavigate,
}: {
  data: Dashboard
  scope: ScopeState
  onNavigate: (label: string) => void
}) {
  const c = data.currency
  const k = data.kpis
  const s = data.summary
  const comparison = data.comparison_period?.label ?? null
  const versus = comparison ? `vs. ${comparison}` : 'no prior period'

  if (s.entries === 0) {
    return (
      <Panel>
        <EmptyState
          title={`No earnings recorded for ${data.scope.period.label}`}
          description="Add a daily earning entry or import a file, and this dashboard will fill itself in."
        >
          <button
            onClick={() => onNavigate('Import / Export')}
            className="mt-2 rounded-lg bg-[#1f3337] px-4 py-2 text-[11px] font-medium text-white"
          >
            Import data
          </button>
        </EmptyState>
      </Panel>
    )
  }

  const series = data.series.map((point) => ({
    ...point,
    day: fmtDayShort(point.date),
  }))

  const platformTotal = data.platforms.reduce((sum, p) => sum + p.income, 0)

  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={s.includes_cash ? 'Total gross income' : 'Gross income (excl. cash)'}
          value={fmtMoney(k.gross_income?.value, c)}
          icon={CircleDollarSign}
          kpi={k.gross_income}
          note={
            s.includes_cash
              ? versus
              : `${versus} · ${fmtMoneyShort(s.cash_income, c)} cash left out`
          }
        />
        <MetricCard
          label="Total expenses"
          value={fmtMoney(k.operating_expenses?.value, c)}
          icon={Fuel}
          kpi={k.operating_expenses}
          invertColors
          note={versus}
        />
        <MetricCard
          label="Operating profit"
          value={fmtMoney(k.operating_profit?.value, c)}
          icon={TrendingUp}
          kpi={k.operating_profit}
          note={`${fmtPercent(s.operating_margin_pct)} margin`}
        />
        <MetricCard
          label="Driver payroll"
          value={fmtMoney(k.payroll?.value, c)}
          icon={WalletCards}
          kpi={k.payroll}
          invertColors
          note={data.scope.period.label}
        />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Net cash balance"
          value={fmtMoney(k.net_cash_balance?.value, c)}
          icon={Target}
          kpi={k.net_cash_balance}
          note={versus}
        />
        <MetricCard
          label="Average daily income"
          value={fmtMoney(k.average_daily_income?.value, c)}
          icon={Activity}
          kpi={k.average_daily_income}
          note={`${fmtNumber(s.active_days)} earning entries`}
        />
        <MetricCard
          label="Best earning day"
          value={data.best_day ? fmtMoney(data.best_day.income, c) : 'N/A'}
          icon={Sparkles}
          changeText={
            data.best_day ? `${fmtDate(data.best_day.date)} · ${data.best_day.weekday}` : 'No data'
          }
        />
        <MetricCard
          label="Best platform"
          value={data.best_platform?.label ?? 'N/A'}
          icon={BarChart3}
          changeText={
            data.best_platform
              ? `${fmtPercent(data.best_platform.share_pct)} share · ${fmtMoneyShort(data.best_platform.income, c)}`
              : 'No data'
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(340px,0.9fr)]">
        <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
          <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-[14px] font-semibold">Daily income trend</h3>
                {k.gross_income?.has_comparison && k.gross_income.change_pct !== null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${
                      k.gross_income.change_pct >= 0
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : 'bg-rose-500/10 text-rose-600'
                    }`}
                  >
                    {k.gross_income.change_pct >= 0 ? '+' : ''}
                    {k.gross_income.change_pct.toFixed(2)}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Gross income against operating expenses · {data.scope.period.label}
              </p>
            </div>
          </div>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="incomeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#55cfa4" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#55cfa4" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  interval={Math.max(0, Math.floor(series.length / 8))}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  tickFormatter={fmtAxis}
                  width={36}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11, background: 'var(--card)' }}
                  formatter={(value: any, name: any) => [
                    fmtMoney(value, c),
                    name === 'income' ? 'Income' : 'Expenses',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="income"
                  stroke="#45bd96"
                  strokeWidth={2.5}
                  fill="url(#incomeFill)"
                />
                <Area
                  type="monotone"
                  dataKey="expenses"
                  stroke="#e28a9b"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex items-center gap-5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <i className="size-2 rounded-full bg-[#45bd96]" />
              Income
            </span>
            <span className="flex items-center gap-2">
              <i className="size-2 rounded-full bg-[#e28a9b]" />
              Expenses
            </span>
            <span className="ml-auto">
              {data.coverage.active_days} of {data.coverage.calendar_days} days had activity
            </span>
          </div>
        </section>

        <section className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[14px] font-semibold">Business insights</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Generated from {data.scope.period.label} data
              </p>
            </div>
            <div className="flex size-8 items-center justify-center rounded-lg bg-[#55cfa4]/10 text-[#299b78]">
              <Sparkles className="size-4" />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            {data.insights.slice(0, 4).map((insight) => (
              <div
                key={insight.key}
                className={`rounded-lg border p-3 ${toneClass(insight.tone)}`}
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider">
                  {insight.title}
                </p>
                <p className="text-[12px] leading-relaxed text-foreground">{insight.message}</p>
              </div>
            ))}
          </div>
          {data.insights.length > 4 && (
            <button
              onClick={() => onNavigate('Analytics')}
              className="mt-4 text-[11px] font-semibold text-foreground hover:text-[#299b78]"
            >
              View all {data.insights.length} insights →
            </button>
          )}
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel
          title="Platform performance"
          description={
            s.includes_cash
              ? 'Income contribution by channel, cash included'
              : 'Income contribution by channel — cash is excluded and shown below'
          }
        >
          <div className="flex flex-col items-center gap-6 p-5 sm:flex-row">
            <div className="relative size-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.platforms}
                    innerRadius={50}
                    outerRadius={69}
                    paddingAngle={3}
                    dataKey="income"
                    nameKey="label"
                    strokeWidth={0}
                  >
                    {data.platforms.map((entry, index) => (
                      <Cell key={entry.platform} fill={platformColor(entry.platform, index)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11, background: 'var(--card)' }}
                    formatter={(value: any) => fmtMoney(value, c)}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-[15px] font-semibold">
                  {fmtMoneyShort(platformTotal, c)}
                </span>
                <span className="text-[9px] text-muted-foreground">
                  {s.includes_cash ? 'total income' : 'excl. cash'}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1 self-stretch">
              {data.platforms.map((item, index) => (
                <div key={item.platform} className="mb-2.5 flex items-center gap-2 text-[11px]">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: platformColor(item.platform, index) }}
                  />
                  <span className="w-14 shrink-0 text-muted-foreground">{item.label}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-muted">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${item.share_pct ?? 0}%`,
                        backgroundColor: platformColor(item.platform, index),
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-[10px]">
                    {fmtPercent(item.share_pct, 1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel
          title="Expense breakdown"
          description={`${fmtMoney(s.operating_expenses, c)} total operating expenses`}
        >
          <div className="p-5">
            <div className="h-[178px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.expense_categories}
                  layout="vertical"
                  margin={{ left: 5, right: 22 }}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    width={70}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{ borderRadius: 10, border: '1px solid var(--border)', fontSize: 11, background: 'var(--card)' }}
                    formatter={(value: any) => [fmtMoney(value, c), 'Expense']}
                  />
                  <Bar dataKey="amount" radius={[0, 4, 4, 0]} barSize={14} fill="#8f77ed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-3 text-[10px]">
              <span className="text-muted-foreground">Expense / income</span>
              <span className="font-mono font-semibold text-foreground">
                {fmtPercent(s.expense_to_income_pct)}
              </span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <Panel
          title="Profitability"
          description="Gross income through to net result"
          action={
            <button
              onClick={() => void api.reportCsv('profitability', scopeQuery(scope))}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[10px] font-medium"
            >
              <Download className="size-3" />
              Export CSV
            </button>
          }
        >
          <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
            {data.profitability.steps.map((step) => (
              <div key={step.key} className="bg-card px-5 py-4">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {step.label}
                </p>
                <p
                  className={`mt-1.5 font-mono text-[16px] font-semibold ${
                    step.kind === 'decrease' ? 'text-rose-600' : 'text-foreground'
                  }`}
                >
                  {step.kind === 'decrease' ? '− ' : ''}
                  {fmtMoney(Math.abs(step.amount), c)}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-6 border-t border-border px-5 py-3 text-[10px] text-muted-foreground">
            <span>
              Operating margin{' '}
              <strong className="font-mono text-foreground">
                {fmtPercent(data.profitability.operating_margin_pct)}
              </strong>
            </span>
            <span>
              Net margin{' '}
              <strong className="font-mono text-foreground">
                {fmtPercent(data.profitability.net_margin_pct)}
              </strong>
            </span>
            <span>
              Cash share of all money taken{' '}
              <strong className="font-mono text-foreground">
                {fmtPercent(s.cash_to_income_pct)}
              </strong>{' '}
              <em className="not-italic text-muted-foreground/80">
                ({fmtMoney(s.cash_income, c)}
                {s.includes_cash ? ', counted above' : ', not counted above'})
              </em>
            </span>
          </div>
        </Panel>
      </div>

      <div className="mt-5">
        <RecentEarnings scope={scope} onNavigate={onNavigate} currency={c} />
      </div>
    </div>
  )
}

function RecentEarnings({
  scope,
  onNavigate,
  currency,
}: {
  scope: ScopeState
  onNavigate: (label: string) => void
  currency: string
}) {
  const query = useMemo(
    () => ({ ...scopeQuery(scope), page_size: 6, ordering: '-date' }),
    [scope],
  )
  const earnings = useApi((signal) => api.earnings(query), [JSON.stringify(query)])

  return (
    <Panel
      title="Recent daily earnings"
      description="Latest income activity across your fleet"
      action={
        <button
          onClick={() => onNavigate('Daily Earnings')}
          className="rounded-md border border-border px-2.5 py-1.5 text-[10px] font-medium"
        >
          View all earnings
        </button>
      }
    >
      <Async query={earnings} loadingLabel="Loading earnings…">
        {(data) =>
          data.results.length === 0 ? (
            <EmptyState
              title="No earning entries in this period"
              description="Recorded entries will appear here as soon as they exist."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {[
                      'Date',
                      'Driver',
                      'Vehicle',
                      'Careem',
                      'Uber',
                      'Bolt',
                      'Yango',
                      scope.includeCash ? 'Cash' : 'Cash (not counted)',
                      scope.includeCash ? 'Total' : 'Total (excl. cash)',
                    ].map((header, index) => (
                      <th
                        key={header}
                        className={`px-5 py-3 font-semibold ${index === 8 ? 'text-right' : ''}`}
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.results.map((row) => (
                    <tr key={row.id} className="text-[11px] hover:bg-muted/30">
                      <td className="px-5 py-3.5 font-medium">{fmtDate(row.date)}</td>
                      <td className="px-5 py-3.5">{row.driver_name}</td>
                      <td className="px-5 py-3.5 text-muted-foreground">{row.vehicle_name}</td>
                      <td className="px-5 py-3.5 font-mono text-muted-foreground">
                        {fmtMoney(row.careem, currency)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-muted-foreground">
                        {fmtMoney(row.uber, currency)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-muted-foreground">
                        {fmtMoney(row.bolt, currency)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-muted-foreground">
                        {fmtMoney(row.yango, currency)}
                      </td>
                      <td
                        className={`px-5 py-3.5 font-mono ${
                          scope.includeCash ? 'text-muted-foreground' : 'text-[#d2618a]'
                        }`}
                      >
                        {fmtMoney(row.cash, currency)}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-semibold text-emerald-600">
                        {fmtMoney(
                          scope.includeCash ? row.total_income : row.platform_income,
                          currency,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Async>
    </Panel>
  )
}
