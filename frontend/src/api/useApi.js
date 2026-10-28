import { useCallback, useEffect, useState } from 'react'

// Minimal data-fetch hook: runs `fn` on mount and whenever `deps` change, tracks loading/error,
// and exposes `reload` for actions to re-pull fresh data after a mutation.
export function useApi(fn, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    fn()
      .then((d) => setData(d))
      .catch((e) => setError(e.message || 'Something went wrong'))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, error, loading, reload, setData }
}
