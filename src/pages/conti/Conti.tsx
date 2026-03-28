import { useState, useEffect, useMemo, type FormEvent } from 'react'
import { Plus, Trash2, Wallet, Building, CreditCard, ArrowUpRight, ArrowDownRight, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useContiStore } from '../../store'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select } from '../../components/ui/Form'
import type { Movimento, TipoConto, TipoMovimento, CategoriaMovimento } from '../../types'

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('it-IT')
}

const tipoContoLabels: Record<TipoConto, string> = {
  banca: 'Conto Corrente',
  cassa: 'Cassa',
  carta: 'Carta',
}

const tipoContoIcons: Record<TipoConto, typeof Wallet> = {
  banca: Building,
  cassa: Wallet,
  carta: CreditCard,
}

const tipoMovLabels: Record<TipoMovimento, string> = {
  entrata: 'Entrata',
  uscita: 'Uscita',
  giroconto: 'Giroconto',
}

const categoriaLabels: Record<CategoriaMovimento, string> = {
  fattura_attiva: 'Fattura Attiva',
  fattura_passiva: 'Fattura Passiva',
  stipendio: 'Stipendio',
  tasse: 'Tasse',
  rimborso: 'Rimborso',
  altro: 'Altro',
}

interface ContoForm {
  nome: string
  tipo: TipoConto
  saldo: number
  iban: string
  banca: string
  colore: string
}

const emptyContoForm: ContoForm = {
  nome: '',
  tipo: 'banca',
  saldo: 0,
  iban: '',
  banca: '',
  colore: '#C9A84C',
}

interface MovimentoForm {
  tipo: TipoMovimento
  categoria: CategoriaMovimento
  importo: number
  descrizione: string
  data: string
}

const emptyMovForm: MovimentoForm = {
  tipo: 'entrata',
  categoria: 'altro',
  importo: 0,
  descrizione: '',
  data: new Date().toISOString().split('T')[0],
}

export default function Conti() {
  const profile = useAuthStore((s) => s.profile)
  const {
    conti, movimenti, loading,
    fetchConti, createConto, removeConto,
    fetchMovimentiConto, createMovimento, removeMovimento,
  } = useContiStore()

  const [selectedContoId, setSelectedContoId] = useState<string | null>(null)
  const [contoModalOpen, setContoModalOpen] = useState(false)
  const [movModalOpen, setMovModalOpen] = useState(false)
  const [contoForm, setContoForm] = useState<ContoForm>(emptyContoForm)
  const [movForm, setMovForm] = useState<MovimentoForm>(emptyMovForm)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchConti(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchConti])

  useEffect(() => {
    if (selectedContoId) {
      fetchMovimentiConto(selectedContoId)
    }
  }, [selectedContoId, fetchMovimentiConto])

  const selectedConto = useMemo(
    () => conti.find((c) => c.id === selectedContoId) ?? null,
    [conti, selectedContoId]
  )

  const runningBalance = useMemo(() => {
    if (!selectedConto) return []
    const sorted = [...movimenti].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime())
    let balance = 0
    return sorted.map((m) => {
      if (m.tipo === 'entrata') balance += m.importo
      else if (m.tipo === 'uscita') balance -= m.importo
      return { ...m, saldoParziale: balance }
    }).reverse()
  }, [movimenti, selectedConto])

  const totaleSaldi = useMemo(
    () => conti.reduce((acc, c) => acc + c.saldo, 0),
    [conti]
  )

  const handleCreateConto = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    const created = await createConto({
      azienda_id: profile.azienda_id,
      nome: contoForm.nome,
      tipo: contoForm.tipo,
      saldo: contoForm.saldo,
      iban: contoForm.iban || null,
      banca: contoForm.banca || null,
      colore: contoForm.colore || null,
    })
    if (created) {
      toast.success('Conto creato')
      setContoModalOpen(false)
      setContoForm(emptyContoForm)
    } else {
      toast.error('Errore nella creazione')
    }
  }

  const handleDeleteConto = async (id: string) => {
    if (!confirm('Eliminare questo conto e tutti i movimenti associati?')) return
    await removeConto(id)
    if (selectedContoId === id) setSelectedContoId(null)
    toast.success('Conto eliminato')
  }

  const handleCreateMovimento = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id || !selectedContoId) return
    const created = await createMovimento({
      conto_id: selectedContoId,
      azienda_id: profile.azienda_id,
      tipo: movForm.tipo,
      categoria: movForm.categoria,
      importo: movForm.importo,
      descrizione: movForm.descrizione || null,
      data: movForm.data,
      fattura_id: null,
      fattura_passiva_id: null,
    })
    if (created) {
      toast.success('Movimento registrato')
      setMovModalOpen(false)
      setMovForm(emptyMovForm)
      // Refresh balance
      if (profile.azienda_id) fetchConti(profile.azienda_id)
    } else {
      toast.error('Errore nella registrazione')
    }
  }

  const handleDeleteMovimento = async (id: string) => {
    if (!confirm('Eliminare questo movimento?')) return
    await removeMovimento(id)
    toast.success('Movimento eliminato')
    if (profile?.azienda_id) fetchConti(profile.azienda_id)
  }

  const movColumns: Column<Movimento & { saldoParziale: number }>[] = [
    {
      key: 'data',
      header: 'Data',
      render: (m) => <span className="text-text2">{formatDate(m.data)}</span>,
    },
    {
      key: 'descrizione',
      header: 'Descrizione',
      render: (m) => <span className="truncate max-w-[200px] block">{m.descrizione ?? '-'}</span>,
    },
    {
      key: 'tipo',
      header: 'Tipo',
      render: (m) => (
        <div className="flex items-center gap-1.5">
          {m.tipo === 'entrata' ? (
            <ArrowUpRight size={14} className="text-green" />
          ) : m.tipo === 'uscita' ? (
            <ArrowDownRight size={14} className="text-red" />
          ) : (
            <RefreshCw size={14} className="text-blue" />
          )}
          <Badge color={m.tipo === 'entrata' ? 'green' : m.tipo === 'uscita' ? 'red' : 'blue'}>
            {tipoMovLabels[m.tipo]}
          </Badge>
        </div>
      ),
    },
    {
      key: 'categoria',
      header: 'Categoria',
      render: (m) => <span className="text-text2 text-xs">{categoriaLabels[m.categoria]}</span>,
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (m) => (
        <span className={`font-mono font-medium ${m.tipo === 'entrata' ? 'text-green' : m.tipo === 'uscita' ? 'text-red' : 'text-blue'}`}>
          {m.tipo === 'uscita' ? '-' : '+'}{formatCurrency(m.importo)}
        </span>
      ),
    },
    {
      key: 'saldo',
      header: 'Saldo',
      render: (m) => (
        <span className="font-mono text-text2">{formatCurrency(m.saldoParziale)}</span>
      ),
    },
    {
      key: 'azioni',
      header: '',
      render: (m) => (
        <button
          onClick={(e) => { e.stopPropagation(); handleDeleteMovimento(m.id) }}
          className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-bg3 transition-colors"
          title="Elimina"
        >
          <Trash2 size={14} />
        </button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-text">Conti</h1>
          <p className="text-text3 text-sm mt-1">
            Saldo complessivo: <span className="text-gold font-mono font-bold">{formatCurrency(totaleSaldi)}</span>
          </p>
        </div>
        <Button variant="primary" onClick={() => setContoModalOpen(true)}>
          <Plus size={16} />
          Nuovo Conto
        </Button>
      </div>

      {/* Conti cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading && conti.length === 0 ? (
          <div className="col-span-full flex items-center justify-center py-10">
            <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
          </div>
        ) : conti.length === 0 ? (
          <div className="col-span-full text-center py-10 text-text3">
            Nessun conto configurato. Crea il tuo primo conto.
          </div>
        ) : (
          conti.map((conto) => {
            const Icon = tipoContoIcons[conto.tipo]
            const isSelected = selectedContoId === conto.id
            return (
              <div
                key={conto.id}
                onClick={() => setSelectedContoId(conto.id)}
                className={`bg-bg2 border rounded-xl p-5 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-gold shadow-lg shadow-gold/10'
                    : 'border-border hover:border-border2'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${conto.colore ?? '#C9A84C'}20` }}
                  >
                    <Icon size={20} style={{ color: conto.colore ?? '#C9A84C' }} />
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge color="gray">{tipoContoLabels[conto.tipo]}</Badge>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteConto(conto.id) }}
                      className="p-1 rounded text-text3 hover:text-red transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <p className="text-text font-medium">{conto.nome}</p>
                {conto.iban && (
                  <p className="text-text3 font-mono text-xs mt-1 truncate">{conto.iban}</p>
                )}
                <p className="text-2xl font-bold font-mono text-text mt-3">
                  {formatCurrency(conto.saldo)}
                </p>
              </div>
            )
          })
        )}
      </div>

      {/* Movimenti for selected conto */}
      {selectedConto && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text">
              Movimenti - {selectedConto.nome}
            </h2>
            <Button size="sm" variant="primary" onClick={() => setMovModalOpen(true)}>
              <Plus size={14} />
              Nuovo Movimento
            </Button>
          </div>
          <Table
            columns={movColumns}
            data={runningBalance}
            keyExtractor={(m) => m.id}
            emptyMessage="Nessun movimento registrato per questo conto."
          />
        </div>
      )}

      {/* New Conto Modal */}
      <Modal
        open={contoModalOpen}
        onClose={() => setContoModalOpen(false)}
        title="Nuovo Conto"
        className="max-w-md"
      >
        <form onSubmit={handleCreateConto} className="space-y-4">
          <Input
            label="Nome Conto"
            value={contoForm.nome}
            onChange={(e) => setContoForm((p) => ({ ...p, nome: e.target.value }))}
            required
          />
          <Select
            label="Tipo"
            value={contoForm.tipo}
            onChange={(e) => setContoForm((p) => ({ ...p, tipo: e.target.value as TipoConto }))}
            options={[
              { value: 'banca', label: 'Conto Corrente' },
              { value: 'cassa', label: 'Cassa' },
              { value: 'carta', label: 'Carta' },
            ]}
          />
          <Input
            label="Saldo Iniziale"
            type="number"
            step={0.01}
            value={contoForm.saldo}
            onChange={(e) => setContoForm((p) => ({ ...p, saldo: parseFloat(e.target.value) || 0 }))}
          />
          <Input
            label="IBAN"
            value={contoForm.iban}
            onChange={(e) => setContoForm((p) => ({ ...p, iban: e.target.value }))}
          />
          <Input
            label="Banca"
            value={contoForm.banca}
            onChange={(e) => setContoForm((p) => ({ ...p, banca: e.target.value }))}
          />
          <Input
            label="Colore"
            type="color"
            value={contoForm.colore}
            onChange={(e) => setContoForm((p) => ({ ...p, colore: e.target.value }))}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setContoModalOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Crea Conto</Button>
          </div>
        </form>
      </Modal>

      {/* New Movimento Modal */}
      <Modal
        open={movModalOpen}
        onClose={() => setMovModalOpen(false)}
        title="Nuovo Movimento"
        className="max-w-md"
      >
        <form onSubmit={handleCreateMovimento} className="space-y-4">
          <Select
            label="Tipo"
            value={movForm.tipo}
            onChange={(e) => setMovForm((p) => ({ ...p, tipo: e.target.value as TipoMovimento }))}
            options={[
              { value: 'entrata', label: 'Entrata' },
              { value: 'uscita', label: 'Uscita' },
              { value: 'giroconto', label: 'Giroconto' },
            ]}
          />
          <Select
            label="Categoria"
            value={movForm.categoria}
            onChange={(e) => setMovForm((p) => ({ ...p, categoria: e.target.value as CategoriaMovimento }))}
            options={[
              { value: 'fattura_attiva', label: 'Fattura Attiva' },
              { value: 'fattura_passiva', label: 'Fattura Passiva' },
              { value: 'stipendio', label: 'Stipendio' },
              { value: 'tasse', label: 'Tasse' },
              { value: 'rimborso', label: 'Rimborso' },
              { value: 'altro', label: 'Altro' },
            ]}
          />
          <Input
            label="Importo"
            type="number"
            min={0}
            step={0.01}
            value={movForm.importo}
            onChange={(e) => setMovForm((p) => ({ ...p, importo: parseFloat(e.target.value) || 0 }))}
            required
          />
          <Input
            label="Descrizione"
            value={movForm.descrizione}
            onChange={(e) => setMovForm((p) => ({ ...p, descrizione: e.target.value }))}
          />
          <Input
            label="Data"
            type="date"
            value={movForm.data}
            onChange={(e) => setMovForm((p) => ({ ...p, data: e.target.value }))}
            required
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={() => setMovModalOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Registra</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
