'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

export interface QueryResult<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  /** True only on the first load, so refreshes don't blank the screen. */
  initialLoading: boolean
  reload: () => void
}

/**
 * Minimal data hook: runs `fetcher` whenever `deps` change, keeps the previous
 * data visible during a refetch, and cancels in-flight work on unmount.
 */
export function useApi<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): QueryResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)
  const seen = useRef(false)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)

    fetcher(controller.signal)
      .then((result) => {
        if (!active) return
        setData(result)
        setError(null)
      })
      .catch((caught) => {
        if (!active || caught?.name === 'AbortError') return
        setError(caught instanceof ApiError ? caught : new ApiError(0, String(caught)))
      })
      .finally(() => {
        if (!active) return
        seen.current = true
        setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, error, loading, initialLoading: loading && !seen.current, reload }
}

export interface MutationResult<Args extends unknown[]> {
  run: (...args: Args) => Promise<boolean>
  pending: boolean
  error: ApiError | null
  reset: () => void
}

/** Wraps a write call so forms get pending/error state without repeating try/catch. */
export function useMutation<Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
): MutationResult<Args> {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const run = useCallback(
    async (...args: Args) => {
      setPending(true)
      setError(null)
      try {
        await action(...args)
        return true
      } catch (caught) {
        setError(caught instanceof ApiError ? caught : new ApiError(0, String(caught)))
        return false
      } finally {
        setPending(false)
      }
    },
    [action],
  )

  return { run, pending, error, reset: () => setError(null) }
}

/** Debounce a fast-changing value (search boxes) before it hits the API. */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}
