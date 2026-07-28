import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './AppContext'
import { Approval } from './screens/Approval'
import { Charge } from './screens/Charge'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { Pay } from './screens/Pay'
import { Receipt } from './screens/Receipt'
import { Settings } from './screens/Settings'
import type { ReactNode } from 'react'

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useApp()
  return token ? <>{children}</> : <Navigate to="/" replace />
}

export function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pay" element={<RequireAuth><Pay /></RequireAuth>} />
        <Route path="/charge" element={<RequireAuth><Charge /></RequireAuth>} />
        <Route path="/session/:id" element={<RequireAuth><Approval /></RequireAuth>} />
        <Route path="/receipt/:id" element={<RequireAuth><Receipt /></RequireAuth>} />
        <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  )
}
