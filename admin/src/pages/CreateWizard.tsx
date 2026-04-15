import { useState, useEffect } from 'react'
import { api } from '../lib/api'

interface WizardData {
  // Step 1: Company
  id: string
  company_name: string
  company_short: string
  company_color: string
  // Step 2: Template
  template: 'fiai' | 'bernardini' | 'blank'
  // Step 3: Agents
  agents: AgentDraft[]
  // Step 4: Deploy
  location: 'local' | 'remote'
  server_ip: string
  ssh_user: string
  url: string
  env_openrouter: string
  env_jwt: string
}

interface AgentDraft {
  domain: string
  name: string
  color: string
  model: string
  tools: string[]
  enabled: boolean
}

const TEMPLATES: Record<string, { label: string; description: string; color: string }> = {
  fiai: { label: 'FIAI Standard', description: '15 agenti generici: Pulse, Commerciale, Produzione, Marketing, Amministrazione, HR, Legale, Documentale, Email, WhatsApp, Pianificazione, IT, Doctor, TTS, General', color: '#C41E3A' },
  bernardini: { label: 'Bernardini (Reparti)', description: '16 agenti per reparti: Direzione, Commerciale, Amm./HR, Contabilita\', Logistica, Officina, Legale/Assicurazioni, Qualita\'/Sicurezza + operativi', color: '#1565C0' },
  blank: { label: 'Vuoto', description: 'Nessun agente preconfigurato. Ideale per iniziare da zero con agenti completamente custom.', color: '#607D8B' },
}

export function CreateWizard({ onComplete, onCancel }: { onComplete: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(1)
  const [data, setData] = useState<WizardData>({
    id: '', company_name: '', company_short: '', company_color: '#607D8B',
    template: 'fiai',
    agents: [],
    location: 'local', server_ip: '', ssh_user: 'root', url: '',
    env_openrouter: '', env_jwt: '',
  })
  const [templateAgents, setTemplateAgents] = useState<AgentDraft[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // Load template agents when template changes
  useEffect(() => {
    if (data.template === 'blank') {
      setTemplateAgents([])
      return
    }
    api.getAgents(data.template).then(agents => {
      setTemplateAgents(agents.map((a: any) => ({
        domain: a.domain, name: a.name, color: a.color,
        model: a.model || '', tools: a.tools || ['generic'], enabled: true,
      })))
    }).catch(() => setTemplateAgents([]))
  }, [data.template])

  // Sync template agents to data
  useEffect(() => {
    setData(d => ({ ...d, agents: templateAgents }))
  }, [templateAgents])

  const updateField = (field: string, value: any) => setData(d => ({ ...d, [field]: value }))

  const toggleAgent = (domain: string) => {
    setData(d => ({
      ...d,
      agents: d.agents.map(a => a.domain === domain ? { ...a, enabled: !a.enabled } : a),
    }))
  }

  const canNext = () => {
    if (step === 1) return data.id && data.company_name
    if (step === 2) return true
    if (step === 3) return data.agents.some(a => a.enabled)
    return true
  }

  const create = async () => {
    setCreating(true)
    setError('')
    try {
      // 1. Create instance
      await api.createInstance({
        id: data.id,
        company_name: data.company_name,
        company_color: data.company_color,
        template: data.template,
      })

      // 2. Update config with customizations
      const config: any = {
        company: { name: data.company_name, short_name: data.company_short || data.id.toUpperCase(), color: data.company_color },
        agents: data.agents.filter(a => a.enabled).map(a => ({
          domain: a.domain, name: a.name, color: a.color,
          ...(a.model ? { model: a.model } : {}),
          prompt: `agents/${a.domain}.md`,
          tools: a.tools,
        })),
        plugins: data.template === 'bernardini' ? { planning: { api_url: 'http://192.168.0.14:8602' } } : {},
      }
      await api.updateInstanceConfig(data.id, config)

      // 3. Register in registry
      await api.updateRegistry(data.id, {
        id: data.id,
        name: data.company_name,
        url: data.url || `https://${data.id}.insightg.eu`,
        location: data.location,
        server_ip: data.server_ip,
        ssh_user: data.ssh_user,
      })

      onComplete()
    } catch (err: any) {
      setError(err.message)
    }
    setCreating(false)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold">Nuovo Cliente</h2>
          <p className="text-gray-500 text-sm mt-1">Step {step} di 4</p>
        </div>
        <button onClick={onCancel} className="text-gray-500 hover:text-white text-sm">Annulla</button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1 mb-8">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-red-500' : 'bg-gray-800'}`} />
        ))}
      </div>

      {/* Step 1: Company Info */}
      {step === 1 && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4 text-lg">🏢 Dati Azienda</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">ID Istanza (slug univoco)</label>
                <input value={data.id} onChange={e => updateField('id', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="acme-srl" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-red-500 focus:outline-none" />
                <p className="text-xs text-gray-600 mt-1">Usato per directory, container Docker, URL</p>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nome Azienda</label>
                <input value={data.company_name} onChange={e => { updateField('company_name', e.target.value); if (!data.company_short) updateField('company_short', e.target.value.split(' ')[0].toUpperCase()) }}
                  placeholder="ACME S.R.L." className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-red-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Nome Breve</label>
                <input value={data.company_short} onChange={e => updateField('company_short', e.target.value)}
                  placeholder="ACME" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-red-500 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Colore Brand</label>
                <div className="flex gap-3 items-center">
                  <input type="color" value={data.company_color} onChange={e => updateField('company_color', e.target.value)} className="h-10 w-14 rounded bg-transparent cursor-pointer" />
                  <input value={data.company_color} onChange={e => updateField('company_color', e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white font-mono focus:border-red-500 focus:outline-none" />
                  <div className="w-10 h-10 rounded-lg" style={{ backgroundColor: data.company_color }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Template */}
      {step === 2 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-lg mb-2">📋 Template Agenti</h3>
          <p className="text-gray-500 text-sm mb-4">Scegli un template di partenza. Potrai personalizzare gli agenti nel passo successivo.</p>

          {Object.entries(TEMPLATES).map(([key, tpl]) => (
            <button key={key} onClick={() => updateField('template', key)}
              className={`w-full text-left bg-gray-900 border rounded-xl p-5 transition-colors ${data.template === key ? 'border-red-500 ring-1 ring-red-500/30' : 'border-gray-800 hover:border-gray-600'}`}>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: tpl.color }} />
                <h4 className="font-semibold text-white">{tpl.label}</h4>
                {data.template === key && <span className="text-red-400 text-xs bg-red-900/30 px-2 py-0.5 rounded">Selezionato</span>}
              </div>
              <p className="text-sm text-gray-400">{tpl.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Step 3: Agents */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-lg">🤖 Agenti</h3>
            <span className="text-xs text-gray-500">{data.agents.filter(a => a.enabled).length} / {data.agents.length} attivi</span>
          </div>
          <p className="text-gray-500 text-sm mb-4">Abilita/disabilita gli agenti per questo cliente. Potrai modificare prompt e tool dal pannello istanza.</p>

          {data.agents.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
              <p>Template vuoto — nessun agente preconfigurato.</p>
              <p className="text-xs mt-2">Potrai aggiungere agenti manualmente dal pannello istanza.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {data.agents.map(agent => (
                <button key={agent.domain} onClick={() => toggleAgent(agent.domain)}
                  className={`flex items-center gap-3 bg-gray-900 border rounded-xl p-4 text-left transition-all ${agent.enabled ? 'border-gray-700 opacity-100' : 'border-gray-800 opacity-40'}`}>
                  <div className="relative">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-xs"
                      style={{ backgroundColor: agent.color }}>
                      {agent.domain.substring(0, 2).toUpperCase()}
                    </div>
                    {agent.enabled && <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full flex items-center justify-center text-[8px] text-white">✓</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-white text-sm truncate">{agent.name}</h4>
                    <p className="text-xs text-gray-500 font-mono">{agent.domain}</p>
                  </div>
                  <span className="text-xs text-gray-600">{agent.tools.length} tool</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step 4: Deploy */}
      {step === 4 && (
        <div className="space-y-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4 text-lg">🚀 Deploy</h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Dove gira questa istanza?</label>
                <div className="flex gap-3">
                  {(['local', 'remote'] as const).map(loc => (
                    <button key={loc} onClick={() => updateField('location', loc)}
                      className={`flex-1 p-3 rounded-lg border text-sm ${data.location === loc ? 'border-red-500 bg-red-900/20 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'}`}>
                      {loc === 'local' ? '💻 Locale (stesso server)' : '🌐 Remoto (server dedicato)'}
                    </button>
                  ))}
                </div>
              </div>

              {data.location === 'remote' && (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">IP Server</label>
                    <input value={data.server_ip} onChange={e => updateField('server_ip', e.target.value)}
                      placeholder="1.2.3.4" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">SSH User</label>
                    <input value={data.ssh_user} onChange={e => updateField('ssh_user', e.target.value)}
                      placeholder="root" className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">URL Pubblico</label>
                    <input value={data.url} onChange={e => updateField('url', e.target.value)}
                      placeholder={`https://${data.id}.example.com`}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white" />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="font-semibold mb-4">📋 Riepilogo</h3>
            <div className="grid grid-cols-2 gap-y-3 text-sm">
              <div className="text-gray-500">Azienda</div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: data.company_color }} />
                {data.company_name}
              </div>
              <div className="text-gray-500">ID Istanza</div>
              <div className="font-mono text-green-400">{data.id}</div>
              <div className="text-gray-500">Template</div>
              <div>{TEMPLATES[data.template]?.label}</div>
              <div className="text-gray-500">Agenti attivi</div>
              <div>{data.agents.filter(a => a.enabled).length}</div>
              <div className="text-gray-500">Location</div>
              <div>{data.location === 'local' ? 'Locale' : `Remoto (${data.server_ip || 'da configurare'})`}</div>
            </div>
          </div>

          {error && <div className="text-red-400 text-sm bg-red-900/20 border border-red-800/30 rounded-lg p-3">{error}</div>}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button onClick={() => step > 1 ? setStep(step - 1) : onCancel()}
          className="px-4 py-2 rounded-lg text-sm bg-gray-800 hover:bg-gray-700 text-gray-300">
          {step === 1 ? 'Annulla' : '← Indietro'}
        </button>

        {step < 4 ? (
          <button onClick={() => setStep(step + 1)} disabled={!canNext()}
            className="px-6 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-700 text-white font-medium disabled:opacity-30 disabled:cursor-not-allowed">
            Avanti →
          </button>
        ) : (
          <button onClick={create} disabled={creating || !canNext()}
            className="px-6 py-2 rounded-lg text-sm bg-green-600 hover:bg-green-700 text-white font-medium disabled:opacity-50">
            {creating ? 'Creazione in corso...' : '✓ Crea Istanza'}
          </button>
        )}
      </div>
    </div>
  )
}
