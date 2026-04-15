import { useEffect, useState } from 'react'
import { api } from '../lib/api'

export function AgentEditor({ instanceId, domain, onBack }: {
  instanceId: string
  domain: string
  onBack: () => void
}) {
  const isNew = domain === '_new'
  const [agentDomain, setAgentDomain] = useState(isNew ? '' : domain)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#607D8B')
  const [model, setModel] = useState('')
  const [prompt, setPrompt] = useState('')
  const [tools, setTools] = useState<string[]>(['generic'])
  const [toolInput, setToolInput] = useState('')
  const [availableTools, setAvailableTools] = useState<{ core: string[]; plugins: string[]; wildcards: string[] }>({ core: [], plugins: [], wildcards: [] })
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!isNew)

  useEffect(() => {
    api.getTools().then(setAvailableTools)
    if (!isNew) {
      api.getAgent(instanceId, domain).then(data => {
        setName(data.name || '')
        setColor(data.color || '#607D8B')
        setModel(data.model || '')
        setPrompt(data.prompt || '')
        setTools(data.tools || ['generic'])
        setLoading(false)
      })
    }
  }, [instanceId, domain])

  const addTool = (tool: string) => {
    if (tool && !tools.includes(tool)) setTools([...tools, tool])
    setToolInput('')
  }

  const removeTool = (tool: string) => setTools(tools.filter(t => t !== tool))

  const save = async () => {
    if (!agentDomain || !name) { alert('Domain e nome obbligatori'); return }
    setSaving(true)
    try {
      await api.updateAgent(instanceId, agentDomain, { name, color, model: model || undefined, tools, prompt })
      alert('Agente salvato. Riavvia l\'istanza per applicare.')
      onBack()
    } catch (err: any) { alert('Errore: ' + err.message) }
    setSaving(false)
  }

  const deleteAgent = async () => {
    if (!confirm(`Eliminare l'agente "${name}" (${domain})?`)) return
    try { await api.deleteAgent(instanceId, domain); onBack() } catch (err: any) { alert(err.message) }
  }

  if (loading) return <div className="p-8 text-gray-500">Caricamento...</div>

  const MODELS = [
    '', 'anthropic/claude-haiku-4.5', 'anthropic/claude-sonnet-4', 'anthropic/claude-opus-4',
    'mistralai/mistral-small-3.1-24b-instruct', 'google/gemini-3.1-flash-image-preview',
  ]

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-white text-sm">← Agenti</button>
        <h2 className="text-xl font-bold">{isNew ? 'Nuovo Agente' : `Modifica: ${name}`}</h2>
        {!isNew && (
          <button onClick={deleteAgent} className="ml-auto text-red-400 hover:text-red-300 text-xs px-3 py-1 border border-red-800 rounded">Elimina</button>
        )}
      </div>

      <div className="space-y-6">
        {/* Basic info */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="font-semibold mb-4">Identita'</h3>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Domain (slug)</label>
              <input value={agentDomain} onChange={e => setAgentDomain(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                disabled={!isNew} placeholder="commerciale"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Nome</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Marco — Commerciale"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Colore</label>
              <div className="flex gap-2">
                <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-9 w-12 rounded bg-transparent" />
                <input value={color} onChange={e => setColor(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Modello LLM</label>
              <select value={model} onChange={e => setModel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
                <option value="">Default (Haiku 4.5)</option>
                {MODELS.filter(Boolean).map(m => <option key={m} value={m}>{m.split('/').pop()}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Tools */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h3 className="font-semibold mb-4">🔧 Tool Disponibili</h3>
          <div className="flex flex-wrap gap-2 mb-4">
            {tools.map(tool => (
              <span key={tool} className="bg-gray-800 text-gray-300 px-2 py-1 rounded text-xs flex items-center gap-1 group">
                <code>{tool}</code>
                <button onClick={() => removeTool(tool)} className="text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100">×</button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <select value={toolInput} onChange={e => { addTool(e.target.value); e.target.value = '' }}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white">
              <option value="">+ Aggiungi tool...</option>
              <optgroup label="Wildcards">
                {availableTools.wildcards.map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
              <optgroup label="Core Tools">
                {availableTools.core.filter(t => !tools.includes(t)).map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
              <optgroup label="Plugin Tools">
                {availableTools.plugins.filter(t => !tools.includes(t)).map(t => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            </select>
          </div>
        </div>

        {/* Prompt Editor */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">📝 System Prompt</h3>
            <span className="text-xs text-gray-500">{prompt.length} caratteri</span>
          </div>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            className="w-full h-[400px] bg-gray-800 border border-gray-700 rounded-xl p-4 text-sm font-mono text-gray-300 focus:border-red-500 focus:outline-none resize-none"
            placeholder="Sei l'agente commerciale di {COMPANY_NAME}..."
            spellCheck={false} />
        </div>

        {/* Save */}
        <div className="flex gap-3">
          <button onClick={save} disabled={saving}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? 'Salvando...' : 'Salva Agente'}
          </button>
          <button onClick={onBack} className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm">Annulla</button>
        </div>
      </div>
    </div>
  )
}
