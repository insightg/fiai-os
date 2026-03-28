import { useState, useCallback, useRef, type DragEvent, type ChangeEvent } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Form'
import { uploadFatturaPassiva } from '../../lib/upload'
import type { Fornitore, InvoiceRecognitionResult } from '../../types'

interface UploadFatturaModalProps {
  open: boolean
  onClose: () => void
  fornitori: Fornitore[]
  onSave: (data: any) => Promise<void>
}

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
const ACCEPTED_EXT = '.pdf,.png,.jpg,.jpeg'

type Step = 'upload' | 'loading' | 'review'

export default function UploadFatturaModal({ open, onClose, fornitori, onSave }: UploadFatturaModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [dragOver, setDragOver] = useState(false)
  const [saving, setSaving] = useState(false)
  const [fileUrl, setFileUrl] = useState<string | null>(null)

  const [form, setForm] = useState({
    fornitore_id: '',
    numero: '',
    data: '',
    scadenza: '',
    imponibile: 0,
    iva: 0,
    totale: 0,
    note: '',
  })

  const reset = () => {
    setStep('upload')
    setDragOver(false)
    setSaving(false)
    setFileUrl(null)
    setForm({
      fornitore_id: '',
      numero: '',
      data: '',
      scadenza: '',
      imponibile: 0,
      iva: 0,
      totale: 0,
      note: '',
    })
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const matchFornitore = useCallback(
    (recognized: InvoiceRecognitionResult): string => {
      // Try matching by PIVA first
      if (recognized.fornitore_piva) {
        const byPiva = fornitori.find(
          (f) => f.piva && f.piva.toLowerCase() === recognized.fornitore_piva!.toLowerCase()
        )
        if (byPiva) return byPiva.id
      }
      // Fallback: match by ragione_sociale (case-insensitive includes)
      if (recognized.fornitore_ragione_sociale) {
        const needle = recognized.fornitore_ragione_sociale.toLowerCase()
        const byName = fornitori.find(
          (f) => f.ragione_sociale.toLowerCase().includes(needle) || needle.includes(f.ragione_sociale.toLowerCase())
        )
        if (byName) return byName.id
      }
      return ''
    },
    [fornitori]
  )

  const processFile = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      toast.error('Formato non supportato. Usa PDF, PNG o JPG.')
      return
    }

    setStep('loading')
    try {
      const result = await uploadFatturaPassiva(file)
      const recognized = result.recognizedData as InvoiceRecognitionResult | undefined
      const url = (result.file_url as string) || null

      setFileUrl(url)

      if (recognized) {
        const fornitoreId = matchFornitore(recognized)
        setForm({
          fornitore_id: fornitoreId,
          numero: recognized.numero_fattura || '',
          data: recognized.data || '',
          scadenza: recognized.scadenza || '',
          imponibile: recognized.imponibile || 0,
          iva: recognized.iva || 0,
          totale: recognized.totale || 0,
          note: '',
        })
      }

      setStep('review')
    } catch (err: any) {
      toast.error(err.message || 'Errore durante il caricamento')
      setStep('upload')
    }
  }

  const onDragOver = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const onDragLeave = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const onFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
  }

  const handleSave = async () => {
    if (!form.fornitore_id) {
      toast.error('Seleziona un fornitore')
      return
    }
    if (!form.numero) {
      toast.error('Inserisci il numero fattura')
      return
    }

    setSaving(true)
    try {
      await onSave({
        fornitore_id: form.fornitore_id,
        numero: form.numero,
        data: form.data,
        scadenza: form.scadenza || null,
        stato: 'da_pagare',
        imponibile: form.imponibile,
        iva: form.iva,
        totale: form.totale,
        note: form.note || null,
        file_url: fileUrl,
      })
      toast.success('Fattura passiva creata')
      handleClose()
    } catch {
      toast.error('Errore nel salvataggio')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upload Fattura" className="max-w-lg">
      {step === 'upload' && (
        <div
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex flex-col items-center justify-center gap-4 p-10 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            dragOver
              ? 'border-gold bg-gold/5'
              : 'border-border hover:border-gold/50 hover:bg-bg3'
          }`}
        >
          <div className="w-14 h-14 rounded-full bg-bg3 flex items-center justify-center">
            <Upload size={24} className="text-gold" />
          </div>
          <div className="text-center">
            <p className="text-text font-medium">Trascina qui il file della fattura</p>
            <p className="text-text3 text-sm mt-1">oppure clicca per selezionare</p>
          </div>
          <p className="text-text3 text-xs">PDF, PNG, JPG</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXT}
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      )}

      {step === 'loading' && (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <Loader2 size={36} className="text-gold animate-spin" />
          <p className="text-text font-medium">Analisi AI in corso...</p>
          <p className="text-text3 text-sm">Stiamo estraendo i dati dalla fattura</p>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {fileUrl && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-bg3 border border-border">
              <FileText size={16} className="text-gold flex-shrink-0" />
              <span className="text-sm text-text truncate">File caricato con successo</span>
            </div>
          )}

          <Select
            label="Fornitore"
            value={form.fornitore_id}
            onChange={(e) => setForm((p) => ({ ...p, fornitore_id: e.target.value }))}
            options={[
              { value: '', label: 'Seleziona fornitore...' },
              ...fornitori.map((f) => ({ value: f.id, label: f.ragione_sociale })),
            ]}
          />

          <Input
            label="Numero Fattura"
            value={form.numero}
            onChange={(e) => setForm((p) => ({ ...p, numero: e.target.value }))}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Data"
              type="date"
              value={form.data}
              onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
              required
            />
            <Input
              label="Scadenza"
              type="date"
              value={form.scadenza}
              onChange={(e) => setForm((p) => ({ ...p, scadenza: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Imponibile"
              type="number"
              min={0}
              step={0.01}
              value={form.imponibile}
              onChange={(e) => {
                const imponibile = parseFloat(e.target.value) || 0
                const iva = Math.round(imponibile * 0.22 * 100) / 100
                setForm((p) => ({ ...p, imponibile, iva, totale: Math.round((imponibile + iva) * 100) / 100 }))
              }}
            />
            <Input
              label="IVA"
              type="number"
              min={0}
              step={0.01}
              value={form.iva}
              onChange={(e) => {
                const iva = parseFloat(e.target.value) || 0
                setForm((p) => ({ ...p, iva, totale: Math.round((p.imponibile + iva) * 100) / 100 }))
              }}
            />
            <Input
              label="Totale"
              type="number"
              min={0}
              step={0.01}
              value={form.totale}
              onChange={(e) => setForm((p) => ({ ...p, totale: parseFloat(e.target.value) || 0 }))}
            />
          </div>

          <Input
            label="Note"
            value={form.note}
            onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
          />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" onClick={handleClose}>Annulla</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Salvataggio...
                </>
              ) : (
                'Salva Fattura'
              )}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
