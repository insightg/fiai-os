import { useState } from 'react'
import { FileText, Image, File, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'
import { Input, Select, Textarea } from './ui/Form'

interface DocumentArchiveModalProps {
  open: boolean
  onClose: () => void
  fileUrl: string
  fileName: string
  fileSize: number
  suggestedCategoria: string
  suggestedTags: string[]
  suggestedDescrizione: string
  extractedText: string
  onConfirm: (data: {
    nome: string
    categoria: string
    tags: string[]
    descrizione: string
    contenuto_testo: string
  }) => Promise<void>
}

const categoriaOptions: { value: string; label: string }[] = [
  { value: 'legale', label: 'Legale' },
  { value: 'pubblicita', label: 'Pubblicita' },
  { value: 'documentazione_tecnica', label: 'Documentazione Tecnica' },
  { value: 'normative', label: 'Normative' },
  { value: 'atti', label: 'Atti' },
  { value: 'contratti', label: 'Contratti' },
  { value: 'amministrazione', label: 'Amministrazione' },
  { value: 'hr', label: 'HR' },
  { value: 'altro', label: 'Altro' },
]

const categoriaBadgeColors: Record<string, string> = {
  legale: 'bg-blue-500/20 text-blue-400',
  pubblicita: 'bg-amber-500/20 text-amber-400',
  documentazione_tecnica: 'bg-purple-500/20 text-purple-400',
  normative: 'bg-red-500/20 text-red-400',
  atti: 'bg-yellow-500/20 text-yellow-400',
  contratti: 'bg-green-500/20 text-green-400',
  amministrazione: 'bg-blue-500/20 text-blue-400',
  hr: 'bg-purple-500/20 text-purple-400',
  altro: 'bg-gray-500/20 text-gray-400',
}

function getFileIcon(fileName: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return <Image size={20} className="text-amber-400" />
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return <FileText size={20} className="text-gold" />
  return <File size={20} className="text-text3" />
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getNameWithoutExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot > 0 ? fileName.substring(0, lastDot) : fileName
}

export default function DocumentArchiveModal({
  open,
  onClose,
  // fileUrl is used by the parent's onConfirm callback
  fileUrl: _,
  fileName,
  fileSize,
  suggestedCategoria,
  suggestedTags,
  suggestedDescrizione,
  extractedText,
  onConfirm,
}: DocumentArchiveModalProps) {
  const [nome, setNome] = useState(getNameWithoutExtension(fileName))
  const [categoria, setCategoria] = useState(suggestedCategoria || 'altro')
  const [tagsInput, setTagsInput] = useState(suggestedTags.join(', '))
  const [descrizione, setDescrizione] = useState(suggestedDescrizione)
  const [saving, setSaving] = useState(false)
  const [textExpanded, setTextExpanded] = useState(false)

  const handleConfirm = async () => {
    if (!nome.trim()) {
      toast.error('Inserisci un nome per il documento')
      return
    }
    setSaving(true)
    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      await onConfirm({
        nome: nome.trim(),
        categoria,
        tags,
        descrizione: descrizione.trim(),
        contenuto_testo: extractedText,
      })
      toast.success('Documento archiviato con successo')
      onClose()
    } catch {
      toast.error('Errore durante l\'archiviazione')
    } finally {
      setSaving(false)
    }
  }

  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const badgeColor = categoriaBadgeColors[categoria] || categoriaBadgeColors.altro

  return (
    <Modal open={open} onClose={onClose} title="Archivia Documento" className="max-w-lg">
      <div className="space-y-4">
        {/* File info */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-bg3 border border-border">
          {getFileIcon(fileName)}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-text font-medium truncate">{fileName}</p>
            <p className="text-xs text-text3">
              {formatFileSize(fileSize)} &middot; {ext.toUpperCase()}
            </p>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badgeColor}`}>
            {categoriaOptions.find((o) => o.value === categoria)?.label || categoria}
          </span>
        </div>

        {/* Form */}
        <Input
          label="Nome"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome del documento"
          required
        />

        <Select
          label="Categoria"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          options={categoriaOptions}
        />

        <Input
          label="Tags"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          placeholder="tag1, tag2, tag3"
        />

        <Textarea
          label="Descrizione"
          value={descrizione}
          onChange={(e) => setDescrizione(e.target.value)}
          placeholder="Breve descrizione del documento"
          rows={2}
        />

        {/* Extracted text preview */}
        {extractedText && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-text2">Testo estratto</label>
              <button
                type="button"
                onClick={() => setTextExpanded(!textExpanded)}
                className="flex items-center gap-1 text-xs text-text3 hover:text-text transition-colors"
              >
                {textExpanded ? (
                  <>Comprimi <ChevronUp size={12} /></>
                ) : (
                  <>Espandi <ChevronDown size={12} /></>
                )}
              </button>
            </div>
            <div className="p-3 rounded-lg bg-bg3 border border-border max-h-32 overflow-y-auto text-xs text-text3 whitespace-pre-wrap">
              {textExpanded ? extractedText : extractedText.substring(0, 300)}
              {!textExpanded && extractedText.length > 300 && '...'}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" onClick={onClose}>
            Salta
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={saving}>
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Archiviazione...
              </>
            ) : (
              'Archivia'
            )}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
