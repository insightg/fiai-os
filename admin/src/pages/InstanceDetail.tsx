import { useEffect, useState } from 'react'
import { api } from '../lib/api'

interface Agent {
  domain: string
  name: string
  color: string
  model?: string
  tools: string[]
  prompt: string
  promptPreview?: string
}

export function InstanceDetail({ instanceId, onBack, onEditAgent }: {
  instanceId: string
  onBack: () => void
  onEditAgent: (domain: string) => void
}) {
  const [instance, setInstance] = useState<any>(null)
  const [agents, setAgents] = useState<Agent[]>([])
  const [tab, setTab] = useState<'agents' | 'config' | 'yaml'>('agents')
  const [yamlContent, setYamlContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [plugins, setPlugins] = useState<any[]>([])

  useEffect(() => {
    api.getInstance(instanceId).then(data => {
      setInstance(data)
      setYamlContent(data.rawYaml || '')
    })
    api.getAgents(instanceId).then(setAgents)
    api.getPlugins().then(setPlugins)
  }, [instanceId])

  const saveYaml = async () => {
    setSaving(true)
    try {
      await api.updateInstanceYaml(instanceId, yamlContent)
      alert('Config salvata. Riavvia l\'istanza per applicare.')
    } catch (err: any) { alert('Errore: ' + err.message) }
    setSaving(false)
  }

  const deleteInstance = async () => {
    if (!confirm(`Eliminare l'istanza "${instanceId}"? Questa azione è irreversibile.`)) return
    try { await api.deleteInstance(instanceId); onBack() } catch (err: any) { alert(err.message) }
  }

  if (!instance) return <div className="p-8 text-gray-500">Caricamento...</div>

  const config = instance.config || {}
  const company = config.company || {}

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-white text-sm">← Istanze</button>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold"
          style={{ backgroundColor: company.color || '#607D8B' }}>
          {(company.short_name || instanceId).substring(0, 2).toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold">{company.name || instanceId}</h2>
          <p className="text-gray-500 text-sm font-mono">{instanceId} · {agents.length} agenti · {config.plugins ? Object.keys(config.plugins).length : 0} plugin</p>
        </div>
        <div className="ml-auto flex gap-2">
          <code className="bg-gray-800 text-green-400 px-3 py-1 rounded text-xs">FIAI_INSTANCE={instanceId}</code>
          {instanceId !== 'fiai' && (
            <button onClick={deleteInstance} className="text-red-400 hover:text-red-300 text-xs px-3 py-1 border border-red-800 rounded hover:bg-red-900/30">Elimina</button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {(['agents', 'config', 'yaml'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-red-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
            {t === 'agents' ? `🤖 Agenti (${agents.length})` : t === 'config' ? '⚙️ Configurazione' : '📄 YAML'}
          </button>
        ))}
      </div>

      {/* Agents Tab */}
      {tab === 'agents' && (
        <div className="space-y-3">
          {agents.map(agent => (
            <div key={agent.domain} onClick={() => onEditAgent(agent.domain)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-600 cursor-pointer transition-colors flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs"
                style={{ backgroundColor: agent.color }}>
                {agent.domain.substring(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium text-white">{agent.name}</h4>
                  <span className="text-xs text-gray-500 font-mono">{agent.domain}</span>
                  {agent.model && <span className="text-xs bg-purple-900/40 text-purple-300 px-2 py-0.5 rounded">{agent.model.split('/').pop()}</span>}
                </div>
                <p className="text-xs text-gray-500 truncate mt-0.5">{agent.promptPreview || '—'}</p>
              </div>
              <div className="text-xs text-gray-500">
                {agent.tools?.length || 0} tool
              </div>
            </div>
          ))}

          <button onClick={() => onEditAgent('_new')}
            className="w-full bg-gray-900/50 border border-dashed border-gray-700 rounded-xl p-4 text-gray-500 hover:text-white hover:border-gray-500 text-sm">
            + Aggiungi Agente
          </button>
        </div>
      )}

      {/* Config Tab */}
      {tab === 'config' && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4">🏢 Azienda</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nome</label>
                <div className="bg-gray-800 rounded-lg px-3 py-2 text-sm">{company.name || '—'}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nome Breve</label>
                <div className="bg-gray-800 rounded-lg px-3 py-2 text-sm">{company.short_name || '—'}</div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Colore Brand</label>
                <div className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2">
                  <div className="w-5 h-5 rounded" style={{ backgroundColor: company.color }} />
                  <span className="text-sm font-mono">{company.color}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4">🔌 Plugin Attivi</h3>
            <div className="space-y-2">
              {plugins.map(p => {
                const isActive = config.plugins && p.name in config.plugins
                return (
                  <div key={p.name} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                    <div>
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-xs text-gray-500 ml-2">{p.description}</span>
                      <span className="text-xs text-gray-600 ml-2">{p.toolCount} tools</span>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded ${isActive ? 'bg-green-900/40 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                      {isActive ? 'Attivo' : 'Disattivo'}
                    </span>
                  </div>
                )
              })}
              {plugins.length === 0 && <p className="text-gray-500 text-sm">Nessun plugin disponibile</p>}
            </div>
          </div>
        </div>
      )}

      {/* YAML Tab */}
      {tab === 'yaml' && (
        <div className="space-y-4">
          <textarea value={yamlContent} onChange={e => setYamlContent(e.target.value)}
            className="w-full h-[600px] bg-gray-900 border border-gray-800 rounded-xl p-4 text-sm font-mono text-green-300 focus:border-red-500 focus:outline-none resize-none"
            spellCheck={false} />
          <div className="flex gap-2">
            <button onClick={saveYaml} disabled={saving}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salva Config'}
            </button>
            <span className="text-xs text-gray-500 self-center">Dopo il salvataggio, riavvia l'istanza per applicare le modifiche.</span>
          </div>
        </div>
      )}
    </div>
  )
}
