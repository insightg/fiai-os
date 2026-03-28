import { useState, useEffect, type FormEvent } from 'react'
import { Input, Select, Textarea } from '../../components/ui/Form'
import Button from '../../components/ui/Button'
import type { Progetto, ProgettoStato, Cliente } from '../../types'

interface ProgettoFormData {
  nome: string
  cliente_id: string
  budget: string
  stato: ProgettoStato
  data_inizio: string
  data_fine_prevista: string
  descrizione: string
  note: string
  ordine_id: string
}

interface ProgettoFormProps {
  progetto?: Progetto | null
  clienti: Cliente[]
  loading: boolean
  onSubmit: (data: Omit<Progetto, 'id' | 'created_at' | 'updated_at' | 'cliente'>) => void
  onCancel: () => void
  aziendaId: string
}

const emptyForm: ProgettoFormData = {
  nome: '',
  cliente_id: '',
  budget: '',
  stato: 'pianificato',
  data_inizio: '',
  data_fine_prevista: '',
  descrizione: '',
  note: '',
  ordine_id: '',
}

const statoOptions: { value: string; label: string }[] = [
  { value: 'pianificato', label: 'Pianificazione' },
  { value: 'in_corso', label: 'In Corso' },
  { value: 'in_pausa', label: 'In Pausa' },
  { value: 'completato', label: 'Completato' },
  { value: 'annullato', label: 'Annullato' },
]

interface FormErrors {
  nome?: string
  cliente_id?: string
  budget?: string
  data_inizio?: string
  data_fine_prevista?: string
}

function validate(form: ProgettoFormData): FormErrors {
  const errors: FormErrors = {}
  if (!form.nome.trim()) {
    errors.nome = 'Il nome del progetto è obbligatorio'
  }
  if (!form.cliente_id) {
    errors.cliente_id = 'Seleziona un cliente'
  }
  if (form.budget && isNaN(Number(form.budget))) {
    errors.budget = 'Il budget deve essere un numero valido'
  }
  if (form.data_inizio && form.data_fine_prevista && form.data_fine_prevista < form.data_inizio) {
    errors.data_fine_prevista = 'La data di scadenza deve essere successiva alla data di inizio'
  }
  return errors
}

export default function ProgettoForm({
  progetto,
  clienti,
  loading,
  onSubmit,
  onCancel,
  aziendaId,
}: ProgettoFormProps) {
  const [form, setForm] = useState<ProgettoFormData>(emptyForm)
  const [errors, setErrors] = useState<FormErrors>({})

  useEffect(() => {
    if (progetto) {
      setForm({
        nome: progetto.nome,
        cliente_id: progetto.cliente_id,
        budget: progetto.budget != null ? String(progetto.budget) : '',
        stato: progetto.stato,
        data_inizio: progetto.data_inizio ?? '',
        data_fine_prevista: progetto.data_fine_prevista ?? '',
        descrizione: progetto.descrizione ?? '',
        note: progetto.note ?? '',
        ordine_id: progetto.ordine_id ?? '',
      })
    }
  }, [progetto])

  const handleChange = (key: keyof ProgettoFormData, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }))
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const validationErrors = validate(form)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    onSubmit({
      azienda_id: aziendaId,
      nome: form.nome.trim(),
      cliente_id: form.cliente_id,
      budget: form.budget ? Number(form.budget) : null,
      stato: form.stato,
      data_inizio: form.data_inizio || null,
      data_fine_prevista: form.data_fine_prevista || null,
      data_fine_effettiva: progetto?.data_fine_effettiva ?? null,
      descrizione: form.descrizione.trim() || null,
      note: form.note.trim() || null,
      ordine_id: form.ordine_id || null,
    })
  }

  const clientiOptions = [
    { value: '', label: '-- Seleziona cliente --' },
    ...clienti.map((c) => ({
      value: c.id,
      label: c.ragione_sociale || `${c.nome}${c.cognome ? ' ' + c.cognome : ''}`,
    })),
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Nome progetto *"
        value={form.nome}
        onChange={(e) => handleChange('nome', e.target.value)}
        error={errors.nome}
        placeholder="Es. Restyling sito web"
      />

      <Select
        label="Cliente *"
        options={clientiOptions}
        value={form.cliente_id}
        onChange={(e) => handleChange('cliente_id', e.target.value)}
        error={errors.cliente_id}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Budget"
          type="number"
          step="0.01"
          min="0"
          value={form.budget}
          onChange={(e) => handleChange('budget', e.target.value)}
          error={errors.budget}
          placeholder="0.00"
        />
        <Select
          label="Stato"
          options={statoOptions}
          value={form.stato}
          onChange={(e) => handleChange('stato', e.target.value as ProgettoStato)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Data inizio"
          type="date"
          value={form.data_inizio}
          onChange={(e) => handleChange('data_inizio', e.target.value)}
          error={errors.data_inizio}
        />
        <Input
          label="Scadenza"
          type="date"
          value={form.data_fine_prevista}
          onChange={(e) => handleChange('data_fine_prevista', e.target.value)}
          error={errors.data_fine_prevista}
        />
      </div>

      <Textarea
        label="Descrizione"
        value={form.descrizione}
        onChange={(e) => handleChange('descrizione', e.target.value)}
        placeholder="Descrizione del progetto..."
      />

      <Textarea
        label="Note"
        value={form.note}
        onChange={(e) => handleChange('note', e.target.value)}
        placeholder="Note aggiuntive..."
      />

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" onClick={onCancel} disabled={loading}>
          Annulla
        </Button>
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? 'Salvataggio...' : progetto ? 'Aggiorna Progetto' : 'Crea Progetto'}
        </Button>
      </div>
    </form>
  )
}
