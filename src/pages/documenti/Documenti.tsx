import { useState, useEffect, useMemo, useCallback, useRef, type FormEvent } from 'react'
import { Plus, Search, Filter, Trash2, Eye, FileText, Image, File, Upload, Sparkles, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore, useDocumentiStore } from '../../store'
import Table, { type Column } from '../../components/ui/Table'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import { Input, Select, Textarea } from '../../components/ui/Form'
import StatCard from '../../components/ui/StatCard'
import DocumentViewer from './DocumentViewer'
import { uploadDocumento } from '../../lib/upload'
import type { Documento, DocumentoCategoria } from '../../types'

const categoriaColors: Record<DocumentoCategoria, 'blue' | 'amber' | 'purple' | 'red' | 'gold' | 'green' | 'gray'> = {
  legale: 'blue',
  pubblicita: 'amber',
  documentazione_tecnica: 'purple',
  normative: 'red',
  atti: 'gold',
  contratti: 'green',
  altro: 'gray',
  amministrazione: 'blue',
  hr: 'purple',
}

const categoriaLabels: Record<DocumentoCategoria, string> = {
  legale: 'Legale',
  pubblicita: 'Pubblicita',
  documentazione_tecnica: 'Documentazione Tecnica',
  normative: 'Normative',
  atti: 'Atti',
  contratti: 'Contratti',
  altro: 'Altro',
  amministrazione: 'Amministrazione',
  hr: 'HR',
}

const categoriaOptions: { value: string; label: string }[] = [
  { value: '', label: 'Seleziona categoria...' },
  { value: 'legale', label: 'Legale' },
  { value: 'pubblicita', label: 'Pubblicita' },
  { value: 'documentazione_tecnica', label: 'Documentazione Tecnica' },
  { value: 'normative', label: 'Normative' },
  { value: 'atti', label: 'Atti' },
  { value: 'contratti', label: 'Contratti' },
  { value: 'altro', label: 'Altro' },
  { value: 'amministrazione', label: 'Amministrazione' },
  { value: 'hr', label: 'HR' },
]

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleDateString('it-IT')
}

function getFileIcon(tipoFile: string) {
  const t = tipoFile.toLowerCase()
  if (t.includes('pdf') || t === 'application/pdf') return FileText
  if (t.includes('image') || ['png', 'jpg', 'jpeg', 'webp'].includes(t)) return Image
  return File
}

interface UploadForm {
  nome: string
  categoria: DocumentoCategoria | ''
  tags: string
  descrizione: string
  fileUrl: string
  fileSize: number | null
  tipoFile: string
}

const emptyUploadForm: UploadForm = {
  nome: '',
  categoria: '',
  tags: '',
  descrizione: '',
  fileUrl: '',
  fileSize: null,
  tipoFile: '',
}

export default function Documenti() {
  const profile = useAuthStore((s) => s.profile)
  const user = useAuthStore((s) => s.user)
  const store = useDocumentiStore()
  const { documenti, searchResults, loading, searching, fetch: fetchDocumenti, create, remove, search: aiSearch, clearSearch } = store

  const [searchQuery, setSearchQuery] = useState('')
  const [aiMode, setAiMode] = useState(false)
  const [filterCategoria, setFilterCategoria] = useState<string>('tutte')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [form, setForm] = useState<UploadForm>(emptyUploadForm)
  const [viewerDoc, setViewerDoc] = useState<Documento | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (profile?.azienda_id) {
      fetchDocumenti(profile.azienda_id)
    }
  }, [profile?.azienda_id, fetchDocumenti])

  // Handle AI search with debounce
  useEffect(() => {
    if (!aiMode || !searchQuery.trim() || !profile?.azienda_id) {
      if (aiMode && !searchQuery.trim()) clearSearch()
      return
    }
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      aiSearch(searchQuery, profile!.azienda_id)
    }, 500)
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    }
  }, [searchQuery, aiMode, profile?.azienda_id, aiSearch, clearSearch])

  // Clear AI results when switching off AI mode
  useEffect(() => {
    if (!aiMode) clearSearch()
  }, [aiMode, clearSearch])

  const displayData = aiMode && searchResults ? searchResults : documenti

  const filtered = useMemo(() => {
    let result = displayData
    if (filterCategoria !== 'tutte') {
      result = result.filter((d) => d.categoria === filterCategoria)
    }
    if (!aiMode && searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (d) =>
          d.nome.toLowerCase().includes(q) ||
          (d.descrizione ?? '').toLowerCase().includes(q) ||
          (d.tags ?? []).some((t) => t.toLowerCase().includes(q))
      )
    }
    return result
  }, [displayData, filterCategoria, searchQuery, aiMode])

  const stats = useMemo(() => {
    const totale = documenti.length
    const byCat = documenti.reduce<Record<string, number>>((acc, d) => {
      acc[d.categoria] = (acc[d.categoria] || 0) + 1
      return acc
    }, {})
    // Get top 2 categories by count
    const sorted = Object.entries(byCat).sort((a, b) => b[1] - a[1])
    return { totale, top: sorted.slice(0, 2) }
  }, [documenti])

  const handleFileSelect = useCallback(async (file: globalThis.File) => {
    const accepted = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'text/plain']
    if (!accepted.includes(file.type) && !file.name.match(/\.(pdf|png|jpg|jpeg|txt)$/i)) {
      toast.error('Formato non supportato. Accettati: PDF, PNG, JPG, TXT')
      return
    }
    setAnalyzing(true)
    try {
      const result = await uploadDocumento(file)
      const data = result as {
        fileUrl?: string
        suggestedCategoria?: DocumentoCategoria
        suggestedTags?: string[]
        suggestedDescrizione?: string
        extractedText?: string
      }
      setForm({
        nome: file.name,
        categoria: data.suggestedCategoria || '',
        tags: (data.suggestedTags ?? []).join(', '),
        descrizione: data.suggestedDescrizione || '',
        fileUrl: data.fileUrl || '',
        fileSize: file.size,
        tipoFile: file.type || file.name.split('.').pop() || '',
      })
    } catch (err) {
      toast.error((err as Error).message || 'Errore durante il caricamento')
      setForm(emptyUploadForm)
    } finally {
      setAnalyzing(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const openUploadModal = () => {
    setForm(emptyUploadForm)
    setUploading(false)
    setAnalyzing(false)
    setUploadModalOpen(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!profile?.azienda_id) {
      toast.error('Errore: azienda non trovata')
      return
    }
    if (!form.fileUrl) {
      toast.error('Carica un file prima di salvare')
      return
    }
    if (!form.categoria) {
      toast.error('Seleziona una categoria')
      return
    }
    setUploading(true)
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    const payload = {
      azienda_id: profile.azienda_id,
      nome: form.nome || 'Documento senza nome',
      tipo_file: form.tipoFile,
      categoria: form.categoria as DocumentoCategoria,
      descrizione: form.descrizione || null,
      file_url: form.fileUrl,
      file_size: form.fileSize,
      tags: tags.length > 0 ? tags : null,
      contenuto_testo: null,
      uploaded_by: user?.id ?? null,
    }
    const created = await create(payload)
    if (created) {
      toast.success('Documento salvato')
      setUploadModalOpen(false)
    } else {
      toast.error('Errore nel salvataggio')
    }
    setUploading(false)
  }

  const handleDelete = async (doc: Documento) => {
    if (!confirm(`Eliminare il documento "${doc.nome}"?`)) return
    await remove(doc.id)
    toast.success('Documento eliminato')
  }

  const openViewer = (doc: Documento) => {
    setViewerDoc(doc)
    setViewerOpen(true)
  }

  const columns: Column<Documento>[] = [
    {
      key: 'nome',
      header: 'Nome',
      render: (doc) => {
        const Icon = getFileIcon(doc.tipo_file)
        return (
          <div className="flex items-center gap-2">
            <Icon size={16} className="text-text3 shrink-0" />
            <span className="font-medium truncate max-w-[200px]">{doc.nome}</span>
          </div>
        )
      },
    },
    {
      key: 'categoria',
      header: 'Categoria',
      render: (doc) => (
        <Badge color={categoriaColors[doc.categoria]}>
          {categoriaLabels[doc.categoria]}
        </Badge>
      ),
    },
    {
      key: 'tags',
      header: 'Tags',
      render: (doc) => (
        <div className="flex flex-wrap gap-1">
          {(doc.tags ?? []).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-bg4 text-text2 border border-border"
            >
              {tag}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'dimensione',
      header: 'Dimensione',
      render: (doc) => <span className="text-text2 text-sm">{formatFileSize(doc.file_size)}</span>,
    },
    {
      key: 'data',
      header: 'Data',
      render: (doc) => <span className="text-text2">{formatDate(doc.created_at)}</span>,
    },
    {
      key: 'azioni',
      header: '',
      render: (doc) => (
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); openViewer(doc) }}
            className="p-1.5 rounded-lg text-text3 hover:text-gold hover:bg-bg3 transition-colors"
            title="Visualizza"
          >
            <Eye size={15} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleDelete(doc) }}
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
        <h1 className="text-2xl font-display font-bold text-text">Documenti</h1>
        <Button variant="primary" onClick={openUploadModal}>
          <Plus size={16} />
          Carica Documento
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard icon={FileText} label="Totale Documenti" value={String(stats.totale)} />
        {stats.top.map(([cat, count]) => (
          <StatCard
            key={cat}
            icon={File}
            label={categoriaLabels[cat as DocumentoCategoria] || cat}
            value={String(count)}
          />
        ))}
        {stats.top.length < 2 && (
          <StatCard icon={File} label="Categorie" value="0" />
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 max-w-md">
          <div className="relative flex items-center">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input
              type="text"
              placeholder={aiMode ? 'Ricerca semantica AI...' : 'Cerca per nome, descrizione, tags...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-l-lg bg-bg3 border border-border text-text text-sm placeholder:text-text3 focus:outline-none focus:ring-1 focus:ring-gold/50 focus:border-gold/50 transition-colors"
            />
            <button
              onClick={() => setAiMode((v) => !v)}
              className={`px-3 py-2 rounded-r-lg border border-l-0 text-sm font-medium transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                aiMode
                  ? 'bg-gold/15 text-gold border-gold/25'
                  : 'bg-bg3 text-text3 border-border hover:text-text2'
              }`}
              title="Attiva/disattiva ricerca AI"
            >
              <Sparkles size={14} />
              Ricerca AI
            </button>
          </div>
          {searching && (
            <p className="text-xs text-gold mt-1 flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" />
              Ricerca in corso...
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-text3" />
          <Select
            value={filterCategoria}
            onChange={(e) => setFilterCategoria(e.target.value)}
            options={[
              { value: 'tutte', label: 'Tutte le categorie' },
              ...categoriaOptions.filter((o) => o.value !== ''),
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
          keyExtractor={(doc) => doc.id}
          emptyMessage="Nessun documento trovato."
          onRowClick={openViewer}
        />
      )}

      {/* Upload Modal */}
      <Modal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Carica Documento"
        className="max-w-lg"
      >
        {!form.fileUrl && !analyzing ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-10 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-gold/50 hover:bg-bg3/50 transition-colors"
          >
            <Upload size={32} className="text-text3" />
            <p className="text-text2 text-sm text-center">
              Trascina un file qui o clicca per selezionare
            </p>
            <p className="text-text3 text-xs">PDF, PNG, JPG, TXT</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleFileSelect(file)
              }}
            />
          </div>
        ) : analyzing ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 size={32} className="text-gold animate-spin" />
            <p className="text-text2 text-sm font-medium">Analisi AI in corso...</p>
            <p className="text-text3 text-xs">Categorizzazione e estrazione dati dal documento</p>
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">
            <Input
              label="Nome"
              value={form.nome}
              onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))}
              required
            />
            <Select
              label="Categoria"
              value={form.categoria}
              onChange={(e) => setForm((p) => ({ ...p, categoria: e.target.value as DocumentoCategoria }))}
              options={categoriaOptions}
            />
            <Input
              label="Tags (separati da virgola)"
              value={form.tags}
              onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
              placeholder="es. contratto, 2024, fornitore"
            />
            <Textarea
              label="Descrizione"
              value={form.descrizione}
              onChange={(e) => setForm((p) => ({ ...p, descrizione: e.target.value }))}
            />
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" onClick={() => setUploadModalOpen(false)}>Annulla</Button>
              <Button type="submit" variant="primary" disabled={uploading}>
                {uploading ? 'Salvataggio...' : 'Salva'}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Document Viewer */}
      <DocumentViewer
        documento={viewerDoc}
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
      />
    </div>
  )
}
