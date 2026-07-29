import { useCallback, useMemo, useState } from 'react'
import { Api } from '../api/client'
import { getWallet } from '../wallet'

const TOKEN_KEY = 'nimble.jwt'
const ADDRESS_KEY = 'nimble.address'
const REFRESH_KEY = 'nimble.refresh'

// One-time key migration from the NIMblink era so nobody gets logged out.
for (const [oldKey, newKey] of [
  ['nimblink.jwt', TOKEN_KEY], ['nimblink.address', ADDRESS_KEY], ['nimblink.refresh', REFRESH_KEY],
] as const) {
  const v = localStorage.getItem(oldKey)
  if (v !== null) {
    if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, v)
    localStorage.removeItem(oldKey)
  }
}

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [address, setAddress] = useState<string | null>(() => localStorage.getItem(ADDRESS_KEY))

  const api = useMemo(() => {
    const clear = (a: Api) => {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(ADDRESS_KEY)
      localStorage.removeItem(REFRESH_KEY)
      setToken(null)
      setAddress(null)
      void a
    }
    // Single-flight: concurrent 401s must share one rotation — a second
    // parallel refresh would send the already-consumed token and log us out.
    let refreshing: Promise<boolean> | null = null
    const a: Api = new Api(
      import.meta.env.VITE_API_URL ?? 'http://localhost:3000',
      () => localStorage.getItem(TOKEN_KEY),
      () => {
        refreshing ??= (async () => {
          const rt = localStorage.getItem(REFRESH_KEY)
          if (!rt) { clear(a); return false }
          try {
            const res = await a.refresh(rt)
            localStorage.setItem(TOKEN_KEY, res.token)
            localStorage.setItem(ADDRESS_KEY, res.address)
            localStorage.setItem(REFRESH_KEY, res.refreshToken)
            setToken(res.token)
            setAddress(res.address)
            return true
          } catch {
            clear(a)
            return false
          } finally {
            refreshing = null
          }
        })()
        return refreshing
      },
    )
    return a
  }, [])

  const login = useCallback(async () => {
    const wallet = getWallet()
    const res = await api.login(wallet)
    localStorage.setItem(TOKEN_KEY, res.token)
    localStorage.setItem(ADDRESS_KEY, res.address)
    localStorage.setItem(REFRESH_KEY, res.refreshToken)
    setToken(res.token)
    setAddress(res.address)
    return res
  }, [api])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ADDRESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
    setToken(null)
    setAddress(null)
  }, [])

  return { token, address, login, logout, api, wallet: getWallet() }
}
