/**
 * Shapes returned by the FleetPulse Django API.
 *
 * One asymmetry worth remembering: the model serializers return money as
 * strings (DRF's COERCE_DECIMAL_TO_STRING), while the analytics and report
 * endpoints return money as JSON numbers. `Money` covers both; run every
 * value through `toNumber()` in lib/format before doing arithmetic.
 */

export type Money = string | number | null

export interface Period {
  start: string
  end: string
  label: string
  granularity: string
  days: number
}

export interface Scope {
  period: Period
  driver_id: number | null
  vehicle_id: number | null
  /** Whether cash collections were counted as income in this response. */
  include_cash: boolean
  income_basis: 'with_cash' | 'excluding_cash'
}

export interface Paginated<T> {
  count: number
  page: number
  page_size: number
  total_pages: number
  next: string | null
  previous: string | null
  results: T[]
}

export interface Choice {
  value: string
  label: string
}

export interface ReportDescriptor {
  key: string
  title: string
  description: string
}

export interface Meta {
  currency: string
  platforms: Choice[]
  expense_categories: Choice[]
  payment_methods: Choice[]
  driver_statuses: Choice[]
  vehicle_statuses: Choice[]
  ranges: string[]
  reports: ReportDescriptor[]
  analytics?: string[]
  aliases?: Record<string, string>
  calculations?: Record<string, string>
}

export interface CurrentUser {
  id: number
  username: string
  email: string
  first_name: string
  last_name: string
  is_staff: boolean
  is_superuser: boolean
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export interface VehicleRef {
  id: number
  make: string
  model: string
  plate_number: string
  display_name: string
  status: string
}

export interface Driver {
  id: number
  name: string
  phone: string
  email: string
  license_number: string
  status: string
  status_label: string
  joined_at: string | null
  notes: string
  vehicles: VehicleRef[]
  created_at: string
  updated_at: string
}

export interface Vehicle {
  id: number
  make: string
  model: string
  display_name: string
  plate_number: string
  year: number | null
  status: string
  status_label: string
  assigned_driver: number | null
  assigned_driver_detail: { id: number; name: string; status: string } | null
  monthly_rent: Money
  notes: string
  created_at: string
  updated_at: string
}

export interface Earning {
  id: number
  date: string
  driver: number
  driver_name: string
  vehicle: number
  vehicle_name: string
  vehicle_plate: string
  careem: Money
  uber: Money
  bolt: Money
  yango: Money
  cash: Money
  total_income: Money
  /** `total_income` with cash removed - what counts as income by default. */
  platform_income: Money
  platform_shares: Record<string, number>
  status: string
  notes: string
  source_batch: number | null
  created_at: string
  updated_at: string
}

export interface Expense {
  id: number
  date: string
  driver: number | null
  driver_name: string | null
  vehicle: number | null
  vehicle_name: string | null
  category: string
  category_label: string
  amount: Money
  payment_method: string
  payment_method_label: string
  description: string
  reference: string
  notes: string
  source_batch: number | null
  created_at: string
  updated_at: string
}

export interface Settlement {
  id: number
  driver: number
  driver_name: string
  period: string
  period_label: string
  salary: Money
  advance: Money
  other_deductions: Money
  rent: Money
  paid_amount: Money
  total_deductions: Money
  balance: Money
  formula: string
  notes: string
  created_at: string
  updated_at: string
}

export interface ImportBatch {
  id: number
  filename: string
  status: string
  total_rows: number
  imported_rows: number
  updated_rows: number
  skipped_rows: number
  failed_rows: number
  error_message?: string | null
  created_by_username?: string | null
  created_at: string
}

export interface AuditEntry {
  id: number
  actor_username: string | null
  action: string
  model_name: string
  object_id: string
  object_label: string
  changes: Record<string, unknown> | null
  created_at: string
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export interface Kpi {
  value: number | null
  previous: number | null
  change_pct: number | null
  has_comparison: boolean
}

export interface PlatformSlice {
  platform: string
  label: string
  income: number
  share_pct: number | null
  active_days: number
  average_per_active_day: number | null
  /** Only on the cash slice: whether this money is part of gross income. */
  counted?: boolean
}

export interface CategorySlice {
  category: string
  label: string
  amount: number
  count: number
  share_pct: number | null
  per_active_day?: number | null
  share_of_income_pct?: number | null
}

export interface DayPoint {
  date: string
  weekday: string
  income: number
  /** Cash taken that day, whether or not `income` counts it. */
  cash: number
  expenses: number
  net_operating_result: number
  platforms: Record<string, number>
}

export interface FinancialSummary {
  /** Follows the cash toggle: platform-only by default. */
  gross_income: number
  /** Everything taken, cash included. Reported whichever way the toggle sits. */
  gross_income_with_cash: number
  cash_income: number
  includes_cash: boolean
  operating_expenses: number
  operating_profit: number
  payroll: number
  payroll_paid: number
  payroll_balance: number
  net_result: number
  operating_margin_pct: number | null
  net_margin_pct: number | null
  expense_to_income_pct: number | null
  fuel_to_income_pct: number | null
  maintenance_to_income_pct: number | null
  cash_to_income_pct: number | null
  active_days: number
  entries: number
  average_daily_income: number | null
  expense_per_active_day: number | null
  platforms: PlatformSlice[]
  /** The cash slice, always present - it is excluded from `platforms` when not counted. */
  cash: PlatformSlice
  expense_categories: CategorySlice[]
  net_cash_balance: number
}

export interface Insight {
  key: string
  title: string
  message: string
  tone: 'positive' | 'warning' | 'critical' | 'neutral' | 'info'
  priority: number
  metrics: Record<string, unknown>
}

export interface WaterfallStep {
  key: string
  label: string
  amount: number
  kind: 'total' | 'increase' | 'decrease' | string
}

export interface Dashboard {
  scope: Scope
  comparison_period: Period | null
  has_comparison: boolean
  currency: string
  kpis: Record<string, Kpi>
  summary: FinancialSummary
  best_day: { date: string; weekday: string; income: number } | null
  worst_day: { date: string; weekday: string; income: number } | null
  best_platform: PlatformSlice | null
  coverage: { calendar_days: number; active_days: number; inactive_days: number }
  series: DayPoint[]
  platforms: PlatformSlice[]
  cash: PlatformSlice
  expense_categories: CategorySlice[]
  profitability: {
    steps: WaterfallStep[]
    operating_margin_pct: number | null
    net_margin_pct: number | null
  }
  insights: Insight[]
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export type CellFormat = 'money' | 'percent' | 'number' | 'text' | 'date'

export interface ReportColumn {
  key: string
  label: string
  format: CellFormat
}

export interface ReportKpi {
  label: string
  value: number | null
  format: CellFormat
  note: string | null
}

export interface ReportChart {
  type: string
  title: string
  data: Record<string, any>[]
}

export interface Report {
  key: string
  title: string
  description: string
  scope: Scope
  currency: string
  kpis: ReportKpi[]
  charts: ReportChart[]
  columns: ReportColumn[]
  rows: Record<string, any>[]
  totals: Record<string, number> | null
  row_count: number
  notes?: string | null
}

export interface PerformanceResponse<T> {
  scope: Scope
  rows: T[]
}

export interface DriverPerformanceRow {
  driver_id: number
  driver: string
  status: string
  vehicle: string | null
  vehicle_id: number | null
  gross_income: number
  operating_expenses: number
  operating_profit: number
  payroll: number
  payroll_balance: number
  active_days: number
  entries: number
  average_per_day: number | null
  operating_margin_pct: number | null
  expense_to_income_pct: number | null
}

export interface VehiclePerformanceRow {
  vehicle_id: number
  vehicle: string
  make: string
  model: string
  plate_number: string
  status: string
  assigned_driver: string | null
  assigned_driver_id: number | null
  gross_income: number
  fuel: number
  salik: number
  maintenance: number
  operating_expenses: number
  operating_profit: number
  active_days: number
  income_per_active_day: number | null
  expense_to_income_pct: number | null
  operating_margin_pct: number | null
}

/* ------------------------------------------------------------------ */
/* Import wizard                                                       */
/* ------------------------------------------------------------------ */

export interface ImportIssue {
  row_number: number
  level: 'error' | 'warning'
  column: string
  code: string
  message: string
}

export interface ImportPreviewRow {
  row_number: number
  date: string | null
  driver: string | null
  driver_id: number | null
  vehicle: string | null
  vehicle_id: number | null
  computed_total: Money
  file_total: Money
  total_expenses: Money
  action: string
  valid: boolean
  errors: { column: string; code: string; message: string }[]
  warnings: { column: string; code: string; message: string }[]
  [key: string]: any
}

export interface ImportAnalysis {
  filename: string
  headers: string[]
  detection: {
    columns: { header: string; key: string | null; confident: boolean }[]
    mapping: Record<string, number>
    unmapped_headers: string[]
    missing_required: string[]
    recognised_platforms: string[]
    recognised_expenses: string[]
  }
  summary: {
    total_rows: number
    valid_rows: number
    invalid_rows: number
    rows_to_create: number
    rows_to_update: number
    warning_count: number
    error_count: number
    total_income: Money
    total_expenses: Money
    date_range: { start: string; end: string } | null
  }
  preview: ImportPreviewRow[]
  issues: ImportIssue[]
  can_commit: boolean
}

export interface ImportResult {
  batch_id: number
  filename: string
  created: number
  updated: number
  failed: number
  expenses_created?: number
  status?: string
  [key: string]: any
}

/* ------------------------------------------------------------------ */
/* Cash desk                                                           */
/* ------------------------------------------------------------------ */

/** One party's cash record. Drivers and vehicles share every field but the name. */
interface CashActor {
  cash_income: number
  /** Counted income the same rows produced, which is what the share is measured against. */
  platform_income: number
  cash_days: number
  average_per_cash_day: number | null
  cash_share_pct: number | null
}

export interface CashDriverRow extends CashActor {
  driver_id: number
  driver: string
}

export interface CashVehicleRow extends CashActor {
  vehicle_id: number
  vehicle: string
  plate_number: string
}

export interface CashDay {
  date: string
  weekday: string
  cash: number
}

export interface CashSeriesPoint extends CashDay {
  platform: number
  cumulative_cash: number
  cash_share_pct: number | null
}

/**
 * The Cash page in one response.
 *
 * None of these figures move with the include-cash toggle - the subject here is
 * the cash itself. `includes_cash` only reports whether the rest of the app is
 * currently counting this money as income.
 */
export interface CashDesk {
  currency: string
  scope: Scope
  includes_cash: boolean
  cash_income: number
  platform_income: number
  gross_income_with_cash: number
  cash_share_pct: number | null
  cash_days: number
  average_per_cash_day: number | null
  largest_cash_day: CashDay | null
  series: CashSeriesPoint[]
  by_driver: CashDriverRow[]
  by_vehicle: CashVehicleRow[]
  top_days: CashDay[]
}

