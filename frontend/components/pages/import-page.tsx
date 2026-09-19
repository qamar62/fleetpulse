'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  History,
  Loader2,
  RefreshCw,
  Upload,
  XCircle,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { useAuth } from '@/lib/auth-context'
import {
  CURRENCY_FALLBACK,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtNumber,
} from '@/lib/format'
import {
  Async,
  EmptyState,
  ErrorState,
  Field,
  Panel,
  PageIntro,
  StatusPill,
  inputClass,
} from '@/components/ui/kit'
import type { ImportAnalysis, ImportIssue, ImportResult } from '@/lib/types'

type Stage = 'choose' | 'review' | 'done'

interface Options {
  driver: string
  vehicle: string
  skip_invalid: boolean
  update_existing: boolean
  create_expenses: boolean
}

const DEFAULT_OPTIONS: Options = {
  driver: '',
  vehicle: '',
  skip_invalid: true,
  update_existing: true,
  create_expenses: true,
}

function buildForm(file: File, options: Options): FormData {
  const form = new FormData()
  form.append('file', file)
  if (options.driver) form.append('driver', options.driver)
  if (options.vehicle) form.append('vehicle', options.vehicle)
  form.append('skip_invalid', String(options.skip_invalid))
  form.append('update_existing', String(options.update_existing))
  form.append('create_expenses', String(options.create_expenses))
  return form
}

export function ImportPage() {
  const { meta } = useAuth()
  const currency = meta?.currency ?? CURRENCY_FALLBACK

  const [stage, setStage] = useState<Stage>('choose')
  const [file, setFile] = useState<File | null>(null)
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS)
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState<'analyze' | 'commit' | 'template' | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [dragging, setDragging] = useState(false)
  const [batchNonce, setBatchNonce] = useState(0)
  const fileInput = useRef<HTMLInputElement>(null)

  const drivers = useApi(() => api.drivers({ page_size: 200, ordering: 'name' }), [])
  const vehicles = useApi(() => api.vehicles({ page_size: 200, ordering: 'plate_number' }), [])
  const batches = useApi(
    () => api.importBatches({ page_size: 8, ordering: '-created_at' }),
    [batchNonce],
  )

  const reset = useCallback(() => {
    setStage('choose')
    setFile(null)
    setAnalysis(null)
    setResult(null)
    setError(null)
    setOptions(DEFAULT_OPTIONS)
    if (fileInput.current) fileInput.current.value = ''
  }, [])

  const runAnalyze = useCallback(
    async (target: File, opts: Options) => {
      setBusy('analyze')
      setError(null)
      try {
        const data = await api.importAnalyze(buildForm(target, opts))
        setAnalysis(data)
        setStage('review')
      } catch (caught) {
        setAnalysis(null)
        setError(caught instanceof ApiError ? caught : new ApiError(0, String(caught)))
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const pickFile = useCallback(
    (picked: File | null) => {
      if (!picked) return
      setFile(picked)
      setResult(null)
      void runAnalyze(picked, options)
    },
    [options, runAnalyze],
  )

  const commit = useCallback(async () => {
    if (!file) return
    setBusy('commit')
    setError(null)
    try {
      const data = await api.importCommit(buildForm(file, options))
      setResult(data)
      setStage('done')
      setBatchNonce((n) => n + 1)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, String(caught)))
    } finally {
      setBusy(null)
    }
  }, [file, options])

  const downloadTemplate = useCallback(async () => {
    setBusy('template')
    try {
      await api.importTemplate()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError(0, String(caught)))
    } finally {
      setBusy(null)
    }
  }, [])

  const setOption = <K extends keyof Options>(key: K, value: Options[K]) => {
    const next = { ...options, [key]: value }
    setOptions(next)
    // Driver/vehicle fallbacks change how rows resolve, so re-analyse.
    if ((key === 'driver' || key === 'vehicle') && file) void runAnalyze(file, next)
  }

  return (
    <div>
      <PageIntro
        eyebrow="Data"
        title="Import & export"
        description="Upload a CSV or Excel sheet. Nothing is written until you review the analysis and confirm."
      >
        <button
          onClick={downloadTemplate}
          disabled={busy === 'template'}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
        >
          {busy === 'template' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Download className="size-3.5" />
          )}
          Download template
        </button>
        {stage !== 'choose' && (
          <button
            onClick={reset}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-medium hover:bg-muted"
          >
            <RefreshCw className="size-3.5" />
            Start over
          </button>
        )}
      </PageIntro>

      <div className="mb-5">
        <Steps stage={stage} />
      </div>

      {error && (
        <div className="mb-5">
          <ErrorState error={error} onRetry={file ? () => void runAnalyze(file, options) : undefined} />
        </div>
      )}

      {stage === 'choose' && (
        <Panel
          title="Choose a file"
          description="CSV, XLSX or XLS. Columns are detected automatically — headers do not have to match exactly."
        >
          <div className="p-5">
            <label
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                pickFile(e.dataTransfer.files?.[0] ?? null)
              }}
              className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-14 text-center transition ${
                dragging ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
              }`}
            >
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="hidden"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
              />
              <span className="flex size-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                {busy === 'analyze' ? (
                  <Loader2 className="size-5 animate-spin" />
                ) : (
                  <Upload className="size-5" />
                )}
              </span>
              <span className="text-[13px] font-semibold">
                {busy === 'analyze' ? 'Analysing file…' : 'Drop a file here, or click to browse'}
              </span>
              <span className="max-w-sm text-[11px] text-muted-foreground">
                The file is analysed first and nothing is saved until you confirm on the next step.
              </span>
            </label>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Fallback driver" hint="Used only when the file has no driver column.">
                <select
                  className={inputClass}
                  value={options.driver}
                  onChange={(e) => setOption('driver', e.target.value)}
                >
                  <option value="">Detect from file</option>
                  {(drivers.data?.results ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fallback vehicle" hint="Used only when the file has no vehicle column.">
                <select
                  className={inputClass}
                  value={options.vehicle}
                  onChange={(e) => setOption('vehicle', e.target.value)}
                >
                  <option value="">Detect from file</option>
                  {(vehicles.data?.results ?? []).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.display_name} — {v.plate_number}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        </Panel>
      )}

      {stage === 'review' && analysis && (
        <Review
          analysis={analysis}
          options={options}
          setOption={setOption}
          onCommit={commit}
          committing={busy === 'commit'}
          currency={currency}
        />
      )}

      {stage === 'done' && result && <Result result={result} onAgain={reset} />}

      <div className="mt-6">
        <Panel title="Recent imports" description="Every committed batch is recorded and auditable.">
          <Async query={batches} loadingLabel="Loading import history…">
            {(page) =>
              page.results.length === 0 ? (
                <EmptyState
                  title="No imports yet"
                  description="Batches you commit here will be listed with their row counts."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-[12px]">
                    <thead>
                      <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2.5 font-medium">File</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 text-right font-medium">Rows</th>
                        <th className="px-4 py-2.5 text-right font-medium">Created</th>
                        <th className="px-4 py-2.5 text-right font-medium">Updated</th>
                        <th className="px-4 py-2.5 text-right font-medium">Skipped</th>
                        <th className="px-4 py-2.5 text-right font-medium">Failed</th>
                        <th className="px-4 py-2.5 font-medium">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.results.map((batch) => (
                        <tr key={batch.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                          <td className="px-4 py-2.5">
                            <span className="flex items-center gap-2 font-medium">
                              <FileSpreadsheet className="size-3.5 text-muted-foreground" />
                              {batch.filename}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <StatusPill value={batch.status} />
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtNumber(batch.total_rows)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">
                            {fmtNumber(batch.imported_rows)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{fmtNumber(batch.updated_rows)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                            {fmtNumber(batch.skipped_rows)}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-rose-500">
                            {fmtNumber(batch.failed_rows)}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">{fmtDateTime(batch.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Async>
        </Panel>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Stepper                                                             */
/* ------------------------------------------------------------------ */

function Steps({ stage }: { stage: Stage }) {
  const steps: { key: Stage; label: string }[] = [
    { key: 'choose', label: 'Choose file' },
    { key: 'review', label: 'Review analysis' },
    { key: 'done', label: 'Imported' },
  ]
  const index = steps.findIndex((s) => s.key === stage)

  return (
    <ol className="flex flex-wrap items-center gap-2 text-[11px]">
      {steps.map((step, i) => {
        const state = i < index ? 'done' : i === index ? 'active' : 'todo'
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 font-medium ${
                state === 'active'
                  ? 'border-primary/40 bg-primary/10 text-foreground'
                  : state === 'done'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                    : 'border-border bg-background text-muted-foreground'
              }`}
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full text-[9px] font-semibold ${
                  state === 'todo' ? 'bg-muted text-muted-foreground' : 'bg-foreground/10'
                }`}
              >
                {state === 'done' ? '✓' : i + 1}
              </span>
              {step.label}
            </span>
            {i < steps.length - 1 && <span className="h-px w-5 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

function Review({
  analysis,
  options,
  setOption,
  onCommit,
  committing,
  currency,
}: {
  analysis: ImportAnalysis
  options: Options
  setOption: <K extends keyof Options>(key: K, value: Options[K]) => void
  onCommit: () => void
  committing: boolean
  currency: string
}) {
  const s = analysis.summary
  const d = analysis.detection
  const errors = useMemo(
    () => analysis.issues.filter((i) => i.level === 'error'),
    [analysis.issues],
  )
  const warnings = useMemo(
    () => analysis.issues.filter((i) => i.level === 'warning'),
    [analysis.issues],
  )
  const blocked = !analysis.can_commit || (!options.skip_invalid && s.invalid_rows > 0)

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Rows found" value={fmtNumber(s.total_rows)} />
        <Tile label="Valid rows" value={fmtNumber(s.valid_rows)} tone={s.valid_rows > 0 ? 'good' : undefined} />
        <Tile
          label="Invalid rows"
          value={fmtNumber(s.invalid_rows)}
          tone={s.invalid_rows > 0 ? 'bad' : undefined}
        />
        <Tile
          label="Warnings"
          value={fmtNumber(s.warning_count)}
          tone={s.warning_count > 0 ? 'warn' : undefined}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="New entries" value={fmtNumber(s.rows_to_create)} />
        <Tile label="Existing entries" value={fmtNumber(s.rows_to_update)} />
        <Tile label="Total income in file" value={fmtMoney(s.total_income, currency)} />
        <Tile
          label="Date range"
          value={
            s.date_range ? `${fmtDate(s.date_range.start)} → ${fmtDate(s.date_range.end)}` : 'N/A'
          }
        />
      </div>

      <Panel
        title="Column detection"
        description={`${analysis.filename} · ${analysis.headers.length} columns read from the header row.`}
      >
        <div className="flex flex-wrap gap-2 p-5">
          {d.columns.map((col, i) => (
            <span
              key={`${col.header}-${i}`}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] ${
                col.key
                  ? col.confident
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                  : 'border-border bg-muted/50 text-muted-foreground line-through'
              }`}
              title={col.key ? `Mapped to ${col.key}` : 'Not recognised — this column is ignored'}
            >
              {col.header}
              {col.key ? <span className="ml-1.5 opacity-70">→ {col.key}</span> : null}
            </span>
          ))}
        </div>
        {d.missing_required.length > 0 && (
          <div className="border-t border-border px-5 py-3 text-[11px] text-rose-600">
            Missing required columns: {d.missing_required.join(', ')}
          </div>
        )}
      </Panel>

      <Panel
        title="What will be written"
        description="These options apply when you confirm the import."
      >
        <div className="space-y-1 p-5">
          <Toggle
            checked={options.skip_invalid}
            onChange={(v) => setOption('skip_invalid', v)}
            label="Skip invalid rows"
            hint="Off means the whole import is rejected if any row fails validation."
          />
          <Toggle
            checked={options.update_existing}
            onChange={(v) => setOption('update_existing', v)}
            label="Update existing entries"
            hint="A row matching an existing date + driver + vehicle overwrites it instead of being skipped."
          />
          <Toggle
            checked={options.create_expenses}
            onChange={(v) => setOption('create_expenses', v)}
            label="Create expense records"
            hint={`Fuel, Salik and maintenance columns become expenses (${fmtMoney(s.total_expenses, currency)} in this file).`}
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground">
            {blocked
              ? 'Resolve the errors above, or allow invalid rows to be skipped, before importing.'
              : `${fmtNumber(s.valid_rows)} rows will be written — ${fmtNumber(s.rows_to_create)} new, ${fmtNumber(s.rows_to_update)} updated.`}
          </p>
          <button
            onClick={onCommit}
            disabled={blocked || committing}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {committing ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
            {committing ? 'Importing…' : 'Import these rows'}
          </button>
        </div>
      </Panel>

      <Panel
        title="Row preview"
        description={`First ${analysis.preview.length} rows exactly as they will be interpreted.`}
      >
        {analysis.preview.length === 0 ? (
          <EmptyState title="No rows found in the file" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-4 py-2.5 font-medium">Date</th>
                  <th className="px-4 py-2.5 font-medium">Driver</th>
                  <th className="px-4 py-2.5 font-medium">Vehicle</th>
                  <th className="px-4 py-2.5 text-right font-medium">Income</th>
                  <th className="px-4 py-2.5 text-right font-medium">Expenses</th>
                  <th className="px-4 py-2.5 font-medium">Action</th>
                  <th className="px-4 py-2.5 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {analysis.preview.map((row) => (
                  <tr
                    key={row.row_number}
                    className={`border-b border-border/60 last:border-0 ${
                      row.valid ? 'hover:bg-muted/40' : 'bg-rose-500/[0.04]'
                    }`}
                  >
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{row.row_number}</td>
                    <td className="px-4 py-2.5">{row.date ? fmtDate(row.date) : '—'}</td>
                    <td className="px-4 py-2.5">{row.driver ?? '—'}</td>
                    <td className="px-4 py-2.5">{row.vehicle ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtMoney(row.computed_total, currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtMoney(row.total_expenses, currency)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill value={row.action} />
                    </td>
                    <td className="px-4 py-2.5 text-[11px]">
                      {row.errors.length > 0 ? (
                        <span className="text-rose-600">{row.errors[0].message}</span>
                      ) : row.warnings.length > 0 ? (
                        <span className="text-amber-600">{row.warnings[0].message}</span>
                      ) : (
                        <span className="text-muted-foreground">OK</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {(errors.length > 0 || warnings.length > 0) && (
        <Panel
          title="Issues"
          description={`${errors.length} errors and ${warnings.length} warnings found during analysis.`}
        >
          <IssueList issues={[...errors, ...warnings].slice(0, 100)} />
        </Panel>
      )}
    </div>
  )
}

function IssueList({ issues }: { issues: ImportIssue[] }) {
  return (
    <ul className="divide-y divide-border/60">
      {issues.map((issue, i) => (
        <li key={`${issue.row_number}-${issue.code}-${i}`} className="flex gap-3 px-5 py-3">
          {issue.level === 'error' ? (
            <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" />
          ) : (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
          )}
          <div className="min-w-0">
            <p className="text-[12px]">{issue.message}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Row {issue.row_number}
              {issue.column ? ` · column “${issue.column}”` : ''} · {issue.code}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------------------------------------------ */
/* Result                                                              */
/* ------------------------------------------------------------------ */

function Result({ result, onAgain }: { result: ImportResult; onAgain: () => void }) {
  const failed = result.status === 'failed'
  return (
    <Panel
      title={failed ? 'Import failed' : 'Import complete'}
      description={`Batch #${result.batch_id} · ${result.filename}`}
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          {failed ? (
            <XCircle className="mt-0.5 size-5 shrink-0 text-rose-500" />
          ) : (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" />
          )}
          <p className="text-[13px]">
            {failed
              ? (result.error_message as string) || 'Nothing was written — the batch was rolled back.'
              : `${fmtNumber(result.created)} entries created and ${fmtNumber(result.updated)} updated. Dashboard and reports now include this data.`}
          </p>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Created" value={fmtNumber(result.created)} tone="good" />
          <Tile label="Updated" value={fmtNumber(result.updated)} />
          <Tile label="Skipped" value={fmtNumber((result.skipped as number) ?? 0)} />
          <Tile
            label="Failed"
            value={fmtNumber(result.failed)}
            tone={result.failed > 0 ? 'bad' : undefined}
          />
        </div>

        <button
          onClick={onAgain}
          className="mt-5 flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-medium hover:bg-muted"
        >
          <History className="size-3.5" />
          Import another file
        </button>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/* Bits                                                                */
/* ------------------------------------------------------------------ */

function Tile({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad' | 'warn'
}) {
  const toneText =
    tone === 'good'
      ? 'text-emerald-600'
      : tone === 'bad'
        ? 'text-rose-600'
        : tone === 'warn'
          ? 'text-amber-600'
          : ''
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`mt-1.5 text-[18px] font-semibold tracking-[-0.03em] ${toneText}`}>{value}</p>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-2.5 hover:bg-muted/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-current"
      />
      <span>
        <span className="block text-[12px] font-medium">{label}</span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
