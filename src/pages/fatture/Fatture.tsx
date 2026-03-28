import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Plus, Download, Trash2, CheckCircle, Search, Filter } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useFattureStore } from '../../store'
import { supabase } from '../../lib/supabase'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import { Select } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import { generateInvoicePdfBlob, downloadBlob } from '../../lib/pdf'
import { generateFatturaPA, downloadXml } from '../../lib/xml-sdi'
import type { Fattura, FatturaStato, Azienda, Cliente } from '../../types'

const statoColors: Record<FatturaStato, 'gray' | 'blue' | 'gold' | 'green' | 'red' | 'amber' | 'purple'> = {
  bozza: 'gray',
  emessa: 'blue',
  inviata_sdi: 'gold',
  pagata: 'green',
  scaduta: 'red',
  stornata: 'purple',
}

const statoLabels: Record<FatturaStato, string> = {
  bozza: 'Bozza',
  emessa: 'Emessa',
  inviata_sdi: 'Inviata SDI',
  pagata: 'Pagata',
  scaduta: 'Scaduta',
  stornata: 'Stornata',
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(n)
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('it-IT')
}

function isOverdue(fattura: Fattura): boolean {
  if (fattura.stato === 'pagata' || fattura.stato === 'stornata') return false
  if (!fattura.scadenza) return false
  return new Date(fattura.scadenza) < new Date()
}

export default function Fatture() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { fatture, loading, fetch, update, remove } = useFattureStore()
  const [search, setSearch] = useState('')
  const [filterStato, setFilterStato] = useState<string>('tutti')
  const [azienda, setAzienda] = useState<Azienda | null>(null)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetch(profile.azienda_id)
      supabase
        .from('aziende')
        .select('*')
        .eq('id', profile.azienda_id)
        .single()
        .then(({ data }) => {
          if (data) setAzienda(data as Azienda)
        })
    }
  }, [profile?.azienda_id, fetch])

  const filtered = useMemo(() => {
    let result = fatture
    if (filterStato !== 'tutti') {
      result = result.filter((f) => f.stato === filterStato)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (f) =>
          f.numero.toLowerCase().includes(q) ||
          (f.cliente?.nome ?? '').toLowerCase().includes(q) ||
          (f.cliente?.ragione_sociale ?? '').toLowerCase().includes(q)
      )
    }
    return result
  }, [fatture, filterStato, search])

  const stats = useMemo(() => {
    const totale = fatture.reduce((acc, f) => acc + f.totale, 0)
    const pagate = fatture.filter((f) => f.stato === 'pagata').reduce((acc, f) => acc + f.totale, 0)
    const scadute = fatture.filter((f) => isOverdue(f)).length
    const inAttesa = fatture.filter((f) => f.stato !== 'pagata' && f.stato !== 'stornata').reduce((acc, f) => acc + f.totale, 0)
    return { totale, pagate, scadute, inAttesa }
  }, [fatture])

  const handleDownloadPdf = async (fattura: Fattura) => {
    if (!azienda || !fattura.cliente) {
      toast.error('Dati azienda o cliente mancanti')
      return
    }
    try {
      const full = await useFattureStore.getState().fetchOne(fattura.id)
      if (!full) {
        toast.error('Errore nel caricamento fattura')
        return
      }
      const blob = await generateInvoicePdfBlob(full, full.righe ?? [], azienda, full.cliente as Cliente)
      downloadBlob(blob, `Fattura_${fattura.numero}.pdf`)
      toast.success('PDF scaricato')
    } catch {
      toast.error('Errore nella generazione PDF')
    }
  }

  const handleDownloadXml = async (fattura: Fattura) => {
    if (!azienda || !fattura.cliente) {
      toast.error('Dati azienda o cliente mancanti')
      return
    }
    try {
      const full = await useFattureStore.getState().fetchOne(fattura.id)
      if (!full) {
        toast.error('Errore nel caricamento fattura')
        return
      }
      const xml = generateFatturaPA(full, full.righe ?? [], azienda, full.cliente as Cliente)
      downloadXml(xml, `IT${azienda.piva}_${fattura.numero}.xml`)
      toast.success('XML SDI scaricato')
    } catch {
      toast.error('Errore nella generazione XML')
    }
  }

  const handleMarkPagata = async (fattura: Fattura) => {
    await update(fattura.id, { stato: 'pagata', pagata_il: new Date().toISOString().split('T')[0] })
    toast.success('Fattura segnata come pagata')
  }

  const handleDelete = async (fattura: Fattura) => {
    if (!confirm(`Eliminare la fattura ${fattura.numero}?`)) return
    await remove(fattura.id)
    toast.success('Fattura eliminata')
  }

  const columns: Column<Fattura>[] = [
    {
      key: 'numero',
      header: 'Numero',
      render: (f) => (
        <span className={isOverdue(f) ? 'text-red font-semibold' : 'font-medium'}>
          {f.numero}
        </span>
      ),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      render: (f) => {
        const nome = f.cliente?.tipo === 'azienda' && f.cliente.ragione_sociale
          ? f.cliente.ragione_sociale
          : `${f.cliente?.nome ?? ''} ${f.cliente?.cognome ?? ''}`.trim()
        return <span className={isOverdue(f) ? 'text-red' : ''}>{nome || '-'}</span>
      },
    },
    {
      key: 'oggetto',
      header: 'Oggetto',
      render: (f) => (
        <span className={`truncate max-w-[200px] block ${isOverdue(f) ? 'text-red' : 'text-text2'}`}>
          {f.oggetto ?? '-'}
        </span>
      ),
    },
    {
      key: 'importo',
      header: 'Importo',
      render: (f) => (
        <span className={`font-mono font-medium ${isOverdue(f) ? 'text-red' : ''}`}>
          {formatCurrency(f.totale)}
        </span>
      ),
    },
    {
      key: 'iva',
      header: 'IVA',
      render: (f) => (
        <span className={`font-mono text-text2 ${isOverdue(f) ? 'text-red' : ''}`}>
          {formatCurrency(f.iva)}
        </span>
      ),
    },
    {
      key: 'data',
      header: 'Data',
      render: (f) => <span className={isOverdue(f) ? 'text-red' : 'text-text2'}>{formatDate(f.data)}</span>,
    },
    {
      key: 'scadenza',
      header: 'Scadenza',
      render: (f) => (
        <span className={isOverdue(f) ? 'text-red font-semibold' : 'text-text2'}>
          {formatDate(f.scadenza)}
        </span>
      ),
    },
    {
      key: 'stato',
      header: 'Stato',
      render: (f) => <Badge color={statoColors[f.stato]}>{statoLabels[f.stato]}</Badge>,
    },
    {
      key: 'azioni',
      header: '',
      render: (f) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); navigate(`/fatture/${f.id}/edit`) }}
            className="p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-bg3 transition-colors"
            title="Modifica"
          >
            <FileText size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownloadPdf(f) }}
            className="p-1.5 rounded-lg text-text3 hover:text-blue hover:bg-bg3 transition-colors"
            title="Scarica PDF"
          >
            <Download size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDownloadXml(f) }}
            className="p-1.5 rounded-lg text-text3 hover:text-amber hover:bg-bg3 transition-colors"
            title="Scarica XML SDI"
          >
            <FileText size={15} />
          </button>
          {f.stato !== 'pagata' && f.stato !== 'stornata' && (
            <button
              onClick={(e) => { e.stopPropagation(); handleMarkPagata(f) }}
              className="p-1.5 rounded-lg text-text3 hover:text-green hover:bg-bg3 transition-colors"
              title="Segna come Pagata"
            >
              <CheckCircle size={15} />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(f) }}
            className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-bg3 transition-colors"
            title="Elimina"
          >
            <Trash2 size={15} />
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold text-text">Fatture</h1>
        <Button variant="primary" onClick={() => navigate('/fatture/nuova')}>
          <Plus size={16} />
          Nuova Fattura
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={FileText} label="Totale Fatturato" value={formatCurrency(stats.totale)} />
        <StatCard icon={CheckCircle} label="Incassato" value={formatCurrency(stats.pagate)} />
        <StatCard icon={FileText} label="In Attesa" value={formatCurrency(stats.inAttesa)} />
        <StatCard icon={FileText} label="Scadute" value={String(stats.scadute)} />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-sm">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              type="text"
              placeholder="Cerca per numero o cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-bg3 border border-border text-text text-sm placeholder:text-text3 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-text3" />
          <Select
            value={filterStato}
            onChange={(e) => setFilterStato(e.target.value)}
            options={[
              { value: 'tutti', label: 'Tutti gli stati' },
              { value: 'bozza', label: 'Bozza' },
              { value: 'emessa', label: 'Emessa' },
              { value: 'inviata_sdi', label: 'Inviata SDI' },
              { value: 'pagata', label: 'Pagata' },
              { value: 'scaduta', label: 'Scaduta' },
              { value: 'stornata', label: 'Stornata' },
            ]}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-gold font-display text-lg animate-pulse">Caricamento...</div>
        </div>
      ) : (
        <Table
          columns={columns}
          data={filtered}
          keyExtractor={(f) => f.id}
          emptyMessage="Nessuna fattura trovata."
          onRowClick={(f) => navigate(`/fatture/${f.id}/edit`)}
        />
      )}
    </div>
  )
}
