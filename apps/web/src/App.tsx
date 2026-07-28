import { Route, Routes } from 'react-router-dom'

// Screens land in the next task — this scaffold proves routing + build.
export function App() {
  return (
    <Routes>
      <Route path="*" element={<main><h1>NIMblink</h1></main>} />
    </Routes>
  )
}
