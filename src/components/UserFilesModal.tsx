import { useState, useEffect, useCallback } from 'react'
import {
  FileText,
  Image,
  File,
  Eye,
  Trash2,
  FolderOpen,
  FileInput,
  ChevronDown,
  ChevronRight,
  Loader2,
  ArrowLeft,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import { getAuthToken } from '../lib/supabase'

interface UserFile {
  name: string
  path: string
  url: string
  size: number
  type: string
  category: string
  createdAt: string
}

interface UserFilesModalProps {
  open: boolean
  onClose: () => void
}

const categoryLabels: Record<string, string> = {
  general: 'Generale',
  'fatture-passive': 'Fatture Passive',
  documenti: 'Documenti',
}

function getCategoryIcon(category: string) {
  if (category === 'fatture-passive') return FileInput
  return FolderOpen
}

function getFileIcon(type: string) {
  if (type === 'application/pdf') return FileText
  if (type.startsWith('image/')) return Image
  return File
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function UserFilesModal({ open, onClose }: UserFilesModalProps) {
  const [files, setFiles] = useState<UserFile[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const fetchFiles = useCallback(async () => {
    setLoading(true)
    try {
      const token = getAuthToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/files', { headers })
      if (!res.ok) throw new Error('Errore nel caricamento dei file')
      const data = await res.json()
      setFiles(data)
    } catch (err) {
      toast.error((err as Error).message || 'Errore nel caricamento dei file')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchFiles()
      setPreviewUrl(null)
    }
  }, [open, fetchFiles])

  const handleDelete = async (file: UserFile) => {
    if (!confirm(`Eliminare il file "${file.name}"?`)) return

    try {
      const token = getAuthToken()
      const headers: Record<string, string> = {}
      if (token) headers['Authorization'] = `Bearer ${token}`

      const res = await fetch(`/api/files/${file.path}`, {
        method: 'DELETE',
        headers,
      })

      if (!res.ok) throw new Error('Errore nella cancellazione')
      setFiles((prev) => prev.filter((f) => f.path !== file.path))
      toast.success('File eliminato')
    } catch (err) {
      toast.error((err as Error).message || 'Errore nella cancellazione')
    }
  }

  const handleView = (file: UserFile) => {
    if (file.type.startsWith('image/')) {
      const token = getAuthToken()
      const url = token ? `${file.url}` : file.url
      setPreviewUrl(url)
    } else {
      // Open in new tab (PDFs, etc.)
      window.open(file.url, '_blank')
    }
  }

  const toggleCategory = (cat: string) => {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  // Group files by category
  const grouped: Record<string, UserFile[]> = {}
  for (const f of files) {
    if (!grouped[f.category]) grouped[f.category] = []
    grouped[f.category].push(f)
  }

  const categoryOrder = ['general', 'fatture-passive', 'documenti']
  const sortedCategories = Object.keys(grouped).sort(
    (a, b) => (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a)) -
              (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b))
  )

  return (
    <Modal open={open} onClose={onClose} title="I miei file" className="max-w-3xl">
      {previewUrl ? (
        <div>
          <button
            onClick={() => setPreviewUrl(null)}
            className="flex items-center gap-1 text-sm text-text2 hover:text-text mb-3 transition-colors"
          >
            <ArrowLeft size={16} />
            Torna alla lista
          </button>
          <img
            src={previewUrl}
            alt="Anteprima"
            className="w-full rounded-lg border border-border"
          />
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-text3" />
        </div>
      ) : files.length === 0 ? (
        <div className="text-center py-12 text-text3">
          Nessun file caricato
        </div>
      ) : (
        <div className="space-y-4">
          {sortedCategories.map((cat) => {
            const catFiles = grouped[cat]
            const isCollapsed = collapsed[cat]
            const CatIcon = getCategoryIcon(cat)
            const label = categoryLabels[cat] || cat

            return (
              <div key={cat}>
                <button
                  onClick={() => toggleCategory(cat)}
                  className="flex items-center gap-2 w-full text-left py-1.5 text-text hover:text-gold transition-colors"
                >
                  {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                  <CatIcon size={18} />
                  <span className="font-medium text-sm">
                    {label} ({catFiles.length})
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="mt-1 space-y-1">
                    {catFiles.map((file) => {
                      const FileIcon = getFileIcon(file.type)
                      return (
                        <div
                          key={file.path}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-bg3 transition-colors group"
                        >
                          <FileIcon size={18} className="text-text3 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text truncate" title={file.name}>
                              {file.name}
                            </div>
                            <div className="text-xs text-text3">
                              {formatSize(file.size)} &middot; {formatDate(file.createdAt)}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => handleView(file)}
                              className="p-1.5 rounded-lg text-text3 hover:text-text hover:bg-bg2 transition-colors"
                              title="Visualizza"
                            >
                              <Eye size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(file)}
                              className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-red/10 transition-colors"
                              title="Elimina"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
