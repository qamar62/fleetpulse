'use client'

import { useMemo } from 'react'
import { CarFront, CircleDollarSign, FileText, Users, WalletCards } from 'lucide-react'
import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { scopeQuery, type ScopeState } from '@/lib/scope'
import type {
  Driver,
  Earning,
  Expense,
  Meta,
  Report,
  Settlement,
  Vehicle,
} from '@/lib/types'
import { fmtDate, fmtMoney, fmtNumber, fmtPercent } from '@/lib/format'
import { MetricCard, StatusPill } from '@/components/ui/kit'
import { ResourcePage, type ColumnSpec, type FieldSpec } from '@/components/resource-page'

/** Reference lists for the driver/vehicle dropdowns on the earning and expense forms. */
function useReferenceData() {
  const drivers = useApi(() => api.drivers({ page_size: 200, ordering: 'name' }), [])
  const vehicles = useApi(() => api.vehicles({ page_size: 200, ordering: 'plate_number' }), [])
  return {
    driverOptions: (drivers.data?.results ?? []).map((d) => ({ value: d.id, label: d.name })),
    vehicleOptions: (vehicles.data?.results ?? []).map((v) => ({
      value: v.id,
      label: `${v.display_name} — ${v.plate_number}`,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Drivers                                                             */
/* ------------------------------------------------------------------ */

export function DriversPage({ scope, meta }: { scope: ScopeState; meta: Meta | null }) {
  const columns: ColumnSpec<Driver>[] = [
    { key: 'name', label: 'Name', render: (r) => <span className="font-semibold">{r.name}</span> },
    { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' },
    { key: 'email', label: 'Email', render: (r) => r.email || '—' },
    { key: 'license', label: 'Licence', render: (r) => r.license_number || '—' },
    {
      key: 'vehicles',
      label: 'Vehicles',
      render: (r) =>
        r.vehicles.length ? (
          <span className="text-muted-foreground">
            {r.vehicles.map((v) => v.plate_number).join(', ')}
          </span>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        ),
    },
    { key: 'joined', label: 'Joined', render: (r) => fmtDate(r.joined_at) },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <StatusPill value={r.status} label={r.status_label} />,
    },
  ]

  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', required: true },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email' },
    { name: 'license_number', label: 'Licence number' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: meta?.driver_statuses ?? [],
      required: true,
    },
    { name: 'joined_at', label: 'Joined on', type: 'date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <ResourcePage<Driver>
      resource="drivers"
      title="Drivers"
      eyebrow="Workspace / Drivers"
      description="Driver profiles, assignments and contact details."
      icon={Users}
      columns={columns}
      fields={fields}
      scope={scope}
      scoped={false}
      defaultOrdering="name"
      toForm={(r) => ({
        name: r.name,
        phone: r.phone,
        email: r.email,
        license_number: r.license_number,
        status: r.status,
        joined_at: r.joined_at ?? '',
        notes: r.notes,
      })}
      emptyHint="Add your first driver to start recording earnings against them."
      header={<DriverPerformanceStrip scope={scope} />}
      minWidth={980}
    />
  )
}

function DriverPerformanceStrip({ scope }: { scope: ScopeState }) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const performance = useApi(() => api.driverPerformance(query), [JSON.stringify(query)])
  const rows = performance.data?.rows ?? []
  if (rows.length === 0) return null
  const top = rows[0]
  const totalIncome = rows.reduce((sum, r) => sum + r.gross_income, 0)
  const totalDays = rows.reduce((sum, r) => sum + r.active_days, 0)

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Drivers with activity" value={fmtNumber(rows.length)} icon={Users} changeText={performance.data?.scope.period.label ?? ''} />
      <MetricCard label="Gross income" value={fmtMoney(totalIncome)} icon={CircleDollarSign} changeText="all listed drivers" />
      <MetricCard label="Active driver-days" value={fmtNumber(totalDays)} icon={FileText} changeText="entries recorded" />
      <MetricCard label="Top earner" value={top.driver} icon={WalletCards} changeText={`${fmtMoney(top.gross_income)} · ${fmtPercent(top.operating_margin_pct)} margin`} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

export function VehiclesPage({ scope, meta }: { scope: ScopeState; meta: Meta | null }) {
  const { driverOptions } = useReferenceData()

  const columns: ColumnSpec<Vehicle>[] = [
    {
      key: 'vehicle',
      label: 'Vehicle',
      render: (r) => <span className="font-semibold">{r.display_name}</span>,
    },
    { key: 'plate', label: 'Plate', render: (r) => <span className="font-mono">{r.plate_number}</span> },
    { key: 'year', label: 'Year', render: (r) => r.year ?? '—' },
    {
      key: 'driver',
      label: 'Assigned driver',
      render: (r) => r.assigned_driver_detail?.name ?? <span className="text-muted-foreground">Unassigned</span>,
    },
    {
      key: 'rent',
      label: 'Monthly rent',
      align: 'right',
      render: (r) => <span className="font-mono">{fmtMoney(r.monthly_rent)}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <StatusPill value={r.status} label={r.status_label} />,
    },
  ]

  const fields: FieldSpec[] = [
    { name: 'make', label: 'Make', required: true },
    { name: 'model', label: 'Model', required: true },
    { name: 'plate_number', label: 'Plate number', required: true },
    { name: 'year', label: 'Year', type: 'number' },
    { name: 'assigned_driver', label: 'Assigned driver', type: 'select', options: driverOptions },
    { name: 'monthly_rent', label: 'Monthly rent', type: 'number', step: '0.01' },
    {
      name: 'status',
      label: 'Status',
      type: 'select',
      options: meta?.vehicle_statuses ?? [],
      required: true,
    },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <ResourcePage<Vehicle>
      resource="vehicles"
      title="Vehicles"
      eyebrow="Workspace / Vehicles"
      description="Fleet registry, driver assignment and rent."
      icon={CarFront}
      columns={columns}
      fields={fields}
      scope={scope}
      scoped={false}
      defaultOrdering="plate_number"
      toForm={(r) => ({
        make: r.make,
        model: r.model,
        plate_number: r.plate_number,
        year: r.year ?? '',
        assigned_driver: r.assigned_driver ?? '',
        monthly_rent: r.monthly_rent ?? '',
        status: r.status,
        notes: r.notes,
      })}
      emptyHint="Register a vehicle so earnings and expenses can be attributed to it."
      header={<VehiclePerformanceStrip scope={scope} />}
      minWidth={920}
    />
  )
}

function VehiclePerformanceStrip({ scope }: { scope: ScopeState }) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const performance = useApi(() => api.vehiclePerformance(query), [JSON.stringify(query)])
  const rows = performance.data?.rows ?? []
  if (rows.length === 0) return null
  const top = rows[0]
  const fuel = rows.reduce((sum, r) => sum + r.fuel, 0)
  const salik = rows.reduce((sum, r) => sum + r.salik, 0)
  const maintenance = rows.reduce((sum, r) => sum + r.maintenance, 0)

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Highest earning vehicle" value={top.vehicle} icon={CarFront} changeText={fmtMoney(top.gross_income)} />
      <MetricCard label="Fuel" value={fmtMoney(fuel)} icon={CircleDollarSign} changeText={performance.data?.scope.period.label ?? ''} />
      <MetricCard label="Salik" value={fmtMoney(salik)} icon={CircleDollarSign} changeText={performance.data?.scope.period.label ?? ''} />
      <MetricCard label="Maintenance" value={fmtMoney(maintenance)} icon={CircleDollarSign} changeText={performance.data?.scope.period.label ?? ''} />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Daily earnings                                                      */
/* ------------------------------------------------------------------ */

export function EarningsPage({ scope, meta }: { scope: ScopeState; meta: Meta | null }) {
  const { driverOptions, vehicleOptions } = useReferenceData()
  const platforms = meta?.platforms ?? []

  const columns: ColumnSpec<Earning>[] = [
    { key: 'date', label: 'Date', render: (r) => <span className="font-medium">{fmtDate(r.date)}</span> },
    { key: 'driver', label: 'Driver', render: (r) => r.driver_name },
    { key: 'vehicle', label: 'Vehicle', render: (r) => <span className="text-muted-foreground">{r.vehicle_name}</span> },
    ...platforms.map<ColumnSpec<Earning>>((platform) => ({
      key: platform.value,
      label: platform.label,
      align: 'right',
      render: (r) => (
        <span className="font-mono text-muted-foreground">
          {fmtMoney((r as any)[platform.value])}
        </span>
      ),
    })),
    {
      key: 'total',
      label: 'Total income',
      align: 'right',
      render: (r) => (
        <span className="font-mono font-semibold text-emerald-600">{fmtMoney(r.total_income)}</span>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusPill value={r.status} /> },
  ]

  const fields: FieldSpec[] = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    { name: 'driver', label: 'Driver', type: 'select', options: driverOptions, required: true },
    { name: 'vehicle', label: 'Vehicle', type: 'select', options: vehicleOptions, required: true },
    ...platforms.map<FieldSpec>((platform) => ({
      name: platform.value,
      label: platform.label,
      type: 'number',
      step: '0.01',
      placeholder: '0.00',
    })),
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <ResourcePage<Earning>
      resource="earnings"
      title="Daily earnings"
      eyebrow="Workspace / Daily earnings"
      description="Every income entry by driver, vehicle and platform. Total income is computed by the database."
      icon={WalletCards}
      columns={columns}
      fields={fields}
      scope={scope}
      defaultOrdering="-date"
      toForm={(r) => ({
        date: r.date,
        driver: r.driver,
        vehicle: r.vehicle,
        ...Object.fromEntries(platforms.map((p) => [p.value, (r as any)[p.value] ?? ''])),
        notes: r.notes,
      })}
      emptyHint="No earnings recorded for this period yet."
      header={<EarningsStrip scope={scope} />}
      minWidth={1080}
    />
  )
}

function EarningsStrip({ scope }: { scope: ScopeState }) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const summary = useApi(() => api.earningsSummary(query), [JSON.stringify(query)])
  const s = summary.data?.summary
  if (!s) return null
  const label = summary.data?.scope?.period?.label ?? ''

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Gross income" value={fmtMoney(s.gross_income)} icon={CircleDollarSign} changeText={label} />
      <MetricCard label="Operating profit" value={fmtMoney(s.operating_profit)} icon={WalletCards} changeText={`${fmtPercent(s.operating_margin_pct)} margin`} />
      <MetricCard label="Recorded entries" value={fmtNumber(s.entries)} icon={FileText} changeText={`${fmtNumber(s.active_days)} active days`} />
      <MetricCard label="Average per entry" value={fmtMoney(s.average_daily_income)} icon={CarFront} changeText="per earning day" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Expenses                                                            */
/* ------------------------------------------------------------------ */

export function ExpensesPage({ scope, meta }: { scope: ScopeState; meta: Meta | null }) {
  const { driverOptions, vehicleOptions } = useReferenceData()

  const columns: ColumnSpec<Expense>[] = [
    { key: 'date', label: 'Date', render: (r) => <span className="font-medium">{fmtDate(r.date)}</span> },
    { key: 'category', label: 'Category', render: (r) => r.category_label },
    { key: 'description', label: 'Description', render: (r) => r.description || '—' },
    { key: 'driver', label: 'Driver', render: (r) => r.driver_name ?? <span className="text-muted-foreground">—</span> },
    { key: 'vehicle', label: 'Vehicle', render: (r) => <span className="text-muted-foreground">{r.vehicle_name ?? '—'}</span> },
    { key: 'method', label: 'Paid by', render: (r) => r.payment_method_label },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (r) => <span className="font-mono font-semibold">{fmtMoney(r.amount)}</span>,
    },
  ]

  const fields: FieldSpec[] = [
    { name: 'date', label: 'Date', type: 'date', required: true },
    {
      name: 'category',
      label: 'Category',
      type: 'select',
      options: meta?.expense_categories ?? [],
      required: true,
    },
    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', required: true },
    {
      name: 'payment_method',
      label: 'Payment method',
      type: 'select',
      options: meta?.payment_methods ?? [],
    },
    { name: 'driver', label: 'Driver', type: 'select', options: driverOptions },
    { name: 'vehicle', label: 'Vehicle', type: 'select', options: vehicleOptions },
    { name: 'description', label: 'Description' },
    { name: 'reference', label: 'Reference' },
  ]

  return (
    <ResourcePage<Expense>
      resource="expenses"
      title="Expenses"
      eyebrow="Workspace / Expenses"
      description="Operating costs by category, driver and vehicle."
      icon={CircleDollarSign}
      columns={columns}
      fields={fields}
      scope={scope}
      defaultOrdering="-date"
      toForm={(r) => ({
        date: r.date,
        category: r.category,
        amount: r.amount ?? '',
        payment_method: r.payment_method,
        driver: r.driver ?? '',
        vehicle: r.vehicle ?? '',
        description: r.description,
        reference: r.reference,
      })}
      emptyHint="No expenses recorded for this period yet."
      header={<ExpensesStrip scope={scope} />}
      minWidth={1040}
    />
  )
}

function ExpensesStrip({ scope }: { scope: ScopeState }) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const summary = useApi<Report>(() => api.expensesSummary(query), [JSON.stringify(query)])
  const kpis = summary.data?.kpis ?? []
  if (kpis.length === 0) return null
  const icons = [CircleDollarSign, FileText, CarFront, WalletCards]

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.slice(0, 4).map((kpi, index) => (
        <MetricCard
          key={kpi.label}
          label={kpi.label}
          value={
            kpi.format === 'percent'
              ? fmtPercent(kpi.value)
              : kpi.format === 'number'
                ? fmtNumber(kpi.value)
                : fmtMoney(kpi.value, summary.data?.currency)
          }
          icon={icons[index] ?? CircleDollarSign}
          changeText={kpi.note ?? summary.data?.scope.period.label ?? ''}
        />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

export function PayrollPage({ scope }: { scope: ScopeState }) {
  const { driverOptions } = useReferenceData()

  const columns: ColumnSpec<Settlement>[] = [
    { key: 'period', label: 'Period', render: (r) => <span className="font-medium">{r.period_label}</span> },
    { key: 'driver', label: 'Driver', render: (r) => r.driver_name },
    { key: 'salary', label: 'Salary', align: 'right', render: (r) => <span className="font-mono">{fmtMoney(r.salary)}</span> },
    { key: 'advance', label: 'Advance', align: 'right', render: (r) => <span className="font-mono text-muted-foreground">{fmtMoney(r.advance)}</span> },
    { key: 'other', label: 'Other deductions', align: 'right', render: (r) => <span className="font-mono text-muted-foreground">{fmtMoney(r.other_deductions)}</span> },
    { key: 'rent', label: 'Rent', align: 'right', render: (r) => <span className="font-mono text-muted-foreground">{fmtMoney(r.rent)}</span> },
    { key: 'paid', label: 'Paid', align: 'right', render: (r) => <span className="font-mono">{fmtMoney(r.paid_amount)}</span> },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: (r) => <span className="font-mono font-semibold text-emerald-600">{fmtMoney(r.balance)}</span>,
    },
  ]

  const fields: FieldSpec[] = [
    { name: 'driver', label: 'Driver', type: 'select', options: driverOptions, required: true },
    {
      name: 'period',
      label: 'Period',
      type: 'date',
      required: true,
      help: 'Use the first day of the settlement month.',
    },
    { name: 'salary', label: 'Salary', type: 'number', step: '0.01', required: true },
    { name: 'advance', label: 'Advance', type: 'number', step: '0.01' },
    { name: 'other_deductions', label: 'Other deductions', type: 'number', step: '0.01' },
    { name: 'rent', label: 'Rent', type: 'number', step: '0.01' },
    { name: 'paid_amount', label: 'Paid amount', type: 'number', step: '0.01' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ]

  return (
    <ResourcePage<Settlement>
      resource="payroll"
      title="Settlements"
      eyebrow="Workspace / Payroll & settlements"
      description="Balance = salary − advance − other deductions − rent − paid. The database computes it."
      icon={FileText}
      columns={columns}
      fields={fields}
      scope={scope}
      defaultOrdering="-period"
      toForm={(r) => ({
        driver: r.driver,
        period: r.period,
        salary: r.salary ?? '',
        advance: r.advance ?? '',
        other_deductions: r.other_deductions ?? '',
        rent: r.rent ?? '',
        paid_amount: r.paid_amount ?? '',
        notes: r.notes,
      })}
      emptyHint="No settlements recorded for this period yet."
      header={<PayrollStrip scope={scope} />}
      minWidth={1080}
    />
  )
}

function PayrollStrip({ scope }: { scope: ScopeState }) {
  const query = useMemo(() => scopeQuery(scope), [scope])
  const summary = useApi<Report>(() => api.payrollSummary(query), [JSON.stringify(query)])
  const kpis = summary.data?.kpis ?? []
  if (kpis.length === 0) return null
  const icons = [WalletCards, CircleDollarSign, FileText, Users]

  return (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.slice(0, 4).map((kpi, index) => (
        <MetricCard
          key={kpi.label}
          label={kpi.label}
          value={
            kpi.format === 'percent'
              ? fmtPercent(kpi.value)
              : kpi.format === 'number'
                ? fmtNumber(kpi.value)
                : fmtMoney(kpi.value, summary.data?.currency)
          }
          icon={icons[index] ?? WalletCards}
          changeText={kpi.note ?? summary.data?.scope.period.label ?? ''}
        />
      ))}
    </div>
  )
}
