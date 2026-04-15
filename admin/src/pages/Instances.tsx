import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Instance {
  id: string
  name: string
  short_name: string
  color: string
  agent_count: number
  plugins: string[]
  has_config: boolean
}

export function InstancesPage({ onSelect }: { onSelect: (id: string) => void }) {
  const [instances, setInstances] = useState<Instance[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#607D8B')
  const [template, setTemplate] = useState('fiai')

  const load = async () => {
    setLoading(true)
    try { setInstances(await api.getInstances()) } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const createInstance = async () => {
    if (!newId) return
    try {
      await api.createInstance({ id: newId, company_name: newName || newId, company_color: newColor, template })
      setShowCreate(false)
      setNewId(''); setNewName(''); setNewColor('#607D8B')
      load()
    } catch (err: any) { alert(err.message) }
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold">Istanze</h2>
          <p className="text-gray-500 text-sm mt-1">{instances.length} istanze configurate</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          + Nuova Istanza
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6 space-y-4">
          <h3 className="font-semibold">Crea Nuova Istanza</h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">ID (slug)</label>
              <input value={newId} onChange={e => setNewId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="nome-cliente" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Nome Azienda</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Acme S.R.L." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Colore Brand</label>
              <div className="flex gap-2">
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="h-9 w-12 rounded bg-transparent" />
                <input value={newColor} onChange={e => setNewColor(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Template</label>
              <select value={template} onChange={e => setTemplate(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="fiai">FIAI (13 agenti generici)</option>
                <option value="bernardini">Bernardini (16 agenti reparti)</option>
                <option value="blank">Vuoto</option>
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={createInstance} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm">Crea</button>
            <button onClick={() => setShowCreate(false)} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">Annulla</button>
          </div>
        </div>
      )}

      {/* Instances grid */}
      {loading ? (
        <div className="text-gray-500">Caricamento...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {instances.map(inst => (
            <button key={inst.id} onClick={() => onSelect(inst.id)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-5 text-left hover:border-gray-600 transition-colors group">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: inst.color }}>
                  {inst.short_name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h3 className="font-semibold text-white group-hover:text-red-400 transition-colors">{inst.name}</h3>
                  <p className="text-xs text-gray-500 font-mono">{inst.id}</p>
                </div>
              </div>
              <div className="flex gap-4 text-xs text-gray-400">
                <span>🤖 {inst.agent_count} agenti</span>
                {inst.plugins.length > 0 && <span>🔌 {inst.plugins.join(', ')}</span>}
                <span className={inst.has_config ? 'text-green-500' : 'text-yellow-500'}>
                  {inst.has_config ? '✓ config' : '⚠ no config'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
