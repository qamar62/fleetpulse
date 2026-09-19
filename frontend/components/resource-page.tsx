'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { Download, Loader2, Pencil, Plus, Search, Trash2, X, type LucideIcon } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { useApi, useDebounced, useMutation } from '@/lib/use-api'
import { scopeQuery, type ScopeState } from '@/lib/scope'
import type { Paginated } from '@/lib/types'
import {
  Async,
  EmptyState,
  Field,
  FormError,
  Pagination,
  Panel,
  inputClass,
} from '@/components/ui/kit'

export interface FieldSpec {
  name: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'month'
  options?: { value: string | number; label: string }[]
  required?: boolean
  step?: string
  placeholder?: string
  /** Hide from the create/edit form but keep it in the table. */
  readOnly?: boolean
  help?: string
}

export interface ColumnSpec<T> {
  key: string
  label: string
  align?: 'left' | 'right'
  render: (row: T) => ReactNode
}

interface ResourcePageProps<T extends { id: number }> {
  resource: string
  title: string
  eyebrow: string
  description: string
  icon: LucideIcon
  columns: ColumnSpec<T>[]
  fields: FieldSpec[]
  scope: ScopeState
  /** Send the period filter to this collection (drivers/vehicles ignore it). */
  scoped?: boolean
  searchable?: boolean
  defaultOrdering?: string
  toForm: (row: T) => Record<string, any>
  emptyHint?: string
  header?: ReactNode
  minWidth?: number
}

export function ResourcePage<T extends { id: number }>({
  resource,
  title,
  eyebrow,
  description,
  icon: Icon,
  columns,
  fields,
  scope,
  scoped = true,
  searchable = true,
  defaultOrdering,
  toForm,
  emptyHint,
  header,
  minWidth = 900,
}: ResourcePageProps<T>) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search)
  const [editing, setEditing] = useState<T | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Record<string, any>>({})
  const [confirmDelete, setConfirmDelete] = useState<T | null>(null)

  const pageSize = 20
  const query = useMemo(() => {
    const base: Record<string, any> = {
      page,
      page_size: pageSize,
      ...(scoped ? scopeQuery(scope) : {}),
    }
    if (debouncedSearch) base.search = debouncedSearch
    if (defaultOrdering) base.ordering = defaultOrdering
    return base
  }, [page, scope, scoped, debouncedSearch, defaultOrdering])

  const list = useApi<Paginated<T>>(
    () => api[resource as 'drivers'](query) as unknown as Promise<Paginated<T>>,
    [JSON.stringify(query)],
  )

  const save = useMutation(async (payload: Record<string, any>, id: number | null) => {
    if (id === null) await api.create(resource, payload)
    else await api.update(resource, id, payload)
  })

  const destroy = useMutation(async (id: number) => {
    await api.remove(resource, id)
  })

  const openCreate = () => {
    setEditing(null)
    setForm(
      Object.fromEntries(
        fields.filter((f) => !f.readOnly).map((f) => [f.name, f.type === 'number' ? '' : '']),
      ),
    )
    save.reset()
    setShowForm(true)
  }

  const openEdit = (row: T) => {
    setEditing(row)
    setForm(toForm(row))
    save.reset()
    setShowForm(true)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const payload: Record<string, any> = {}
    for (const field of fields) {
      if (field.readOnly) continue
      const value = form[field.name]
      if (value === '' || value === undefined) {
        // Only send blanks for fields the user actually cleared on an edit.
        if (editing) payload[field.name] = field.type === 'number' ? null : ''
        continue
      }
      payload[field.name] = value
    }
    const ok = await save.run(payload, editing ? editing.id : null)
    if (ok) {
      setShowForm(false)
      setEditing(null)
      list.reload()
    }
  }

  const remove = async (row: T) => {
    const ok = await destroy.run(row.id)
    if (ok) {
      setConfirmDelete(null)
      list.reload()
    }
  }

  const singular = title.replace(/s$/, '').toLowerCase()
  const formFields = fields.filter((f) => !f.readOnly)

  return (
    <div className="animate-in fade-in duration-300">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">{eyebrow}</p>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#55cfa4]/15 text-[#299b78]">
              <Icon className="size-5" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold tracking-[-0.04em]">{title}</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">{description}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void api.exportCsv(resource, scoped ? scopeQuery(scope) : {})}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5 text-[11px] font-medium"
          >
            <Download className="size-3.5" />
            Export CSV
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg bg-[#1f3337] px-4 py-2.5 text-[11px] font-medium text-white shadow-sm"
          >
            <Plus className="size-3.5" />
            Add {singular}
          </button>
        </div>
      </div>

      {header}

      {showForm && (
        <form
          onSubmit={submit}
          className="mb-5 rounded-xl border border-[#55cfa4]/30 bg-card p-5 shadow-sm"
        >
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h3 className="text-[14px] font-semibold">
                {editing ? `Edit ${singular}` : `Add ${singular}`}
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Saved straight to the Django API.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>

          <FormError error={save.error} />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {formFields.map((field) => (
              <Field key={field.name} label={field.label} error={save.error?.fields[field.name]}>
                {field.type === 'select' ? (
                  <select
                    value={form[field.name] ?? ''}
                    required={field.required}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, [field.name]: e.target.value }))
                    }
                    className={inputClass}
                  >
                    <option value="">—</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'textarea' ? (
                  <textarea
                    value={form[field.name] ?? ''}
                    rows={2}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, [field.name]: e.target.value }))
                    }
                    className={inputClass}
                  />
                ) : (
                  <input
                    type={field.type === 'month' ? 'date' : (field.type ?? 'text')}
                    step={field.step}
                    required={field.required}
                    placeholder={field.placeholder}
                    value={form[field.name] ?? ''}
                    onChange={(e) =>
                      setForm((current) => ({ ...current, [field.name]: e.target.value }))
                    }
                    className={inputClass}
                  />
                )}
                {field.help && (
                  <span className="mt-1 block text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                    {field.help}
                  </span>
                )}
              </Field>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-3 py-2 text-[11px] font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={save.pending}
              className="flex items-center gap-1.5 rounded-lg bg-[#55cfa4] px-4 py-2 text-[11px] font-semibold text-[#10201f] disabled:opacity-60"
            >
              {save.pending && <Loader2 className="size-3.5 animate-spin" />}
              {editing ? 'Save changes' : 'Create record'}
            </button>
          </div>
        </form>
      )}

      <Panel
        title={
          list.data
            ? `${list.data.count.toLocaleString('en-US')} ${title.toLowerCase()}`
            : title
        }
        description="Live records from the FleetPulse API."
        action={
          searchable ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder={`Search ${title.toLowerCase()}…`}
                className="w-40 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
              />
            </div>
          ) : undefined
        }
      >
        <Async
          query={list}
          empty={<EmptyState description={emptyHint} />}
          loadingLabel={`Loading ${title.toLowerCase()}…`}
        >
          {(data) =>
            data.results.length === 0 ? (
              <EmptyState
                title={`No ${title.toLowerCase()} found`}
                description={
                  debouncedSearch
                    ? `Nothing matches “${debouncedSearch}”.`
                    : (emptyHint ?? 'There is nothing recorded for this period yet.')
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left" style={{ minWidth }}>
                    <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <tr>
                        {columns.map((column) => (
                          <th
                            key={column.key}
                            className={`px-5 py-3 font-semibold ${column.align === 'right' ? 'text-right' : ''}`}
                          >
                            {column.label}
                          </th>
                        ))}
                        <th className="px-5 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data.results.map((row) => (
                        <tr key={row.id} className="text-[11px] hover:bg-muted/30">
                          {columns.map((column) => (
                            <td
                              key={column.key}
                              className={`px-5 py-3.5 ${column.align === 'right' ? 'text-right' : ''}`}
                            >
                              {column.render(row)}
                            </td>
                          ))}
                          <td className="px-5 py-3.5">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => openEdit(row)}
                                aria-label="Edit"
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <Pencil className="size-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDelete(row)}
                                aria-label="Delete"
                                className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
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
                  noun={title.toLowerCase()}
                />
              </>
            )
          }
        </Async>
      </Panel>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-lg">
            <h3 className="text-[14px] font-semibold">Delete this {singular}?</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              This removes the record from the database. It cannot be undone from here.
            </p>
            {destroy.error && (
              <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                {destroy.error.message}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-border px-3 py-2 text-[11px] font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => void remove(confirmDelete)}
                disabled={destroy.pending}
                className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-[11px] font-semibold text-white disabled:opacity-60"
              >
                {destroy.pending && <Loader2 className="size-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
