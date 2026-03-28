import { Download, FileText, Image, X } from 'lucide-react'
import Modal from '../../components/ui/Modal'
import Badge from '../../components/ui/Badge'
import Button from '../../components/ui/Button'
import type { Documento, DocumentoCategoria } from '../../types'

interface DocumentViewerProps {
  documento: Documento | null
  open: boolean
  onClose: () => void
}

const categoriaColors: Record<DocumentoCategoria, 'blue' | 'amber' | 'purple' | 'red' | 'gold' | 'green' | 'gray'> = {
  legale: 'blue',
  pubblicita: 'amber',
  documentazione_tecnica: 'purple',
  normative: 'red',
  atti: 'gold',
  contratti: 'green',
  altro: 'gray',
}

const categoriaLabels: Record<DocumentoCategoria, string> = {
  legale: 'Legale',
  pubblicita: 'Pubblicita',
  documentazione_tecnica: 'Documentazione Tecnica',
  normative: 'Normative',
  atti: 'Atti',
  contratti: 'Contratti',
  altro: 'Altro',
}

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

function isImage(tipoFile: string): boolean {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'png', 'jpg', 'jpeg', 'webp'].includes(
    tipoFile.toLowerCase()
  )
}

function isPdf(tipoFile: string): boolean {
  return ['application/pdf', 'pdf'].includes(tipoFile.toLowerCase())
}

export default function DocumentViewer({ documento, open, onClose }: DocumentViewerProps) {
  if (!documento) return null

  return (
    <Modal open={open} onClose={onClose} className="max-w-5xl">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left side: document preview */}
        <div className="flex-[7] min-w-0">
          <div className="rounded-lg bg-bg3 border border-border overflow-hidden flex items-center justify-center">
            {isPdf(documento.tipo_file) ? (
              <iframe
                src={documento.file_url}
                className="w-full h-[70vh]"
                title={documento.nome}
              />
            ) : isImage(documento.tipo_file) ? (
              <img
                src={documento.file_url}
                alt={documento.nome}
                className="max-w-full max-h-[70vh] object-contain"
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-text3 gap-3">
                <FileText size={48} className="text-text3/50" />
                <p className="text-sm">Anteprima non disponibile per questo tipo di file</p>
              </div>
            )}
          </div>
        </div>

        {/* Right side: metadata panel */}
        <div className="flex-[3] min-w-0 space-y-5">
          <div>
            <p className="text-xs text-text3 uppercase tracking-wider mb-1">Nome</p>
            <p className="text-text font-medium text-sm break-words">{documento.nome}</p>
          </div>

          <div>
            <p className="text-xs text-text3 uppercase tracking-wider mb-1">Categoria</p>
            <Badge color={categoriaColors[documento.categoria]}>
              {categoriaLabels[documento.categoria]}
            </Badge>
          </div>

          {documento.tags && documento.tags.length > 0 && (
            <div>
              <p className="text-xs text-text3 uppercase tracking-wider mb-1">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {documento.tags.map((tag) => (
                  <Badge key={tag} color="gray">{tag}</Badge>
                ))}
              </div>
            </div>
          )}

          {documento.descrizione && (
            <div>
              <p className="text-xs text-text3 uppercase tracking-wider mb-1">Descrizione</p>
              <p className="text-text2 text-sm">{documento.descrizione}</p>
            </div>
          )}

          <div>
            <p className="text-xs text-text3 uppercase tracking-wider mb-1">Data caricamento</p>
            <p className="text-text2 text-sm">{formatDate(documento.created_at)}</p>
          </div>

          <div>
            <p className="text-xs text-text3 uppercase tracking-wider mb-1">Dimensione</p>
            <p className="text-text2 text-sm">{formatFileSize(documento.file_size)}</p>
          </div>

          <div className="pt-2">
            <a href={documento.file_url} download>
              <Button variant="primary" className="w-full">
                <Download size={16} />
                Scarica
              </Button>
            </a>
          </div>
        </div>
      </div>
    </Modal>
  )
}
