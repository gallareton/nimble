import { useCallback, useMemo, useState } from 'react'
import { Api } from '../api/client'
import { getWallet } from '../wallet'

const TOKEN_KEY = 'nimblink.jwt'
const ADDRESS_KEY = 'nimblink.address'

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY))
  const [address, setAddress] = useState<string | null>(() => localStorage.getItem(ADDRESS_KEY))

  const api = useMemo(
    () => new Api(import.meta.env.VITE_API_URL ?? 'http://localhost:3000', () => localStorage.getItem(TOKEN_KEY),
      () => { // stale JWT: drop it and fall back to the login screen
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(ADDRESS_KEY)
        setToken(null)
        setAddress(null)
      }),
    [],
  )

  const login = useCallback(async () => {
    const wallet = getWallet()
    const res = await api.login(wallet)
    localStorage.setItem(TOKEN_KEY, res.token)
    localStorage.setItem(ADDRESS_KEY, res.address)
    setToken(res.token)
    setAddress(res.address)
    return res
  }, [api])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(ADDRESS_KEY)
    setToken(null)
    setAddress(null)
  }, [])

  return { token, address, login, logout, api, wallet: getWallet() }
}
