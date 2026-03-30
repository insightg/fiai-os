import { useState, useEffect, useMemo, useRef, type FormEvent } from 'react'
import { FileText, Scale, Search, ExternalLink, Plus, Trash2, Upload } from 'lucide-react'
import AgentPanel from './AgentPanel'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Modal from '../ui/Modal'
import { Input, Select, Textarea } from '../ui/Form'
import { useAuthStore, useDocumentiStore } from '../../store'
import type { DocumentoCategoria, Documento } from '../../types'
import { uploadDocumento } from '../../lib/upload'
import toast from 'react-hot-toast'

const categoriaColors: Record<string, 'blue' | 'green' | 'gold' | 'red' | 'gray'> = {
  contratti: 'green',
  normative: 'red',
  atti: 'gold',
  legale: 'blue',
  altro: 'gray',
  pubblicita: 'gray',
  documentazione_tecnica: 'gray',
}

const CATEGORIA_OPTIONS: { value: DocumentoCategoria; label: string }[] = [
  { value: 'contratti', label: 'Contratti' },
  { value: 'normative', label: 'Normative' },
  { value: 'atti', label: 'Atti' },
  { value: 'legale', label: 'Legale' },
  { value: 'pubblicita', label: 'Pubblicita' },
  { value: 'documentazione_tecnica', label: 'Doc. Tecnica' },
  { value: 'amministrazione', label: 'Amministrazione' },
  { value: 'hr', label: 'HR' },
  { value: 'altro', label: 'Altro' },
]

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatSize(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const defaultDocForm = {
  nome: '',
  categoria: 'contratti' as DocumentoCategoria,
  descrizione: '',
  tags: '',
}

export default function LegalPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState('contratti')
  const [search, setSearch] = useState('')
  const profile = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const { documenti, fetch: fetchDocumenti, create: createDocumento, update: updateDocumento, remove: removeDocumento } = useDocumentiStore()

  // Document CRUD
  const [editDoc, setEditDoc] = useState<Documento | null>(null)
  const [docFormOpen, setDocFormOpen] = useState(false)
  const [docForm, setDocForm] = useState({ ...defaultDocForm })
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!profile?.azienda_id) return
    fetchDocumenti(profile.azienda_id)
  }, [profile?.azienda_id])

  const contratti = useMemo(() => {
    const docs = documenti.filter((d) => d.categoria === 'contratti')
    if (!search.trim()) return docs
    const q = search.toLowerCase()
    return docs.filter((d) => d.nome.toLowerCase().includes(q))
  }, [documenti, search])

  const normative = useMemo(() => {
    const docs = documenti.filter((d) => d.categoria === 'normative' || d.categoria === 'atti' || d.categoria === 'legale')
    if (!search.trim()) return docs
    const q = search.toLowerCase()
    return docs.filter((d) => d.nome.toLowerCase().includes(q))
  }, [documenti, search])

  const currentDocs = tab === 'contratti' ? contratti : normative

  // CRUD handlers
  const openCreateDoc = () => {
    setEditDoc(null)
    setDocForm({
      ...defaultDocForm,
      categoria: tab === 'contratti' ? 'contratti' : 'normative',
    })
    setDocFormOpen(true)
  }
  const openEditDoc = (item: Documento) => {
    setEditDoc(item)
    setDocForm({
      nome: item.nome,
      categoria: item.categoria,
      descrizione: item.descrizione ?? '',
      tags: (item.tags ?? []).join(', '),
    })
    setDocFormOpen(true)
  }
  const handleSaveDoc = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) return
    if (!docForm.nome.trim()) { toast.error('Nome obbligatorio'); return }
    const tagsArray = docForm.tags.trim()
      ? docForm.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : null
    if (editDoc) {
      await updateDocumento(editDoc.id, {
        nome: docForm.nome.trim(),
        categoria: docForm.categoria,
        descrizione: docForm.descrizione.trim() || null,
        tags: tagsArray,
      })
      toast.success('Documento aggiornato')
    } else {
      await createDocumento({
        nome: docForm.nome.trim(),
        categoria: docForm.categoria,
        descrizione: docForm.descrizione.trim() || null,
        tags: tagsArray,
        azienda_id: profile.azienda_id,
        tipo_file: 'unknown',
        file_url: '',
        file_size: null,
        contenuto_testo: null,
        uploaded_by: user?.id ?? null,
      })
      toast.success('Documento creato')
    }
    setDocFormOpen(false)
  }
  const handleDeleteDoc = async (id: string) => {
    if (!confirm('Eliminare questo documento?')) return
    await removeDocumento(id)
    toast.success('Documento eliminato')
  }

  const handleUpload = async () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !profile?.azienda_id) return
    setUploading(true)
    try {
      const result = await uploadDocumento(file)
      toast.success('File caricato')
      await fetchDocumenti(profile.azienda_id)
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = ''
      console.log('Upload result:', result)
    } catch (err: any) {
      toast.error(err.message ?? 'Errore upload')
    } finally {
      setUploading(false)
    }
  }

  const tabs = [
    { key: 'contratti', label: 'Contratti', icon: FileText },
    { key: 'normative', label: 'Normative', icon: Scale },
  ]

  return (
    <AgentPanel title="Legal" color="#D32F2F" tabs={tabs} activeTab={tab} onTabChange={setTab} onClose={onClose}>
      <div className="flex items-center gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text3" />
          <input
            type="text"
            placeholder="Cerca documenti..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-bg2 border border-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
          />
        </div>
        <Button size="sm" variant="primary" onClick={openCreateDoc}>
          <Plus size={13} />
        </Button>
        <Button size="sm" onClick={handleUpload} disabled={uploading}>
          <Upload size={13} />
        </Button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileChange} />
      </div>

      <div className="space-y-0.5">
        {currentDocs.slice(0, 25).map((doc) => (
          <div
            key={doc.id}
            onClick={() => openEditDoc(doc)}
            className="bg-bg2 border border-border rounded-lg px-2.5 py-2 hover:border-gold/20 transition-colors cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-0.5">
              <p className="text-xs font-medium text-text truncate flex-1 mr-2">{doc.nome}</p>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge color={categoriaColors[doc.categoria] ?? 'gray'}>{doc.categoria}</Badge>
                {doc.file_url && (
                  <a
                    href={doc.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1 rounded text-text3 hover:text-gold transition-colors"
                    title="Apri documento"
                  >
                    <ExternalLink size={12} />
                  </a>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteDoc(doc.id) }}
                  className="p-0.5 rounded text-text3 hover:text-red opacity-0 group-hover:opacity-100 transition-all"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-text3">
              <span>{doc.tipo_file}</span>
              <span>{formatSize(doc.file_size)}</span>
              <span>{formatDate(doc.created_at)}</span>
              {doc.tags && doc.tags.length > 0 && (
                <span className="truncate">{doc.tags.slice(0, 3).join(', ')}</span>
              )}
            </div>
            {doc.descrizione && (
              <p className="text-[10px] text-text3 mt-0.5 truncate">{doc.descrizione}</p>
            )}
          </div>
        ))}
        {currentDocs.length === 0 && (
          <p className="text-xs text-text3 text-center py-6">
            Nessun documento {tab === 'contratti' ? 'contrattuale' : 'normativo'} trovato
          </p>
        )}
      </div>

      {/* Document Modal */}
      <Modal open={docFormOpen} onClose={() => setDocFormOpen(false)} title={editDoc ? 'Modifica Documento' : 'Nuovo Documento'}>
        <form onSubmit={handleSaveDoc} className="space-y-3">
          <Input label="Nome" required value={docForm.nome} onChange={(e) => setDocForm((f) => ({ ...f, nome: e.target.value }))} />
          <Select label="Categoria" options={CATEGORIA_OPTIONS} value={docForm.categoria} onChange={(e) => setDocForm((f) => ({ ...f, categoria: e.target.value as DocumentoCategoria }))} />
          <Textarea label="Descrizione" value={docForm.descrizione} onChange={(e) => setDocForm((f) => ({ ...f, descrizione: e.target.value }))} />
          <Input label="Tags (separati da virgola)" value={docForm.tags} onChange={(e) => setDocForm((f) => ({ ...f, tags: e.target.value }))} />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setDocFormOpen(false)}>Annulla</Button>
            <Button type="submit" variant="primary">Salva</Button>
          </div>
        </form>
      </Modal>
    </AgentPanel>
  )
}
