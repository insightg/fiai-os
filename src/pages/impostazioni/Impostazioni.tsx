import { useState, useEffect, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store'
import { Input, Textarea } from '../../components/ui/Form'
import Button from '../../components/ui/Button'
import toast from 'react-hot-toast'
import type { Azienda } from '../../types'

const emptyAzienda: Omit<Azienda, 'id' | 'created_at' | 'updated_at'> = {
  nome: '',
  piva: '',
  codice_sdi: '',
  pec: '',
  indirizzo: '',
  cap: '',
  citta: '',
  provincia: '',
  email: '',
  telefono: '',
  iban: '',
  banca: '',
  logo_url: '',
}

export default function Impostazioni() {
  const profile = useAuthStore((s) => s.profile)
  const [form, setForm] = useState(emptyAzienda)
  const [loading, setLoading] = useState(false)
  const [aziendaId, setAziendaId] = useState<string | null>(null)

  useEffect(() => {
    if (!profile?.azienda_id) return
    const fetchAzienda = async () => {
      const { data, error } = await supabase
        .from('aziende')
        .select('*')
        .eq('id', profile.azienda_id)
        .single()
      if (error) {
        toast.error('Errore nel caricamento dati azienda')
        return
      }
      if (data) {
        const az = data as Azienda
        setAziendaId(az.id)
        setForm({
          nome: az.nome ?? '',
          piva: az.piva ?? '',
          codice_sdi: az.codice_sdi ?? '',
          pec: az.pec ?? '',
          indirizzo: az.indirizzo ?? '',
          cap: az.cap ?? '',
          citta: az.citta ?? '',
          provincia: az.provincia ?? '',
          email: az.email ?? '',
          telefono: az.telefono ?? '',
          iban: az.iban ?? '',
          banca: az.banca ?? '',
          logo_url: az.logo_url ?? '',
        })
      }
    }
    fetchAzienda()
  }, [profile?.azienda_id])

  const handleChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!aziendaId) return
    setLoading(true)
    const { error } = await supabase
      .from('aziende')
      .update({
        ...form,
        updated_at: new Date().toISOString(),
      })
      .eq('id', aziendaId)
    setLoading(false)
    if (error) {
      toast.error('Errore nel salvataggio')
    } else {
      toast.success('Impostazioni salvate')
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-display font-bold text-text mb-6">Impostazioni Azienda</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text mb-2">Dati Azienda</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Nome Azienda"
              value={form.nome}
              onChange={(e) => handleChange('nome', e.target.value)}
              required
            />
            <Input
              label="Partita IVA"
              value={form.piva}
              onChange={(e) => handleChange('piva', e.target.value)}
              required
            />
            <Input
              label="Codice SDI"
              value={form.codice_sdi ?? ''}
              onChange={(e) => handleChange('codice_sdi', e.target.value)}
            />
            <Input
              label="PEC"
              type="email"
              value={form.pec ?? ''}
              onChange={(e) => handleChange('pec', e.target.value)}
            />
          </div>
        </div>

        <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text mb-2">Indirizzo</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Indirizzo"
              value={form.indirizzo ?? ''}
              onChange={(e) => handleChange('indirizzo', e.target.value)}
              className="md:col-span-2"
            />
            <Input
              label="CAP"
              value={form.cap ?? ''}
              onChange={(e) => handleChange('cap', e.target.value)}
            />
            <Input
              label="Citt\u00e0"
              value={form.citta ?? ''}
              onChange={(e) => handleChange('citta', e.target.value)}
            />
            <Input
              label="Provincia"
              value={form.provincia ?? ''}
              onChange={(e) => handleChange('provincia', e.target.value)}
            />
          </div>
        </div>

        <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text mb-2">Contatti</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              value={form.email ?? ''}
              onChange={(e) => handleChange('email', e.target.value)}
            />
            <Input
              label="Telefono"
              value={form.telefono ?? ''}
              onChange={(e) => handleChange('telefono', e.target.value)}
            />
          </div>
        </div>

        <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text mb-2">Dati Bancari</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="IBAN"
              value={form.iban ?? ''}
              onChange={(e) => handleChange('iban', e.target.value)}
            />
            <Input
              label="Banca"
              value={form.banca ?? ''}
              onChange={(e) => handleChange('banca', e.target.value)}
            />
          </div>
        </div>

        <div className="bg-bg2 border border-border rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold text-text mb-2">Logo</h2>
          <Textarea
            label="URL Logo"
            value={form.logo_url ?? ''}
            onChange={(e) => handleChange('logo_url', e.target.value)}
            placeholder="https://..."
          />
          {form.logo_url && (
            <img
              src={form.logo_url}
              alt="Logo anteprima"
              className="h-16 object-contain rounded border border-border"
            />
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={loading}>
            {loading ? 'Salvataggio...' : 'Salva Impostazioni'}
          </Button>
        </div>
      </form>
    </div>
  )
}
