'use client'

import { useState } from 'react'
import { Activity, LogOut, Server, ShieldCheck, User } from 'lucide-react'

import { api, API_BASE } from '@/lib/api'
import { useApi } from '@/lib/use-api'
import { useAuth } from '@/lib/auth-context'
import { fmtDateTime } from '@/lib/format'
import { Async, EmptyState, Pagination, Panel, PageIntro, StatusPill } from '@/components/ui/kit'

export function SettingsPage() {
  const { user, meta, logout } = useAuth()
  const [page, setPage] = useState(1)

  const health = useApi(() => api.health(), [])
  const audit = useApi(
    () => api.auditLog({ page, page_size: 15, ordering: '-created_at' }),
    [page],
  )

  return (
    <div>
      <PageIntro
        eyebrow="Settings"
        title="Configuration & activity"
        description="What this frontend is connected to, how each figure is calculated, and who changed what."
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Connection" description="Configured by NEXT_PUBLIC_API_URL in .env.local.">
          <dl className="divide-y divide-border/60 text-[12px]">
            <Row label="API base" value={<code className="text-[11px]">{API_BASE}</code>} icon={Server} />
            <Row
              label="Backend status"
              icon={Activity}
              value={
                health.initialLoading ? (
                  <span className="text-muted-foreground">Checking…</span>
                ) : health.error ? (
                  <StatusPill value="unreachable" />
                ) : (
                  <StatusPill value={(health.data as any)?.status ?? 'ok'} />
                )
              }
            />
            <Row label="Currency" value={meta?.currency ?? '—'} icon={ShieldCheck} />
            <Row
              label="Platforms"
              value={(meta?.platforms ?? []).map((p) => p.label).join(', ') || '—'}
              icon={ShieldCheck}
            />
          </dl>
        </Panel>

        <Panel title="Signed in as" description="Session is held as a JWT in this browser only.">
          <dl className="divide-y divide-border/60 text-[12px]">
            <Row label="Username" value={user?.username ?? '—'} icon={User} />
            <Row
              label="Name"
              value={[user?.first_name, user?.last_name].filter(Boolean).join(' ') || '—'}
              icon={User}
            />
            <Row label="Email" value={user?.email || '—'} icon={User} />
            <Row
              label="Role"
              value={user?.is_superuser ? 'Superuser' : user?.is_staff ? 'Staff' : 'Standard user'}
              icon={ShieldCheck}
            />
          </dl>
          <div className="border-t border-border px-5 py-4">
            <button
              onClick={logout}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-[11px] font-medium hover:bg-muted"
            >
              <LogOut className="size-3.5" />
              Sign out
            </button>
          </div>
        </Panel>
      </div>

      {meta?.calculations && (
        <div className="mt-5">
          <Panel
            title="How each figure is calculated"
            description="Served by the backend so the definitions here and in the API can never drift apart."
          >
            <dl className="divide-y divide-border/60">
              {Object.entries(meta.calculations).map(([key, formula]) => (
                <div key={key} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
                  <dt className="w-52 shrink-0 text-[12px] font-medium capitalize">
                    {key.replace(/_/g, ' ')}
                  </dt>
                  <dd className="text-[11px] text-muted-foreground">
                    <code>{String(formula)}</code>
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      )}

      <div className="mt-5">
        <Panel
          title="Audit log"
          description="Every create, update, delete and import recorded by the backend."
        >
          <Async query={audit} loadingLabel="Loading audit log…">
            {(data) =>
              data.results.length === 0 ? (
                <EmptyState
                  title="No recorded activity yet"
                  description="Changes made through the app or the admin will appear here."
                />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-[12px]">
                      <thead>
                        <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">When</th>
                          <th className="px-4 py-2.5 font-medium">Who</th>
                          <th className="px-4 py-2.5 font-medium">Action</th>
                          <th className="px-4 py-2.5 font-medium">Record</th>
                          <th className="px-4 py-2.5 font-medium">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.results.map((entry) => (
                          <tr
                            key={entry.id}
                            className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                          >
                            <td className="px-4 py-2.5 text-muted-foreground">
                              {fmtDateTime(entry.created_at)}
                            </td>
                            <td className="px-4 py-2.5">{entry.actor_username ?? 'system'}</td>
                            <td className="px-4 py-2.5">
                              <StatusPill value={entry.action} />
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="font-medium">{entry.object_label || entry.object_id}</span>
                              <span className="ml-1.5 text-[10px] text-muted-foreground">
                                {entry.model_name}
                              </span>
                            </td>
                            <td className="max-w-[280px] truncate px-4 py-2.5 text-[11px] text-muted-foreground">
                              {entry.changes ? JSON.stringify(entry.changes) : '—'}
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
                    noun="entries"
                  />
                </>
              )
            }
          </Async>
        </Panel>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <dt className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
    </div>
  )
}
