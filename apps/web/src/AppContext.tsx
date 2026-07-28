import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from './auth/useAuth'
import type { Api } from './api/client'
import type { WalletProvider } from './wallet/types'

interface AppCtx {
  api: Api
  wallet: WalletProvider
  token: string | null
  address: string | null
  login: () => Promise<{ token: string; address: string }>
  logout: () => void
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  return <Ctx.Provider value={auth}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}

// For screens that accept injectable props in tests: no throw outside provider.
export function useAppOptional(): AppCtx | null {
  return useContext(Ctx)
}
