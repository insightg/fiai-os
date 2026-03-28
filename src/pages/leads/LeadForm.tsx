import { useState, useEffect, type FormEvent } from 'react'
import { Input, Select, Textarea } from '../../components/ui/Form'
import Button from '../../components/ui/Button'
import { useLeadsStore, useAuthStore } from '../../store'
import type { Lead, LeadStato } from '../../types'
import toast from 'react-hot-toast'

interface LeadFormProps {
  lead?: Lead | null
  onClose: () => void
}

const STATI_OPTIONS: { value: LeadStato; label: string }[] = [
  { value: 'nuovo', label: 'Nuovo' },
  { value: 'contattato', label: 'Contattato' },
  { value: 'qualificato', label: 'Qualificato' },
  { value: 'proposta', label: 'Proposta' },
  { value: 'convertito', label: 'Convertito' },
  { value: 'perso', label: 'Perso' },
]

const FONTE_OPTIONS = [
  { value: '', label: '-- Seleziona fonte --' },
  { value: 'sito_web', label: 'Sito Web' },
  { value: 'referral', label: 'Referral' },
  { value: 'social', label: 'Social Media' },
  { value: 'evento', label: 'Evento' },
  { value: 'cold_call', label: 'Cold Call' },
  { value: 'altro', label: 'Altro' },
]

export default function LeadForm({ lead, onClose }: LeadFormProps) {
  const profile = useAuthStore((s) => s.profile)
  const createLead = useLeadsStore((s) => s.create)
  const updateLead = useLeadsStore((s) => s.update)
  const loading = useLeadsStore((s) => s.loading)

  const [nome, setNome] = useState(lead?.nome ?? '')
  const [cognome, setCognome] = useState(lead?.cognome ?? '')
  const [email, setEmail] = useState(lead?.email ?? '')
  const [telefono, setTelefono] = useState(lead?.telefono ?? '')
  const [aziendaLead, setAziendaLead] = useState(lead?.azienda_lead ?? '')
  const [fonte, setFonte] = useState(lead?.fonte ?? '')
  const [stato, setStato] = useState<LeadStato>(lead?.stato ?? 'nuovo')
  const [valoreStimato, setValoreStimato] = useState(lead?.valore_stimato?.toString() ?? '')
  const [note, setNote] = useState(lead?.note ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (lead) {
      setNome(lead.nome)
      setCognome(lead.cognome)
      setEmail(lead.email ?? '')
      setTelefono(lead.telefono ?? '')
      setAziendaLead(lead.azienda_lead ?? '')
      setFonte(lead.fonte ?? '')
      setStato(lead.stato)
      setValoreStimato(lead.valore_stimato?.toString() ?? '')
      setNote(lead.note ?? '')
    }
  }, [lead])

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!nome.trim()) errs.nome = 'Il nome è obbligatorio'
    if (!cognome.trim()) errs.cognome = 'Il cognome è obbligatorio'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errs.email = 'Indirizzo email non valido'
    }
    if (valoreStimato && isNaN(Number(valoreStimato))) {
      errs.valoreStimato = 'Il valore deve essere un numero'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!validate() || !profile) return

    const payload = {
      nome: nome.trim(),
      cognome: cognome.trim(),
      email: email.trim() || null,
      telefono: telefono.trim() || null,
      azienda_lead: aziendaLead.trim() || null,
      fonte: fonte || null,
      stato,
      valore_stimato: valoreStimato ? Number(valoreStimato) : null,
      note: note.trim() || null,
    }

    if (lead) {
      await updateLead(lead.id, payload)
      toast.success('Lead aggiornato con successo')
    } else {
      const created = await createLead({
        ...payload,
        azienda_id: profile.azienda_id,
        assegnato_a: profile.id,
      })
      if (created) {
        toast.success('Lead creato con successo')
      } else {
        toast.error('Errore nella creazione del lead')
        return
      }
    }
    onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Nome *"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          error={errors.nome}
          placeholder="Mario"
        />
        <Input
          label="Cognome *"
          value={cognome}
          onChange={(e) => setCognome(e.target.value)}
          error={errors.cognome}
          placeholder="Rossi"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          placeholder="mario@azienda.it"
        />
        <Input
          label="Telefono"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          placeholder="+39 333 1234567"
        />
      </div>

      <Input
        label="Azienda"
        value={aziendaLead}
        onChange={(e) => setAziendaLead(e.target.value)}
        placeholder="Nome azienda del lead"
      />

      <div className="grid grid-cols-2 gap-4">
        <Select
          label="Fonte"
          value={fonte}
          onChange={(e) => setFonte(e.target.value)}
          options={FONTE_OPTIONS}
        />
        <Select
          label="Stato"
          value={stato}
          onChange={(e) => setStato(e.target.value as LeadStato)}
          options={STATI_OPTIONS}
        />
      </div>

      <Input
        label="Valore stimato (EUR)"
        type="number"
        value={valoreStimato}
        onChange={(e) => setValoreStimato(e.target.value)}
        error={errors.valoreStimato}
        placeholder="10000"
        min={0}
        step={0.01}
      />

      <Textarea
        label="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Informazioni aggiuntive sul lead..."
      />

      <div className="flex justify-end gap-3 mt-2">
        <Button type="button" onClick={onClose}>
          Annulla
        </Button>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Salvataggio...' : lead ? 'Aggiorna' : 'Crea Lead'}
        </Button>
      </div>
    </form>
  )
}
