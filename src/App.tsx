import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store'
import Layout from './components/layout/Layout'
import Login from './pages/auth/Login'
import Impostazioni from './pages/impostazioni/Impostazioni'
import Progetti from './pages/progetti/Progetti'
import ProgettoDetail from './pages/progetti/ProgettoDetail'
import Dashboard from './pages/dashboard/Dashboard'
import Report from './pages/report/Report'
import Leads from './pages/leads/Leads'
import Clienti from './pages/clienti/Clienti'
import Preventivi from './pages/preventivi/Preventivi'
import Ordini from './pages/ordini/Ordini'
import Fatture from './pages/fatture/Fatture'
import FatturaEditor from './pages/fatture/FatturaEditor'
import FatturaPDF from './pages/fatture/FatturaPDF'
import Ricorrenti from './pages/fatture/Ricorrenti'
import FatturePassive from './pages/fatture-passive/FatturePassive'
import Fornitori from './pages/fornitori/Fornitori'
import Conti from './pages/conti/Conti'
import Rimborsi from './pages/rimborsi/Rimborsi'
import CostoSimulatore from './pages/hr/CostoSimulatore'
import AnnunciLavoro from './pages/hr/AnnunciLavoro'
import Candidati from './pages/hr/Candidati'
import Documenti from './pages/documenti/Documenti'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const loading = useAuthStore((s) => s.loading)
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gold font-display text-2xl font-bold animate-pulse">FIAI</div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}

function GuestGuard({ children }: { children: React.ReactNode }) {
  const session = useAuthStore((s) => s.session)
  const loading = useAuthStore((s) => s.loading)

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gold font-display text-2xl font-bold animate-pulse">FIAI</div>
      </div>
    )
  }

  if (session) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

export default function App() {
  const initialize = useAuthStore((s) => s.initialize)

  useEffect(() => {
    initialize()
  }, [initialize])

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestGuard>
            <Login />
          </GuestGuard>
        }
      />

      <Route
        path="/"
        element={
          <AuthGuard>
            <Layout />
          </AuthGuard>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="leads" element={<Leads />} />
        <Route path="clienti" element={<Clienti />} />
        <Route path="preventivi" element={<Preventivi />} />
        <Route path="ordini" element={<Ordini />} />
        <Route path="progetti" element={<Progetti />} />
        <Route path="progetti/:id" element={<ProgettoDetail />} />
        <Route path="fatture" element={<Fatture />} />
        <Route path="fatture/nuova" element={<FatturaEditor />} />
        <Route path="fatture/:id/edit" element={<FatturaEditor />} />
        <Route path="fatture/:id/pdf" element={<FatturaPDF />} />
        <Route path="fatture/ricorrenti" element={<Ricorrenti />} />
        <Route path="fatture-passive" element={<FatturePassive />} />
        <Route path="fornitori" element={<Fornitori />} />
        <Route path="conti" element={<Conti />} />
        <Route path="rimborsi" element={<Rimborsi />} />
        <Route path="hr/simulatore-costo" element={<CostoSimulatore />} />
        <Route path="hr/annunci" element={<AnnunciLavoro />} />
        <Route path="hr/candidati" element={<Candidati />} />
        <Route path="documenti" element={<Documenti />} />
        <Route path="report" element={<Report />} />
        <Route path="impostazioni" element={<Impostazioni />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
