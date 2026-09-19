'use client'

import { useState } from 'react'
import { Activity, Loader2, LogIn } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { API_BASE, ApiError } from '@/lib/api'

export function LoginScreen() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await login(username, password)
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.status === 401
            ? 'That username and password combination was not accepted.'
            : caught.message
          : 'Sign in failed.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#172127] px-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-[#55cfa4] text-[#10201f]">
            <Activity className="size-6" strokeWidth={2.5} />
          </div>
          <div>
            <div className="text-[17px] font-bold tracking-[0.18em] text-white">
              FLEET<span className="text-[#55cfa4]">PULSE</span>
            </div>
            <div className="mt-0.5 text-[9px] uppercase tracking-[0.16em] text-slate-500">
              Finance intelligence
            </div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur"
        >
          <h1 className="text-[18px] font-semibold text-white">Sign in</h1>
          <p className="mt-1 text-[11px] text-slate-400">
            Use your Django account to reach the fleet data.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}

          <label className="mt-5 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0f171b] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-white outline-none focus:border-[#55cfa4]/60"
            />
          </label>

          <label className="mt-4 block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0f171b] px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-white outline-none focus:border-[#55cfa4]/60"
            />
          </label>

          <button
            type="submit"
            disabled={pending}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#55cfa4] py-2.5 text-[12px] font-semibold text-[#10201f] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
            {pending ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="mt-5 border-t border-white/10 pt-4 text-[10px] leading-relaxed text-slate-500">
            API: <span className="font-mono text-slate-400">{API_BASE}</span>
            <br />
            Set <span className="font-mono">NEXT_PUBLIC_API_URL</span> in{' '}
            <span className="font-mono">.env.local</span> to point somewhere else.
          </p>
        </form>
      </div>
    </div>
  )
}
