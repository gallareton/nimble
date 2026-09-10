import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from './AppContext'
import { AppShell } from './components/AppShell'
import { Approval } from './screens/Approval'
import { Charge } from './screens/Charge'
import { History } from './screens/History'
import { Home } from './screens/Home'
import { NewRemoteCharge } from './screens/NewRemoteCharge'
import { Pay } from './screens/Pay'
import { Products } from './screens/Products'
import { RemoteCharge } from './screens/RemoteCharge'
import { Receipt } from './screens/Receipt'
import { Refund } from './screens/Refund'
import { Settings } from './screens/Settings'
import { Shift } from './screens/Shift'
import type { ReactNode } from 'react'

function RequireAuth({ children }: { children: ReactNode }) {
  const { token } = useApp()
  return token ? <>{children}</> : <Navigate to="/" replace />
}

export function App() {
  return (
    <AppProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Home />} />
          <Route path="/pay" element={<RequireAuth><Pay /></RequireAuth>} />
          <Route path="/charge" element={<RequireAuth><Charge /></RequireAuth>} />
          <Route path="/charge/remote" element={<RequireAuth><NewRemoteCharge /></RequireAuth>} />
          <Route path="/products" element={<RequireAuth><Products /></RequireAuth>} />
          {/* Unauthenticated: the payer following a shared link may have no
              account yet — same reasoning as the API route it calls. Login
              happens inline, on accept, not as a route gate. */}
          <Route path="/r/:id" element={<RemoteCharge />} />
          <Route path="/session/:id" element={<RequireAuth><Approval /></RequireAuth>} />
          <Route path="/receipt/:id" element={<RequireAuth><Receipt /></RequireAuth>} />
          <Route path="/history" element={<RequireAuth><History /></RequireAuth>} />
          <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
          <Route path="/shift" element={<RequireAuth><Shift /></RequireAuth>} />
          <Route path="/refund/:chargeId" element={<RequireAuth><Refund /></RequireAuth>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppProvider>
  )
}
