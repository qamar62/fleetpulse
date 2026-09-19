'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  BarChart3,
  CarFront,
  CircleDollarSign,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Sun,
  TrendingUp,
  Upload,
  Users,
  WalletCards,
  X,
} from 'lucide-react'

import { api } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { useAuth } from '@/lib/auth-context'
import {
  DEFAULT_SCOPE,
  RANGE_OPTIONS,
  currentMonth,
  customRangeIsIncomplete,
  monthBounds,
  monthOptions,
  type ScopeState,
} from '@/lib/scope'
import { initials } from '@/lib/format'

import { LoginScreen } from '@/components/login-screen'
import { DashboardPage } from '@/components/pages/dashboard-page'
import {
  DriversPage,
  EarningsPage,
  ExpensesPage,
  PayrollPage,
  VehiclesPage,
} from '@/components/pages/crud-pages'
import { ReportsPage } from '@/components/pages/reports-page'
import { AnalyticsPage } from '@/components/pages/analytics-page'
import { ImportPage } from '@/components/pages/import-page'
import { SettingsPage } from '@/components/pages/settings-page'

const WORKSPACE_NAV = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Daily Earnings', icon: WalletCards },
  { label: 'Drivers', icon: Users },
  { label: 'Vehicles', icon: CarFront },
  { label: 'Expenses', icon: CircleDollarSign },
  { label: 'Payroll & Settlements', icon: FileText },
  { label: 'Reports', icon: BarChart3 },
  { label: 'Analytics', icon: TrendingUp },
] as const

const MANAGE_NAV = [
  { label: 'Import / Export', icon: Upload },
  { label: 'Settings', icon: Settings },
] as const

/** Pages that read the scope bar; the rest hide it to avoid implying a filter that does nothing. */
const SCOPED_PAGES = new Set<string>([
  'Dashboard',
  'Daily Earnings',
  'Drivers',
  'Vehicles',
  'Expenses',
  'Payroll & Settlements',
  'Reports',
  'Analytics',
])

export function FleetPulseDashboard() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6f8]">
        <div className="flex flex-col items-center gap-3">
          <span className="flex size-10 animate-pulse items-center justify-center rounded-xl bg-[#55cfa4] text-[#10201f]">
            <Activity className="size-5" strokeWidth={2.5} />
          </span>
          <p className="text-[12px] text-muted-foreground">Restoring your session…</p>
        </div>
      </div>
    )
  }

  if (status === 'anonymous') return <LoginScreen />

  return <Workspace />
}

function Workspace() {
  const { user, meta, logout } = useAuth()
  const [activeNav, setActiveNav] = useState('Dashboard')
  const [dark, setDark] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [scope, setScope] = useState<ScopeState>({ ...DEFAULT_SCOPE, month: currentMonth() })

  const drivers = useApi(() => api.drivers({ page_size: 200, ordering: 'name' }), [])
  const vehicles = useApi(() => api.vehicles({ page_size: 200, ordering: 'plate_number' }), [])

  const months = useMemo(() => monthOptions(24), [])
  const today = useMemo(
    () =>
      new Date().toLocaleDateString('en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      }),
    [],
  )

  // Close the drawer whenever the route changes on small screens.
  useEffect(() => setSidebarOpen(false), [activeNav])

  const firstName = user?.first_name || user?.username || 'there'
  const avatar = initials(
    [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || 'FP',
  )

  return (
    <div className={dark ? 'dark min-h-screen bg-background text-foreground' : 'min-h-screen bg-[#f5f6f8] text-foreground'}>
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-white/10 bg-[#172127] text-slate-300 transition-transform lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-[76px] items-center border-b border-white/10 px-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-[#55cfa4] text-[#10201f]">
            <Activity className="size-5" strokeWidth={2.5} />
          </div>
          <div className="ml-3">
            <div className="text-[15px] font-bold tracking-[0.18em] text-white">
              FLEET<span className="text-[#55cfa4]">PULSE</span>
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-slate-500">
              Finance intelligence
            </div>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden" aria-label="Close navigation">
            <X className="size-4" />
          </button>
        </div>

        <nav className="px-3 pt-6">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Workspace
          </p>
          {WORKSPACE_NAV.map(({ label, icon: Icon }) => (
            <NavButton
              key={label}
              label={label}
              Icon={Icon}
              active={activeNav === label}
              onClick={() => setActiveNav(label)}
              badge={label === 'Reports' ? meta?.reports?.length : undefined}
            />
          ))}
        </nav>

        <nav className="mt-5 px-3">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Manage
          </p>
          {MANAGE_NAV.map(({ label, icon: Icon }) => (
            <NavButton
              key={label}
              label={label}
              Icon={Icon}
              active={activeNav === label}
              onClick={() => setActiveNav(label)}
            />
          ))}
        </nav>

        <div className="mt-auto p-4">
          <div className="flex items-center gap-3 border-t border-white/10 pt-4">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#d6b594] text-[11px] font-bold text-[#463529]">
              {avatar}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold text-white">
                {[user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username}
              </p>
              <p className="truncate text-[10px] text-slate-500">
                {user?.is_superuser ? 'Administrator' : user?.is_staff ? 'Staff' : 'User'}
              </p>
            </div>
            <button
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
              className="ml-auto rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-white"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {sidebarOpen && (
        <button
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <main className="min-h-screen lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-border/70 bg-background/90 px-4 backdrop-blur-md sm:px-7">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden" aria-label="Open navigation">
              <Menu className="size-5" />
            </button>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground">{today}</p>
              <h1 className="mt-0.5 text-[19px] font-semibold tracking-tight">Welcome back, {firstName}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDark(!dark)}
              className="rounded-lg border border-border p-2 text-muted-foreground hover:bg-muted"
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
            <div className="ml-1 hidden size-8 items-center justify-center rounded-full bg-[#d6b594] text-[11px] font-bold text-[#463529] sm:flex">
              {avatar}
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-7 lg:px-9">
          {SCOPED_PAGES.has(activeNav) && (
            <ScopeBar
              scope={scope}
              onChange={setScope}
              months={months}
              drivers={(drivers.data?.results ?? []).map((d) => ({ id: d.id, label: d.name }))}
              vehicles={(vehicles.data?.results ?? []).map((v) => ({
                id: v.id,
                label: `${v.display_name} — ${v.plate_number}`,
              }))}
            />
          )}

          <Route activeNav={activeNav} scope={scope} meta={meta} onNavigate={setActiveNav} />
        </div>
      </main>
    </div>
  )
}

function Route({
  activeNav,
  scope,
  meta,
  onNavigate,
}: {
  activeNav: string
  scope: ScopeState
  meta: ReturnType<typeof useAuth>['meta']
  onNavigate: (label: string) => void
}) {
  switch (activeNav) {
    case 'Daily Earnings':
      return <EarningsPage scope={scope} meta={meta} />
    case 'Drivers':
      return <DriversPage scope={scope} meta={meta} />
    case 'Vehicles':
      return <VehiclesPage scope={scope} meta={meta} />
    case 'Expenses':
      return <ExpensesPage scope={scope} meta={meta} />
    case 'Payroll & Settlements':
      return <PayrollPage scope={scope} />
    case 'Reports':
      return <ReportsPage scope={scope} />
    case 'Analytics':
      return <AnalyticsPage scope={scope} />
    case 'Import / Export':
      return <ImportPage />
    case 'Settings':
      return <SettingsPage />
    default:
      return <DashboardPage scope={scope} onNavigate={onNavigate} />
  }
}

function NavButton({
  label,
  Icon,
  active,
  onClick,
  badge,
}: {
  label: string
  Icon: React.ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[12px] font-medium transition ${
        active ? 'bg-white/10 text-white shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <Icon className={`size-4 ${active ? 'text-[#55cfa4]' : ''}`} />
      {label}
      {badge ? (
        <span className="ml-auto rounded-full bg-[#55cfa4]/15 px-1.5 py-0.5 text-[9px] text-[#55cfa4]">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* Scope bar — one period + filter selection shared by every page      */
/* ------------------------------------------------------------------ */

/** Switching to Custom pre-fills the month already on screen, so the range is
 *  usable on the first click instead of showing an empty form. */
function selectRange(scope: ScopeState, range: string): ScopeState {
  if (range !== 'custom') return { ...scope, range }
  if (scope.start && scope.end) return { ...scope, range }
  const bounds = monthBounds(scope.month || currentMonth())
  return { ...scope, range, start: bounds.start, end: bounds.end }
}

function fmtDay(iso: string): string {
  if (!iso) return ''
  const parsed = new Date(`${iso}T00:00:00`)
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function ScopeBar({
  scope,
  onChange,
  months,
  drivers,
  vehicles,
}: {
  scope: ScopeState
  onChange: (scope: ScopeState) => void
  months: { value: string; label: string }[]
  drivers: { id: number; label: string }[]
  vehicles: { id: number; label: string }[]
}) {
  const selectClass =
    'rounded-lg border border-border bg-card px-3 py-2 text-[11px] font-medium shadow-sm outline-none focus:ring-2 focus:ring-[#55cfa4]/40'

  const incomplete = customRangeIsIncomplete(scope)
  const customLabel =
    scope.range === 'custom' && !incomplete
      ? `${fmtDay(scope.start)} – ${fmtDay(scope.end)}`
      : ''

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
        {RANGE_OPTIONS.map((option) => (
          <button
            key={option.value}
            onClick={() => onChange(selectRange(scope, option.value))}
            className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition ${
              scope.range === option.value
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {scope.range === 'month' && (
        <select
          value={scope.month}
          onChange={(e) => onChange({ ...scope, month: e.target.value })}
          className={selectClass}
          aria-label="Month"
        >
          {months.map((month) => (
            <option key={month.value} value={month.value}>
              {month.label}
            </option>
          ))}
        </select>
      )}

      {scope.range === 'custom' && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            From
            <input
              type="date"
              value={scope.start}
              max={scope.end || undefined}
              onChange={(e) => onChange({ ...scope, start: e.target.value })}
              className={selectClass}
              aria-label="Range start"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
            To
            <input
              type="date"
              value={scope.end}
              min={scope.start || undefined}
              onChange={(e) => onChange({ ...scope, end: e.target.value })}
              className={selectClass}
              aria-label="Range end"
            />
          </label>
          {incomplete ? (
            <span className="text-[10px] font-medium text-amber-600">
              {scope.start && scope.end
                ? 'The start date is after the end date.'
                : 'Pick both dates to apply the range.'}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground">{customLabel}</span>
          )}
        </div>
      )}

      <select
        value={scope.driver ?? ''}
        onChange={(e) => onChange({ ...scope, driver: e.target.value ? Number(e.target.value) : null })}
        className={selectClass}
        aria-label="Driver filter"
      >
        <option value="">All drivers</option>
        {drivers.map((driver) => (
          <option key={driver.id} value={driver.id}>
            {driver.label}
          </option>
        ))}
      </select>

      <select
        value={scope.vehicle ?? ''}
        onChange={(e) => onChange({ ...scope, vehicle: e.target.value ? Number(e.target.value) : null })}
        className={selectClass}
        aria-label="Vehicle filter"
      >
        <option value="">All vehicles</option>
        {vehicles.map((vehicle) => (
          <option key={vehicle.id} value={vehicle.id}>
            {vehicle.label}
          </option>
        ))}
      </select>

      {(scope.driver || scope.vehicle || scope.range !== 'month') && (
        <button
          onClick={() => onChange({ ...DEFAULT_SCOPE, month: scope.month || currentMonth() })}
          className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-medium text-muted-foreground hover:bg-muted"
        >
          Reset
        </button>
      )}
    </div>
  )
}
