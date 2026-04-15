import { useEffect, useState } from 'react'
import { useAdminStore } from './store'
import { InstancesPage } from './pages/Instances'
import { InstanceDetail } from './pages/InstanceDetail'
import { AgentEditor } from './pages/AgentEditor'
import { LoginPage } from './pages/Login'

type Page =
  | { type: 'instances' }
  | { type: 'instance'; id: string }
  | { type: 'agent'; instanceId: string; domain: string }

export default function App() {
  const { user, loading, checkAuth, logout } = useAdminStore()
  const [page, setPage] = useState<Page>({ type: 'instances' })

  useEffect(() => { checkAuth() }, [])

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><div className="text-red-500 font-bold text-2xl animate-pulse">FIAI OS</div></div>
  if (!user) return <LoginPage />

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold text-red-500">FIAI OS</h1>
          <p className="text-xs text-gray-500">Platform Admin</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          <button onClick={() => setPage({ type: 'instances' })}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${page.type === 'instances' ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}`}>
            <span className="mr-2">🏢</span> Istanze
          </button>
        </nav>

        <div className="p-3 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-300">{user.email}</p>
            </div>
            <button onClick={logout} className="text-xs text-gray-500 hover:text-red-400">Esci</button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {page.type === 'instances' && (
          <InstancesPage onSelect={(id) => setPage({ type: 'instance', id })} />
        )}
        {page.type === 'instance' && (
          <InstanceDetail
            instanceId={page.id}
            onBack={() => setPage({ type: 'instances' })}
            onEditAgent={(domain) => setPage({ type: 'agent', instanceId: page.id, domain })}
          />
        )}
        {page.type === 'agent' && (
          <AgentEditor
            instanceId={page.instanceId}
            domain={page.domain}
            onBack={() => setPage({ type: 'instance', id: page.instanceId })}
          />
        )}
      </main>
    </div>
  )
}
