import { useState, useEffect } from 'react'
import { LayoutGrid, DollarSign, Target, FolderOpen, Users, FileText } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import {
  useAuthStore,
  useClientiStore,
  useFattureStore,
  useLeadsStore,
  useProgettiStore,
} from '../../store'

function formatEuro(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
}

export default function PulsePanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('dashboard')
  const profile = useAuthStore((s) => s.profile)
  const { clienti, fetch: fetchClienti } = useClientiStore()
  const { fatture, fetch: fetchFatture } = useFattureStore()
  const { leads, fetch: fetchLeads } = useLeadsStore()
  const { progetti, fetch: fetchProgetti } = useProgettiStore()

  useEffect(() => {
    if (!profile?.azienda_id) return
    const aid = profile.azienda_id
    fetchClienti(aid)
    fetchFatture(aid)
    fetchLeads(aid)
    fetchProgetti(aid)
  }, [profile?.azienda_id])

  const fatturatoTot = fatture.filter((f) => f.stato === 'pagata').reduce((a, f) => a + f.totale, 0)
  const daIncassare = fatture.filter((f) => ['emessa', 'inviata_sdi', 'scaduta'].includes(f.stato)).reduce((a, f) => a + f.totale, 0)
  const pipelineVal = leads.filter((l) => !['convertito', 'perso'].includes(l.stato)).reduce((a, l) => a + (l.valore_stimato ?? 0), 0)
  const progettiAttivi = progetti.filter((p) => p.stato === 'in_corso').length

  // Recent activity: last 5 items from each domain
  const recentLeads = leads.slice(0, 3)
  const recentFatture = fatture.slice(0, 3)
  const recentProgetti = progetti.slice(0, 3)

  return (
    <AgentPanel
      title="Pulse"
      color="#C41E3A"
      tabs={[{ key: 'dashboard', label: 'Dashboard', icon: LayoutGrid }]}
      activeTab={tab}
      onTabChange={setTab}
      onClose={onClose}
    >
      {/* Stat Cards - 2 col grid */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <MiniStat icon={DollarSign} label="Fatturato" value={formatEuro(fatturatoTot)} color="#22c55e" />
        <MiniStat icon={FileText} label="Da incassare" value={formatEuro(daIncassare)} color="#eab308" />
        <MiniStat icon={Target} label="Pipeline" value={formatEuro(pipelineVal)} color="#3b82f6" />
        <MiniStat icon={FolderOpen} label="Progetti attivi" value={String(progettiAttivi)} color="#f97316" />
      </div>

      {/* Recent Activity */}
      <Section title="Lead recenti" icon={Users}>
        {recentLeads.length === 0 && <EmptyRow />}
        {recentLeads.map((l) => (
          <div key={l.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
            <span className="text-xs text-text truncate">{l.nome} {l.cognome}</span>
            <Badge color={l.stato === 'convertito' ? 'green' : l.stato === 'perso' ? 'red' : 'blue'}>
              {l.stato}
            </Badge>
          </div>
        ))}
      </Section>

      <Section title="Fatture recenti" icon={FileText}>
        {recentFatture.length === 0 && <EmptyRow />}
        {recentFatture.map((f) => (
          <div key={f.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
            <span className="text-xs text-text truncate">#{f.numero}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-text2">{formatEuro(f.totale)}</span>
              <Badge color={f.stato === 'pagata' ? 'green' : f.stato === 'scaduta' ? 'red' : 'blue'}>
                {f.stato}
              </Badge>
            </div>
          </div>
        ))}
      </Section>

      <Section title="Progetti recenti" icon={FolderOpen}>
        {recentProgetti.length === 0 && <EmptyRow />}
        {recentProgetti.map((p) => (
          <div key={p.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
            <span className="text-xs text-text truncate">{p.nome}</span>
            <Badge color={p.stato === 'completato' ? 'green' : p.stato === 'in_corso' ? 'gold' : 'blue'}>
              {p.stato}
            </Badge>
          </div>
        ))}
      </Section>
    </AgentPanel>
  )
}

function MiniStat({ icon: Icon, label, value, color }: { icon: React.ComponentType<any>; label: string; value: string; color: string }) {
  return (
    <div className="bg-bg2 border border-border rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={14} style={{ color }} />
        <span className="text-[10px] text-text3 uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
    </div>
  )
}

function Section({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<any>; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon size={13} className="text-text3" />
        <span className="text-xs font-semibold text-text2">{title}</span>
      </div>
      <div className="bg-bg2 border border-border rounded-lg px-2.5 py-1">
        {children}
      </div>
    </div>
  )
}

function EmptyRow() {
  return <p className="text-xs text-text3 py-2 text-center">Nessun dato</p>
}
