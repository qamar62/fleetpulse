'use client'

import { useMemo, useState } from 'react'
import {
  Banknote,
  CalendarDays,
  Coins,
  Download,
  PieChart as PieIcon,
  Search,
  TrendingUp,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { api } from '@/lib/api'
import { useApi, useDebounced } from '@/lib/use-api'
import { scopeQuery, type ScopeState } from '@/lib/scope'
import type { CashDesk, CashDriverRow, CashVehicleRow } from '@/lib/types'
import {
  fmtAxis,
  fmtDate,
  fmtDayShort,
  fmtMoney,
  fmtMoneyShort,
  fmtNumber,
  fmtPercent,
} from '@/lib/format'
import { Async, EmptyState, MetricCard, Pagination, PageIntro, Panel } from '@/components/ui/kit'

const CASH_COLOR = '#f27b9b'
const PLATFORM_COLOR = '#55cfa4'
const PAGE_SIZE = 15

export function CashPage({ scope }: { scope: ScopeState }) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const desk = useApi<CashDesk>(() => api.cashDesk(query), [JSON.stringify(query)])

  return (
    <Async query={desk} loadingLabel="Loading cash activity…">
      {(data) => <CashBody data={data} scope={scope} />}
    </Async>
  )
}

function CashBody({ data, scope }: { data: CashDesk; scope: ScopeState }) {
  const c = data.currency

  if (Number(data.cash_income) === 0) {
    return (
      <>
        <CashIntro data={data} scope={scope} />
        <Panel>
          <EmptyState
            title={`No cash collected in ${data.scope.period.label}`}
            description="Every earning entry in this period was platform income. Rows with a cash amount will show up here."
          />
        </Panel>
      </>
    )
  }

  const series = data.series.map((point) => ({ ...point, day: fmtDayShort(point.date) }))

  return (
    <div className="animate-in fade-in duration-300">
      <CashIntro data={data} scope={scope} />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Cash collected"
          value={fmtMoney(data.cash_income, c)}
          icon={Banknote}
          changeText={data.scope.period.label}
        />
        <MetricCard
          label="Share of all money taken"
          value={fmtPercent(data.cash_share_pct)}
          icon={PieIcon}
          changeText={`of ${fmtMoneyShort(data.gross_income_with_cash, c)} total`}
        />
        <MetricCard
          label="Days with cash"
          value={fmtNumber(data.cash_days)}
          icon={CalendarDays}
          changeText={`${fmtMoney(data.average_per_cash_day, c)} average`}
        />
        <MetricCard
          label="Largest cash day"
          value={data.largest_cash_day ? fmtMoney(data.largest_cash_day.cash, c) : 'N/A'}
          icon={TrendingUp}
          changeText={
            data.largest_cash_day
              ? `${fmtDate(data.largest_cash_day.date)} · ${data.largest_cash_day.weekday}`
              : 'No cash recorded'
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.9fr)]">
        <Panel
          title="Cash against platform income"
          description={`Daily collections · ${data.scope.period.label}`}
        >
          <div className="p-5">
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CASH_COLOR} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={CASH_COLOR} stopOpacity={0.02} />
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
                    contentStyle={{
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                      fontSize: 11,
                      background: 'var(--card)',
                    }}
                    formatter={(value: any, name: any) => [
                      fmtMoney(value, c),
                      name === 'cash' ? 'Cash' : 'Platforms',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cash"
                    stroke={CASH_COLOR}
                    strokeWidth={2.5}
                    fill="url(#cashFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="platform"
                    stroke={PLATFORM_COLOR}
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    fill="none"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-5 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-2">
                <i className="size-2 rounded-full" style={{ backgroundColor: CASH_COLOR }} />
                Cash
              </span>
              <span className="flex items-center gap-2">
                <i className="size-2 rounded-full" style={{ backgroundColor: PLATFORM_COLOR }} />
                Platforms
              </span>
              <span className="ml-auto">
                {fmtMoney(data.cash_income, c)} cash against{' '}
                {fmtMoney(data.platform_income, c)} platform income
              </span>
            </div>
          </div>
        </Panel>

        <Panel title="Biggest cash days" description="Top ten by amount collected">
          <div className="divide-y divide-border">
            {data.top_days.map((day, index) => (
              <div key={day.date} className="flex items-center gap-3 px-5 py-2.5 text-[11px]">
                <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{fmtDate(day.date)}</span>
                  <span className="ml-1.5 text-[10px] text-muted-foreground">{day.weekday}</span>
                </span>
                <span className="shrink-0 font-mono font-semibold" style={{ color: CASH_COLOR }}>
                  {fmtMoney(day.cash, c)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <CashByParty
          title="Cash by driver"
          description="Who is holding the money"
          rows={data.by_driver}
          nameOf={(row) => row.driver}
          keyOf={(row) => row.driver_id}
          currency={c}
        />
        <CashByParty
          title="Cash by vehicle"
          description="Which car the cash came through"
          rows={data.by_vehicle}
          nameOf={(row) => `${row.vehicle} · ${row.plate_number}`}
          keyOf={(row) => row.vehicle_id}
          currency={c}
        />
      </div>

      <div className="mt-5">
        <CashRecords scope={scope} currency={c} />
      </div>
    </div>
  )
}

function CashIntro({ data, scope }: { data: CashDesk; scope: ScopeState }) {
  return (
    <PageIntro
      eyebrow="Daily Earnings / Cash"
      title="Cash collections"
      description={
        data.includes_cash
          ? 'Cash is currently counted towards income across the rest of the app.'
          : 'Cash is not counted towards income elsewhere in the app. These figures are the money itself, either way.'
      }
    >
      <span
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-medium ${
          data.includes_cash
            ? 'bg-emerald-500/10 text-emerald-700'
            : 'bg-amber-500/10 text-amber-700'
        }`}
      >
        <Coins className="size-3.5" />
        {data.includes_cash ? 'Counted as income' : 'Excluded from income'}
      </span>
      <button
        onClick={() => void api.exportCsv('earnings', { ...scopeQuery(scope), has_cash: true })}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[10px] font-medium hover:bg-muted"
      >
        <Download className="size-3" />
        Export cash rows
      </button>
    </PageIntro>
  )
}

/**
 * One cash league table. Drivers and vehicles differ only in how a row is
 * named, so they share a component rather than two near-identical tables that
 * would drift apart the first time one of them is tweaked.
 */
function CashByParty<T extends CashDriverRow | CashVehicleRow>({
  title,
  description,
  rows,
  nameOf,
  keyOf,
  currency,
}: {
  title: string
  description: string
  rows: T[]
  nameOf: (row: T) => string
  keyOf: (row: T) => number
  currency: string
}) {
  const chart = rows.slice(0, 8).map((row) => ({
    name: nameOf(row),
    cash: Number(row.cash_income),
  }))

  return (
    <Panel title={title} description={description}>
      <div className="p-5">
        <div className="h-[180px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} layout="vertical" margin={{ left: 5, right: 22 }}>
              <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                width={110}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                contentStyle={{
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  fontSize: 11,
                  background: 'var(--card)',
                }}
                formatter={(value: any) => [fmtMoney(value, currency), 'Cash']}
              />
              <Bar dataKey="cash" radius={[0, 4, 4, 0]} barSize={14} fill={CASH_COLOR} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[560px] text-left">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-5 py-3 text-right font-semibold">Cash</th>
              <th className="px-5 py-3 text-right font-semibold">Days</th>
              <th className="px-5 py-3 text-right font-semibold">Avg / day</th>
              <th className="px-5 py-3 text-right font-semibold">Cash share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={keyOf(row)} className="text-[11px] hover:bg-muted/30">
                <td className="px-5 py-3 font-medium">{nameOf(row)}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold">
                  {fmtMoney(row.cash_income, currency)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-muted-foreground">
                  {fmtNumber(row.cash_days)}
                </td>
                <td className="px-5 py-3 text-right font-mono text-muted-foreground">
                  {fmtMoney(row.average_per_cash_day, currency)}
                </td>
                <td className="px-5 py-3 text-right font-mono">
                  {fmtPercent(row.cash_share_pct, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

/** Every earning row that carries cash, searchable and paged. */
function CashRecords({ scope, currency }: { scope: ScopeState; currency: string }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)

  const query = useMemo(
    () => ({
      ...scopeQuery(scope),
      has_cash: true,
      page,
      page_size: PAGE_SIZE,
      ordering: '-cash',
      search: debounced || undefined,
    }),
    [scope, page, debounced],
  )
  const records = useApi(() => api.earnings(query), [JSON.stringify(query)])

  return (
    <Panel
      title="Cash records"
      description="Every entry with a cash amount, largest first"
      action={
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search driver, vehicle, notes…"
            className="w-[240px] rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-[11px] outline-none focus:ring-2 focus:ring-[#55cfa4]/40"
          />
        </div>
      }
    >
      <Async query={records} loadingLabel="Loading cash records…">
        {(data) =>
          data.results.length === 0 ? (
            <EmptyState
              title="No cash records match"
              description="Try a different search term, or widen the period in the bar above."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Date</th>
                      <th className="px-5 py-3 font-semibold">Driver</th>
                      <th className="px-5 py-3 font-semibold">Vehicle</th>
                      <th className="px-5 py-3 text-right font-semibold">Cash</th>
                      <th className="px-5 py-3 text-right font-semibold">Platform income</th>
                      <th className="px-5 py-3 text-right font-semibold">All-in total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.results.map((row) => (
                      <tr key={row.id} className="text-[11px] hover:bg-muted/30">
                        <td className="px-5 py-3.5 font-medium">{fmtDate(row.date)}</td>
                        <td className="px-5 py-3.5">{row.driver_name}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{row.vehicle_name}</td>
                        <td
                          className="px-5 py-3.5 text-right font-mono font-semibold"
                          style={{ color: CASH_COLOR }}
                        >
                          {fmtMoney(row.cash, currency)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-muted-foreground">
                          {fmtMoney(row.platform_income, currency)}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono">
                          {fmtMoney(row.total_income, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={data.page}
                totalPages={data.total_pages}
                count={data.count}
                pageSize={data.page_size}
                onChange={setPage}
                noun="cash records"
              />
            </>
          )
        }
      </Async>
    </Panel>
  )
}
